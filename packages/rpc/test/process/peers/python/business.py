"""Native/Content-Length business peer, independent of JavaScript and external libraries.

Existing peer.py owns native framing and hello grammar; this module owns only
published business/control dispatch for the conformance profile.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, BinaryIO

import peer


CONTRACT = json.loads((Path(__file__).resolve().parents[4] / "schema/vectors/remote-contract.json").read_text())["contracts"][0]["value"]
ERROR_SOURCE = "@migaia/rpc/core"


def error_graph() -> dict[str, Any]:
    """Return two preserved semantic causes, with every original stack present."""
    cause = {"source": ERROR_SOURCE, "code": "INTERNAL", "name": "Error", "message": "peer cause", "stack": "Error: peer cause"}
    return {"source": ERROR_SOURCE, "code": "INTERNAL", "name": "RpcError", "message": "peer error", "stack": "RpcError: peer error", "cause": cause}


def reply_route(message: dict[str, Any], kind: str) -> dict[str, Any]:
    """Reply to this exact sender/session while preserving receiver and trace correlation."""
    incoming = message["data"]["route"]
    route = peer.route(kind, incoming["targetId"], incoming["senderId"])
    if "receiverId" in incoming:
        route["receiverId"] = incoming["senderId"]
    if "trace" in incoming:
        route["trace"] = incoming["trace"]
    if kind == "response":
        route["method"] = message["method"]
    return route


def native_response(message: dict[str, Any], payload: Any, error: dict[str, Any] | None = None) -> dict[str, Any]:
    """Keep native response identity and complete wire-error graph."""
    result = {"kind": "response", "id": message["id"], "ok": error is None, "data": {"route": reply_route(message, "response")}}
    if error is None:
        result["data"]["payload"] = payload
    else:
        result.update(code=error["code"], message=error["message"], error=error)
    return result


def stream_frame(message: dict[str, Any], event: str, seq: int, value: Any = peer.ABSENT) -> dict[str, Any]:
    """Produce one credit-controlled stream event with its original stream id."""
    payload = {"event": event, "seq": seq}
    if value is not peer.ABSENT:
        payload["value"] = value
    return {"kind": "stream", "id": message["id"], "data": {"route": reply_route(message, "stream"), "payload": payload}}


class Business:
    """Session-owned call/cancel/stream state; Host catalog resolves one local definition."""

    def __init__(self, host: bool) -> None:
        self.host = host
        self.installed = not host
        self.revision = 0
        self.received: list[Any] = []
        self.aborts: list[Any] = []
        self.waiting: dict[str, dict[str, Any]] = {}
        self.streams: dict[str, tuple[dict[str, Any], list[Any], int]] = {}
        self.pongs = 0
        self.closes = 0
        self.closing = False

    def item(self) -> dict[str, Any]:
        """Project the actual local installed record, never executable definitions."""
        return {"name": "p", "state": "enabled", "revision": self.revision, "features": ["f"]}

    def invoke(self, method: str, payload: Any, trace: Any = None) -> tuple[Any, Any]:
        """Execute portable Host controls or local business methods without a TS intermediary."""
        if method == "migaia.remote.describe":
            return ({"schemaVersion": 1, "catalog": {"p": CONTRACT}} if self.host else CONTRACT), None
        if method == "migaia.remote.host.use" and self.host:
            if not isinstance(payload, list) or not 1 <= len(payload) <= 2 or payload[0] != "p":
                return None, peer.wire_error("REMOTE_CONTRACT_INVALID", "invalid Host use")
            self.installed = True
            self.revision += 1
            return self.item(), None
        if method == "migaia.remote.host.unUse" and self.host:
            if not isinstance(payload, list) or not 1 <= len(payload) <= 2 or payload[0] != "p":
                return None, peer.wire_error("REMOTE_CONTRACT_INVALID", "invalid Host unUse")
            self.installed = False
            self.revision += 1
            return {"ok": True}, None
        if method == "migaia.remote.host.inspect" and self.host:
            return {"revision": self.revision, "plugins": [self.item()] if self.installed else []}, None
        if method in ("echo", "peer.echo"):
            return payload, None
        if method == "peer.received":
            return {"count": len(self.received), "values": list(self.received)}, None
        if method == "peer.aborts":
            return list(self.aborts), None
        if method == "peer.stats":
            return {"pongs": self.pongs, "closes": self.closes, "pid": peer.os.getpid()}, None
        if method == "peer.trace":
            return trace, None
        if method == "peer.error":
            return None, error_graph()
        if method.startswith("p.f.") and not self.installed:
            return None, {**peer.wire_error("REMOTE_CLOSED", "remote is closed"), "source": "@migaia/rpc/remote"}
        if method == "p.f.request":
            return payload[0], None
        if method == "p.f.oneWay":
            self.received.append(payload[0])
            return None, None
        return None, peer.wire_error("METHOD_NOT_FOUND", "native peer method unavailable")

    def native(self, message: dict[str, Any]) -> list[dict[str, Any]]:
        """Dispatch one validated native frame; streams require one pull credit per item."""
        kind = message.get("kind")
        data = message.get("data", {})
        route = data.get("route", {})
        identifier = message.get("id")
        payload = data.get("payload")
        if kind == "discovery" and route.get("type") == "discovery-query":
            header = reply_route(message, "discovery-response")
            header.update(resolvedTargetId=route["targetId"], receiverId=route["targetId"], platform="Process")
            return [{"kind": "discovery", "id": identifier, "version": message["version"], "acceptVersions": message["acceptVersions"], "data": {"route": header}}]
        if kind == "variation":
            control = route.get("variation")
            if control == "ping":
                self.pongs += 1
                result = {"kind": "variation", "id": identifier, "data": {"route": {**reply_route(message, "variation"), "variation": "pong"}}}
                return [result]
            if control == "abort":
                if self.waiting.pop(identifier, None) is not None:
                    reason = payload.get("reason") if isinstance(payload, dict) and "reason" in payload else payload
                    self.aborts.append(reason)
            if control == "close":
                self.closes += 1
                self.closing = True
            return []
        if kind == "stream":
            state = self.streams.get(identifier)
            if not state:
                return []
            original, items, seq = state
            if payload["event"] == "cancel":
                del self.streams[identifier]
                return [stream_frame(original, "cancelled", seq)]
            if payload["event"] != "pull" or payload["seq"] != seq:
                raise peer.PeerFailure("INVALID_STREAM")
            if seq < len(items):
                self.streams[identifier] = original, items, seq + 1
                return [stream_frame(original, "item", seq, items[seq])]
            del self.streams[identifier]
            return [stream_frame(original, "end", seq)]
        if kind != "request" or self.closing:
            return []
        method = message["method"]
        if method == "peer.wait":
            self.waiting[identifier] = message
            return []
        if method in ("p.f.generator", "p.f.asyncGenerator"):
            items = payload[0] if isinstance(payload[0], list) else [payload[0]] * 3
            self.streams[identifier] = message, items, 0
            return [stream_frame(message, "open", 0)]
        result, error = self.invoke(method, payload, route.get("trace"))
        if route.get("dispatchOnly") is True:
            return []
        return [native_response(message, result, error)]


def serve(reader: BinaryIO, writer: BinaryIO, host: bool, token: str | None, bridge: bool = False) -> None:
    """Authenticate before publishing the independent native service; EOF releases session state."""
    if bridge:
        serve_bridge(reader, writer, host, token)
        return
    raw = peer.read_frame(reader, peer.MAX_HANDSHAKE)
    if raw is None:
        raise peer.PeerFailure("HANDSHAKE_INVALID")
    hello = peer.decode_frame(raw)
    local = peer.own_offer("python-peer")
    agreed = peer.negotiate(hello, local)
    if agreed is None or (token is not None and hello.get("auth") != token):
        peer.write_json(writer, {"kind": "handshake", "step": "reject", "protocol": peer.PROTOCOL, "error": peer.wire_error("AUTH_REJECTED", "authentication rejected")})
        return
    peer.write_json(writer, {"kind": "handshake", "step": "accept", "protocol": peer.PROTOCOL, **agreed, "peer": local["peer"]})
    business = Business(host)
    while True:
        raw = peer.read_frame(reader)
        if raw is None:
            return
        for reply in business.native(peer.decode_frame(raw)):
            peer.write_json(writer, reply)


BRIDGE_METHODS = ["migaia.hello", "migaia.describe", "migaia.invoke", "migaia.cancel"]
BRIDGE_CAPABILITIES = ["abort@1", "jsonrpc-bridge@1", "wire-error@1", "deadline@1", "trace@1", "idempotency@1"]


def bridge_read(reader: BinaryIO) -> Any:
    """Bound a Content-Length header before reading its exact UTF-8 body."""
    header = bytearray()
    while not header.endswith(b"\r\n\r\n"):
        byte = reader.read(1)
        if not byte and not header:
            return None
        if not byte or len(header) >= 1024:
            raise peer.PeerFailure("INVALID_FRAME_LENGTH")
        header.extend(byte)
    fields = header.decode("ascii").split("\r\n")
    lengths = [line.split(":", 1)[1].strip() for line in fields if line.lower().startswith("content-length:")]
    if len(lengths) != 1 or not lengths[0].isdigit() or not 1 <= int(lengths[0]) <= peer.MAX_FRAME:
        raise peer.PeerFailure("INVALID_FRAME_LENGTH")
    return peer.decode_frame(peer.read_exact(reader, int(lengths[0])))


def bridge_write(writer: BinaryIO, message: Any) -> None:
    """Content-Length counts UTF-8 bytes and never emits native framing or controls."""
    body = json.dumps(message, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    writer.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body)
    writer.flush()


def serve_bridge(reader: BinaryIO, writer: BinaryIO, host: bool, token: str | None) -> None:
    """Serve the four negotiated extensions using the same independent local business owner."""
    business = Business(host)
    business.contract = json.loads(json.dumps(CONTRACT))
    for method in ["generator", "asyncGenerator"]:
        del business.contract["features"]["f"]["methods"][method]
    authenticated = False
    while (message := bridge_read(reader)) is not None:
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or isinstance(message, list):
            raise peer.PeerFailure("INVALID_ENVELOPE")
        method, params, identifier = message.get("method"), message.get("params", {}), message.get("id")
        if method == "migaia.hello":
            hello = peer.decode_frame(params["hello"].encode("utf-8"))
            local = {**peer.own_offer(), "capabilities": BRIDGE_CAPABILITIES}
            agreed = peer.negotiate(hello, local)
            authenticated = agreed is not None and token is not None and hello.get("auth") == token
            reply = {"kind": "handshake", "step": "accept", "protocol": peer.PROTOCOL, **agreed, "peer": local["peer"]} if authenticated else {"kind": "handshake", "step": "reject", "protocol": peer.PROTOCOL, "error": peer.wire_error("AUTH_REJECTED", "authentication rejected")}
            result, error = {"reply": json.dumps(reply, separators=(",", ":")), "methods": BRIDGE_METHODS}, None
        elif not authenticated:
            raise peer.PeerFailure("AUTH_REQUIRED")
        elif method == "migaia.cancel":
            if business.waiting.pop(params.get("id"), None) is not None:
                business.aborts.append(params.get("reason"))
                bridge_write(writer, {"jsonrpc": "2.0", "id": params["id"], "result": "late-after-cancel"})
            continue
        elif method == "migaia.describe":
            result = {"schemaVersion": 1, "catalog": {"p": business.contract}} if host else business.contract
            error = None
        elif method == "migaia.invoke":
            called, args = params["method"], params["args"]
            if called == "peer.wait" or called == "p.f.request" and args == ["__wait"]:
                business.waiting[identifier] = message
                continue
            result, error = business.invoke(called, args, params.get("meta", {}).get("trace"))
        else:
            result, error = None, peer.wire_error("METHOD_NOT_FOUND", "bridge peer method unavailable")
        if identifier is not None:
            reply = {"jsonrpc": "2.0", "id": identifier}
            if error is None:
                reply["result"] = result
            else:
                reply["error"] = {"code": -32000, "message": error["message"], "data": {"migaiaWireError": error}}
            bridge_write(writer, reply)


def run_business(args: Any) -> int:
    """Select existing framing over true owned stdio or borrowed reusable Unix listener."""
    import os
    import socket
    import sys
    token = None
    if args.auth_fd is not None:
        with os.fdopen(args.auth_fd, "rb") as auth:
            token = auth.read().decode("utf-8")
    if args.stdio:
        if args.bootstrap == "stdin":
            raw = peer.read_frame(sys.stdin.buffer, peer.MAX_HANDSHAKE)
            if raw is None:
                raise peer.PeerFailure("BOOTSTRAP_INVALID")
            token = raw.decode("utf-8")
        print(f"READY pid={os.getpid()}", file=sys.stderr, flush=True)
        serve(sys.stdin.buffer, sys.stdout.buffer, args.host, token, args.jsonrpc)
        return 0
    if not args.listen_unix or token is None:
        raise peer.PeerFailure("AUTH_REQUIRED")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
        listener.bind(args.listen_unix)
        listener.listen(8)
        print(f"READY pid={os.getpid()}", file=sys.stderr, flush=True)
        while True:
            conn, _ = listener.accept()
            with conn, conn.makefile("rb") as reader, conn.makefile("wb") as writer:
                try:
                    serve(reader, writer, args.host, token, args.jsonrpc)
                except (peer.PeerFailure, BrokenPipeError, ConnectionResetError):
                    print("PEER_FAIL BUSINESS_SESSION", file=sys.stderr, flush=True)
