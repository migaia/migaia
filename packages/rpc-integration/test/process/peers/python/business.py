"""Actual native provider state over the single canonical byte-stream session."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
from typing import Any, BinaryIO

import peer
from reverse import ReverseCalls

# The advertised directory is derived from this actual provider registry, never a reserved method.
METHODS = {
    "echo": ["request", "notify"], "peer.echo": ["request", "notify"],
    "peer.received": ["request"], "peer.aborts": ["request"], "peer.stats": ["request"],
    "peer.trace": ["request"], "peer.error": ["request"], "peer.wait": ["request"],
    "peer.pause": ["request"], "peer.busy": ["request"], "peer.crash": ["request"],
    "peer.finish": ["request"], "peer.reverse": ["request"],
    "p.f.request": ["request"], "p.f.oneWay": ["notify"],
    "p.f.generator": ["stream"], "p.f.asyncGenerator": ["stream"]
}
# CLI captures actual provider idempotency before any connection is accepted.
REQUEST_IDEMPOTENT = True
# Native connection admission carries launch credentials before the unchanged RPC profile.
NATIVE_CONNECTION_KIND = "rpc-process-connection"
NATIVE_CONNECTION_VERSION = 1
NATIVE_CONNECTION_REJECTED = "PROCESS_CHANNEL_AUTH_REJECTED"
# Ordinary native teardown uses the same canonical lifecycle reason as the Host.
SESSION_CLOSED_TEXT = "Endpoint disposed"


def error_graph() -> dict[str, Any]:
    """Preserve both original native error nodes and their exact source/code/name/stack fields."""
    return {"root": 0, "nodes": [
        {"source": "rpc.endpoint", "code": "INTERNAL", "name": "RpcError", "message": "peer error", "stack": "RpcError: peer error", "cause": 1},
        {"source": "rpc.endpoint", "code": "INTERNAL", "name": "Error", "message": "peer cause", "stack": "Error: peer cause"}
    ]}


def operation_header(message: dict[str, Any]) -> dict[str, Any]:
    """Retain correlation only after dispatch; pending work does not retain caller payload/options."""
    return {"id": message["id"], "route": message["route"], "task": message["task"]}


def reply_route(message: dict[str, Any]) -> dict[str, Any]:
    """Reply to the exact authenticated sender while preserving this operation's explicit trace."""
    incoming = message["route"]
    return peer.route(incoming["receiverId"], incoming["senderId"], incoming.get("trace", peer.ABSENT))


def native_response(message: dict[str, Any], payload: Any = peer.ABSENT, error: dict[str, Any] | None = None) -> dict[str, Any]:
    """Echo the complete immutable task; failure carries the same flat graph without a wrapper."""
    result = {"profile": peer.PROTOCOL, "kind": "error" if error is not None else "result", "id": message["id"], "route": reply_route(message), "task": message["task"]}
    if error is not None:
        result["error"] = error
    elif payload is not peer.ABSENT:
        result["result"] = payload
    return result


def stream_frame(message: dict[str, Any], event: str, seq: int, value: Any = peer.ABSENT) -> dict[str, Any]:
    """Produce one credit-controlled event with its exact original task and stream correlation."""
    payload = {"event": event, "seq": seq}
    if value is not peer.ABSENT:
        payload["value"] = value
    return {"profile": peer.PROTOCOL, "kind": "stream", "id": message["id"], "route": reply_route(message), "task": message["task"], "stream": payload}


