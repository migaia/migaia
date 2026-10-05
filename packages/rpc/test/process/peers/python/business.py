"""Native/Content-Length business peer, independent of JavaScript and external libraries.

Existing peer.py owns native framing and hello grammar; this module owns only
published business/control dispatch for the conformance profile.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, BinaryIO

import peer


# The static registry names actual fixture routes; no frozen v1 contract is loaded.
DESCRIBE = "migaia.remote.runtime.describe"
STREAM_PREFIX = "migaia.remote.runtime.stream."
METHODS = {
    "echo": ["request", "notify"], "peer.echo": ["request", "notify"],
    "peer.received": ["request"], "peer.aborts": ["request"], "peer.stats": ["request"],
    "peer.trace": ["request"], "peer.error": ["request"], "peer.wait": ["request"],
    "peer.pause": ["request"], "peer.busy": ["request"], "peer.crash": ["request"],
    "peer.finish": ["request"], "peer.reverse": ["request"], "p.f.request": ["request"], "p.f.oneWay": ["notify"],
    "p.f.generator": ["stream"], "p.f.asyncGenerator": ["stream"]
}
HOST_METHODS = ["migaia.remote.host.use", "migaia.remote.host.unUse", "migaia.remote.host.inspect"]
ERROR_SOURCE = "@migaia/rpc/core"
# CLI fixes the actual provider declaration once, before this process accepts any session.
REQUEST_IDEMPOTENT = True


def error_graph() -> dict[str, Any]:
    """Return two preserved semantic causes, with every original stack present."""
    cause = {"source": ERROR_SOURCE, "code": "INTERNAL", "name": "Error", "message": "peer cause", "stack": "Error: peer cause"}
    return {"source": ERROR_SOURCE, "code": "INTERNAL", "name": "RpcError", "message": "peer error", "stack": "RpcError: peer error", "cause": cause}


def reply_route(message: dict[str, Any], kind: str) -> dict[str, Any]:
    """Reply to this exact sender/session while preserving receiver and trace correlation."""
    incoming = message["data"]["route"]
    route = peer.route(kind, incoming["targetId"], incoming["senderId"])
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
        self.capabilities = set(peer.CAPABILITIES)
        self.remote_id = ""
        self.reverse = None
        # Only an admitted fault provider can stop this reader after its ACK is flushed.
        self.pending_fault = None
        # Registered providers alone can be invoked; the directory derives from this same whitelist.
        self.providers = {name: (lambda payload, trace, method=name: self.invoke(method, payload, trace))
                          for name in [DESCRIBE, *METHODS, *(HOST_METHODS if host else [])]}



    def description(self) -> dict[str, Any]:
        """Expose only the safe identity and modes installed in this exact session."""
        methods = {**METHODS}
        if "stream@1" not in self.capabilities:
            methods = {name: modes for name, modes in methods.items() if "stream" not in modes}
        if self.host:
            methods.update({name: ["request"] for name in HOST_METHODS})
        return {"schemaVersion": 2, "self": {"name": "python-peer", "instanceId": "python-peer"},
                "methods": [{"name": name, "supportedModes": modes, "modeSource": "declared",
                             **({"idempotent": REQUEST_IDEMPOTENT} if name == "p.f.request" else {})}
                            for name, modes in methods.items()]}

    def item(self) -> dict[str, Any]:
        """Project the actual local installed record, never executable definitions."""
        return {"name": "p", "state": "enabled", "revision": self.revision, "features": ["f"]}

    def invoke(self, method: str, payload: Any, trace: Any = None) -> tuple[Any, Any]:
        """Execute portable Host controls or local business methods without a TS intermediary."""
        if method == DESCRIBE:
            return self.description(), None
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
        if method in ("peer.pause", "peer.busy", "peer.crash"):
            self.pending_fault = method
            return "ACK", None
        if method.startswith("p.f.") and not self.installed:
            return None, {**peer.wire_error("REMOTE_CLOSED", "remote is closed"), "source": "@migaia/rpc/remote"}
        if method == "p.f.request":
            return payload[0], None
        if method == "p.f.oneWay":
            self.received.append(payload[0])
            return None, None
        return None, {**peer.wire_error("PROVIDER_NOT_FOUND", "Runtime method is not provided by this peer"), "source": ERROR_SOURCE}

    def native(self, message: dict[str, Any]) -> list[dict[str, Any]]:
        """Dispatch one validated native frame; streams require one pull credit per item."""
        kind = message.get("kind")
        data = message.get("data", {})
        route = data.get("route", {})
        identifier = message.get("id")
        payload = data.get("payload")
        if kind == "response":
            return self.reverse.response(message) if self.reverse is not None else []
        if kind == "discovery" and route.get("type") == "discovery-query":
            header = reply_route(message, "discovery-response")
            header.update(resolvedTargetId=route["targetId"], receiverId=route["targetId"], platform="Process")
            return [{"kind": "discovery", "id": identifier, "version": message["version"], "acceptVersions": message["acceptVersions"], "data": {"route": header}}]
        if kind == "variation":
            control = route.get("variation")
            if control == "ping" and "ping@1" in self.capabilities:
                self.pongs += 1
                result = {"kind": "variation", "id": identifier, "data": {"route": {**reply_route(message, "variation"), "variation": "pong"}}}
                return [result]
            if control == "abort" and "abort@1" in self.capabilities:
                if self.closing:
                    print("PEER_EVENT ABORT_DURING_DRAIN", file=peer.sys.stderr, flush=True)
                reverse_aborts = self.reverse.cancel(identifier, payload) if self.reverse is not None else []
                if self.waiting.pop(identifier, None) is not None:
                    reason = payload.get("reason") if isinstance(payload, dict) and "reason" in payload else payload
                    self.aborts.append(reason)
                return reverse_aborts
            if control == "close" and "close@1" in self.capabilities:
                if not isinstance(payload, dict) or type(payload.get("drainMs")) is not int or not 0 <= payload["drainMs"] <= 2_147_483_647:
                    print("PEER_ERROR PROTOCOL_INVALID", file=peer.sys.stderr, flush=True)
                    return []
                self.closes += 1
                self.closing = True
                if payload["drainMs"] == 0:
                    self.waiting.clear()
                    self.streams.clear()
                return self.reverse.close() if self.reverse is not None else []
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
        modes = ["request"] if method == DESCRIBE or method in HOST_METHODS else METHODS.get(method)
        if modes is not None and ("notify" if route.get("dispatchOnly") is True else "request") not in modes:
            error = {**peer.wire_error("CAPABILITY_UNSUPPORTED", "Runtime operation capability is unavailable"), "source": ERROR_SOURCE}
            return [] if route.get("dispatchOnly") else [native_response(message, None, error)]
        if method == "peer.reverse" and self.reverse is not None:
            return self.providers[method](message, len(self.waiting) + len(self.streams))
        if self.reverse is not None and len(self.reverse.pending) + len(self.waiting) + len(self.streams) >= 2 and method not in (DESCRIBE, "peer.finish"):
            error = {**peer.wire_error("OVERLOADED", "Reverse provider concurrency limit reached"), "source": ERROR_SOURCE}
            return [] if route.get("dispatchOnly") else [native_response(message, None, error)]
        if method == "peer.wait":
            self.waiting[identifier] = message
            return []
        if method in (STREAM_PREFIX + "p.f.generator", STREAM_PREFIX + "p.f.asyncGenerator") and "stream@1" in self.capabilities:
            items = payload[0] if isinstance(payload[0], list) else [payload[0]] * 3
            self.streams[identifier] = message, items, 0
            return [stream_frame(message, "open", 0)]
        if method == "peer.finish":
            replies = [native_response(wait, None) for wait in self.waiting.values()]
            self.waiting.clear()
            if route.get("dispatchOnly") is not True:
                replies.append(native_response(message, None))
            return replies
        provider = self.providers.get(method)
        result, error = provider(payload, route.get("trace")) if provider else (None, {
            **peer.wire_error("PROVIDER_NOT_FOUND", "Runtime method is not provided by this peer"), "source": ERROR_SOURCE})
        if route.get("dispatchOnly") is True:
            return []
        return [native_response(message, result, error)]


def serve(reader: BinaryIO, writer: BinaryIO, host: bool, token: str | None, bridge: bool = False, bare: bool = False) -> None:
    """Authenticate before publishing the independent native service; EOF releases session state."""
    if bridge:
        if bare:
            while (body := bridge_body(reader)) is not None:
                # A10 includes one payload parse and serialization without RPC envelope work.
                payload = json.loads(body)
                encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                bridge_write_body(writer, encoded)
            return
        serve_bridge(reader, writer, host, token)
        return
    raw = peer.read_frame(reader, peer.MAX_HANDSHAKE)
    if raw is None:
        raise peer.PeerFailure("HANDSHAKE_INVALID")
    hello = peer.decode_frame(raw)
    local = peer.own_offer("python-peer")
    agreed = peer.negotiate(hello, local)
    if agreed is None or agreed["major"] != 1 or agreed["minor"] != 1 or not {"runtime-api@1", "batch@1"} <= set(agreed["capabilities"]):
        reason = "protocol" if hello.get("protocol") != peer.PROTOCOL else "version"
        peer.write_json(writer, {"kind": "handshake", "step": "reject", "protocol": peer.PROTOCOL, "error": peer.wire_error("HANDSHAKE_INCOMPATIBLE", "rpc handshake incompatible: " + reason)})
        raise peer.PeerFailure("HANDSHAKE_INVALID")
    if token is not None and hello.get("auth") != token:
        peer.write_json(writer, {"kind": "handshake", "step": "reject", "protocol": peer.PROTOCOL, "error": peer.wire_error("AUTH_REJECTED", "authentication rejected")})
        return
    peer.write_json(writer, {"kind": "handshake", "step": "accept", "protocol": peer.PROTOCOL, **agreed, "peer": local["peer"]})
    business = Business(host)
    business.capabilities = set(agreed["capabilities"])
    business.remote_id = hello["peer"]["id"]
    from reverse import ReverseCalls
    business.reverse = ReverseCalls(business.remote_id, native_response)
    business.providers["peer.reverse"] = business.reverse.start
    while True:
        raw = peer.read_frame(reader)
        if raw is None:
            business.waiting.clear()
            business.streams.clear()
            business.reverse.close()
            return
        physical = peer.decode_frame(raw)
        if not isinstance(physical, dict):
            raise peer.PeerFailure("INVALID_ENVELOPE")
        batched = physical.get("kind") == "batch"
        if batched:
            members = physical.get("envelopes")
            if set(physical) != {"kind", "envelopes"} or not isinstance(members, list) or not members:
                raise peer.PeerFailure("INVALID_ENVELOPE")
        else:
            members = [physical]
        for message in members:
            try:
                if not isinstance(message, dict):
                    raise peer.PeerFailure("INVALID_ENVELOPE")
                kind = message.get("kind")
                if kind not in ("request", "response", "discovery", "variation", "stream"):
                    print("PEER_WARN UNKNOWN_KIND", file=peer.sys.stderr, flush=True)
                    continue
                route = message.get("data", {}).get("route") if isinstance(message.get("data"), dict) else None
                if not isinstance(message.get("id"), str) or not isinstance(route, dict) or route.get("profile") != peer.ROUTE_PROFILE:
                    raise peer.PeerFailure("INVALID_ENVELOPE")
                if route.get("senderId") != business.remote_id or route.get("targetId") != "python-peer":
                    raise peer.PeerFailure("INVALID_ENVELOPE")
                if kind == "request" and (route.get("type") != "request" or not isinstance(message.get("method"), str)):
                    raise peer.PeerFailure("INVALID_ENVELOPE")
                for reply in business.native(message):
                    peer.write_json(writer, reply)
                if business.pending_fault is not None:
                    fault, business.pending_fault = business.pending_fault, None
                    perform_fault(fault)
                if business.closing and not business.waiting:
                    business.streams.clear()
                    return
            except (peer.PeerFailure, KeyError, TypeError, IndexError):
                if not batched:
                    raise peer.PeerFailure("INVALID_ENVELOPE")
                print("PEER_ERROR PROTOCOL_INVALID", file=peer.sys.stderr, flush=True)




def bridge_body(reader: BinaryIO) -> bytes | None:
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
    return peer.read_exact(reader, int(lengths[0]))


def bridge_read(reader: BinaryIO) -> Any:
    """Apply the existing strict JSON decoder only on RPC business sides."""
    body = bridge_body(reader)
    return None if body is None else peer.decode_frame(body)


def bridge_write_body(writer: BinaryIO, body: bytes) -> None:
    """Physical echo and RPC replies share this same byte-counted carrier writer."""
    writer.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body)
    writer.flush()


def bridge_write(writer: BinaryIO, message: Any) -> None:
    """Content-Length counts UTF-8 bytes and never emits native framing or controls."""
    body = json.dumps(message, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    bridge_write_body(writer, body)


# The bridge keeps the installed request/notification profile and the required U36 baseline.
BRIDGE_METHODS = ["migaia.hello", "migaia.describe", "migaia.invoke", "migaia.cancel"]
BRIDGE_CAPABILITIES = ["runtime-api@1", "batch@1", "abort@1", "jsonrpc-bridge@1",
                       "wire-error@1", "deadline@1", "trace@1", "idempotency@1"]


def perform_fault(method: str) -> None:
    """After flushing ACK, stop, spin or exit the actual provider PID as the original fixture did."""
    import signal
    if method == "peer.crash":
        peer.os._exit(17)
    if method == "peer.pause":
        peer.os.kill(peer.os.getpid(), signal.SIGSTOP)
    else:
        while True:
            pass


def serve_bridge(reader: BinaryIO, writer: BinaryIO, host: bool, token: str | None) -> None:
    """Use the session's original providers over Content-Length, with v2 and ordered batch arrays."""
    business = Business(host)
    business.capabilities = set(BRIDGE_CAPABILITIES)
    # Reverse and stream owners require native frames and are not installed by this bridge profile.
    business.providers.pop("peer.reverse")
    authenticated = False
    while (physical := bridge_read(reader)) is not None:
        batched = isinstance(physical, list)
        if batched and (not authenticated or not physical):
            raise peer.PeerFailure("INVALID_ENVELOPE")
        replies = []
        for message in physical if batched else [physical]:
            if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
                if batched:
                    print("PEER_ERROR PROTOCOL_INVALID", file=peer.sys.stderr, flush=True)
                    continue
                raise peer.PeerFailure("INVALID_ENVELOPE")
            method, params, identifier = message.get("method"), message.get("params", {}), message.get("id")
            if method == "migaia.hello":
                hello = peer.decode_frame(params["hello"].encode("utf-8"))
                local = {**peer.own_offer("python-peer"), "capabilities": BRIDGE_CAPABILITIES}
                agreed = peer.negotiate(hello, local)
                baseline = agreed is not None and agreed["major"] == 1 and agreed["minor"] == 1 and {
                    "runtime-api@1", "batch@1"} <= set(agreed["capabilities"])
                authenticated = baseline and token is not None and hello.get("auth") == token
                reply = {"kind": "handshake", "step": "accept", "protocol": peer.PROTOCOL, **agreed,
                         "peer": local["peer"]} if authenticated else {
                    "kind": "handshake", "step": "reject", "protocol": peer.PROTOCOL,
                    "error": peer.wire_error("AUTH_REJECTED" if baseline else "HANDSHAKE_INCOMPATIBLE",
                                             "authentication rejected" if baseline else "rpc handshake incompatible: version")}
                result, error = {"reply": json.dumps(reply, separators=(",", ":")), "methods": BRIDGE_METHODS}, None
            elif not authenticated:
                raise peer.PeerFailure("AUTH_REQUIRED")
            elif method == "migaia.cancel":
                if business.waiting.pop(params.get("id"), None) is not None:
                    business.aborts.append(params.get("reason"))
                    replies.append({"jsonrpc": "2.0", "id": params["id"], "result": "late-after-cancel"})
                continue
            elif method == "migaia.describe":
                result, error = business.description(), None
                result["methods"] = [entry for entry in result["methods"] if entry["name"] in business.providers]
            elif method == "migaia.invoke":
                called, args = params["method"], params["args"]
                if called == "peer.wait" or called == "p.f.request" and args == ["__wait"]:
                    business.waiting[identifier] = message
                    continue
                provider = business.providers.get(called)
                result, error = provider(args, params.get("meta", {}).get("trace")) if provider else (
                    None, peer.wire_error("PROVIDER_NOT_FOUND", "Runtime method is not provided by this peer"))
            else:
                result, error = None, peer.wire_error("METHOD_NOT_FOUND", "bridge peer method unavailable")
            if identifier is not None:
                replies.append({"jsonrpc": "2.0", "id": identifier, **({"result": result} if error is None else {
                    "error": {"code": -32000, "message": error["message"], "data": {"migaiaWireError": error}}})})
            if business.pending_fault is not None:
                if replies:
                    bridge_write(writer, replies if batched else replies[0])
                    replies.clear()
                fault, business.pending_fault = business.pending_fault, None
                perform_fault(fault)
        if replies:
            bridge_write(writer, replies if batched else replies[0])



