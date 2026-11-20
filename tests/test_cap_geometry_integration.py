import datetime
import importlib.util
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "refresh_smn_alerts.py"
SPEC = importlib.util.spec_from_file_location("refresh_smn_alerts", MODULE_PATH)
smn = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smn)


class CapGeometryIntegrationTests(unittest.TestCase):
    def test_polygon_converts_cap_lat_lon_to_geojson_lon_lat_and_closes_ring(self):
        ring = smn.parse_polygon("-31.40,-64.20 -31.40,-64.10 -31.50,-64.10 -31.50,-64.20")
        self.assertEqual(ring[0], [-64.2, -31.4])
        self.assertEqual(ring[0], ring[-1])
        self.assertEqual(len(ring), 5)

    def test_invalid_or_partial_polygon_is_rejected(self):
        self.assertEqual(smn.parse_polygon("not coordinates"), [])
        self.assertEqual(smn.parse_polygon("-31.4,-64.2 invalid -31.5,-64.1"), [])
        self.assertEqual(smn.parse_polygon("-31.4,-64.2 91,0 -31.5,-64.1"), [])

    def test_circle_parses_center_and_radius_and_rejects_invalid_values(self):
        self.assertEqual(
            smn.parse_circle("-31.4167,-64.1833 25"),
            {"lat": -31.4167, "lon": -64.1833, "radiusKm": 25.0},
        )
        self.assertIsNone(smn.parse_circle("91,0 10"))
        self.assertIsNone(smn.parse_circle("-31,-64 0"))

    def test_cap_area_preserves_description_geometry_and_geocodes(self):
        import xml.etree.ElementTree as ET
        area = ET.fromstring("""<area>
          <areaDesc>Córdoba</areaDesc>
          <polygon>-31.40,-64.20 -31.40,-64.10 -31.50,-64.10 -31.50,-64.20</polygon>
          <circle>-31.4167,-64.1833 15</circle>
          <geocode><valueName>Departamento</valueName><value>001</value></geocode>
        </area>""")
        parsed = smn.cap_area(area)
        self.assertEqual(parsed["description"], "Córdoba")
        self.assertEqual(len(parsed["polygons"]), 1)
        self.assertEqual(len(parsed["circles"]), 1)
        self.assertEqual(parsed["geocodes"][0]["value"], "001")

    def test_cap_record_keeps_multiple_info_blocks_and_official_metadata(self):
        xml = """<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
          <identifier>test-123</identifier><sender>smn@smn.gob.ar</sender>
          <sent>2026-11-16T08:00:00-03:00</sent><status>Actual</status>
          <msgType>Alert</msgType><scope>Public</scope>
          <references>smn@smn.gob.ar,old-123,2026-11-16T07:00:00-03:00</references>
          <info><language>es-AR</language><event>Tormentas</event>
            <headline>Alerta de prueba</headline><severity>Severe</severity>
            <parameter><valueName>SAT_COLOR</valueName><value>Naranja</value></parameter>
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
        self.assertEqual(record["scope"], "Public")
        self.assertEqual(record["referencedIdentifiers"], ["old-123"])
        self.assertEqual(record["parameters"], [{"name": "SAT_COLOR", "value": "Naranja"}])
        self.assertEqual(len(record["infoBlocks"]), 2)
        self.assertEqual(record["areas"][0]["description"], "Córdoba")
        self.assertEqual(len(record["areas"][0]["polygons"]), 1)
        self.assertEqual(len(record["areas"][0]["circles"]), 1)
        self.assertEqual(record["areas"][0]["geocodes"][0]["value"], "001")

    def test_cap_cancellation_without_info_block_is_preserved(self):
        xml = """<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
          <identifier>cancel-1</identifier><sender>smn@smn.gob.ar</sender>
          <sent>2026-11-16T08:00:00Z</sent><status>Actual</status>
          <msgType>Cancel</msgType><scope>Public</scope>
          <references>smn@smn.gob.ar,old-123,2026-11-16T07:00:00Z</references>
        </alert>""".encode("utf-8")
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        record = smn.cap_record(xml, "https://ssl.smn.gob.ar/cancel.xml", stamp)
        self.assertEqual(record["state"], "cancelled")
        self.assertEqual(record["areas"], [])

    def test_cap_cancel_message_cancels_previously_active_alert(self):
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        old = {
            "identifier": "old-123", "url": "https://ssl.smn.gob.ar/old.xml",
            "lastSeen": "2026-11-16T11:00:00Z", "expires": "2026-11-16T18:00:00Z",
            "status": "Actual", "scope": "Public", "messageType": "Alert", "state": "active",
        }
        cancel = {
            "identifier": "cancel-123", "url": "https://ssl.smn.gob.ar/cancel.xml",
            "lastSeen": "2026-11-16T12:00:00Z", "messageType": "Cancel",
            "referencedIdentifiers": ["old-123"], "state": "cancelled",
        }
        result = smn.reconcile_alerts([old], [cancel], {old["url"], cancel["url"]}, stamp)
        previous = next(item for item in result if item.get("identifier") == "old-123")
        self.assertEqual(previous["state"], "cancelled")
        self.assertEqual(previous["cancelledBy"], "cancel-123")

    def test_cap_update_replaces_referenced_previous_alert(self):
        stamp = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
        old = {
            "identifier": "old-123", "url": "https://ssl.smn.gob.ar/old.xml",
            "lastSeen": "2026-11-16T11:00:00Z", "expires": "2026-11-16T18:00:00Z",
            "status": "Actual", "scope": "Public", "messageType": "Alert", "state": "active",
        }
        update = {
            "identifier": "update-123", "url": "https://ssl.smn.gob.ar/update.xml",
            "lastSeen": "2026-11-16T12:00:00Z", "messageType": "Update",
            "referencedIdentifiers": ["old-123"], "state": "active",
        }
        result = smn.reconcile_alerts([old], [update], {old["url"], update["url"]}, stamp)
        identifiers = {item.get("identifier") for item in result}
        self.assertNotIn("old-123", identifiers)
        self.assertIn("update-123", identifiers)


if __name__ == "__main__":
    unittest.main()
