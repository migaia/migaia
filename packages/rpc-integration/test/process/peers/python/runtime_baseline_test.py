"""Original runtime-baseline business assertions at the canonical native entry."""
import unittest
import io
import peer
from business import Business, native_response, serve
from reverse import ReverseCalls


def request(identifier, method, local, remote, payload=None, mode="request"):
    """Author the actual admitted operation, preserving exact caller and target generation facts."""
    return {"profile": peer.PROTOCOL, "kind": "call", "id": identifier,
            "route": peer.route(remote["instanceId"], local["instanceId"]), "options": {}, "payload": payload,
            "task": {"mode": mode, "method": method, "callerId": remote["instanceId"],
                     "callerGeneration": remote["generation"], "targetGeneration": local["generation"]}}


class RuntimeBaseline(unittest.TestCase):
    """Keep original native identity, registry, receipt, error, mode and cleanup checks."""

    # test_offered_baseline's only assertion was the removed runtime-api/batch capability gate (BC2).

    def test_actual_v2_directory(self):
        """The same actual provider catalog is now schema3 and is published in handshake."""
        value = Business().description()
        self.assertEqual(set(value), {"schemaVersion", "self", "methods"})
        self.assertEqual(value["schemaVersion"], 3)
        self.assertEqual(value["self"]["instanceId"], "python-peer")
        peer.generation(value["self"]["generation"])
        self.assertTrue(any(m["name"] == "echo" and m["supportedModes"] == ["request", "notify"] for m in value["methods"]))

    def test_retired_describe_is_not_a_provider(self):
        value, error = Business().invoke("migaia.remote.describe", None)
        self.assertIsNone(value)
        self.assertIsNotNone(error)

    def test_fault_providers_remain_in_the_actual_registry(self):
        business = Business()
        names = {method["name"] for method in business.description()["methods"]}
        for name in ("peer.pause", "peer.busy", "peer.crash"):
            self.assertIn(name, names)
            self.assertIn(name, business.providers)

    def test_bridge_v2_batch_and_notification_share_business_state(self):
        """Keep strict token validation and original ordered siblings over genuine native frames (BC2 bridge retired)."""
        reader, writer = io.BytesIO(), io.BytesIO()
        hello = {**peer.own_offer("parent"), "auth": "unit-token"}
        local = Business().identity
        remote = hello["directory"]["self"]
        peer.write_json(reader, hello)
        confirmation = peer.negotiate(peer.own_offer("python-peer"), hello)
        confirmation["auth"] = hello["auth"]
        peer.write_json(reader, confirmation)
        for value in (request("notify", "p.f.oneWay", local, remote, ["receipt"], "notify"),
                      request("missing", "absent", local, remote, []),
                      request("received", "peer.received", local, remote, [])):
            peer.write_json(reader, value)
        reader.seek(0)
        serve(reader, writer, "unit-token")
        writer.seek(0)
        offered = peer.decode_frame(peer.read_frame(writer))
        agreed = peer.decode_frame(peer.read_frame(writer))
        self.assertEqual(agreed["step"], "accept")
        self.assertEqual(offered["directory"], agreed["directory"])
        self.assertEqual(offered["directory"]["schemaVersion"], 3)
        responses = [peer.decode_frame(peer.read_frame(writer)) for _ in range(2)]
        self.assertEqual([reply["id"] for reply in responses], ["missing", "received"])
        self.assertEqual(responses[0]["error"]["nodes"][0]["code"], "PROVIDER_NOT_FOUND")
        self.assertEqual(responses[1]["result"], {"count": 1, "values": ["receipt"]})
        # BC12 retains every original response and adds the final close before physical EOF.
        closing = peer.decode_frame(peer.read_frame(writer))
        self.assertEqual(closing["operation"], peer.CONTROL_CLOSE)
        self.assertEqual(closing["reason"]["nodes"][0]["code"], "ENDPOINT_DISPOSED")
        self.assertIsNone(peer.read_frame(writer))

    def test_reverse_mode_whitelist(self):
        local, remote = Business().identity, peer.own_offer("parent")["directory"]
        remote["methods"] = [{"name": "notifyOnly", "supportedModes": ["notify"], "modeSource": "declared"}]
        calls = ReverseCalls(local, remote, native_response)
        message = request("unit-reverse", "peer.reverse", local, remote["self"])
        answer = calls.start(message, {"method": "notifyOnly"})
        self.assertEqual(answer[0]["error"]["nodes"][0]["code"], "CAPABILITY_UNSUPPORTED")
        self.assertEqual(calls.pending, {})

    def test_reverse_close_releases_pending_once(self):
        local, remote = Business().identity, peer.own_offer("parent")["directory"]
        remote["methods"] = [{"name": "parentEcho", "supportedModes": ["request"], "modeSource": "declared"}]
        calls = ReverseCalls(local, remote, native_response)
        message = request("unit-reverse", "peer.reverse", local, remote["self"])
        self.assertEqual(calls.start(message, {"method": "parentEcho"})[0]["task"]["method"], "parentEcho")
        self.assertEqual(calls.close()[0]["id"], "unit-reverse")
        self.assertEqual(calls.pending, {})
        self.assertEqual(calls.whitelist, {})
        self.assertEqual(calls.close(), [])


if __name__ == "__main__":
    unittest.main()