class Business:
    """Own this session's provider receipts, waits, streams and original reverse-call owner."""

    def __init__(self, identity: dict[str, Any] | None = None) -> None:
        self.identity = identity or {"name": "python-peer", "instanceId": "python-peer", "generation": {"kind": "session", "value": 0, "providerId": "python-peer"}}
        self.received: list[Any] = []
        self.aborts: list[Any] = []
        self.waiting: dict[str, dict[str, Any]] = {}
        self.streams: dict[str, tuple[dict[str, Any], list[Any], int]] = {}
        self.pongs = 0
        self.closes = 0
        self.closing = False
        # The original admitted graph is retained until this connection finishes teardown.
        self.close_reason: dict[str, Any] | None = None
        # An inbound final close never produces a reply close or ACK.
        self.close_received = False
        self.remote: dict[str, Any] | None = None
        self.reverse: ReverseCalls | None = None
        self.pending_fault: str | None = None
        self.providers = {name: modes for name, modes in METHODS.items()}

    def description(self) -> dict[str, Any]:
        """Publish only actual installed methods and the exact native or explicit identity."""
        return {"schemaVersion": 3, "self": self.identity,
                "methods": [{"name": name, "supportedModes": modes, "modeSource": "declared",
                             **({"idempotent": REQUEST_IDEMPOTENT} if name == "p.f.request" else {})}
                            for name, modes in self.providers.items()]}

    def bind(self, remote: dict[str, Any]) -> None:
        """Compile the admitted directory once and lend the same native reader to reverse calls."""
        self.remote = remote["directory"]
        self.reverse = ReverseCalls(self.identity, self.remote, native_response)

    def invoke(self, method: str, payload: Any, trace: Any = None) -> tuple[Any, Any]:
        """Execute the original registered portable business methods without a Host façade."""
        if method in ("echo", "peer.echo"):
            return payload, None
        if method == "peer.received":
            return {"count": len(self.received), "values": list(self.received)}, None
        if method == "peer.aborts":
            return list(self.aborts), None
        if method == "peer.stats":
            return {"pongs": self.pongs, "closes": self.closes, "pid": os.getpid()}, None
        if method == "peer.trace":
            return trace, None
        if method == "peer.error":
            return None, error_graph()
        if method in ("peer.pause", "peer.busy", "peer.crash"):
            self.pending_fault = method
            return "ACK", None
        if method == "p.f.request":
            return payload[0], None
        if method == "p.f.oneWay":
            self.received.append(payload[0])
            return None, None
        return None, peer.wire_error("PROVIDER_NOT_FOUND", "Runtime method is not provided by this peer")

    def admit(self, message: dict[str, Any]) -> bool:
        """Bind every frame to this actual source before any pending call can settle."""
        routing = message["route"]
        if routing["senderId"] != self.remote["self"]["instanceId"] or routing["receiverId"] != self.identity["instanceId"] or routing["targetId"] != self.identity["instanceId"]:
            return False
        if message["kind"] in ("call", "group", "cancel", "stream"):
            task = message["task"]
            return task["callerGeneration"] == self.remote["self"]["generation"] and task["targetGeneration"] == self.identity["generation"] and task["callerId"] == self.remote["self"]["instanceId"]
        return True

    def native(self, message: dict[str, Any]) -> list[dict[str, Any]]:
        """Dispatch original work with request, notify, cancel and stream lifecycle kept separate."""
        if not self.admit(message):
            return []
        kind, identifier = message["kind"], message["id"]
        if kind in ("result", "error"):
            return self.reverse.response(message)
        if kind == "directory":
            if message["directory"]["self"] != self.remote["self"]:
                raise peer.PeerFailure("PROTOCOL_INVALID")
            self.remote = message["directory"]
            self.reverse.directory(self.remote)
            return []
        if kind == "control":
            if message["operation"] == "ping":
                self.pongs += 1
                return [{"profile": peer.PROTOCOL, "kind": "control", "id": identifier, "route": reply_route(message), "operation": "pong"}]
            if message["operation"] == peer.CONTROL_CLOSE:
                self.closes += 1
                self.closing = True
                self.close_received = True
                self.close_reason = message.get("reason")
                self.close()
                return []
            if message["operation"] == "drain":
                self.close_reason = message.get("reason")
                self.closes += 1
                self.closing = True
                if message["route"].get("remainingMs") == 0:
                    self.waiting.clear()
                    self.streams.clear()
                return self.reverse.close()
            return []
        if kind == "cancel":
            waiting = self.waiting.get(identifier)
            if waiting is not None and waiting["task"] == message["task"]:
                del self.waiting[identifier]
                if self.closing:
                    print("PEER_EVENT ABORT_DURING_DRAIN", file=sys.stderr, flush=True)
                reason = message.get("reason")
                self.aborts.append(reason["nodes"][reason["root"]] if reason is not None else None)
            stream = self.streams.get(identifier)
            if stream is not None and stream[0]["task"] == message["task"]:
                del self.streams[identifier]
                return [stream_frame(stream[0], "cancelled", stream[2])]
            return self.reverse.cancel(message)
        if kind == "stream":
            state = self.streams.get(identifier)
            if state is None or state[0]["task"] != message["task"]:
                return []
            original, items, seq = state
            control = message["stream"]
            if control["event"] == "finish-without-items":
                del self.streams[identifier]
                return [stream_frame(original, "end", seq)]
            if control["event"] != "pull" or control["seq"] != seq:
                raise peer.PeerFailure("INVALID_STREAM")
            if seq < len(items):
                self.streams[identifier] = original, items, seq + 1
                return [stream_frame(original, "item", seq, items[seq])]
            del self.streams[identifier]
            return [stream_frame(original, "end", seq)]
        if kind not in ("call", "group") or self.closing:
            return []
        if kind == "group":
            outcomes = []
            failed = False
            for step in message["steps"]:
                if failed:
                    outcomes.append({"state": "not-executed"})
                    continue
                result, failure = self.invoke(step["method"], step.get("payload"), message["route"].get("trace"))
                outcomes.append({"state": "failure", "error": failure} if failure else {"state": "success", "result": result})
                failed = failure is not None
            return [native_response(message, outcomes)]
        method, mode = message["task"]["method"], message["task"]["mode"]
        payload = message.get("payload")
        if mode not in self.providers.get(method, []):
            failure = peer.wire_error("CAPABILITY_UNSUPPORTED" if method in self.providers else "PROVIDER_NOT_FOUND", "Runtime operation capability is unavailable" if method in self.providers else "Runtime method is not provided by this peer")
            return [] if mode == "notify" else [native_response(message, error=failure)]
        if method == "peer.reverse":
            return self.reverse.start(operation_header(message), payload, len(self.waiting) + len(self.streams))
        if len(self.reverse.pending) + len(self.waiting) + len(self.streams) >= 2 and method != "peer.finish":
            return [] if mode == "notify" else [native_response(message, error=peer.wire_error("OVERLOADED", "Reverse provider concurrency limit reached"))]
        if method == "peer.wait":
            self.waiting[identifier] = operation_header(message)
            return []
        if mode == "stream":
            items = payload[0] if isinstance(payload[0], list) else [payload[0]] * 3
            self.streams[identifier] = operation_header(message), items, 0
            return [stream_frame(message, "open", 0)]
        if method == "peer.finish":
            replies = [native_response(wait, None) for wait in self.waiting.values()]
            self.waiting.clear()
            replies.append(native_response(message, None))
            return replies
        result, failure = self.invoke(method, payload, message["route"].get("trace"))
        return [] if mode == "notify" else [native_response(message, result, failure)]

    def close_frame(self) -> dict[str, Any]:
        """Write the final local lifecycle reason through the same native framing owner."""
        # Preserve an admitted graph verbatim; only an absent reason receives the lifecycle default.
        reason = self.close_reason or peer.wire_error("ENDPOINT_DISPOSED", SESSION_CLOSED_TEXT)
        return {"profile": peer.PROTOCOL, "kind": "control", "id": peer.CONTROL_CLOSE,
                "route": peer.route(self.identity["instanceId"], self.remote["self"]["instanceId"]),
                "operation": peer.CONTROL_CLOSE, "reason": reason}

    def close(self) -> None:
        """EOF releases each existing lifecycle table; no close ACK or second owner is created."""
        self.waiting.clear()
        self.streams.clear()
        if self.reverse is not None:
            self.reverse.close()