def initiate_bridge(reader: BinaryIO, writer: BinaryIO, token: str | None) -> None:
    """Initiate the existing bridge profile through its original framing and strict JSON owners."""
    if token is None:
        raise peer.PeerFailure("AUTH_REQUIRED")
    hello = {**peer.own_offer("python-peer"), "auth": token, "capabilities": BRIDGE_CAPABILITIES}
    bridge_write(writer, {"jsonrpc": "2.0", "id": "hello", "method": "migaia.hello", "params": {"hello": json.dumps(hello)}})
    reply = bridge_read(reader)
    accepted = json.loads(reply["result"]["reply"])
    if accepted.get("step") != "accept" or not {"runtime-api@1", "batch@1"} <= set(accepted["capabilities"]):
        raise peer.PeerFailure("HANDSHAKE_INCOMPATIBLE")
    bridge_write(writer, {"jsonrpc": "2.0", "id": "directory", "method": "migaia.describe", "params": {"args": []}})
    directory = bridge_read(reader)["result"]
    if directory.get("schemaVersion") != 2 or directory["self"]["instanceId"] != accepted["peer"]["id"]:
        raise peer.PeerFailure("CONTRACT_INVALID")
    bridge_write(writer, [
        {"jsonrpc": "2.0", "id": "first", "method": "migaia.invoke", "params": {"method": "echo", "args": ["bridge-first"]}},
        {"jsonrpc": "2.0", "id": "missing", "method": "migaia.invoke", "params": {"method": "absent", "args": []}},
        {"jsonrpc": "2.0", "id": "last", "method": "migaia.invoke", "params": {"method": "echo", "args": ["bridge-last"]}}
    ])
    replies = bridge_read(reader)
    if not isinstance(replies, list) or [x["id"] for x in replies] != ["first", "missing", "last"] or replies[0]["result"] != ["bridge-first"] or replies[2]["result"] != ["bridge-last"] or replies[1]["error"]["data"]["migaiaWireError"]["code"] != "PROVIDER_NOT_FOUND":
        raise peer.PeerFailure("INVALID_ENVELOPE")
    print("RESULT ok", file=peer.sys.stderr, flush=True)


