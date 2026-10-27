#!/usr/bin/env python3
"""Independent standard-library peer for the sole migaia.rpc/2 byte protocol."""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import socket
import struct
import sys
import time
from typing import Any, BinaryIO
from json.encoder import _make_iterencode, encode_basestring

# Native framing and bootstrap remain distinct from the semantic protocol revision.
MAX_FRAME = 16_777_216
MAX_HANDSHAKE = 65_536
# The route carries its origin plus at most sixteen forwarding hosts, also retained in error provenance.
MAX_FORWARD_ROUTE_NODES = 17
PROTOCOL = "migaia.rpc/2"
# Final close is a lifecycle control, never a provider method or an ACK exchange.
CONTROL_CLOSE = "close"
CODEC_RE = re.compile(r"^[a-z][a-z0-9.-]{0,31}$")
EXTENSION_RE = re.compile(r"^[a-z][a-z0-9.-]*@[1-9][0-9]*$")
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,39}$")
ABSENT = object()
# The supported numeric domain is native binary64; safe integers retain actual integer metadata types.
MAX_SAFE_INTEGER = 9_007_199_254_740_991

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


def read_frame(stream: BinaryIO, max_payload: int = MAX_FRAME) -> bytes | None:
    """Check the frame and caller-specific limits before reading the payload."""
    first = stream.read(1)
    if not first:
        return None
    header = first + read_exact(stream, 3)
    length = struct.unpack(">I", header)[0]
    if not 1 <= length <= MAX_FRAME or length > max_payload:
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
        return json.loads(payload.decode("utf-8", "strict"), parse_int=parse_json_number, parse_float=parse_json_number)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise PeerFailure("INVALID_JSON") from None
    except RecursionError:
        raise PeerFailure("RECURSION_ERROR") from None


def parse_json_number(text: str) -> int | float:
    """Borrow native binary64 parsing once; integer metadata keeps its original safe integer type."""
    value = float(text)
    return int(value) if math.isfinite(value) and value.is_integer() and abs(value) <= MAX_SAFE_INTEGER else value


def canonical_float(value: float) -> str:
    """Use native shortest binary64 digits with the same decimal/exponent spelling as Serialize JSON."""
    if not math.isfinite(value):
        raise ValueError("nonfinite JSON number")
    if value == 0:
        return "0"
    shortest = repr(abs(value)).lower()
    mantissa, separator, explicit = shortest.partition("e")
    point = mantissa.index(".") if "." in mantissa else len(mantissa)
    digits = mantissa.replace(".", "")
    first = len(digits) - len(digits.lstrip("0"))
    exponent = point + (int(explicit) if separator else 0) - first - 1
    significant = digits[first:].rstrip("0")
    sign = "-" if value < 0 else ""
    if 1e-6 <= abs(value) < 1e21:
        position = exponent + 1
        if position <= 0:
            return sign + "0." + "0" * -position + significant
        if position >= len(significant):
            return sign + significant + "0" * (position - len(significant))
        return sign + significant[:position] + "." + significant[position:]
    coefficient = significant[0] + ("." + significant[1:] if len(significant) > 1 else "")
    return sign + coefficient + "e" + ("+" if exponent >= 0 else "") + str(exponent)


def canonical_integer(value: int) -> str:
    """Keep safe integers exact and project larger Python integers into the supported binary64 domain."""
    return str(value) if abs(value) <= MAX_SAFE_INTEGER else canonical_float(float(value))


class CanonicalJsonEncoder(json.JSONEncoder):
    """Reuse the standard library's one ordered graph walk with explicit native number formatting."""

    def iterencode(self, value: Any, _one_shot: bool = False) -> Any:
        """Lend all existing circular/default/string ownership to the standard iterator; replace only numeric spelling."""
        markers = {} if self.check_circular else None
        encode = _make_iterencode(markers, self.default, encode_basestring, self.indent,
                                 canonical_float, self.key_separator, self.item_separator,
                                 self.sort_keys, self.skipkeys, _one_shot, _intstr=canonical_integer)
        return encode(value, 0)


def encode_json(value: Any) -> bytes:
    """Share one ordered UTF-8 encoding operation between RPC and the pure accounting fixture."""
    try:
        payload = json.dumps(value, cls=CanonicalJsonEncoder, ensure_ascii=False,
                             separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, OverflowError, UnicodeEncodeError):
        raise PeerFailure("INVALID_JSON") from None
    except RecursionError:
        raise PeerFailure("RECURSION_ERROR") from None
    return payload


