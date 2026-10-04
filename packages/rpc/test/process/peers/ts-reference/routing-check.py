#!/usr/bin/env python3
"""Check the independent reference peer's production discovery and reply identity."""

import json
from pathlib import Path
import sys

# Reuse the existing real-process harness; this test owns no alternate frame reader.
PEERS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PEERS))
from behavior_check import run_case

# The baseline offer is independent of the TS production endpoint implementation.
HELLO = {
    "kind": "handshake", "step": "hello", "protocol": "migaia.rpc",
    "versions": [{"major": 1, "minor": 1}], "codecs": ["json"],
    "capabilities": ["runtime-api@1", "batch@1", "ping@1", "close@1"],
    "peer": {"id": "routing-caller", "runtime": "python"},
}


def route(kind):
    """Create one supported production route with the caller's genuine identity."""
    return {
        "profile": "migaia.rpc.route", "type": kind, "applicationVersion": "1.0",
        "senderId": "routing-caller", "targetId": "ts-peer", "sentAt": 0,
    }


def main():
    """Return independent verdicts for discovery and an explicitly addressed request."""
    command = [str(PEERS / "ts-reference" / "run.sh")]
    cases = [
        {
            "id": "U36-reference-discovery",
            "steps": [{"frame": {
                "kind": "discovery", "id": "routing-discovery",
                "version": "1.0", "acceptVersions": ["1.0"],
                "data": {"route": route("discovery-query")},
            }}],
            "expect": {"exit": 0, "frames": [
                {"kind": "handshake", "step": "accept"},
                {"kind": "discovery", "id": "routing-discovery",
                 "version": "1.0", "acceptVersions": ["1.0"], "data": {"route": {
                    "type": "discovery-response", "resolvedTargetId": "ts-peer",
                    "receiverId": "ts-peer", "accepted": True,
                }}},
            ]},
        },
        {
            "id": "U36-reference-addressed-response",
            "steps": [{"frame": {
                "kind": "request", "id": "routing-echo", "method": "echo",
                "data": {"route": {**route("request"), "receiverId": "ts-peer"},
                         "payload": "addressed"},
            }}],
            "expect": {"exit": 0, "frames": [
                {"kind": "handshake", "step": "accept"},
                {"kind": "response", "id": "routing-echo", "ok": True,
                 "data": {"route": {"receiverId": "routing-caller"}, "payload": "addressed"}},
            ]},
        },
    ]
    failures = [case["id"] for case in cases if not run_case(command, HELLO, case)]
    print(json.dumps({"language": "ts-reference", "passed": len(cases) - len(failures),
                      "total": len(cases), "failures": failures}))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
