#!/usr/bin/env python3
"""Original seven reverse-call checks through one real canonical child reader."""
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from baseline_check import Session, peer, frame


def reply(request, value=None, error=None, method=None):
    """Echo the exact task and native identities; a changed method must never settle it."""
    task = {**request["task"]}
    if method is not None:
        task["method"] = method
    result = {"profile": peer.PROTOCOL, "kind": "error" if error is not None else "result",
              "id": request["id"], "task": task,
              "route": peer.route(request["route"]["receiverId"], request["route"]["senderId"])}
    result["error" if error is not None else "result"] = error if error is not None else value
    return result


def error_code(message):
    """Inspect the original semantic error node inside its canonical flat graph."""
    graph = message["error"]
    return graph["nodes"][graph["root"]]["code"]


def check():
    """Hold actual reverse replies while the same native reader serves ordinary calls and close."""
    hello = peer.own_offer("baseline-caller")
    hello["directory"]["methods"] = [{"name": "parentEcho", "supportedModes": ["request"], "modeSource": "declared"}]
    session = Session("python", hello=hello)
    try:
        session.send(session.request("reverse-1", "peer.reverse", {"method": "parentEcho", "payload": "reverse"}))
        called = session.receive()
        # removed reserved directory discovery; the existing handshake directory supplies the same whitelist.
        assert called["kind"] == "call" and called["task"]["method"] == "parentEcho" and called["payload"] == "reverse"
        session.send(session.request("forward-while-reverse", "echo", "reader-live"))
        forward = session.receive()
        assert forward["id"] == "forward-while-reverse" and forward["result"] == "reader-live"
        session.send(reply(called, "ignored", method="wrongMethod"))
        session.send(session.request("still-live", "echo", "after-mismatch"))
        assert session.receive()["id"] == "still-live"
        session.send(reply(called, "reverse-result"))
        result = session.receive()
        assert result["id"] == "reverse-1" and result["result"] == "reverse-result"
        session.send(session.request("unknown", "peer.reverse", {"method": "notPublished", "payload": 0}))
        unknown = session.receive()
        assert unknown["id"] == "unknown" and error_code(unknown) == "PROVIDER_NOT_FOUND"
        session.process.stdin.write(b"".join(frame(session.request(f"pending-{n}", "peer.reverse", {"method": "parentEcho", "payload": n})) for n in range(3)))
        session.process.stdin.flush()
        first, second, full = session.receive(), session.receive(), session.receive()
        assert first["kind"] == second["kind"] == "call"
        assert full["id"] == "pending-2" and error_code(full) == "OVERLOADED"
        cause = {"source": "rpc.endpoint", "code": "INTERNAL", "name": "Error", "message": "cause", "stack": "Error: cause"}
        failure = {"root": 0, "nodes": [{**cause, "message": "reverse failure", "stack": "Error: reverse failure", "cause": 1}, cause]}
        session.send(reply(second, error=failure))
        failed = session.receive()
        assert failed["id"] == "pending-1" and failed["error"] == failure
        route = peer.route(hello["peer"]["id"], session.remote)
        route["remainingMs"] = 0
        session.send({"profile": peer.PROTOCOL, "kind": "control", "id": "close", "route": route, "operation": "drain"})
        closed = session.receive()
        assert closed["id"] == "pending-0" and error_code(closed) == "TRANSPORT"
        return {"passed": 7, "total": 7}
    finally:
        session.close()


if __name__ == "__main__":
    try:
        print(json.dumps(check()))
    except Exception as error:
        print(json.dumps({"passed": 0, "total": 7, "failure": type(error).__name__}))
        raise SystemExit(1)