def write_json(stream: BinaryIO, value: Any) -> None:
    """Encode JSON without ASCII escaping; framing length counts UTF-8 bytes."""
    write_frame(stream, encode_json(value))


def read_baseline_body(reader: BinaryIO) -> bytes | None:
    """Retain the original bounded Content-Length accounting carrier without RPC admission."""
    header = bytearray()
    while not header.endswith(b"\r\n\r\n"):
        byte = reader.read(1)
        if not byte and not header:
            return None
        if not byte or len(header) >= 1024:
            raise PeerFailure("INVALID_FRAME_LENGTH")
        header.extend(byte)
    fields = header.decode("ascii").split("\r\n")
    lengths = [line.split(":", 1)[1].strip() for line in fields if line.lower().startswith("content-length:")]
    if len(lengths) != 1 or not lengths[0].isdigit() or not 1 <= int(lengths[0]) <= MAX_FRAME:
        raise PeerFailure("INVALID_FRAME_LENGTH")
    return read_exact(reader, int(lengths[0]))


def run_json_baseline(reader: BinaryIO, writer: BinaryIO) -> None:
    """Parse and write JSON once, without handshakes, methods, routing or responses."""
    while True:
        body = read_baseline_body(reader)
        if body is None:
            return
        value = decode_frame(body)
        if isinstance(value, dict) and value.get("xrtReverse") is True:
            value = baseline_reverse(reader, writer, value)
        write_baseline_json(writer, value)


def write_baseline_json(writer: BinaryIO, value: Any) -> None:
    """Lend the sole JSON writer to original accounting echo and reverse payloads."""
    body = encode_json(value)
    writer.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body)
    writer.flush()


def baseline_reverse(reader: BinaryIO, writer: BinaryIO, control: dict[str, Any]) -> dict[str, Any]:
    """Keep the original bounded bare reverse accounting loop without RPC methods or profile admission."""
    count, payload = control["count"], control["payload"]
    if type(count) is not int or not 1 <= count <= 10000 or not isinstance(payload, str):
        raise PeerFailure("INVALID_ENVELOPE")
    latencies = []
    start = time.perf_counter_ns()
    for _ in range(count):
        round_start = time.perf_counter_ns()
        write_baseline_json(writer, payload)
        body = read_baseline_body(reader)
        if body is None or decode_frame(body) != payload:
            raise PeerFailure("INVALID_ENVELOPE")
        latencies.append(time.perf_counter_ns() - round_start)
    return {"xrtReceipt": True, "calls": count, "elapsedNs": time.perf_counter_ns() - start,
            "latenciesNs": latencies, "clientInFlightPeak": 1, "burstSize": 1}



def record(value: Any, required: set[str]) -> dict[str, Any]:
    """Read required known fields in place; ignore unknown protocol metadata under R17."""
    if not isinstance(value, dict) or not required <= value.keys():
        raise PeerFailure("PROTOCOL_INVALID")
    return value


def identifier(value: Any) -> bool:
    """Use the canonical bounded identity and correlation domain."""
    return isinstance(value, str) and 1 <= len(value.encode("utf-16-le", "surrogatepass")) // 2 <= 128


def portable(value: Any, depth: int = 0) -> None:
    """Check ordinary JSON values in place, without copying the business graph."""
    if depth > 64:
        raise PeerFailure("PROTOCOL_INVALID")
    if value is None or type(value) is bool:
        return
    if type(value) in (int, float) and math.isfinite(value):
        return
    if isinstance(value, str) and not any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        return
    if isinstance(value, list):
        for item in value:
            portable(item, depth + 1)
        return
    if isinstance(value, dict):
        if "$rpc" in value:
            if not bytes_tag(value):
                raise PeerFailure("PROTOCOL_INVALID")
            return
        for key, item in value.items():
            portable(key, depth + 1)
            portable(item, depth + 1)
        return
    raise PeerFailure("PROTOCOL_INVALID")


def generation(value: Any) -> dict[str, Any]:
    """Admit execution generation data; it grants no authority by itself."""
    value = record(value, {"kind", "value", "providerId"})
    if value["kind"] not in ("restart", "session") or type(value["value"]) is not int or not 0 <= value["value"] <= 9_007_199_254_740_991 or not identifier(value["providerId"]):
        raise PeerFailure("PROTOCOL_INVALID")
    return value


