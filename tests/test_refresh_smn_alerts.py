import datetime
import importlib.util
import pathlib
import urllib.error
import unittest
from unittest.mock import patch

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "refresh_smn_alerts.py"
SPEC = importlib.util.spec_from_file_location("refresh_smn_alerts", MODULE_PATH)
smn = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smn)


class CapGeometryTests(unittest.TestCase):
    def test_polygon_converts_cap_lat_lon_to_geojson_lon_lat(self):
        ring = smn.parse_polygon("-31.40,-64.20 -31.40,-64.10 -31.50,-64.10 -31.50,-64.20")
        self.assertEqual(ring[0], [-64.2, -31.4])
        self.assertEqual(ring[0], ring[-1])
        self.assertEqual(len(ring), 5)

    def test_invalid_polygon_is_rejected(self):
        self.assertEqual(smn.parse_polygon("not coordinates"), [])

    def test_circle_parses_center_and_radius(self):
        self.assertEqual(
            smn.parse_circle("-31.4167,-64.1833 25"),
            {"lat": -31.4167, "lon": -64.1833, "radiusKm": 25.0},
        )
        self.assertIsNone(smn.parse_circle("91,0 10"))

    def test_cap_record_preserves_areas_geometry_geocodes_and_info_blocks(self):
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
          <identifier>test-123</identifier><sender>smn@smn.gob.ar</sender>
          <sent>2026-11-16T08:00:00-03:00</sent><status>Actual</status>
          <msgType>Alert</msgType><scope>Public</scope>
          <info><language>es-AR</language><event>Tormentas</event>
            <headline>Alerta de prueba</headline><severity>Severe</severity>
            <urgency>Immediate</urgency><certainty>Observed</certainty>
            <expires>2026-11-16T12:00:00-03:00</expires>
            <area><areaDesc>Córdoba</areaDesc>
              <polygon>-31.40,-64.20 -31.40,-64.10 -31.50,-64.10 -31.50,-64.20</polygon>
              <circle>-31.4167,-64.1833 15</circle>
              <geocode><valueName>Departamento</valueName><value>001</value></geocode>
            </area>
          </info>
          <info><language>en-US</language><event>Storms</event><headline>Test alert</headline></info>
        </alert>""".encode("utf-8")
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        record = smn.cap_record(xml, "https://ssl.smn.gob.ar/test.xml", stamp)
        self.assertEqual(record["identifier"], "test-123")
        self.assertEqual(len(record["infoBlocks"]), 2)
        self.assertEqual(record["event"], "Tormentas")
        self.assertEqual(record["areas"][0]["description"], "Córdoba")
        self.assertEqual(len(record["areas"][0]["polygons"]), 1)
        self.assertEqual(len(record["areas"][0]["circles"]), 1)
        self.assertEqual(record["areas"][0]["geocodes"][0]["value"], "001")

    def test_cancel_message_without_info_is_parsed_and_links_previous_identifier(self):
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
          <identifier>cancel-456</identifier><sender>smn@smn.gob.ar</sender>
          <sent>2026-11-16T09:00:00-03:00</sent><status>Actual</status>
          <msgType>Cancel</msgType><scope>Public</scope>
          <references>smn@smn.gob.ar,alert-123,2026-11-16T08:00:00-03:00</references>
        </alert>""".encode("utf-8")
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        record = smn.cap_record(xml, "https://ssl.smn.gob.ar/cancel.xml", stamp)
        self.assertEqual(record["state"], "cancelled")
        self.assertEqual(record["referencedIdentifiers"], ["alert-123"])
        self.assertEqual(record["areas"], [])
        self.assertEqual(record["infoBlocks"], [])

    def test_referenced_identifiers_ignore_malformed_entries_and_deduplicate(self):
        values = [
            "smn@smn.gob.ar,alert-123,2026-11-16T08:00:00-03:00",
            "bad-reference",
            "smn@smn.gob.ar,alert-123,2026-11-16T08:00:00-03:00",
            "smn@smn.gob.ar,alert-456,2026-11-16T08:30:00-03:00",
        ]
        self.assertEqual(smn.referenced_identifiers(values), ["alert-123", "alert-456"])

    def test_update_message_extracts_referenced_alert_identifier(self):
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
          <identifier>update-789</identifier><sender>smn@smn.gob.ar</sender>
          <sent>2026-11-16T09:30:00-03:00</sent><status>Actual</status>
          <msgType>Update</msgType><scope>Public</scope>
          <references>smn@smn.gob.ar,alert-123,2026-11-16T08:00:00-03:00</references>
          <info><language>es-AR</language><event>Tormentas</event>
            <headline>Aviso actualizado</headline><expires>2026-11-16T14:00:00-03:00</expires></info>
        </alert>""".encode("utf-8")
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        record = smn.cap_record(xml, "https://ssl.smn.gob.ar/update.xml", stamp)
        self.assertEqual(record["messageType"], "Update")
        self.assertEqual(record["referencedIdentifiers"], ["alert-123"])
        self.assertEqual(smn.referenced_ids_for([record], "update"), {"alert-123"})

    def test_merge_keeps_one_record_per_identifier_and_prefers_new_parse(self):
        previous = [{"identifier": "alert-123", "headline": "Texto anterior"}]
        current = [
            {"identifier": "alert-123", "headline": "Texto actualizado"},
            {"identifier": "alert-456", "headline": "Otro aviso"},
            {"identifier": "alert-456", "headline": "Duplicado del mismo CAP"},
        ]
        merged = smn.merge_alert_records(previous, current)
        by_id = {item["identifier"]: item for item in merged}
        self.assertEqual(len(merged), 2)
        self.assertEqual(by_id["alert-123"]["headline"], "Texto actualizado")
        self.assertEqual(by_id["alert-456"]["headline"], "Duplicado del mismo CAP")

    def test_integrated_cancel_marks_previous_alert_cancelled_and_keeps_history(self):
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        previous = [{"identifier": "alert-123", "url": "https://ssl.smn.gob.ar/alert.xml",
            "messageType": "Alert", "status": "Actual", "expires": "2026-11-16T15:00:00Z",
            "lastSeen": "2026-11-16T11:00:00Z", "headline": "Tormentas"}]
        cancel = {"identifier": "cancel-456", "url": "https://ssl.smn.gob.ar/cancel.xml",
            "messageType": "Cancel", "referencedIdentifiers": ["alert-123"],
            "state": "cancelled", "sent": "2026-11-16T11:30:00Z"}
        result = smn.reconcile_alerts(previous, [cancel], set(), stamp)
        old = next(item for item in result if item.get("identifier") == "alert-123")
        self.assertEqual(old["state"], "cancelled")
        self.assertEqual(old["cancelledBy"], "cancel-456")
        self.assertIn("cancel-456", {item.get("identifier") for item in result})

    def test_integrated_update_replaces_previous_alert_without_duplicate_history(self):
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        previous = [{"identifier": "alert-123", "url": "https://ssl.smn.gob.ar/alert.xml",
            "messageType": "Alert", "lastSeen": "2026-11-16T11:00:00Z", "headline": "Texto anterior"}]
        update = {"identifier": "update-789", "url": "https://ssl.smn.gob.ar/update.xml",
            "messageType": "Update", "referencedIdentifiers": ["alert-123"],
            "state": "active", "headline": "Texto actualizado"}
        result = smn.reconcile_alerts(previous, [update], set(), stamp)
        ids = [item.get("identifier") for item in result]
        self.assertNotIn("alert-123", ids)
        self.assertEqual(ids.count("update-789"), 1)
        self.assertEqual(next(item for item in result if item.get("identifier") == "update-789")["headline"], "Texto actualizado")

    def test_integrated_duplicate_documents_keep_single_latest_record(self):
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        first = {"identifier": "alert-123", "url": "https://ssl.smn.gob.ar/alert.xml", "headline": "Primera versión", "state": "active"}
        duplicate = {"identifier": "alert-123", "url": "https://ssl.smn.gob.ar/alert.xml", "headline": "Última versión", "state": "active"}
        result = smn.reconcile_alerts([], [first, duplicate], set(), stamp)
        self.assertEqual(len([item for item in result if item.get("identifier") == "alert-123"]), 1)
        self.assertEqual(result[0]["headline"], "Última versión")

    def test_429_retries_then_continues_successfully(self):
        rate_limited = urllib.error.HTTPError(
            "https://ssl.smn.gob.ar/test.xml", 429, "Too Many Requests",
            {"Retry-After": "0"}, None
        )
        with patch.object(smn, "request_text", side_effect=[rate_limited, (200, "application/xml", b"<alert/>")]) as request, patch.object(smn.time, "sleep") as sleep:
            result = smn.fetch_cap_document("https://ssl.smn.gob.ar/test.xml")
        self.assertEqual(result[0], 200)
        self.assertEqual(request.call_count, 2)
        sleep.assert_called_once()

    def test_429_exhaustion_raises_for_current_document_only(self):
        rate_limited = urllib.error.HTTPError(
            "https://ssl.smn.gob.ar/test.xml", 429, "Too Many Requests",
            {"Retry-After": "0"}, None
        )
        with patch.object(smn, "request_text", side_effect=rate_limited) as request, patch.object(smn.time, "sleep"):
            with self.assertRaises(urllib.error.HTTPError):
                smn.fetch_cap_document("https://ssl.smn.gob.ar/test.xml")
        self.assertEqual(request.call_count, 4)


if __name__ == "__main__":
    unittest.main()