def run_business(args: Any) -> int:
    """Select existing framing over true owned stdio or borrowed reusable Unix listener."""
    global REQUEST_IDEMPOTENT
    REQUEST_IDEMPOTENT = not args.non_idempotent_request
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
        import subprocess
        child = subprocess.Popen(["/bin/sleep", "600"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) if args.descendant else None
        print(f"READY pid={os.getpid()}", file=sys.stderr, flush=True)
        try:
            if args.jsonrpc and args.role == "initiator":
                initiate_bridge(sys.stdin.buffer, sys.stdout.buffer, token)
            else:
                serve(sys.stdin.buffer, sys.stdout.buffer, args.host, token, args.jsonrpc, args.bare_jsonrpc)
        finally:
            if child is not None:
                child.terminate()
                child.wait()
        return 0
    if not args.listen_unix or token is None:
        raise peer.PeerFailure("AUTH_REQUIRED")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
        listener.bind(args.listen_unix)
        listener.listen(8)
        print(f"READY pid={os.getpid()}", file=sys.stderr, flush=True)
        while True:
            conn, _ = listener.accept()
            try:
                with conn, conn.makefile("rb") as reader, conn.makefile("wb") as writer:
                    serve(reader, writer, args.host, token, args.jsonrpc, args.bare_jsonrpc)
            except (peer.PeerFailure, BrokenPipeError, ConnectionResetError):
                # Buffered writer close may flush after a lost borrower; the listener survives it.
                print("PEER_FAIL BUSINESS_SESSION", file=sys.stderr, flush=True)