def directory(value: Any) -> dict[str, Any]:
    """Compile only declared providers from the authenticated schema3 directory."""
    value = record(value, {"schemaVersion", "self", "methods"})
    identity = record(value["self"], {"name", "instanceId", "generation"})
    if value["schemaVersion"] != 3 or not identifier(identity["name"]) or not identifier(identity["instanceId"]):
        raise PeerFailure("PROTOCOL_INVALID")
    generation(identity["generation"])
    if "nodeId" in value and (not isinstance(value["nodeId"], str) or not re.fullmatch(r"[0-9a-f]{32}", value["nodeId"])):
        raise PeerFailure("PROTOCOL_INVALID")
    methods = value["methods"]
    if not isinstance(methods, list) or len(methods) > 4096:
        raise PeerFailure("PROTOCOL_INVALID")
    names = set()
    for method in methods:
        record(method, {"name", "supportedModes", "modeSource"})
        name, modes = method["name"], method["supportedModes"]
        if not identifier(name) or not all(NAME_RE.fullmatch(part) for part in name.split(".")) or name in names or not isinstance(modes, list) or not modes or any(mode not in ("request", "notify", "stream") for mode in modes) or len(set(modes)) != len(modes) or method["modeSource"] not in ("declared", "generated-routes"):
            raise PeerFailure("PROTOCOL_INVALID")
        if "idempotent" in method and type(method["idempotent"]) is not bool:
            raise PeerFailure("PROTOCOL_INVALID")
        if "forwardedVia" in method and (not isinstance(method["forwardedVia"], str) or not NAME_RE.fullmatch(method["forwardedVia"])):
            raise PeerFailure("PROTOCOL_INVALID")
        for field in ("input", "output", "yield"):
            if field in method:
                from reverse import valid_runtime_schema
                if not valid_runtime_schema(method[field], 3):
                    raise PeerFailure("PROTOCOL_INVALID")
        names.add(name)
    return value


def wire_error(code: str, message: str, source: str = "rpc.endpoint", name: str = "Error") -> dict[str, Any]:
    """Create one explicit flat error node with stable fields and its original stack."""
    return {"root": 0, "nodes": [{"source": source, "code": code, "name": name, "message": message, "stack": name + ": " + message}]}


def scalar_text_bytes(value: Any) -> int:
    """Admit one Unicode scalar string before charging its actual UTF-8 bytes."""
    if not isinstance(value, str) or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise PeerFailure("PROTOCOL_INVALID")
    return len(value.encode("utf-8"))


def bytes_tag(value: dict[str, Any]) -> bool:
    """Use one canonical URL alphabet/unused-bit rule for the portable bytes record."""
    if set(value) != {"$rpc", "base64url"} or value["$rpc"] != "bytes" or not isinstance(value["base64url"], str):
        return False
    encoded = value["base64url"]
    if not re.fullmatch(r"[A-Za-z0-9_-]*", encoded) or len(encoded) % 4 == 1:
        return False
    last = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".index(encoded[-1]) if encoded else 0
    return len(encoded) % 4 == 0 or len(encoded) % 4 == 2 and last & 15 == 0 or len(encoded) % 4 == 3 and last & 3 == 0


def error_data_bytes(value: Any, depth: int = 17) -> int:
    """Keep the original independent 65536 text subtotal and portable depth in one data walk."""
    if depth > 64:
        raise PeerFailure("PROTOCOL_INVALID")
    if value is None or type(value) is bool:
        count = 0
    elif type(value) in (int, float) and math.isfinite(value):
        count = 0
    elif isinstance(value, str):
        count = scalar_text_bytes(value)
    elif isinstance(value, list):
        count = sum(error_data_bytes(child, depth + 1) for child in value)
    elif isinstance(value, dict):
        if "$rpc" in value:
            if not bytes_tag(value):
                raise PeerFailure("PROTOCOL_INVALID")
            count = len(value["base64url"])
        else:
            count = sum(scalar_text_bytes(key) + error_data_bytes(child, depth + 1) for key, child in value.items())
    else:
        raise PeerFailure("PROTOCOL_INVALID")
    if count > 65_536:
        raise PeerFailure("PROTOCOL_INVALID")
    return count


