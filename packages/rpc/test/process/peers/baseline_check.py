#!/usr/bin/env python3
"""Exercise U36 directory and batch admission against each independent process."""
import argparse
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading

from behavior_check import COMMANDS, collect_frames, frame

PEERS = Path(__file__).resolve().parent
BASELINE = json.loads((PEERS.parents[2] / "schema/vectors/protocol-baseline.json").read_text())
DESCRIBE = BASELINE["descriptionMethod"]


class Session:
    """Own one child and a concurrent reader, with bounded response waits."""

    def __init__(self, language, business=False, hello=None):
        self.process = subprocess.Popen(COMMANDS[language] + ["--stdio"] + (["--business"] if business else []),
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=PEERS)
        self.frames = queue.Queue()
        self.reader = threading.Thread(target=collect_frames, args=(self.process.stdout, self), daemon=True)
        self.reader.start()
        self.send(hello or BASELINE["handshake"][0]["hello"])
        self.accept = self.receive()
        self.remote = self.accept.get("peer", {}).get("id", "unknown")

    def append(self, value):
        """Adapt the existing framing collector to a blocking queue."""
        self.frames.put(value)

    def send(self, value):
        """Write a complete physical frame and flush before waiting for replies."""
        self.process.stdin.write(frame(value))
        self.process.stdin.flush()

    def receive(self):
        """Bound a missing reply without exposing potentially sensitive frames."""
        return self.frames.get(timeout=5)

    def request(self, identifier, method, payload=None):
        """Use the actual route shape admitted by a production request receiver."""
        return {"kind": "request", "id": identifier, "method": method, "data": {"payload": payload, "route": {
            "profile": "migaia.rpc.route", "type": "request", "applicationVersion": "1", "senderId": "u36-caller",
            "targetId": self.remote, "receiverId": self.remote, "sentAt": 1}}}

    def close(self):
        """EOF releases the child; terminate only a child that does not finish promptly."""
        try:
            self.process.stdin.close()
            self.process.wait(timeout=5)
        except (BrokenPipeError, subprocess.TimeoutExpired):
            self.process.terminate()
            self.process.wait(timeout=5)
        self.reader.join(timeout=1)


def directory(value, remote):
    """Assert the closed v2 shape and safe identity, using real installed mode summaries."""
    assert set(value) == {"schemaVersion", "self", "methods"}
    assert value["schemaVersion"] == 2 and set(value["self"]) == {"name", "instanceId"}
    assert value["self"]["instanceId"] == remote and value["self"]["name"]
    assert value["methods"] and len({m["name"] for m in value["methods"]}) == len(value["methods"])
    for method in value["methods"]:
        assert set(method) <= {"name", "supportedModes", "modeSource", "idempotent"}
        assert method["modeSource"] == "declared" and method["supportedModes"]
        assert set(method["supportedModes"]) <= {"request", "notify", "stream"}
    assert any(m["name"] == "echo" and "request" in m["supportedModes"] for m in value["methods"])


def handshake_check(language, case):
    """Use the published new-baseline offers against an actual process, including required-cap refusals."""
    session = Session(language, hello=case["hello"])
    try:
        assert session.accept["step"] == ("accept" if case["accepted"] else "reject")
        if case["accepted"]:
            assert set(BASELINE["requiredCapabilities"]) <= set(session.accept["capabilities"])
        else:
            assert session.accept["error"]["code"] == case["code"]
        return {"language": language, "id": case["id"], "ok": True}
    finally:
        session.close()


def check(language, business=False):
    """Check baseline negotiation, v2, removed v1 and independent ordered batch siblings."""
    session = Session(language, business)
    try:
        assert session.accept.get("step") == "accept"
        assert {"runtime-api@1", "batch@1"} <= set(session.accept["capabilities"])
        session.send(session.request("directory", DESCRIBE))
        answer = session.receive()
        assert answer["id"] == "directory" and answer["ok"]
        directory(answer["data"]["payload"], session.remote)
        session.send(session.request("retired", "migaia.remote.describe"))
        retired = session.receive()
        assert retired["id"] == "retired" and retired["ok"] is False
        session.send({"kind": "batch", "envelopes": [session.request("first", "echo", "first"),
            {"kind": "request", "id": "bad", "method": 7}, session.request("unavailable", "absent.provider"),
            session.request("last", "echo", "last")]})
        replies = {}
        order = []
        while "last" not in replies:
            reply = session.receive()
            replies[reply.get("id")] = reply
            order.append(reply.get("id"))
        assert replies["first"]["ok"] and replies["first"]["data"]["payload"] == "first"
        assert replies["unavailable"]["ok"] is False
        assert replies["last"]["ok"] and replies["last"]["data"]["payload"] == "last"
        assert order.index("first") < order.index("last")
        session.send(session.request("optional", "migaia.remote.runtime.group", []))
        optional = session.receive()
        assert optional["id"] == "optional" and optional["ok"] is False
        return {"language": language, "business": business, "ok": True, "checks": 5}
    finally:
        session.close()


def main():
    """Print fixed verdicts suitable for RED/GREEN receipts without recording credentials."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", choices=COMMANDS)
    parser.add_argument("--business", action="store_true")
    args = parser.parse_args()
    rows = []
    for language in [args.language] if args.language else COMMANDS:
        try:
            rows.extend(handshake_check(language, case) for case in BASELINE["handshake"])
            rows.append(check(language, args.business))
        except Exception as error:
            rows.append({"language": language, "business": args.business, "ok": False, "failure": type(error).__name__})
    print(json.dumps({"passed": sum(row["ok"] for row in rows), "total": len(rows), "rows": rows}))
    return 0 if all(row["ok"] for row in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
