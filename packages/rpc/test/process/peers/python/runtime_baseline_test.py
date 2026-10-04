"""Unit checks for the Python fixture's U36 directory and capability claims."""
import unittest
import peer
from business import Business


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


if __name__ == "__main__":
    unittest.main()
