#!/usr/bin/env python3
"""Fetch a conservative sample of official SMN CAP documents and retain short history."""
import html
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

ROOT = "https://ssl.smn.gob.ar"
# Feed ACP para avisos a muy corto plazo. Las alertas generales se toman
# del índice CAP vivo; el RSS general puede conservar enlaces archivados.
FEEDS = [
    ("corto_plazo", ROOT + "/feeds/CAP/avisocortoplazo/rss_acpCAP.xml"),
]
INDEX_URL = ROOT + "/CAP/AR.php"
OUTPUT = "data/smn-alerts.json"
MAX_DOCUMENTS = 12
REQUEST_DELAY_SECONDS = 1.25
HISTORY_HOURS = 48
USER_AGENT = "Mozilla/5.0 (compatible; ClimaGo/1.0; +https://github.com/juliorobb/Climago)"


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if dt else None


def local_name(tag):
    return tag.rsplit("}", 1)[-1].split(":")[-1].lower()


def first_text(element, name):
    if element is None:
        return ""
    for child in element.iter():
        if local_name(child.tag) == name.lower() and child is not element:
            return " ".join("".join(child.itertext()).split())
    return ""


def children(element, name):
    if element is None:
        return []
    return [child for child in element.iter() if local_name(child.tag) == name.lower() and child is not element]


def parse_time(value):
    if not value:
        return None
    candidate = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def request_text(url, accept):
    request = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": accept,
    })
    with urllib.request.urlopen(request, timeout=15) as response:
        status = response.status
        content_type = response.headers.get("Content-Type", "")
        body = response.read()
    return status, content_type, body


def fetch_cap_document(url):
    """Fetch one CAP document once; callers stop the catalog batch on HTTP 429."""
    return request_text(url, "application/cap+xml, application/xml, text/xml, */*")


def valid_cap_url(raw, base):
    if not raw:
        return None
    url = urllib.parse.urljoin(base, html.unescape(raw.strip()))
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or parsed.hostname != "ssl.smn.gob.ar":
        return None
    if not parsed.path.lower().endswith(".xml"):
        return None
    return urllib.parse.urlunparse(("https", parsed.netloc, parsed.path, "", parsed.query, ""))


def rss_links(payload, feed_url):
    links = []
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        return links
    for node in root.iter():
        if local_name(node.tag) in ("item", "entry"):
            for child in list(node):
                if local_name(child.tag) == "link":
                    value = child.attrib.get("href") or (child.text or "")
                    url = valid_cap_url(value, feed_url)
                    if url:
                        links.append(url)
    return links


class AnchorParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            for key, value in attrs:
                if key.lower() == "href" and value:
                    self.hrefs.append(value)


def index_links(payload):
    parser = AnchorParser()
    parser.feed(payload.decode("utf-8", "replace"))
    candidates = list(parser.hrefs)
    candidates.extend(re.findall(r"""https?://[^\s"'<>]+?\.xml(?:\?[^\s"'<>]*)?""", payload.decode("utf-8", "replace"), re.I))
    out = []
    for raw in candidates:
        url = valid_cap_url(str(raw), INDEX_URL)
        if url:
            out.append(url)
    return out


def parse_polygon(value):
    """Convert CAP 'lat,lon lat,lon ...' into GeoJSON-order [lon, lat] pairs."""
    points = []
    for pair in (value or "").strip().split():
        parts = pair.split(",")
        if len(parts) != 2:
            continue
        try:
            lat, lon = float(parts[0]), float(parts[1])
        except ValueError:
            continue
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            points.append([lon, lat])
    if len(points) < 3:
        return []
    if points[0] != points[-1]:
        points.append(points[0])
    return points


def parse_circle(value):
    parts = (value or "").strip().split()
    if len(parts) != 2:
        return None
    coords = parts[0].split(",")
    if len(coords) != 2:
        return None
    try:
        lat, lon, radius_km = float(coords[0]), float(coords[1]), float(parts[1])
    except ValueError:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180 and radius_km > 0):
        return None
    return {"lat": lat, "lon": lon, "radiusKm": radius_km}


def cap_area(area):
    description = first_text(area, "areadesc")
    polygons = [ring for node in children(area, "polygon")
                if (ring := parse_polygon("".join(node.itertext()))) ]
    circles = [circle for node in children(area, "circle")
               if (circle := parse_circle("".join(node.itertext()))) ]
    geocodes = []
    for node in children(area, "geocode"):
        name = first_text(node, "valuename")
        value = first_text(node, "value")
        if name or value:
            geocodes.append({"valueName": name, "value": value})
    result = {
        "description": description,
        "polygons": polygons,
        "circles": circles,
        "geocodes": geocodes,
    }
    return result