def validate_error(value: Any) -> dict[str, Any]:
    """Admit each flat node once, then validate bounded indexes without following graph edges."""
    value = record(value, {"root", "nodes"})
    nodes = value["nodes"]
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 1024 or type(value["root"]) is not int or not 0 <= value["root"] < len(nodes):
        raise PeerFailure("PROTOCOL_INVALID")
    total = 0
    for node in nodes:
        record(node, {"source", "code", "name", "message", "stack"})
        for field in ("source", "code", "name", "message", "stack"):
            size = scalar_text_bytes(node[field])
            if size > 65_536 or field != "message" and not node[field]:
                raise PeerFailure("PROTOCOL_INVALID")
            total += size
        references = []
        if "cause" in node:
            references.append(node["cause"])
        if "errors" in node:
            if not isinstance(node["errors"], list) or not node["errors"]:
                raise PeerFailure("PROTOCOL_INVALID")
            references.extend(node["errors"])
        if any(type(index) is not int or not 0 <= index < len(nodes) for index in references):
            raise PeerFailure("PROTOCOL_INVALID")
        if "data" in node:
            error_data_bytes(node["data"])
            total += len(encode_json(node["data"]))
        if "route" in node:
            route = node["route"]
            if not isinstance(route, list) or not 1 <= len(route) <= MAX_FORWARD_ROUTE_NODES or any(not isinstance(item, str) or not re.fullmatch(r"[0-9a-f]{32}", item) for item in route):
                raise PeerFailure("PROTOCOL_INVALID")
            total += len(route) * 32
        if total > 1_048_576 or "truncated" in node and node["truncated"] is not True:
            raise PeerFailure("PROTOCOL_INVALID")
    return value


def own_offer(peer_id: str = "python-peer", published: dict[str, Any] | None = None) -> dict[str, Any]:
    """Advertise actual providers and only implemented canonical extensions."""
    published = published or {"schemaVersion": 3, "self": {"name": peer_id, "instanceId": peer_id, "generation": {"kind": "session", "value": 0, "providerId": peer_id}}, "methods": [{"name": "echo", "supportedModes": ["request", "notify"], "modeSource": "declared"}]}
    return {"profile": PROTOCOL, "kind": "handshake", "step": "hello", "versions": [{"major": 2, "minor": 0}], "codecs": ["json"], "extensions": [], "peer": {"id": peer_id, "runtime": "python", "runtimeVersion": f"{sys.version_info.major}.{sys.version_info.minor}"}, "directory": published}


