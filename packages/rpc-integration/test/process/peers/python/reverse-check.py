#!/usr/bin/env python3
"""Check reverse RPC correlation, whitelist, concurrency and close on one real reader."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from baseline_check import Session


def reply(request, value=None, error=None, method=None):
    """Answer a Python outbound request using its exact method/id and authenticated identity."""
    result = {"kind": "response", "id": request["id"], "ok": error is None, "data": {"route": {
        "profile": "migaia.rpc.route", "type": "response", "applicationVersion": "1",
        "senderId": "u36-caller", "targetId": "python-peer", "receiverId": "python-peer",
        "sentAt": 1, "method": method or request["method"]}}}
    if error is None:
        result["data"]["payload"] = value
    else:
        result.update(code=error["code"], message=error["message"], error=error)
    return result


def check():
    """Hold reverse replies while proving the same reader still dispatches regular calls."""
    session = Session("python")
    try:
        session.send(session.request("reverse-1", "peer.reverse", {"method": "parentEcho", "payload": "reverse"}))
        describe = session.receive()
        assert describe["kind"] == "request" and describe["method"] == "migaia.remote.runtime.describe"
        session.send(session.request("forward-while-reverse", "echo", "reader-live"))
        forward = session.receive()
        assert forward["id"] == "forward-while-reverse" and forward["data"]["payload"] == "reader-live"
        session.send(reply(describe, {"schemaVersion": 2, "self": {"name": "parent", "instanceId": "u36-caller"},
                    "methods": [{"name": "parentEcho", "supportedModes": ["request"], "modeSource": "declared"}]}))
        called = session.receive()
        assert called["method"] == "parentEcho" and called["data"]["payload"] == "reverse"
        session.send(reply(called, "ignored", method="wrongMethod"))
        session.send(session.request("still-live", "echo", "after-mismatch"))
        assert session.receive()["id"] == "still-live"
        session.send(reply(called, "reverse-result"))
        result = session.receive()
        assert result["id"] == "reverse-1" and result["data"]["payload"] == "reverse-result"
        session.send(session.request("unknown", "peer.reverse", {"method": "notPublished", "payload": 0}))
        unknown = session.receive()
        assert unknown["id"] == "unknown" and unknown["code"] == "PROVIDER_NOT_FOUND"
        session.send({"kind": "batch", "envelopes": [session.request(f"pending-{n}", "peer.reverse", {"method": "parentEcho", "payload": n}) for n in range(3)]})
        first, second, full = session.receive(), session.receive(), session.receive()
        assert first["kind"] == second["kind"] == "request"
        assert full["id"] == "pending-2" and full["code"] == "OVERLOADED"
        cause = {"source": "@migaia/rpc/core", "code": "INTERNAL", "name": "Error", "message": "cause", "stack": "Error: cause"}
        failure = {**cause, "message": "reverse failure", "stack": "Error: reverse failure", "cause": cause}
        session.send(reply(second, error=failure))
        failed = session.receive()
        assert failed["id"] == "pending-1" and failed["error"] == failure
        session.send({"kind": "variation", "id": "close", "data": {"route": {
            "profile": "migaia.rpc.route", "type": "variation", "applicationVersion": "1", "senderId": "u36-caller",
            "targetId": "python-peer", "sentAt": 1, "variation": "close"}, "payload": {"drainMs": 0}}})
        closed = session.receive()
        assert closed["id"] == "pending-0" and closed["code"] == "TRANSPORT"
        return {"passed": 7, "total": 7}
    finally:
        session.close()


if __name__ == "__main__":
    try:
        print(json.dumps(check()))
    except Exception as error:
        print(json.dumps({"passed": 0, "total": 7, "failure": type(error).__name__}))
        raise SystemExit(1)
