#!/usr/bin/env python3
"""Exercise runtime-baseline directory and batch admission against each independent process."""
import argparse
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading

from behavior_check import COMMANDS, collect_frames, frame, peer

PEERS = Path(__file__).resolve().parent
# The baseline stays frozen under its Integration owner after package separation.
BASELINE = json.loads((PEERS.parents[3] / "rpc-integration/schema/vectors/protocol-baseline.json").read_text())



class Session:
    """Own one child and a concurrent reader, with bounded response waits."""

    def __init__(self, language, business=False, hello=None):
        self.process = subprocess.Popen(COMMANDS[language] + ["--stdio"] + (["--business"] if business else []),
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=PEERS)
        self.frames = queue.Queue()
        self.reader = threading.Thread(target=collect_frames, args=(self.process.stdout, self), daemon=True)
        self.reader.start()
        self.local = hello or BASELINE["handshake"][0]["hello"]
        self.send(self.local)
        self.offer = self.receive()
        assert self.offer.get("step") == "hello"
        self.remote = self.offer["peer"]["id"]
        self.accept = self.receive()
        peer.validate_handshake(self.accept)
        if self.accept["step"] == "accept":
            assert self.offer["peer"] == self.accept["peer"] and self.offer["directory"] == self.accept["directory"]
            confirmation = {**self.accept, "peer": self.local["peer"], "directory": self.local["directory"]}
            confirmation.pop("auth", None)
            if "auth" in self.local:
                confirmation["auth"] = self.local["auth"]
            self.send(confirmation)

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
        return {"profile": peer.PROTOCOL, "kind": "call", "id": identifier, "payload": payload,
                "route": peer.route(self.local["peer"]["id"], self.remote), "options": {},
                "task": {"mode": "request", "method": method, "callerId": self.local["peer"]["id"],
                         "callerGeneration": self.local["directory"]["self"]["generation"],
                         "targetGeneration": self.offer["directory"]["self"]["generation"]}}

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
    """Assert the closed schema3 shape and safe identity, using real installed mode summaries."""
    assert set(value) == {"schemaVersion", "self", "methods"}
    assert value["schemaVersion"] == 3 and set(value["self"]) == {"name", "instanceId", "generation"}
    assert value["self"]["instanceId"] == remote and value["self"]["name"]
    peer.generation(value["self"]["generation"])
    assert value["methods"] and len({m["name"] for m in value["methods"]}) == len(value["methods"])
    for method in value["methods"]:
        assert set(method) <= {"name", "supportedModes", "modeSource", "idempotent"}
        assert method["modeSource"] == "declared" and method["supportedModes"]
        assert set(method["supportedModes"]) <= {"request", "notify", "stream"}
    assert any(m["name"] == "echo" and "request" in m["supportedModes"] for m in value["methods"])


def handshake_check(language, case):
    """Use the published new-baseline offers against an actual process, including the original retired-version refusal."""
    session = Session(language, hello=case["hello"])
    try:
        assert session.accept["step"] == ("accept" if case["accepted"] else "reject")
        if case["accepted"]:
            assert session.accept["profile"] == peer.PROTOCOL and session.accept["major"] == 2 and session.accept["codec"] == "json"
        else:
            assert session.accept["error"]["nodes"][session.accept["error"]["root"]]["code"] == case["code"]
        return {"language": language, "id": case["id"], "ok": True}
    finally:
        session.close()


def check(language, business=False):
    """Check baseline negotiation, v2, removed v1 and independent ordered batch siblings."""
    session = Session(language, business)
    try:
        assert session.accept.get("step") == "accept"
        directory(session.offer["directory"], session.remote)
        session.send(session.request("retired", "migaia.remote.describe"))
        retired = session.receive()
        assert retired["id"] == "retired" and retired["kind"] == "error"
        first, malformed, missing, last = (session.request("first", "echo", "first"), session.request("bad", "echo"),
                                           session.request("unavailable", "absent.provider"), session.request("last", "echo", "last"))
        malformed["task"]["method"] = 7
        # Preserve original coalesced physical input and sibling isolation; there is no semantic batch wrapper.
        session.process.stdin.write(b"".join(frame(value) for value in (first, malformed, missing, last)))
        session.process.stdin.flush()
        replies, order = {}, []
        while "last" not in replies:
            reply = session.receive()
            replies[reply.get("id")] = reply
            order.append(reply.get("id"))
        assert set(replies) == {"first", "unavailable", "last"}
        assert replies["first"]["kind"] == "result" and replies["first"]["result"] == "first"
        assert replies["unavailable"]["kind"] == "error"
        assert replies["last"]["kind"] == "result" and replies["last"]["result"] == "last"
        assert order.index("first") < order.index("last")
        session.send(session.request("optional", "migaia.remote.runtime.group", []))
        optional = session.receive()
        assert optional["id"] == "optional" and optional["kind"] == "error"
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
        for case in BASELINE["handshake"]:
            try:
                rows.append(handshake_check(language, case))
            except Exception as error:
                rows.append({"language": language, "id": case["id"], "ok": False, "failure": type(error).__name__})
        try:
            rows.append(check(language, args.business))
        except Exception as error:
            rows.append({"language": language, "business": args.business, "ok": False, "failure": type(error).__name__})
    print(json.dumps({"passed": sum(row["ok"] for row in rows), "total": len(rows), "rows": rows}))
    return 0 if all(row["ok"] for row in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
