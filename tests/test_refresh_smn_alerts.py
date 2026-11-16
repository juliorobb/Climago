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