def serve(reader: BinaryIO, writer: BinaryIO, token: str | None = None, identity: dict[str, Any] | None = None, parent: str | None = None) -> None:
    """Strict original credential verification precedes actual native provider admission."""
    business = Business(identity)
    local = peer.own_offer(business.identity["instanceId"], business.description())
    remote = peer.handshake(reader, writer, local, token, parent)
    business.bind(remote)
    try:
        while (raw := peer.read_frame(reader)) is not None:
            value = peer.decode_frame(raw)
            try:
                message = peer.validate_frame(value)
            except peer.PeerFailure:
                print("PEER_ERROR PROTOCOL_INVALID", file=sys.stderr, flush=True)
                continue
            for reply in business.native(message):
                peer.write_json(writer, reply)
            if business.pending_fault is not None:
                fault, business.pending_fault = business.pending_fault, None
                perform_fault(fault)
            if business.closing and not business.waiting and not business.streams and not business.reverse.pending:
                break
        if not business.close_received:
            peer.write_json(writer, business.close_frame())
    finally:
        business.close()


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




def read_bootstrap(reader: BinaryIO) -> dict[str, Any]:
    """Consume the true private native-v1 launch record without accepting semantic-v1 traffic."""
    raw = peer.read_frame(reader, peer.MAX_HANDSHAKE)
    if raw is None:
        raise peer.PeerFailure("BOOTSTRAP_INVALID")
    value = peer.record(peer.decode_frame(raw), {"kind", "version", "self", "parentInstanceId", "token"})
    identity = peer.record(value["self"], {"name", "instanceId"})
    if value["kind"] != "rpc-runtime-api-bootstrap" or value["version"] != 1 or not all(peer.identifier(identity[field]) for field in ("name", "instanceId")) or not peer.identifier(value["parentInstanceId"]) or not isinstance(value["token"], str) or not value["token"]:
        raise peer.PeerFailure("BOOTSTRAP_INVALID")
    if "generation" in value:
        peer.generation(value["generation"])
    return value


