"""Unit checks for the Python fixture's U36 directory and capability claims."""
import unittest
import peer
from business import Business, native_response
from reverse import ReverseCalls


class RuntimeBaseline(unittest.TestCase):
    """Assert installed behavior independently of upstream frozen protocol vectors."""

    def test_offered_baseline(self):
        self.assertTrue({"runtime-api@1", "batch@1"} <= set(peer.own_offer()["capabilities"]))

    def test_actual_v2_directory(self):
        value, error = Business(False).invoke("migaia.remote.runtime.describe", None)
        self.assertIsNone(error)
        self.assertEqual(set(value), {"schemaVersion", "self", "methods"})
        self.assertEqual(value["schemaVersion"], 2)
        self.assertEqual(value["self"]["instanceId"], "python-peer")
        self.assertTrue(any(m["name"] == "echo" and m["supportedModes"] == ["request", "notify"] for m in value["methods"]))

    def test_retired_describe_is_not_a_provider(self):
        value, error = Business(False).invoke("migaia.remote.describe", None)
        self.assertIsNone(value)
        self.assertIsNotNone(error)

    def test_reverse_mode_whitelist(self):
        calls = ReverseCalls("parent", native_response)
        calls.whitelist = calls.directory({"schemaVersion": 2, "self": {"name": "parent", "instanceId": "parent"},
            "methods": [{"name": "notifyOnly", "supportedModes": ["notify"], "modeSource": "declared"}]})
        message = {"kind": "request", "id": "unit-reverse", "method": "peer.reverse", "data": {
            "route": peer.route("request", "parent", "python-peer"), "payload": {"method": "notifyOnly"}}}
        self.assertEqual(calls.start(message)[0]["code"], "CAPABILITY_UNSUPPORTED")
        self.assertEqual(calls.pending, {})

    def test_reverse_close_releases_pending_once(self):
        calls = ReverseCalls("parent", native_response)
        message = {"kind": "request", "id": "unit-reverse", "method": "peer.reverse", "data": {
            "route": peer.route("request", "parent", "python-peer"), "payload": {"method": "parentEcho"}}}
        self.assertEqual(calls.start(message)[0]["method"], "migaia.remote.runtime.describe")
        self.assertEqual(calls.close()[0]["id"], "unit-reverse")
        self.assertEqual(calls.pending, {})
        self.assertIsNone(calls.whitelist)
        self.assertEqual(calls.close(), [])


if __name__ == "__main__":
    unittest.main()
