#!/usr/bin/env python3
"""Standard-library RPC byte-stream peer for cross-language conformance."""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import struct
import sys
import time
from typing import Any, BinaryIO


MAX_FRAME = 16_777_216
MAX_HANDSHAKE = 65_536
PROTOCOL = "migaia.rpc"
ROUTE_PROFILE = "migaia.rpc.route"
CAPABILITIES = ["abort@1", "ping@1", "close@1", "wire-error@1", "stream@1"]
CODEC_RE = re.compile(r"^[a-z][a-z0-9.-]{0,31}$")
CAPABILITY_RE = re.compile(r"^[a-z][a-z0-9.-]*@[1-9][0-9]*$")
ABSENT = object()


class PeerFailure(Exception):
    """Carry a fixed diagnostic code; never retain untrusted frame text."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def read_exact(stream: BinaryIO, size: int) -> bytes:
    """Read a bounded number of bytes, or reject a truncated frame."""
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            raise PeerFailure("TRUNCATED_FRAME")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_frame(stream: BinaryIO) -> bytes | None:
    """Check the 4-byte length before allocating or reading the payload."""
    first = stream.read(1)
    if not first:
        return None
    header = first + read_exact(stream, 3)
    length = struct.unpack(">I", header)[0]
    if not 1 <= length <= MAX_FRAME:
        raise PeerFailure("INVALID_FRAME_LENGTH")
    return read_exact(stream, length)


def write_frame(stream: BinaryIO, payload: bytes) -> None:
    """Emit a single bounded payload and flush for interactive peers."""
    if not 1 <= len(payload) <= MAX_FRAME:
        raise PeerFailure("INVALID_FRAME_LENGTH")
    stream.write(struct.pack(">I", len(payload)))
    stream.write(payload)
    stream.flush()


def decode_frame(payload: bytes) -> Any:
    """Decode strict UTF-8 JSON without exposing invalid text in errors."""
    try:
        return json.loads(payload.decode("utf-8", "strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PeerFailure("INVALID_JSON") from None


def write_json(stream: BinaryIO, value: Any) -> None:
    """Encode JSON without ASCII escaping; framing length counts UTF-8 bytes."""
    try:
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeEncodeError):
        raise PeerFailure("INVALID_JSON") from None
    write_frame(stream, payload)


def wire_error(code: str, message: str) -> dict[str, str]:
    """Create a complete fixed-text wire error without peer-provided secrets."""
    return {
        "source": "@migaia/rpc/process",
        "code": code,
        "name": "Error",
        "message": message,
        "stack": "Error: " + message,
    }


def own_offer(peer_id: str = "python-peer") -> dict[str, Any]:
    """Offer JSON protocol 1.1 and the control capabilities this peer handles."""
    return {
        "kind": "handshake",
        "step": "hello",
        "protocol": PROTOCOL,
        "versions": [{"major": 1, "minor": 1}],
        "codecs": ["json"],
        "capabilities": CAPABILITIES,
        "peer": {"id": peer_id, "runtime": "python", "runtimeVersion": f"{sys.version_info.major}.{sys.version_info.minor}"},
    }


def _plain_object(value: Any) -> bool:
    """Distinguish JSON objects from arrays and scalar values."""
    return isinstance(value, dict)


def validate_hello(value: Any) -> None:
    """Reject malformed hello fields before negotiation or authentication."""
    if not _plain_object(value) or value.get("kind") != "handshake" or value.get("step") != "hello":
        raise PeerFailure("HANDSHAKE_INVALID")
    if not isinstance(value.get("protocol"), str):
        raise PeerFailure("HANDSHAKE_INVALID")
    versions = value.get("versions")
    if not isinstance(versions, list) or not 1 <= len(versions) <= 8:
        raise PeerFailure("HANDSHAKE_INVALID")
    majors: set[int] = set()
    for version in versions:
        if not _plain_object(version):
            raise PeerFailure("HANDSHAKE_INVALID")
        major, minor = version.get("major"), version.get("minor")
        if type(major) is not int or major < 1 or type(minor) is not int or minor < 0 or major in majors:
            raise PeerFailure("HANDSHAKE_INVALID")
        majors.add(major)
    codecs = value.get("codecs")
    if not isinstance(codecs, list) or not 1 <= len(codecs) <= 16 or len(set(map(str, codecs))) != len(codecs):
        raise PeerFailure("HANDSHAKE_INVALID")
    if any(not isinstance(codec, str) or not CODEC_RE.fullmatch(codec) for codec in codecs):
        raise PeerFailure("HANDSHAKE_INVALID")
    if "json" not in codecs:
        raise PeerFailure("HANDSHAKE_INVALID")
    capabilities = value.get("capabilities")
    if not isinstance(capabilities, list) or len(capabilities) > 64 or len(set(map(str, capabilities))) != len(capabilities):
        raise PeerFailure("HANDSHAKE_INVALID")
    if any(not isinstance(capability, str) or not CAPABILITY_RE.fullmatch(capability) for capability in capabilities):
        raise PeerFailure("HANDSHAKE_INVALID")
    peer = value.get("peer")
    if not _plain_object(peer) or not isinstance(peer.get("id"), str) or not 1 <= len(peer["id"]) <= 128:
        raise PeerFailure("HANDSHAKE_INVALID")
    if not isinstance(peer.get("runtime"), str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", peer["runtime"]):
        raise PeerFailure("HANDSHAKE_INVALID")


def negotiate(hello: dict[str, Any], local: dict[str, Any]) -> dict[str, Any] | None:
    """Use highest common major, lower minor, initiator codec and cap order."""
    validate_hello(hello)
    validate_hello(local)
    if hello["protocol"] != local["protocol"]:
        return None
    local_versions = {item["major"]: item["minor"] for item in local["versions"]}
    common = [item for item in hello["versions"] if item["major"] in local_versions]
    if not common:
        return None
    highest = max(common, key=lambda item: item["major"])
    codec = next((item for item in hello["codecs"] if item in local["codecs"]), None)
    if codec is None:
        return None
    return {
        "major": highest["major"],
        "minor": min(highest["minor"], local_versions[highest["major"]]),
        "codec": codec,
        "capabilities": [item for item in hello["capabilities"] if item in local["capabilities"]],
    }


def route(route_type: str, sender: str, target: str, **fields: Any) -> dict[str, Any]:
    """Construct the shared route header for native envelopes."""
    return {
        "profile": ROUTE_PROFILE,
        "type": route_type,
        "applicationVersion": "1",
        "senderId": sender,
        "targetId": target,
        "sentAt": int(time.time() * 1000),
        **fields,
    }


def variation(identifier: str, control: str, sender: str, target: str, payload: Any = None) -> dict[str, Any]:
    """Build a ping, pong, abort or close control envelope."""
    data: dict[str, Any] = {"route": route("variation", sender, target, variation=control)}
    if payload is not None:
        data["payload"] = payload
    return {"kind": "variation", "id": identifier, "data": data}


def response(identifier: str, method: str, sender: str, target: str, payload: Any = ABSENT, error: dict[str, str] | None = None) -> dict[str, Any]:
    """Build a success or failed response with its matching method route."""
    data = {"route": route("response", sender, target, method=method)}
    if error is None:
        if payload is not ABSENT:
            data["payload"] = payload
        return {"kind": "response", "id": identifier, "ok": True, "data": data}
    return {"kind": "response", "id": identifier, "ok": False, "code": error["code"], "message": error["message"], "error": error, "data": data}


def run_responder(reader: BinaryIO, writer: BinaryIO) -> None:
    """Complete handshake, then serve one-way, request and control frames."""
    local = own_offer()
    first = read_frame(reader)
    if first is None or len(first) > MAX_HANDSHAKE:
        raise PeerFailure("HANDSHAKE_INVALID")
    hello = decode_frame(first)
    validate_hello(hello)
    agreed = negotiate(hello, local)
    if agreed is None:
        reason = "protocol" if hello["protocol"] != local["protocol"] else "version"
        write_json(writer, {"kind": "handshake", "step": "reject", "protocol": PROTOCOL, "error": wire_error("HANDSHAKE_INCOMPATIBLE", "rpc handshake incompatible: " + reason)})
        return
    write_json(writer, {"kind": "handshake", "step": "accept", "protocol": PROTOCOL, **agreed, "peer": local["peer"]})
    remote_id = hello["peer"]["id"]
    open_waits: dict[str, str] = {}
    closing = False
    while True:
        raw = read_frame(reader)
        if raw is None:
            return
        message = decode_frame(raw)
        if not _plain_object(message):
            raise PeerFailure("INVALID_ENVELOPE")
        identifier = message.get("id")
        data = message.get("data")
        header = data.get("route") if _plain_object(data) else None
        if not isinstance(identifier, str) or not _plain_object(header) or header.get("profile") != ROUTE_PROFILE:
            raise PeerFailure("INVALID_ENVELOPE")
        kind = message.get("kind")
        if kind == "variation" and header.get("type") == "variation":
            control = header.get("variation")
            if control == "ping" and "ping@1" in agreed["capabilities"]:
                write_json(writer, variation(identifier, "pong", local["peer"]["id"], remote_id))
            elif control == "abort" and "abort@1" in agreed["capabilities"]:
                open_waits.pop(identifier, None)
                if closing and not open_waits:
                    return
            elif control == "close" and "close@1" in agreed["capabilities"]:
                payload = data.get("payload")
                if not _plain_object(payload) or type(payload.get("drainMs")) is not int or not 0 <= payload["drainMs"] <= 2_147_483_647:
                    raise PeerFailure("INVALID_CONTROL")
                closing = True
                if not open_waits:
                    return
            continue
        if kind != "request" or header.get("type") != "request":
            raise PeerFailure("INVALID_ENVELOPE")
        method = message.get("method")
        if not isinstance(method, str):
            raise PeerFailure("INVALID_ENVELOPE")
        if closing:
            continue
        if method == "peer.wait":
            open_waits[identifier] = method
            continue
        if header.get("dispatchOnly") is True:
            continue
        if method == "peer.error":
            result = response(identifier, method, local["peer"]["id"], remote_id, error=wire_error("PEER_ERROR", "native peer requested error"))
        elif method == "echo":
            result = response(identifier, method, local["peer"]["id"], remote_id, payload=data.get("payload", ABSENT))
        else:
            result = response(identifier, method, local["peer"]["id"], remote_id, error=wire_error("METHOD_NOT_FOUND", "native peer method unavailable"))
        write_json(writer, result)


def run_initiator(reader: BinaryIO, writer: BinaryIO) -> None:
    """Prove a peer-to-peer handshake and echo, then announce close."""
    local = own_offer()
    write_json(writer, local)
    raw = read_frame(reader)
    if raw is None or len(raw) > MAX_HANDSHAKE:
        raise PeerFailure("HANDSHAKE_INVALID")
    reply = decode_frame(raw)
    if not _plain_object(reply) or reply.get("kind") != "handshake" or reply.get("step") != "accept" or reply.get("protocol") != PROTOCOL:
        raise PeerFailure("HANDSHAKE_REJECTED")
    if reply.get("major") != 1 or reply.get("minor") not in (0, 1) or reply.get("codec") != "json":
        raise PeerFailure("HANDSHAKE_MISMATCH")
    capabilities = reply.get("capabilities")
    if not isinstance(capabilities, list) or any(item not in local["capabilities"] for item in capabilities):
        raise PeerFailure("HANDSHAKE_MISMATCH")
    remote = reply.get("peer")
    if not _plain_object(remote) or not isinstance(remote.get("id"), str):
        raise PeerFailure("HANDSHAKE_INVALID")
    payload = {"echo": "python", "number": 1}
    write_json(writer, {"kind": "request", "id": "python-echo-1", "method": "echo", "data": {"route": route("request", local["peer"]["id"], remote["id"]), "payload": payload}})
    raw = read_frame(reader)
    if raw is None:
        raise PeerFailure("MISSING_RESPONSE")
    answer = decode_frame(raw)
    if not _plain_object(answer) or answer.get("kind") != "response" or answer.get("id") != "python-echo-1" or answer.get("ok") is not True or not _plain_object(answer.get("data")) or answer["data"].get("payload") != payload:
        raise PeerFailure("WRONG_RESPONSE")
    if "close@1" in capabilities:
        write_json(writer, variation("python-close-1", "close", local["peer"]["id"], remote["id"], {"drainMs": 0}))
    print("RESULT ok", file=sys.stderr, flush=True)


def main() -> int:
    """Select stdio/socket transport while keeping stdout protocol-only."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stdio", action="store_true")
    parser.add_argument("--listen-unix")
    parser.add_argument("--connect-unix")
    parser.add_argument("--role", choices=("responder", "initiator"), default="responder")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--vectors")
    args = parser.parse_args()
    if args.selftest:
        from selftest import run_selftest
        return run_selftest(args.vectors)
    if int(args.stdio) + int(bool(args.listen_unix)) + int(bool(args.connect_unix)) != 1:
        parser.error("select exactly one transport")
    if args.stdio:
        reader, writer = sys.stdin.buffer, sys.stdout.buffer
        sock = listener = None
    elif args.listen_unix:
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(args.listen_unix)
        listener.listen(1)
        print(f"READY pid={os.getpid()}", file=sys.stderr, flush=True)
        sock, _ = listener.accept()
        reader, writer = sock.makefile("rb"), sock.makefile("wb")
    else:
        listener = None
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(args.connect_unix)
        reader, writer = sock.makefile("rb"), sock.makefile("wb")
    try:
        if not args.listen_unix:
            print(f"READY pid={os.getpid()}", file=sys.stderr, flush=True)
        if args.role == "responder":
            run_responder(reader, writer)
        else:
            run_initiator(reader, writer)
        return 0
    except (PeerFailure, BrokenPipeError, ConnectionResetError) as error:
        code = error.code if isinstance(error, PeerFailure) else "CHANNEL_CLOSED"
        print("PEER_FAIL " + code, file=sys.stderr, flush=True)
        return 1
    finally:
        if sock is not None:
            reader.close()
            writer.close()
            sock.close()
        if listener is not None:
            listener.close()


if __name__ == "__main__":
    raise SystemExit(main())