def read_native_connection(reader: BinaryIO) -> dict[str, Any]:
    """Read exactly one bounded native record, leaving coalesced RPC bytes in the original reader."""
    raw = peer.read_frame(reader, peer.MAX_HANDSHAKE)
    if raw is None:
        raise peer.PeerFailure(NATIVE_CONNECTION_REJECTED)
    value = peer.record(peer.decode_frame(raw), {"kind", "version", "step"})
    if value["kind"] != NATIVE_CONNECTION_KIND or type(value["version"]) is not int or value["version"] != NATIVE_CONNECTION_VERSION:
        raise peer.PeerFailure(NATIVE_CONNECTION_REJECTED)
    return value


def connect_native(reader: BinaryIO, writer: BinaryIO, token: str, identity: dict[str, Any]) -> None:
    """Prove the actual launch identity once; the parent owns admission timeout and physical close."""
    local = peer.own_offer(identity["instanceId"])["peer"]
    peer.write_json(writer, {"kind": NATIVE_CONNECTION_KIND, "version": NATIVE_CONNECTION_VERSION,
                             "step": "hello", "token": token,
                             "peer": {"id": local["id"], "runtime": local["runtime"]}})
    if read_native_connection(reader)["step"] != "accept":
        raise peer.PeerFailure(NATIVE_CONNECTION_REJECTED)


def accept_native(reader: BinaryIO, writer: BinaryIO, token: str) -> None:
    """Authenticate this borrowed connection before publishing any RPC directory or provider."""
    value = read_native_connection(reader)
    remote = value.get("peer")
    if value["step"] != "hello" or value.get("token") != token or not isinstance(remote, dict) or not all(peer.identifier(remote.get(field)) for field in ("id", "runtime")):
        peer.write_json(writer, {"kind": NATIVE_CONNECTION_KIND, "version": NATIVE_CONNECTION_VERSION,
                                 "step": "reject", "code": NATIVE_CONNECTION_REJECTED})
        raise peer.PeerFailure(NATIVE_CONNECTION_REJECTED)
    peer.write_json(writer, {"kind": NATIVE_CONNECTION_KIND, "version": NATIVE_CONNECTION_VERSION,
                             "step": "accept"})


def run_business(args: Any) -> int:
    """Retain true owned stdio/descendant cleanup and reusable borrowed Unix listener ownership."""
    global REQUEST_IDEMPOTENT
    REQUEST_IDEMPOTENT = not args.non_idempotent_request
    token = None
    if args.auth_fd is not None:
        with os.fdopen(args.auth_fd, "rb") as auth:
            token = auth.read().decode("utf-8")
    if args.stdio:
        if args.bare_jsonrpc:
            print(f"READY pid={os.getpid()}", file=sys.stderr, flush=True)
            peer.run_json_baseline(sys.stdin.buffer, sys.stdout.buffer)
            return 0
        identity, parent = None, None
        if args.bootstrap == "stdin":
            bootstrap = read_bootstrap(sys.stdin.buffer)
            token, parent = bootstrap["token"], bootstrap["parentInstanceId"]
            identity = {**bootstrap["self"], "generation": bootstrap.get("generation", {"kind": "session", "value": 0, "providerId": bootstrap["self"]["instanceId"]})}
            connect_native(sys.stdin.buffer, sys.stdout.buffer, token, identity)
            token = None
        child = subprocess.Popen(["/bin/sleep", "600"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) if args.descendant else None
        print(f"READY pid={os.getpid()}", file=sys.stderr, flush=True)
        try:
            serve(sys.stdin.buffer, sys.stdout.buffer, token, identity, parent)
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
                    accept_native(reader, writer, token)
                    serve(reader, writer)
            except (peer.PeerFailure, BrokenPipeError, ConnectionResetError):
                print("PEER_FAIL BUSINESS_SESSION", file=sys.stderr, flush=True)