def validate_handshake(value: Any) -> dict[str, Any]:
    """Reject semantic v1/JSON-RPC before publishing identity or invoking business."""
    if not isinstance(value, dict) or value.get("profile") != PROTOCOL or value.get("kind") != "handshake":
        raise PeerFailure("HANDSHAKE_INVALID")
    step = value.get("step")
    if step == "reject":
        record(value, {"profile", "kind", "step", "error"})
        validate_error(value["error"])
        return value
    common = {"profile", "kind", "step", "peer", "directory", "extensions"}
    record(value, {"profile", "kind", "step", "peer", "remainingMs"} if step == "pending" else common | ({"versions", "codecs"} if step == "hello" else {"major", "minor", "codec"}))
    if step not in ("hello", "accept", "pending"):
        raise PeerFailure("HANDSHAKE_INVALID")
    remote = record(value["peer"], {"id", "runtime"})
    if not identifier(remote["id"]) or not isinstance(remote["runtime"], str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", remote["runtime"]):
        raise PeerFailure("HANDSHAKE_INVALID")
    if "runtimeVersion" in remote and not isinstance(remote["runtimeVersion"], str):
        raise PeerFailure("HANDSHAKE_INVALID")
    if "implementation" in remote:
        implementation = record(remote["implementation"], {"name", "version"})
        if any(not isinstance(field, str) for field in (implementation["name"], implementation["version"])):
            raise PeerFailure("HANDSHAKE_INVALID")
    if step == "pending":
        remaining = value["remainingMs"]
        if type(remaining) not in (int, float) or not math.isfinite(remaining) or not 0 <= remaining <= 2147483647:
            raise PeerFailure("HANDSHAKE_INVALID")
        if "auth" in value:
            portable(value["auth"])
        return value
    if directory(value["directory"])["self"]["instanceId"] != remote["id"]:
        raise PeerFailure("HANDSHAKE_INVALID")
    for field, pattern, maximum in (("extensions", EXTENSION_RE, 64), ("requiredExtensions", EXTENSION_RE, 64), ("codecs", CODEC_RE, 16)):
        if field not in value:
            continue
        items = value[field]
        if not isinstance(items, list) or len(items) > maximum or any(not isinstance(item, str) or not pattern.fullmatch(item) for item in items) or len(set(items)) != len(items):
            raise PeerFailure("HANDSHAKE_INVALID")
    if step == "hello":
        versions = value["versions"]
        if not isinstance(versions, list) or not 1 <= len(versions) <= 8 or "json" not in value["codecs"]:
            raise PeerFailure("HANDSHAKE_INVALID")
        majors = set()
        for version in versions:
            record(version, {"major", "minor"})
            if type(version["major"]) is not int or not 1 <= version["major"] <= MAX_SAFE_INTEGER or type(version["minor"]) is not int or not 0 <= version["minor"] <= MAX_SAFE_INTEGER or version["major"] in majors:
                raise PeerFailure("HANDSHAKE_INVALID")
            majors.add(version["major"])
        if any(item not in value["extensions"] for item in value.get("requiredExtensions", [])):
            raise PeerFailure("HANDSHAKE_INVALID")
    elif type(value["major"]) is not int or value["major"] != 2 or type(value["minor"]) is not int or value["minor"] != 0 or value["codec"] != "json":
        raise PeerFailure("HANDSHAKE_INVALID")
    if "auth" in value:
        portable(value["auth"])
    return value


def negotiate(hello: dict[str, Any], local: dict[str, Any]) -> dict[str, Any]:
    """Select common values in the actual initiating offer's order."""
    validate_handshake(hello)
    validate_handshake(local)
    if not any(version["major"] == 2 and version["minor"] == 0 for version in hello["versions"]) or "json" not in hello["codecs"]:
        raise PeerFailure("HANDSHAKE_INCOMPATIBLE")
    extensions = [item for item in hello["extensions"] if item in local["extensions"]]
    if any(item not in extensions for item in [*hello.get("requiredExtensions", []), *local.get("requiredExtensions", [])]):
        raise PeerFailure("EXTENSION_NEGOTIATION_FAILED")
    return {"profile": PROTOCOL, "kind": "handshake", "step": "accept", "major": 2, "minor": 0, "codec": "json", "extensions": extensions, "peer": local["peer"], "directory": local["directory"]}


def handshake(reader: BinaryIO, writer: BinaryIO, local: dict[str, Any], token: str | None = None, parent: str | None = None) -> dict[str, Any]:
    """Both sides send hello; the larger actual identity responds, with strict original auth."""
    write_json(writer, local)
    remote_hello = None
    selected = None
    while True:
        raw = read_frame(reader, MAX_HANDSHAKE)
        if raw is None:
            raise PeerFailure("HANDSHAKE_INVALID")
        try:
            remote = validate_handshake(decode_frame(raw))
        except PeerFailure as error:
            raise PeerFailure("HANDSHAKE_INVALID") from error
        if remote["step"] == "reject":
            raise PeerFailure("HANDSHAKE_REJECTED")
        if parent is not None and remote["peer"]["id"] != parent:
            raise PeerFailure("HANDSHAKE_INVALID")
        if token is not None and remote.get("auth") != token:
            write_json(writer, {"profile": PROTOCOL, "kind": "handshake", "step": "reject", "error": wire_error("AUTH_REJECTED", "authentication rejected", "rpc.transport.process")})
            raise PeerFailure("AUTH_REJECTED")
        if remote["peer"]["id"] == local["peer"]["id"]:
            raise PeerFailure("HANDSHAKE_INVALID")
        if remote["step"] == "pending":
            if remote_hello is None or remote["peer"] != remote_hello["peer"]:
                raise PeerFailure("HANDSHAKE_INVALID")
            continue
        if remote["step"] == "hello":
            if local["peer"]["id"] > remote["peer"]["id"]:
                try:
                    accepted = negotiate(remote, local)
                except PeerFailure as error:
                    write_json(writer, {"profile": PROTOCOL, "kind": "handshake", "step": "reject", "error": wire_error(error.code, "handshake incompatible", "rpc.contract")})
                    raise PeerFailure("HANDSHAKE_INCOMPATIBLE") from error
                if "auth" in local:
                    accepted["auth"] = local["auth"]
                write_json(writer, accepted)
                remote_hello, selected = remote, accepted
                continue
            remote_hello = remote
            continue
        if selected is not None:
            if any(remote[key] != selected[key] for key in ("major", "minor", "codec", "extensions")) or remote["peer"] != remote_hello["peer"] or remote["directory"] != remote_hello["directory"]:
                raise PeerFailure("HANDSHAKE_INVALID")
            return remote_hello
        if local["peer"]["id"] > remote["peer"]["id"] or any(item not in local["extensions"] for item in remote["extensions"]):
            raise PeerFailure("HANDSHAKE_INVALID")
        if remote_hello is not None and (remote["peer"] != remote_hello["peer"] or remote["directory"] != remote_hello["directory"]):
            raise PeerFailure("HANDSHAKE_INVALID")
        confirmation = {**remote, "peer": local["peer"], "directory": local["directory"]}
        confirmation.pop("auth", None)
        if "auth" in local:
            confirmation["auth"] = local["auth"]
        write_json(writer, confirmation)
        return remote



def route(sender: str, target: str, trace: Any = ABSENT) -> dict[str, Any]:
    """Construct direct routing while retaining explicit trace only for this operation."""
    value = {"applicationVersion": "1", "senderId": sender, "targetId": target, "receiverId": target, "sentAt": int(time.time() * 1000)}
    if trace is not ABSENT:
        value["trace"] = trace
    return value


def portable_size(value: Any, depth: int = 0) -> int:
    """Validate and charge the original stream budget in one graph walk, without copying it."""
    if depth > 64:
        raise PeerFailure("PROTOCOL_INVALID")
    if value is None:
        return 4
    if type(value) is bool:
        return 4 if value else 5
    if type(value) in (int, float) and math.isfinite(value):
        return 24
    if isinstance(value, str):
        scalar_text_bytes(value)
        return len(encode_json(value))
    if isinstance(value, list):
        return 2 + max(0, len(value) - 1) + sum(portable_size(item, depth + 1) for item in value)
    if isinstance(value, dict):
        if "$rpc" in value and not bytes_tag(value):
            raise PeerFailure("PROTOCOL_INVALID")
        return 2 + max(0, len(value) - 1) + sum(portable_size(key, depth + 1) + 1 + portable_size(item, depth + 1) for key, item in value.items())
    raise PeerFailure("PROTOCOL_INVALID")


def validate_stream(value: Any) -> None:
    """Admit only each event's actual field and preserve the original 16KiB semantic value budget."""
    event = record(value, {"event", "seq"})
    fields = {"open": None, "pull": None, "item": "value", "end": "value", "fail": "error", "cancelled": "error", "finish-without-items": "reason"}
    if event["event"] not in fields or type(event["seq"]) is not int or not 0 <= event["seq"] <= MAX_SAFE_INTEGER or event["event"] == "open" and event["seq"] != 0:
        raise PeerFailure("PROTOCOL_INVALID")
    field = fields[event["event"]]
    record(event, {"event", "seq"} | ({field} if event["event"] in ("item", "fail") else set()))
    if field in event:
        if field == "value":
            if portable_size(event[field]) > 16384:
                raise PeerFailure("PROTOCOL_INVALID")
        else:
            validate_error(event[field])


def validate_group_result(value: Any) -> None:
    """Keep fail-stop reports contiguous; a failed step permits only not-executed successors."""
    if not isinstance(value, list) or not value:
        raise PeerFailure("PROTOCOL_INVALID")
    failed = False
    for step in value:
        if not isinstance(step, dict):
            raise PeerFailure("PROTOCOL_INVALID")
        state = step.get("state")
        if state == "success" and not failed:
            record(step, {"state"})
            if "result" in step:
                portable(step["result"])
        elif state == "failure" and not failed:
            record(step, {"state", "error"})
            validate_error(step["error"])
            failed = True
        elif state == "not-executed" and failed:
            record(step, {"state"})
        else:
            raise PeerFailure("PROTOCOL_INVALID")


def validate_outcome(value: dict[str, Any]) -> None:
    """Admit the canonical replay lookup/status contract without implementing a foreign replay ledger."""
    if value["task"]["mode"] != "outcome":
        raise PeerFailure("PROTOCOL_INVALID")
    if value["operation"] == "lookup":
        record(value, {"profile", "kind", "id", "route", "task", "operation", "idempotencyKey"})
        if not identifier(value["idempotencyKey"]):
            raise PeerFailure("PROTOCOL_INVALID")
        return
    record(value, {"profile", "kind", "id", "route", "task", "operation", "state", "store"})
    store = value["store"]
    if not isinstance(store, dict):
        raise PeerFailure("PROTOCOL_INVALID")
    if store.get("kind") == "unavailable":
        record(store, {"kind", "continuity"})
        if store["continuity"] != "unavailable":
            raise PeerFailure("PROTOCOL_INVALID")
    else:
        record(store, {"kind", "epoch", "continuity"})
        if store["kind"] not in ("memory", "external") or not identifier(store["epoch"]) or store["continuity"] not in ("retained", "lost-since-restart"):
            raise PeerFailure("PROTOCOL_INVALID")
    if value["operation"] != "result" or value["state"] not in ("unknown", "pending", "done"):
        raise PeerFailure("PROTOCOL_INVALID")
    if value["state"] == "done":
        record(value, {"outcome"})
        outcome = record(value["outcome"], {"mode", "targetGeneration", "completion"})
        generation(outcome["targetGeneration"])
        completion = outcome["completion"]
        if outcome["mode"] not in ("request", "notify", "stream", "group") or not isinstance(completion, dict) or type(completion.get("ok")) is not bool:
            raise PeerFailure("PROTOCOL_INVALID")
        record(completion, {"ok"} | ({"error"} if not completion["ok"] else set()))
        if not completion["ok"]:
            validate_error(completion["error"])
        elif outcome["mode"] == "group":
            validate_group_result(completion.get("result"))
        elif "result" in completion:
            portable(completion["result"])


def validate_frame(value: Any) -> dict[str, Any]:
    """Admit each kind's known call, terminal, cancel, stream and native control fields."""
    if not isinstance(value, dict) or value.get("profile") != PROTOCOL:
        raise PeerFailure("PROTOCOL_INVALID")
    kind = value.get("kind")
    if kind == "handshake":
        return validate_handshake(value)
    common = {"profile", "kind", "id", "route"}
    fields = {"call": ({"task", "options"}, {"payload", "extensions"}), "group": ({"task", "options", "steps"}, {"extensions"}), "result": ({"task"}, {"result", "extensions"}), "error": ({"task", "error"}, {"extensions"}), "cancel": ({"task"}, {"reason", "extensions"}), "stream": ({"task", "stream"}, {"extensions"}), "control": ({"operation"}, {"reason"}), "directory": ({"directory"}, set()), "outcome": ({"task", "operation"}, {"idempotencyKey", "state", "store", "outcome", "extensions"})}
    if kind not in fields:
        raise PeerFailure("PROTOCOL_INVALID")
    required, optional = fields[kind]
    record(value, common | required)
    if not identifier(value["id"]):
        raise PeerFailure("PROTOCOL_INVALID")
    routing = record(value["route"], {"applicationVersion", "senderId", "receiverId", "targetId", "sentAt"})
    if any(not identifier(routing[field]) for field in ("applicationVersion", "senderId", "receiverId", "targetId")) or type(routing["sentAt"]) not in (int, float) or not math.isfinite(routing["sentAt"]) or routing["sentAt"] < 0:
        raise PeerFailure("PROTOCOL_INVALID")
    if "remainingMs" in routing and (type(routing["remainingMs"]) not in (int, float) or not math.isfinite(routing["remainingMs"]) or not 0 <= routing["remainingMs"] <= 2147483647):
        raise PeerFailure("PROTOCOL_INVALID")
    if "trace" in routing and (not isinstance(routing["trace"], str) or not re.fullmatch(r"[ -~]{1,256}", routing["trace"])):
        raise PeerFailure("PROTOCOL_INVALID")
    if "forwardRoute" in routing and (not isinstance(routing["forwardRoute"], list) or len(routing["forwardRoute"]) > MAX_FORWARD_ROUTE_NODES or any(not identifier(item) for item in routing["forwardRoute"])):
        raise PeerFailure("PROTOCOL_INVALID")
    if "task" in required:
        task = record(value["task"], {"mode", "callerId", "callerGeneration", "targetGeneration"})
        if task["mode"] not in ("request", "notify", "stream", "group", "outcome") or not identifier(task["callerId"]):
            raise PeerFailure("PROTOCOL_INVALID")
        generation(task["callerGeneration"])
        generation(task["targetGeneration"])
        if task["mode"] in ("request", "notify", "stream"):
            if not identifier(task.get("method")) or not all(NAME_RE.fullmatch(part) for part in task["method"].split(".")):
                raise PeerFailure("PROTOCOL_INVALID")
    if kind in ("call", "group"):
        options = record(value["options"], set())
        if kind == "call" and value["task"]["mode"] not in ("request", "notify", "stream") or kind == "group" and value["task"]["mode"] != "group":
            raise PeerFailure("PROTOCOL_INVALID")
        if any(not identifier(options[field]) for field in ("orderKey", "idempotencyKey") if field in options) or "cancel" in options and options["cancel"] != "before-start" or value["task"]["mode"] == "notify" and "idempotencyKey" in options and options.get("cancel") != "before-start":
            raise PeerFailure("PROTOCOL_INVALID")
    if "extensions" in optional and "extensions" in value and not isinstance(value["extensions"], dict):
        raise PeerFailure("PROTOCOL_INVALID")
    for field in ("payload", "extensions"):
        if field in optional and field in value:
            portable(value[field])
    if kind == "result" and "result" in value:
        if value["task"]["mode"] == "group":
            validate_group_result(value["result"])
        else:
            portable(value["result"])
    elif kind == "result" and value["task"]["mode"] == "group":
        raise PeerFailure("PROTOCOL_INVALID")
    for field in ("error", "reason"):
        if field in required | optional and field in value:
            validate_error(value[field])
    if kind == "stream":
        if value["task"]["mode"] != "stream":
            raise PeerFailure("PROTOCOL_INVALID")
        validate_stream(value["stream"])
    if kind == "outcome":
        validate_outcome(value)
    if kind == "control" and value["operation"] not in ("ping", "pong", "drain", CONTROL_CLOSE):
        raise PeerFailure("PROTOCOL_INVALID")
    if kind == "directory":
        directory(value["directory"])
    if kind == "group":
        if not isinstance(value["steps"], list) or not value["steps"]:
            raise PeerFailure("PROTOCOL_INVALID")
        for step in value["steps"]:
            record(step, {"method"})
            if not identifier(step["method"]) or not all(NAME_RE.fullmatch(part) for part in step["method"].split(".")):
                raise PeerFailure("PROTOCOL_INVALID")
            if "payload" in step:
                portable(step["payload"])
    return value


def run_responder(reader: BinaryIO, writer: BinaryIO) -> None:
    """Use the same real session/business owner for standalone native peers."""
    from business import serve
    serve(reader, writer)


def run_initiator(reader: BinaryIO, writer: BinaryIO) -> None:
    """Prove the canonical peer handshake and direct echo without a reserved describe call."""
    local = own_offer()
    remote = handshake(reader, writer, local)
    payload = {"echo": "python", "number": 1}
    task = {"mode": "request", "callerId": local["peer"]["id"], "callerGeneration": local["directory"]["self"]["generation"], "targetGeneration": remote["directory"]["self"]["generation"], "method": "echo"}
    write_json(writer, {"profile": PROTOCOL, "kind": "call", "id": "python-echo-1", "route": route(local["peer"]["id"], remote["peer"]["id"]), "task": task, "options": {}, "payload": payload})
    raw = read_frame(reader)
    if raw is None:
        raise PeerFailure("MISSING_RESPONSE")
    answer = validate_frame(decode_frame(raw))
    if answer["kind"] != "result" or answer["id"] != "python-echo-1" or answer["task"] != task or answer.get("result") != payload:
        raise PeerFailure("WRONG_RESPONSE")
    print("RESULT ok", file=sys.stderr, flush=True)

def main() -> int:
    """Select stdio/socket transport while keeping stdout protocol-only."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stdio", action="store_true")
    parser.add_argument("--listen-unix")
    parser.add_argument("--connect-unix")
    parser.add_argument("--role", choices=("responder", "initiator"), default="responder")
    parser.add_argument("--business", action="store_true")
    parser.add_argument("--jsonrpc", action="store_true", help="historical pure JSON baseline label only")
    parser.add_argument("--bare-jsonrpc", action="store_true", help="parse/write JSON only; no RPC profile")
    parser.add_argument("--descendant", action="store_true")
    parser.add_argument("--non-idempotent-request", action="store_true")
    parser.add_argument("--bootstrap", choices=("none", "stdin"), default="none")
    parser.add_argument("--auth-fd", type=int)
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--vectors")
    args = parser.parse_args()
    if args.jsonrpc != args.bare_jsonrpc or args.bare_jsonrpc and (not args.business or not args.stdio):
        parser.error("retired semantic profile")
    if args.selftest:
        from selftest import run_selftest
        return run_selftest(args.vectors)
    if int(args.stdio) + int(bool(args.listen_unix)) + int(bool(args.connect_unix)) != 1:
        parser.error("select exactly one transport")
    if args.business:
        from business import run_business
        return run_business(args)
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
    except (PeerFailure, BrokenPipeError, ConnectionResetError, RecursionError) as error:
        code = error.code if isinstance(error, PeerFailure) else "RECURSION_ERROR" if isinstance(error, RecursionError) else "CHANNEL_CLOSED"
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
    # Business shares this exact framing/error owner when the file is launched as a script.
    sys.modules["peer"] = sys.modules[__name__]
    sys.dont_write_bytecode = True
    raise SystemExit(main())
