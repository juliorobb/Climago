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

    def test_polygon_rejects_partial_or_out_of_range_coordinates(self):
        self.assertEqual(smn.parse_polygon("-31.4,-64.2 invalid -31.5,-64.1"), [])
        self.assertEqual(smn.parse_polygon("-31.4,-64.2 91,0 -31.5,-64.1"), [])
        self.assertEqual(smn.parse_polygon("-31.4,-64.2 -31.4,-64.2 -31.4,-64.2"), [])

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

    def test_429_is_not_retried(self):
        rate_limited = urllib.error.HTTPError(
            "https://ssl.smn.gob.ar/test.xml", 429, "Too Many Requests",
            {"Retry-After": "30"}, None
        )
        with patch.object(smn, "request_text", side_effect=rate_limited) as request, patch.object(smn.time, "sleep") as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                smn.fetch_cap_document("https://ssl.smn.gob.ar/test.xml")
        self.assertEqual(request.call_count, 1)
        sleep.assert_not_called()

    def test_catalog_download_stops_after_first_429_and_keeps_prior_records(self):
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        urls = [
            "https://ssl.smn.gob.ar/one.xml",
            "https://ssl.smn.gob.ar/two.xml",
            "https://ssl.smn.gob.ar/three.xml",
        ]
        record = {"identifier": "alert-1", "url": urls[0], "headline": "Aviso", "state": "active"}
        limited = urllib.error.HTTPError(urls[1], 429, "Too Many Requests", {}, None)
        with patch.object(smn, "fetch_cap_document", side_effect=[
            (200, "application/xml", b"<unused/>"), limited
        ]) as fetch, patch.object(smn, "cap_record", return_value=record), patch.object(smn.time, "sleep"):
            parsed, failures = smn.download_cap_catalog(urls, stamp)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["identifier"], "alert-1")
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["error"], "HTTP 429")
        self.assertEqual(failures[0]["attempts"], 1)
        self.assertEqual(fetch.call_count, 2)

    def test_cancel_in_same_batch_marks_referenced_alert_cancelled(self):
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        alert = {"identifier": "alert-123", "url": "https://ssl.smn.gob.ar/alert.xml",
            "messageType": "Alert", "state": "active", "headline": "Tormentas"}
        cancel = {"identifier": "cancel-456", "url": "https://ssl.smn.gob.ar/cancel.xml",
            "messageType": "Cancel", "referencedIdentifiers": ["alert-123"], "state": "cancelled"}
        result = smn.reconcile_alerts([], [alert, cancel], set(), stamp)
        old = next(item for item in result if item.get("identifier") == "alert-123")
        self.assertEqual(old["state"], "cancelled")
        self.assertEqual(old["cancelledBy"], "cancel-456")

    def test_update_in_same_batch_removes_referenced_old_alert(self):
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        alert = {"identifier": "alert-123", "url": "https://ssl.smn.gob.ar/alert.xml",
            "messageType": "Alert", "state": "active"}
        update = {"identifier": "update-789", "url": "https://ssl.smn.gob.ar/update.xml",
            "messageType": "Update", "referencedIdentifiers": ["alert-123"], "state": "active"}
        result = smn.reconcile_alerts([], [alert, update], set(), stamp)
        ids = [item.get("identifier") for item in result]
        self.assertNotIn("alert-123", ids)
        self.assertIn("update-789", ids)

    def test_cancelled_history_stays_cancelled_after_cancel_document_disappears(self):
        stamp = datetime.datetime(2026, 11, 16, 13, 0, tzinfo=datetime.timezone.utc)
        previous = [{"identifier": "alert-123", "url": "https://ssl.smn.gob.ar/alert.xml",
            "messageType": "Alert", "state": "cancelled", "expires": "2026-11-16T18:00:00Z",
            "lastSeen": "2026-11-16T12:00:00Z", "cancelledBy": "cancel-456"}]
        result = smn.reconcile_alerts(previous, [], {"https://ssl.smn.gob.ar/alert.xml"}, stamp)
        self.assertEqual(result[0]["state"], "cancelled")
        self.assertEqual(result[0]["cancelledBy"], "cancel-456")

    def test_cancelled_previous_alert_is_not_reactivated_if_old_xml_remains_in_feed(self):
        stamp = datetime.datetime(2026, 11, 16, 14, 0, tzinfo=datetime.timezone.utc)
        previous = [{"identifier": "alert-123", "url": "https://ssl.smn.gob.ar/alert.xml",
            "messageType": "Alert", "state": "cancelled", "lastSeen": "2026-11-16T13:00:00Z",
            "cancelledBy": "cancel-456"}]
        still_listed = {"identifier": "alert-123", "url": "https://ssl.smn.gob.ar/alert.xml",
            "messageType": "Alert", "state": "active", "headline": "Versión anterior"}
        result = smn.reconcile_alerts(previous, [still_listed], {"https://ssl.smn.gob.ar/alert.xml"}, stamp)
        self.assertEqual(result[0]["state"], "cancelled")
        self.assertEqual(result[0]["cancelledBy"], "cancel-456")


    def test_catalog_batch_is_bounded_and_rotates(self):
        urls = [f"https://ssl.smn.gob.ar/{i}.xml" for i in range(25)]
        first, cursor, truncated = smn.select_catalog_batch(urls, {}, 12)
        self.assertEqual(len(first), 12)
        self.assertEqual(cursor, 0)
        self.assertTrue(truncated)
        second, next_cursor, _ = smn.select_catalog_batch(urls, {"nextCursor": 12}, 12)
        self.assertEqual(second[0], urls[12])
        self.assertEqual(next_cursor, 12)
        third, _, _ = smn.select_catalog_batch(urls, {"nextCursor": 24}, 12)
        self.assertEqual(third[0], urls[24])
        self.assertEqual(third[1], urls[0])

    def test_catalog_batch_resumes_from_last_successful_position(self):
        urls = [f"https://ssl.smn.gob.ar/{i}.xml" for i in range(20)]
        selected, cursor, _ = smn.select_catalog_batch(urls, {"nextCursor": 5}, 12)
        self.assertEqual(cursor, 5)
        self.assertEqual(selected[0], urls[5])
        self.assertEqual(selected[-1], urls[16])


    def test_cursor_advances_past_a_first_document_rate_limit(self):
        self.assertEqual(smn.next_catalog_cursor(0, 1, 110), 1)

    def test_cursor_advances_by_all_attempts_not_only_successes(self):
        self.assertEqual(smn.next_catalog_cursor(10, 12, 110), 22)

    def test_cursor_wraps_at_catalog_end(self):
        self.assertEqual(smn.next_catalog_cursor(108, 4, 110), 2)

    def test_empty_catalog_has_no_batch(self):
        self.assertEqual(smn.select_catalog_batch([], {}, 12), ([], 0, False))


if __name__ == "__main__":
    unittest.main()
