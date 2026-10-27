#!/usr/bin/env python3
"""Run envelope-level behavior vectors against one real native peer process."""

import argparse
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import threading
import time

# Reuse the actual native peer JSON codec; this harness owns only child IO and fixture comparison.
sys.path.insert(0, str(Path(__file__).resolve().parent / "python"))
sys.dont_write_bytecode = True
import peer


PEERS = Path(__file__).resolve().parent
COMMANDS = {
    "python": [sys.executable, "-B", str(PEERS / "python" / "peer.py")],
    "rust": [str(PEERS / "rust" / "run.sh")],
    "go": [str(PEERS / "go" / "run.sh")],
    "ts-reference": [str(PEERS / "ts-reference" / "run.sh")],
}
PEER_IDS = {"python": "python-peer", "rust": "rust-peer", "go": "go-peer", "ts-reference": "ts-peer"}


def frame(value):
    """Encode one JSON envelope with the four-byte native length prefix."""
    body = peer.encode_json(value)
    return struct.pack(">I", len(body)) + body


def exact(stream, size):
    """Read a bounded response fragment or fail without showing payload text."""
    chunks = []
    while size:
        chunk = os.read(stream.fileno(), size)
        if not chunk:
            raise EOFError("partial frame")
        chunks.append(chunk)
        size -= len(chunk)
    return b"".join(chunks)


def collect_frames(stream, results, accepted=None):
    """Collect output concurrently so a peer cannot block on a full pipe."""
    try:
        while True:
            header = os.read(stream.fileno(), 4)
            if not header:
                return
            if len(header) < 4:
                header += exact(stream, 4 - len(header))
            length = struct.unpack(">I", header)[0]
            if not 1 <= length <= 16_777_216:
                raise ValueError("invalid frame length")
            incoming = peer.decode_frame(exact(stream, length))
            results.append(incoming)
            if accepted is not None and isinstance(incoming, dict) and incoming.get("kind") == "handshake" and incoming.get("step") in ("accept", "reject"):
                accepted.set()
    except (EOFError, UnicodeDecodeError, json.JSONDecodeError, ValueError, peer.PeerFailure):
        results.append({"$harnessError": "bad peer frame"})


def matches(actual, expected):
    """Compare all declared expected fields while allowing route metadata."""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(
            key in actual and matches(actual[key], value) for key, value in expected.items()
        )
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(matches(item, wanted) for item, wanted in zip(actual, expected))
    return actual == expected


def run_case(command, base_hello, case, target="provider"):
    """Exercise one complete connection and return a bounded fixed verdict."""
    process = subprocess.Popen(
        command + ["--stdio", "--role", "responder"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=PEERS,
    )
    assert process.stdin and process.stdout and process.stderr
    output = []
    # This latch observes the real first decision; it never substitutes a fabricated ready frame.
    accepted = threading.Event()
    collector = threading.Thread(target=collect_frames, args=(process.stdout, output, accepted), daemon=True)
    collector.start()
    negotiated = True
    try:
        if case.get("sendHello", True):
            hello = case.get("hello", base_hello)
            hello = {**hello, **case.get("helloFields", {})} if isinstance(hello, dict) else hello
            if isinstance(hello, dict) and "capabilities" in case:
                hello = {**hello, "capabilities": case["capabilities"]}
            process.stdin.write(frame(hello) + bytes.fromhex(case.get("coalescedAfterHelloHex", "")))
            process.stdin.flush()
            if any(value.get("step") == "accept" for value in case["expect"]["frames"]):
                negotiated = accepted.wait(timeout=5)
                decision = next((value for value in output if isinstance(value, dict) and value.get("kind") == "handshake" and value.get("step") in ("accept", "reject")), None)
                if decision is not None and decision["step"] == "accept":
                    confirmation = {**decision, "peer": hello["peer"], "directory": hello["directory"]}
                    confirmation.pop("auth", None)
                    if "auth" in hello:
                        confirmation["auth"] = hello["auth"]
                    process.stdin.write(frame(confirmation))
                    process.stdin.flush()
        for step in case["steps"] if negotiated else []:
            if step.get("pauseMs"):
                time.sleep(step["pauseMs"] / 1000)
            # Vector routes use a symbolic provider; bind it to the real fixture identity.
            def resolve(value):
                if isinstance(value, dict):
                    return {key: target if key in ("targetId", "receiverId", "providerId") and item == "provider" else resolve(item)
                            for key, item in value.items()}
                return [resolve(item) for item in value] if isinstance(value, list) else value
            process.stdin.write(bytes.fromhex(step["rawHex"]) if "rawHex" in step else frame(resolve(step["frame"])))
            process.stdin.flush()
    except BrokenPipeError:
        pass
    finally:
        try:
            process.stdin.close()
        except BrokenPipeError:
            pass
    try:
        code = process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        code = -1
    collector.join(timeout=1)
    stderr = process.stderr.read().decode("utf-8", "replace")
    expected = case["expect"]
    if code != expected["exit"] or len(output) != len(expected["frames"]):
        return False
    if any(not matches(actual, wanted) for actual, wanted in zip(output, expected["frames"])):
        return False
    ok = (all(stderr.count(marker) == count for marker, count in expected.get("stderr", {}).items())
            and all(marker in stderr for marker in expected.get("stderrContains", []))
            and all(marker not in stderr for marker in expected.get("stderrNot", [])))
    return ok


def main():
    """Load every declared behavior case and fail if any real peer differs."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", required=True, choices=COMMANDS)
    args = parser.parse_args()
    vectors = json.loads((PEERS / "behavior-vectors.json").read_text())
    if vectors.get("schema") != "migaia.rpc.peer-behavior/2":
        raise SystemExit("BEHAVIOR_SCHEMA_INVALID")
    # A language's explicitly changed local diagnostic retains the same physical-frame assertions.
    cases = [{**case, "expect": {**case["expect"], **case.get("expectByLanguage", {}).get(args.language, {})}} for case in vectors["cases"]]
    rows = [{"id": case["id"], "ok": run_case(COMMANDS[args.language], vectors["hello"], case, PEER_IDS[args.language])} for case in cases]
    failures = [row["id"] for row in rows if not row["ok"]]
    print(json.dumps({"language": args.language, "passed": len(rows) - len(failures), "failed": len(failures), "failures": failures, "rows": rows}))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    raise SystemExit(main())
