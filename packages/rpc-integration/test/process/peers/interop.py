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
    "python": [sys.executable, "-B", str(PEERS / "python" / "peer.py")],
    "rust": [str(PEERS / "rust" / "run.sh")],
    "go": [str(PEERS / "go" / "run.sh")],
    "ts-reference": [str(PEERS / "ts-reference" / "run.sh")],
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


def pair(initiator_name, responder_name, bridge=False):
    """Return one verdict with fixed markers and process codes, never frame data."""
    # Each physical bridge endpoint receives the same secret through its own inherited pipe.
    token = os.urandom(24).hex().encode()
    def launch(name, role):
        auth_read, auth_write = os.pipe()
        try:
            os.write(auth_write, token)
        finally:
            os.close(auth_write)
        try:
            extra = ["--business", "--jsonrpc", "--auth-fd", str(auth_read)] if bridge else []
            return subprocess.Popen(
                COMMANDS[name] + ["--stdio", "--role", role] + extra,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                cwd=PEERS, pass_fds=(auth_read,) if bridge else (),
            )
        finally:
            os.close(auth_read)
    initiator = launch(initiator_name, "initiator")
    responder = launch(responder_name, "responder")
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
        "initiator": initiator_name, "responder": responder_name, "wire": "jsonrpc" if bridge else "native",
        "ok": ok, "initiatorExit": initiator.returncode, "responderExit": responder.returncode,
        "initiatorStatus": "RESULT ok" if b"RESULT ok" in init_err else "missing result",
    }


def main():
    """Print a JSON matrix and fail when any ordered language pair fails."""
    rows = [pair(left, right) for left in COMMANDS for right in COMMANDS if left != right]
    bridges = [pair(left, right, True) for left in COMMANDS if left != "ts-reference"
               for right in COMMANDS if right != "ts-reference" and left != right]
    print(json.dumps({"passed": sum(row["ok"] for row in rows), "total": len(rows), "pairs": rows,
                     "bridgePassed": sum(row["ok"] for row in bridges), "bridgeTotal": len(bridges), "bridgePairs": bridges}))
    return 0 if all(row["ok"] for row in rows + bridges) else 1


if __name__ == "__main__":
    sys.exit(main())
