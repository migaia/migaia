"""Unit checks for the Python fixture's U36 directory and capability claims."""
import unittest
import io
import json
import peer
from business import Business, native_response, serve, bridge_write, bridge_read
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

    def test_fault_providers_remain_in_the_actual_registry(self):
        business = Business(False)
        names = {method["name"] for method in business.description()["methods"]}
        for name in ("peer.pause", "peer.busy", "peer.crash"):
            self.assertIn(name, names)
            self.assertIn(name, business.providers)

    def test_bridge_v2_batch_and_notification_share_business_state(self):
        """Real Content-Length input retains v2 admission and ordered batch side effects."""
        reader, writer = io.BytesIO(), io.BytesIO()
        hello = {**peer.own_offer("parent"), "auth": "unit-token", "capabilities": [
            "runtime-api@1", "batch@1", "jsonrpc-bridge@1", "abort@1", "wire-error@1"]}
        bridge_write(reader, {"jsonrpc": "2.0", "id": "hello", "method": "migaia.hello",
                              "params": {"hello": json.dumps(hello)}})
        bridge_write(reader, [
            {"jsonrpc": "2.0", "id": "directory", "method": "migaia.describe", "params": {"args": []}},
            {"jsonrpc": "2.0", "method": "migaia.invoke", "params": {"method": "p.f.oneWay", "args": ["receipt"]}},
            {"jsonrpc": "2.0", "id": "missing", "method": "migaia.invoke", "params": {"method": "absent", "args": []}},
            {"jsonrpc": "2.0", "id": "received", "method": "migaia.invoke", "params": {"method": "peer.received", "args": []}}
        ])
        reader.seek(0)
        serve(reader, writer, False, "unit-token", bridge=True)
        writer.seek(0)
        agreed = json.loads(bridge_read(writer)["result"]["reply"])
        self.assertTrue({"runtime-api@1", "batch@1"} <= set(agreed["capabilities"]))
        responses = bridge_read(writer)
        self.assertEqual([reply["id"] for reply in responses], ["directory", "missing", "received"])
        directory = responses[0]["result"]
        self.assertEqual(directory["schemaVersion"], 2)
        self.assertFalse(any("stream" in method["supportedModes"] for method in directory["methods"]))
        self.assertEqual(responses[1]["error"]["data"]["migaiaWireError"]["code"], "PROVIDER_NOT_FOUND")
        self.assertEqual(responses[2]["result"], {"count": 1, "values": ["receipt"]})
        self.assertIsNone(bridge_read(writer))

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
