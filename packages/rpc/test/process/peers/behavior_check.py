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


PEERS = Path(__file__).resolve().parent
COMMANDS = {
    "python": [sys.executable, "-B", str(PEERS / "python" / "peer.py")],
    "rust": [str(PEERS / "rust" / "run.sh")],
    "go": [str(PEERS / "go" / "run.sh")],
    "ts-reference": [str(PEERS / "ts-reference" / "run.sh")],
}


def frame(value):
    """Encode one JSON envelope with the four-byte native length prefix."""
    body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
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


def collect_frames(stream, results):
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
            results.append(json.loads(exact(stream, length).decode("utf-8")))
    except (EOFError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        results.append({"$harnessError": "bad peer frame"})


def matches(actual, expected):
    """Compare all declared expected fields while allowing route metadata."""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(
            key in actual and matches(actual[key], value) for key, value in expected.items()
        )
    return actual == expected


def run_case(command, base_hello, case):
    """Exercise one complete connection and return a bounded fixed verdict."""
    process = subprocess.Popen(
        command + ["--stdio", "--role", "responder"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=PEERS,
    )
    assert process.stdin and process.stdout and process.stderr
    output = []
    collector = threading.Thread(target=collect_frames, args=(process.stdout, output), daemon=True)
    collector.start()
    try:
        if case.get("sendHello", True):
            hello = case.get("hello", base_hello)
            hello = {**hello, **case.get("helloFields", {})} if isinstance(hello, dict) else hello
            if isinstance(hello, dict) and "capabilities" in case:
                hello = {**hello, "capabilities": case["capabilities"]}
            process.stdin.write(frame(hello) + bytes.fromhex(case.get("coalescedAfterHelloHex", "")))
            process.stdin.flush()
        for step in case["steps"]:
            if step.get("pauseMs"):
                time.sleep(step["pauseMs"] / 1000)
            process.stdin.write(frame(step["frame"]))
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
    return (all(stderr.count(marker) == count for marker, count in expected.get("stderr", {}).items())
            and all(marker not in stderr for marker in expected.get("stderrNot", [])))


def main():
    """Load every declared behavior case and fail if any real peer differs."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", required=True, choices=COMMANDS)
    args = parser.parse_args()
    vectors = json.loads((PEERS / "behavior-vectors.json").read_text())
    if vectors.get("schema") != "migaia.rpc.peer-behavior/1":
        raise SystemExit("BEHAVIOR_SCHEMA_INVALID")
    failures = []
    for case in vectors["cases"]:
        if not run_case(COMMANDS[args.language], vectors["hello"], case):
            failures.append(case["id"])
    print(json.dumps({"language": args.language, "passed": len(vectors["cases"]) - len(failures),
                      "failed": len(failures), "failures": failures}))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    raise SystemExit(main())
