#!/usr/bin/env python3
"""Prove unsupported notifications do not execute or increment accepted receipts."""

import json
from pathlib import Path
import sys

# The existing real-process harness owns framing and terminal process observations.
PEERS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PEERS))
from behavior_check import run_case, peer


def request(identifier, method, notify=False):
    """Build one baseline request while keeping notification mode in route metadata."""
    return {"profile": peer.PROTOCOL, "kind": "call", "id": identifier,
            "route": peer.route("notification-caller", "ts-peer"), "options": {}, "payload": "receipt",
            "task": {"mode": "notify" if notify else "request", "method": method,
                     "callerId": "notification-caller", "callerGeneration": {"kind": "session", "value": 0, "providerId": "notification-caller"},
                     "targetGeneration": {"kind": "session", "value": 0, "providerId": "ts-peer"}}}


def main():
    """Compare accepted counts after unknown, request-only, and valid echo notifications."""
    hello = peer.own_offer("notification-caller")
    hello["directory"]["methods"] = []
    case = {
        "id": "U36-reference-notification-admission",
        "steps": [{"frame": frame} for frame in [
            request("pending-request", "peer.wait"),
            request("unknown-notify", "missing.method", True),
            request("request-only-notify", "peer.finish", True),
            request("accepted-notify", "echo", True),
            request("receipt-query", "peer.receipts"),
            request("valid-finish", "peer.finish"),
        ]],
        "expect": {
            "exit": 0,
            "frames": [
                {"profile": peer.PROTOCOL, "kind": "handshake", "step": "hello"},
                {"profile": peer.PROTOCOL, "kind": "handshake", "step": "accept"},
                {"kind": "result", "id": "receipt-query", "result": 1},
                {"kind": "result", "id": "pending-request", "result": None},
                {"kind": "result", "id": "valid-finish", "result": None},
                {"kind": "control", "operation": "close", "reason": {"root": 0, "nodes": [{"code": "ENDPOINT_DISPOSED"}]}},
            ],
            "stderr": {"PEER_ERROR PROVIDER_NOT_FOUND": 1,
                       "PEER_ERROR CAPABILITY_UNSUPPORTED": 1},
        },
    }
    passed = run_case([str(PEERS / "ts-reference" / "run.sh")], hello, case)
    print(json.dumps({"language": "ts-reference", "passed": int(passed), "total": 1,
                      "failures": [] if passed else [case["id"]]}))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
