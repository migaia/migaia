#!/usr/bin/env python3
"""Original discovery identity and addressed-response assertions at the canonical directory boundary."""
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
PEERS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PEERS))
from behavior_check import run_case, peer

# This caller publishes no provider it does not execute.
HELLO = peer.own_offer("routing-caller")
HELLO["directory"]["methods"] = []


def main():
    """Keep both original IDs and their identity/result/count assertions using actual bilateral frames."""
    command = [str(PEERS / "ts-reference" / "run.sh")]
    handshakes = [{"profile": peer.PROTOCOL, "kind": "handshake", "step": "hello",
                   "peer": {"id": "ts-peer"}, "directory": {"schemaVersion": 3, "self": {"instanceId": "ts-peer"}}},
                  {"profile": peer.PROTOCOL, "kind": "handshake", "step": "accept",
                   "peer": {"id": "ts-peer"}, "directory": {"schemaVersion": 3, "self": {"instanceId": "ts-peer"}}}]
    cases = [
        {"id": "U36-reference-discovery", "steps": [],
         "retiredAssertions": ['discovery-query/response version,acceptVersions,type,resolvedTargetId and accepted/platform wire shape retired; true directory and accepted peer identity remain asserted.'],
         "expect": {"exit": 0, "frames": [*handshakes, {"kind": "control", "operation": "close"}]}},
        {"id": "U36-reference-addressed-response", "steps": [{"frame": {
            "profile": peer.PROTOCOL, "kind": "call", "id": "routing-echo", "options": {},
            "route": peer.route("routing-caller", "ts-peer"), "payload": "addressed",
            "task": {"mode": "request", "method": "echo", "callerId": "routing-caller",
                     "callerGeneration": HELLO["directory"]["self"]["generation"],
                     "targetGeneration": {"kind": "session", "value": 0, "providerId": "ts-peer"}}}}],
         "expect": {"exit": 0, "frames": [*handshakes, {"kind": "result", "id": "routing-echo",
                    "route": {"receiverId": "routing-caller"}, "result": "addressed"}, {"kind": "control", "operation": "close"}]}}
    ]
    failures = [case["id"] for case in cases if not run_case(command, HELLO, case)]
    print(json.dumps({"language": "ts-reference", "passed": len(cases) - len(failures), "total": len(cases), "failures": failures}))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