def referenced_identifiers(references):
    """Extract the identifier from CAP reference triples: sender,identifier,sent."""
    identifiers = []
    for reference in references or []:
        parts = str(reference).split(",")
        if len(parts) == 3 and parts[1].strip():
            identifiers.append(parts[1].strip())
    return list(dict.fromkeys(identifiers))


def referenced_ids_for(records, message_type):
    wanted = str(message_type or "").lower()
    return {
        identifier
        for item in records
        if str(item.get("messageType", "")).lower() == wanted
        for identifier in item.get("referencedIdentifiers", [])
    }


def merge_alert_records(retained, parsed_records):
    """Keep one current record per CAP identifier; the newest parsed record wins."""
    merged = {}
    for item in retained:
        key = item.get("identifier") or item.get("url") or item.get("headline")
        if key:
            merged[key] = item
    for item in parsed_records:
        key = item.get("identifier") or item.get("url") or item.get("headline")
        if key:
            merged[key] = item
    return list(merged.values())


def cap_record(payload, url, stamp):
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise ValueError("XML CAP inválido: " + str(error))
    info_nodes = children(root, "info")
    message_type = first_text(root, "msgtype")
    # CAP cancellation messages may legitimately contain no <info> block.
    if not info_nodes and message_type.lower() != "cancel":
        raise ValueError("El documento no contiene bloques CAP <info>.")
    preferred = next((n for n in info_nodes if first_text(n, "language").lower().startswith("es")), info_nodes[0] if info_nodes else None)
    areas = []
    for area in children(preferred, "area"):
        parsed = cap_area(area)
        if parsed not in areas:
            areas.append(parsed)
    identifier = first_text(root, "identifier")
    if not identifier:
        raise ValueError("Documento CAP sin identifier.")
    references = [v for v in (first_text(root, "references") or "").split() if v]
    record = {
        "identifier": identifier,
        "sender": first_text(root, "sender"),
        "sent": first_text(root, "sent"),
        "messageType": message_type,
        "status": first_text(root, "status"),
        "references": references,
        "referencedIdentifiers": referenced_identifiers(references),
        "scope": first_text(root, "scope"),
        "source": first_text(root, "source"),
        "event": first_text(preferred, "event"),
        "headline": first_text(preferred, "headline"),
        "description": first_text(preferred, "description"),
        "instruction": first_text(preferred, "instruction"),
        "severity": first_text(preferred, "severity"),
        "urgency": first_text(preferred, "urgency"),
        "certainty": first_text(preferred, "certainty"),
        "effective": first_text(preferred, "effective"),
        "onset": first_text(preferred, "onset"),
        "expires": first_text(preferred, "expires"),
        "areas": areas,
        "infoBlocks": [{
            "language": first_text(info, "language"),
            "event": first_text(info, "event"),
            "headline": first_text(info, "headline"),
            "description": first_text(info, "description"),
            "instruction": first_text(info, "instruction"),
            "severity": first_text(info, "severity"),
            "urgency": first_text(info, "urgency"),
            "certainty": first_text(info, "certainty"),
            "effective": first_text(info, "effective"),
            "onset": first_text(info, "onset"),
            "expires": first_text(info, "expires"),
        } for info in info_nodes],
        "url": url,
        "sourceLabel": "Servicio Meteorológico Nacional · CAP",
        "lastSeen": iso(stamp),
    }
    expiry = parse_time(record["expires"])
    effective = parse_time(record["effective"] or record["onset"])
    status = (record["status"] or "").lower()
    message_type = (record["messageType"] or "").lower()
    if status == "cancel" or message_type == "cancel":
        state = "cancelled"
    elif expiry and expiry < stamp:
        state = "expired"
    elif effective and effective > stamp:
        state = "scheduled"
    elif expiry and expiry >= stamp:
        state = "active"
    else:
        state = "unconfirmed"
    record["state"] = state
    return record


def select_catalog_batch(urls, previous_coverage, batch_size=MAX_DOCUMENTS):
    """Select a bounded rotating batch and resume after the last successful download."""
    if not urls:
        return [], 0, False
    try:
        cursor = int((previous_coverage or {}).get("nextCursor", 0) or 0) % len(urls)
    except (TypeError, ValueError):
        cursor = 0
    count = min(max(1, int(batch_size)), len(urls))
    selected = [urls[(cursor + offset) % len(urls)] for offset in range(count)]
    return selected, cursor, len(urls) > count


