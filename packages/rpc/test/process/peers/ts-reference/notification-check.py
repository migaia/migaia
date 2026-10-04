#!/usr/bin/env python3
"""Prove unsupported notifications do not execute or increment accepted receipts."""

import json
from pathlib import Path
import sys

# The existing real-process harness owns framing and terminal process observations.
PEERS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PEERS))
from behavior_check import run_case


def request(identifier, method, notify=False):
    """Build one baseline request while keeping notification mode in route metadata."""
    return {
        "kind": "request", "id": identifier, "method": method,
        "data": {"route": {
            "profile": "migaia.rpc.route", "type": "request", "applicationVersion": "1.0",
            "senderId": "notification-caller", "targetId": "ts-peer", "sentAt": 0,
            **({"dispatchOnly": True} if notify else {}),
        }, "payload": "receipt"},
    }


def main():
    """Compare accepted counts after unknown, request-only, and valid echo notifications."""
    hello = {
        "kind": "handshake", "step": "hello", "protocol": "migaia.rpc",
        "versions": [{"major": 1, "minor": 1}], "codecs": ["json"],
        "capabilities": ["runtime-api@1", "batch@1"],
        "peer": {"id": "notification-caller", "runtime": "python"},
    }
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
                {"kind": "handshake", "step": "accept"},
                {"kind": "response", "id": "receipt-query", "ok": True,
                 "data": {"payload": 1}},
                {"kind": "response", "id": "pending-request", "ok": True,
                 "data": {"payload": None}},
                {"kind": "response", "id": "valid-finish", "ok": True,
                 "data": {"payload": None}},
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
