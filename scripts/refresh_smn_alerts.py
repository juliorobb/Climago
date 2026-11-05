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
FEEDS = [
    ("alertas", ROOT + "/feeds/CAP/rss_alertaCAP_nuevo.xml"),
    ("corto_plazo", ROOT + "/feeds/CAP/avisocortoplazo/rss_acpCAP.xml"),
]
INDEX_URL = ROOT + "/CAP/AR.php"
OUTPUT = "data/smn-alerts.json"
MAX_DOCUMENTS = 6
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
    candidates.extend(re.findall(rb"""https?://[^\s\"'<>]+?\.xml(?:\?[^\s\"'<>]*)?""", payload.decode("utf-8", "replace"), re.I))
    out = []
    for raw in candidates:
        url = valid_cap_url(str(raw), INDEX_URL)
        if url:
            out.append(url)
    return out


def cap_record(payload, url, stamp):
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise ValueError("XML CAP inválido: " + str(error))
    info_nodes = children(root, "info")
    if not info_nodes:
        raise ValueError("El documento no contiene bloques CAP <info>.")
    info = next((n for n in info_nodes if first_text(n, "language").lower().startswith("es")), info_nodes[0])
    areas = []
    for area in children(info, "area"):
        area_name = first_text(area, "areadesc")
        if area_name and area_name not in areas:
            areas.append(area_name)
    identifier = first_text(root, "identifier")
    if not identifier:
        raise ValueError("Documento CAP sin identifier.")
    record = {
        "identifier": identifier,
        "sender": first_text(root, "sender"),
        "sent": first_text(root, "sent"),
        "messageType": first_text(root, "msgtype"),
        "status": first_text(root, "status"),
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
        "areas": areas,
        "url": url,
        "source": "Servicio Meteorológico Nacional · CAP",
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


def load_previous():
    try:
        with open(OUTPUT, "r", encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def main():
    stamp = now_utc()
    previous = load_previous()
    previous_alerts = previous.get("alerts", []) if isinstance(previous.get("alerts"), list) else []
    feed_status = []
    discovered = []
    feed_failures = []

    for feed_name, feed_url in FEEDS:
        try:
            status, content_type, body = request_text(feed_url, "application/rss+xml, application/xml, text/xml, */*")
            links = rss_links(body, feed_url)
            discovered.extend(links)
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
        discovered.extend(index_urls)
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

    unique_urls = list(dict.fromkeys(discovered))
    selected_urls = unique_urls[:MAX_DOCUMENTS]
    truncated = len(unique_urls) > len(selected_urls)
    parsed_records = []
    failures = []
    for index, url in enumerate(selected_urls):
        if index:
            time.sleep(1.0)
        try:
            status, content_type, body = request_text(url, "application/cap+xml, application/xml, text/xml, */*")
            parsed_records.append(cap_record(body, url, stamp))
        except urllib.error.HTTPError as error:
            failures.append({"url": url, "error": f"HTTP {error.code}"})
            if error.code == 429:
                break
        except Exception as error:
            failures.append({"url": url, "error": str(error)[:240]})

    # Keep recently seen notices after they disappear from the source index.
    # The old MVP RSS format is kept only as unverified legacy history, never as a confirmed live warning.
    current_keys = {item["identifier"] for item in parsed_records}
    retained = []
    cutoff = stamp - timedelta(hours=HISTORY_HOURS)
    for old in previous_alerts:
        if not isinstance(old, dict):
            continue
        identifier = old.get("identifier")
        last_seen = parse_time(old.get("lastSeen") or previous.get("generatedAt"))
        if identifier and identifier in current_keys:
            continue
        if last_seen and last_seen < cutoff:
            continue
        if identifier:
            expiry = parse_time(old.get("expires"))
            status = str(old.get("status", "")).lower()
            msg_type = str(old.get("messageType", "")).lower()
            if status == "cancel" or msg_type == "cancel":
                old["state"] = "cancelled"
            elif expiry and expiry < stamp:
                old["state"] = "expired"
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

    merged = {item.get("identifier") or item.get("url") or item.get("headline"): item for item in retained}
    for item in parsed_records:
        merged[item["identifier"]] = item
    all_alerts = list(merged.values())
    order = {"active": 0, "scheduled": 1, "unconfirmed": 2, "expired": 3, "cancelled": 4, "not_currently_listed": 5}
    all_alerts.sort(key=lambda item: (order.get(item.get("state"), 9), item.get("sent") or ""), reverse=False)

    downloaded = len(parsed_records)
    complete = (
        not feed_failures and bool(unique_urls) and not truncated
        and downloaded == len(selected_urls) and not failures
    )
    if any(item.get("error", "").startswith("HTTP 429") for item in failures):
        complete = False
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
            "truncated": truncated,
            "feedSources": feed_status,
            "feedErrors": feed_failures,
            "documentErrors": failures[:10],
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
    print("Complete:", complete, "| retained:", len(retained), "| status:", state)
    if feed_failures or failures:
        print("Warnings:", json.dumps({"feeds": feed_failures, "documents": failures}, ensure_ascii=False))


if __name__ == "__main__":
    main()
