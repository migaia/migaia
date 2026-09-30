#!/usr/bin/env python3
"""Run every ordered native-peer pair over two bridged stdio pipes."""

import json
import os
from pathlib import Path
import subprocess
import sys
import threading


PEERS = Path(__file__).resolve().parent
COMMANDS = {
    "python": [sys.executable, str(PEERS / "python" / "peer.py")],
    "rust": [str(PEERS / "rust" / "run.sh")],
    "go": [str(PEERS / "go" / "run.sh")],
    "ts": [str(PEERS / "ts" / "run.sh")],
}


def relay(source, destination):
    """Forward raw framed bytes and signal EOF when the sender exits."""
    try:
        while chunk := os.read(source.fileno(), 65536):
            destination.write(chunk)
            destination.flush()
    except (BrokenPipeError, ValueError):
        pass
    finally:
        try:
            destination.close()
        except (BrokenPipeError, ValueError):
            pass


def pair(initiator_name, responder_name):
    """Return one verdict with fixed markers and process codes, never frame data."""
    initiator = subprocess.Popen(
        COMMANDS[initiator_name] + ["--stdio", "--role", "initiator"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=PEERS,
    )
    responder = subprocess.Popen(
        COMMANDS[responder_name] + ["--stdio", "--role", "responder"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=PEERS,
    )
    assert initiator.stdout and initiator.stdin and initiator.stderr
    assert responder.stdout and responder.stdin and responder.stderr
    forwards = [
        threading.Thread(target=relay, args=(initiator.stdout, responder.stdin), daemon=True),
        threading.Thread(target=relay, args=(responder.stdout, initiator.stdin), daemon=True),
    ]
    for thread in forwards:
        thread.start()
    try:
        initiator.wait(timeout=90)
        responder.wait(timeout=90)
        init_err = initiator.stderr.read()
        resp_err = responder.stderr.read()
    except subprocess.TimeoutExpired:
        initiator.kill()
        responder.kill()
        initiator.wait()
        responder.wait()
        return {"initiator": initiator_name, "responder": responder_name, "ok": False, "reason": "timeout"}
    finally:
        for thread in forwards:
            thread.join(timeout=1)
    ok = (
        initiator.returncode == responder.returncode == 0
        and b"READY pid=" in init_err
        and b"READY pid=" in resp_err
        and b"RESULT ok" in init_err
    )
    return {
        "initiator": initiator_name, "responder": responder_name,
        "ok": ok, "initiatorExit": initiator.returncode, "responderExit": responder.returncode,
        "initiatorStatus": "RESULT ok" if b"RESULT ok" in init_err else "missing result",
    }


def main():
    """Print a JSON matrix and fail when any ordered language pair fails."""
    rows = [pair(left, right) for left in COMMANDS for right in COMMANDS if left != right]
    print(json.dumps({"passed": sum(row["ok"] for row in rows), "total": len(rows), "pairs": rows}))
    return 0 if all(row["ok"] for row in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