def download_cap_catalog(selected_urls, stamp):
    """Download CAP documents sequentially and stop immediately when SMN rate-limits."""
    parsed_records = []
    failures = []
    for index, url in enumerate(selected_urls):
        if index:
            time.sleep(REQUEST_DELAY_SECONDS)
        try:
            status, content_type, body = fetch_cap_document(url)
            parsed_records.append(cap_record(body, url, stamp))
        except urllib.error.HTTPError as error:
            failures.append({"url": url, "error": f"HTTP {error.code}", "attempts": 1})
            if error.code == 429:
                print("HTTP 429 del SMN: se detiene la descarga del catálogo para respetar el límite y conservar los documentos ya procesados.")
                break
        except Exception as error:
            failures.append({"url": url, "error": str(error)[:240], "attempts": 1})
    return parsed_records, failures


def load_previous():
    try:
        with open(OUTPUT, "r", encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def reconcile_alerts(previous_alerts, parsed_records, current_catalog_urls, stamp, previous_generated_at=""):
    """Reconcile CAP lifecycle messages, including messages found in one batch."""
    records = [dict(item) for item in parsed_records if isinstance(item, dict)]
    previously_cancelled = {
        item.get("identifier"): item.get("cancelledBy", "")
        for item in previous_alerts
        if isinstance(item, dict) and item.get("identifier") and item.get("state") == "cancelled"
    }
    cancelled_by = {}
    updated_identifiers = referenced_ids_for(records, "update")
    for item in records:
        if str(item.get("messageType", "")).lower() == "cancel":
            for identifier in item.get("referencedIdentifiers", []):
                cancelled_by[identifier] = item.get("identifier", "")
    reconciled_records = []
    for item in records:
        identifier = item.get("identifier")
        msg_type = str(item.get("messageType", "")).lower()
        if identifier in updated_identifiers and msg_type != "update":
            continue
        if identifier in cancelled_by or identifier in previously_cancelled:
            item["state"] = "cancelled"
            item["cancelledBy"] = cancelled_by.get(identifier) or previously_cancelled.get(identifier, "")
        reconciled_records.append(item)

    current_keys = {item.get("identifier") for item in reconciled_records}
    parsed_urls = {item.get("url") for item in reconciled_records}
    retained = []
    cutoff = stamp - timedelta(hours=HISTORY_HOURS)
    for original in previous_alerts:
        if not isinstance(original, dict):
            continue
        old = dict(original)
        identifier = old.get("identifier")
        old_url = old.get("url") or old.get("documentUrl") or ""
        last_seen = parse_time(old.get("lastSeen") or previous_generated_at)
        if identifier and identifier in current_keys:
            continue
        if identifier and identifier in updated_identifiers:
            continue
        if old_url and old_url in parsed_urls:
            continue
        if last_seen and last_seen < cutoff:
            continue
        if identifier:
            expiry = parse_time(old.get("expires"))
            effective = parse_time(old.get("effective") or old.get("onset"))
            status = str(old.get("status", "")).lower()
            msg_type = str(old.get("messageType", "")).lower()
            if old.get("state") == "cancelled" or identifier in cancelled_by or status == "cancel" or msg_type == "cancel":
                old["state"] = "cancelled"
                if identifier in cancelled_by:
                    old["cancelledBy"] = cancelled_by[identifier]
            elif expiry and expiry < stamp:
                old["state"] = "expired"
            elif old_url in current_catalog_urls:
                if effective and effective > stamp:
                    old["state"] = "scheduled"
                elif expiry:
                    old["state"] = "active"
                else:
                    old["state"] = "unconfirmed"
            elif expiry:
                old["state"] = "not_currently_listed"
            else:
                old["state"] = "unconfirmed"
            old["lastSeen"] = iso(last_seen or stamp)
        else:
            old = {
                "headline": old.get("title") or "Aviso CAP anterior (formato histórico)",
                "description": old.get("description") or "",
                "areas": old.get("areas") or [],
                "url": old.get("url") or "",
                "sent": old.get("sent") or "",
                "severity": old.get("severity") or "",
                "source": "Servicio Meteorológico Nacional · CAP (registro anterior sin vigencia verificable)",
                "state": "unconfirmed",
                "lastSeen": iso(last_seen or stamp),
            }
        retained.append(old)
    all_alerts = merge_alert_records(retained, reconciled_records)
    order = {"active": 0, "scheduled": 1, "unconfirmed": 2, "expired": 3, "cancelled": 4, "not_currently_listed": 5}
    all_alerts.sort(key=lambda item: (order.get(item.get("state"), 9), item.get("sent") or ""), reverse=False)
    return all_alerts

def main():
    stamp = now_utc()
    previous = load_previous()
    previous_alerts = previous.get("alerts", []) if isinstance(previous.get("alerts"), list) else []
    feed_status = []
    rss_discovered = []
    index_urls = []
    feed_failures = []

    for feed_name, feed_url in FEEDS:
        try:
            status, content_type, body = request_text(feed_url, "application/rss+xml, application/xml, text/xml, */*")
            links = rss_links(body, feed_url)
            rss_discovered.extend(links)
            feed_status.append({
                "name": feed_name, "httpStatus": status, "contentType": content_type,
                "linksFound": len(links), "ok": True,
            })
        except urllib.error.HTTPError as error:
            feed_failures.append(f"{feed_name}: HTTP {error.code}")
            feed_status.append({"name": feed_name, "httpStatus": error.code, "linksFound": 0, "ok": False})
        except Exception as error:
            feed_failures.append(f"{feed_name}: {error}")
            feed_status.append({"name": feed_name, "httpStatus": None, "linksFound": 0, "ok": False})

    try:
        status, content_type, body = request_text(INDEX_URL, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        index_urls = index_links(body)
        feed_status.append({
            "name": "indice_CAP_general", "httpStatus": status, "contentType": content_type,
            "linksFound": len(index_urls), "ok": True,
        })
    except urllib.error.HTTPError as error:
        feed_failures.append(f"indice_CAP_general: HTTP {error.code}")
        feed_status.append({"name": "indice_CAP_general", "httpStatus": error.code, "linksFound": 0, "ok": False})
    except Exception as error:
        feed_failures.append(f"indice_CAP_general: {error}")
        feed_status.append({"name": "indice_CAP_general", "httpStatus": None, "linksFound": 0, "ok": False})

    # Priorizar los avisos de corto plazo y rotar el catálogo general en lotes pequeños.
    unique_urls = list(dict.fromkeys(rss_discovered + index_urls))
    previous_coverage = previous.get("coverage", {}) if isinstance(previous.get("coverage"), dict) else {}
    selected_urls, start_cursor, truncated = select_catalog_batch(unique_urls, previous_coverage)
    parsed_records, failures = download_cap_catalog(selected_urls, stamp)
    successful_urls = {item.get("url") for item in parsed_records if item.get("url")}
    next_cursor = (start_cursor + len(successful_urls)) % len(unique_urls) if unique_urls else 0

    # Reconcile lifecycle messages and preserve relevant recent history.
    current_catalog_urls = set(unique_urls)
    all_alerts = reconcile_alerts(
        previous_alerts, parsed_records, current_catalog_urls, stamp,
        previous.get("generatedAt", "")
    )

    downloaded = len(parsed_records)
    # La cobertura solo es completa cuando todos los documentos del catálogo
    # fueron descargados y procesados correctamente en esta ejecución.
    # La cobertura se mide en una ventana móvil, porque el catálogo se consulta por lotes.
    freshness_cutoff = stamp - timedelta(hours=24)
    recently_seen_urls = {
        item.get("url") for item in all_alerts
        if item.get("url") and parse_time(item.get("lastSeen")) and parse_time(item.get("lastSeen")) >= freshness_cutoff
    }
    recently_seen_urls.update(item.get("url") for item in parsed_records if item.get("url"))
    catalog_fresh = bool(unique_urls) and all(url in recently_seen_urls for url in unique_urls)
    complete = (
        not feed_failures and catalog_fresh
        and downloaded == len(selected_urls) and not failures
    )
    state = "ok" if complete else ("partial" if downloaded else "unavailable")
    output = {
        "schemaVersion": 2,
        "source": "Servicio Meteorológico Nacional · CAP",
        "generatedAt": iso(stamp),
        "status": state,
        "coverage": {
            "complete": complete,
            "discovered": len(unique_urls),
            "selected": len(selected_urls),
            "downloaded": downloaded,
            "batchSize": MAX_DOCUMENTS,
            "truncated": truncated,
            "nextCursor": next_cursor,
            "freshWindowHours": 24,
            "catalogFresh": catalog_fresh,
            "feedSources": feed_status,
            "feedErrors": feed_failures,
            "documentErrors": failures[:20],
            "failedCount": len(failures),
            "rateLimited": any(item.get("error") == "HTTP 429" for item in failures),
            "unattemptedCount": max(0, len(unique_urls) - downloaded - len(failures)),
            "historyHours": HISTORY_HOURS,
        },
        "alerts": all_alerts,
        "note": (
            "Consulta completa de las fuentes consultadas." if complete else
            "Cobertura parcial o fuente inaccesible. Una lista vacía o incompleta no significa ausencia de riesgo."
        ),
    }
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as file:
        json.dump(output, file, ensure_ascii=False, indent=2)
        file.write("\n")
    print("SMN feeds:", json.dumps(feed_status, ensure_ascii=False))
    print("CAP links:", len(unique_urls), "| selected:", len(selected_urls), "| downloaded:", downloaded)
    print("Complete:", complete, "| total alerts:", len(all_alerts), "| status:", state)
    if feed_failures or failures:
        print("Warnings:", json.dumps({"feeds": feed_failures, "documents": failures}, ensure_ascii=False))


if __name__ == "__main__":
    main()
