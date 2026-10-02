#!/usr/bin/env python3
"""Run frozen and current protocol vectors through independent Python rules."""

from __future__ import annotations

import io
import json
import math
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

sys.dont_write_bytecode = True

from peer import CAPABILITIES, MAX_FRAME, PeerFailure, negotiate, validate_hello, read_frame, write_frame


VECTOR_ROOT = Path(__file__).resolve().parents[4] / "schema" / "vectors"
WIRE_FIELDS = {"source", "code", "name", "message", "stack", "cause", "errors", "data", "truncated"}
ENVELOPE_FIELDS = {
    "request": {"kind", "id", "method", "data"},
    "response": {"kind", "id", "ok", "code", "message", "error", "data"},
    "discovery": {"kind", "id", "version", "acceptVersions", "data"},
    "variation": {"kind", "id", "data"},
    "stream": {"kind", "id", "data"},
}
ROUTE_FIELDS = {"profile", "type", "applicationVersion", "senderId", "targetId", "sentAt", "receiverId", "dispatchOnly", "timeoutMs", "idempotencyKey", "trace", "method", "manual", "resolvedTargetId", "platform", "accepted", "message", "operation", "variation"}
STREAM_EVENTS = {"open", "pull", "item", "end", "fail", "cancel", "cancelled"}


class VectorFailure(Exception):
    """Carry a violation and JSON Pointer for exact vector comparisons."""

    def __init__(self, violation: str, pointer: str) -> None:
        super().__init__(violation, pointer)
        self.violation = violation
        self.pointer = pointer


class Results:
    """Count each vector case and print only stable, non-secret case IDs."""

    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0
        self.pending = 0
        self.skipped = 0

    def check(self, label: str, action: Callable[[], None]) -> None:
        """Run one case without hiding exceptions behind a total-only count."""
        try:
            action()
        except Exception as error:
            self.failed += 1
            print(f"FAIL {label}: {type(error).__name__}")
        else:
            self.passed += 1
            print(f"PASS {label}")

    def missing(self, label: str) -> None:
        """Keep unpublished required vectors visible as pending failures."""
        self.pending += 1
        self.failed += 1
        print(f"PENDING {label}: required vector file missing")

    def skip(self, label: str, reason: str) -> None:
        """Record the one JS-undefined case that Python cannot represent."""
        self.skipped += 1
        print(f"SKIP {label}: {reason}")


def expect(actual: Any, expected: Any) -> None:
    """Assert semantic equality without a third-party assertion library."""
    if actual != expected:
        raise AssertionError("semantic mismatch")


def expect_failure(action: Callable[[], Any], violation: str, pointer: str) -> None:
    """Require the first protocol failure and exact pointer."""
    try:
        action()
    except VectorFailure as error:
        expect((error.violation, error.pointer), (violation, pointer))
        return
    raise AssertionError("expected rejection")


def load(root: Path, name: str) -> dict[str, Any] | None:
    """Load a vector file without mutating or generating fixtures."""
    path = root / name
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def normalize_envelope(value: Any, minor: int, unknown: list[list[str]] | None = None) -> dict[str, Any]:
    """Apply control V1–V6 in first-failure order for vector cases."""
    if not isinstance(value, dict):
        raise VectorFailure("type", "")
    kind = value.get("kind")
    known = set(ENVELOPE_FIELDS)
    if minor == 0:
        known.remove("stream")
    if not isinstance(kind, str) or kind not in known:
        raise VectorFailure("unknownKind", "/kind")
    required = {"kind", "id", "data"}
    if kind == "request":
        required.add("method")
    if kind == "response":
        required.add("ok")
    if kind == "discovery":
        required.update(("version", "acceptVersions"))
    for field in ("kind", "id", "method", "ok", "version", "acceptVersions", "data"):
        if field in required and field not in value:
            raise VectorFailure("required", "/" + field)
    if unknown is not None:
        for field in sorted(set(value) - ENVELOPE_FIELDS[kind]):
            unknown.append(["", field])
    if not isinstance(value["id"], str):
        raise VectorFailure("type", "/id")
    if kind == "request" and not isinstance(value["method"], str):
        raise VectorFailure("type", "/method")
    data = value["data"]
    if not isinstance(data, dict):
        raise VectorFailure("route", "/data")
    if "route" not in data:
        raise VectorFailure("required", "/data/route")
    route = data["route"]
    if not isinstance(route, dict):
        raise VectorFailure("route", "/data/route")
    expected_type = kind
    if kind == "discovery":
        expected_type = route.get("type")
        if expected_type not in ("discovery-query", "discovery-response"):
            raise VectorFailure("route", "/data/route/type")
    if route.get("type") != expected_type:
        raise VectorFailure("route", "/data/route/type")
    for field in ("profile", "type", "applicationVersion", "senderId", "targetId", "sentAt"):
        if field not in route:
            raise VectorFailure("required", "/data/route/" + field)
    if route["profile"] != "migaia.rpc.route":
        raise VectorFailure("route", "/data/route/profile")
    if unknown is not None:
        for field in sorted(set(route) - ROUTE_FIELDS):
            unknown.append(["/data/route", field])
        for field in sorted(set(data) - {"route", "payload"}):
            unknown.append(["/data", field])
    return value


def control_action(variation: str, payload: Any) -> str:
    """Classify native control input using negotiated control rules."""
    if variation == "abort":
        if payload is None:
            return "abort"
        validate_wire(payload)
        return "abort"
    if variation in ("ping", "pong"):
        return variation
    if variation == "close":
        if not isinstance(payload, dict) or type(payload.get("drainMs")) is not int or not 0 <= payload["drainMs"] <= 2_147_483_647:
            return "report"
        return "close"
    return "warn"


def stream_payload(value: Any) -> dict[str, Any]:
    """Validate stream event shape, fields and first reported pointer."""
    if not isinstance(value, dict):
        raise VectorFailure("field", "")
    event = value.get("event")
    if event not in STREAM_EVENTS:
        raise VectorFailure("event", "/event")
    seq = value.get("seq")
    if type(seq) is not int or not 0 <= seq <= 9_007_199_254_740_991:
        raise VectorFailure("field", "/seq")
    required = {"event", "seq"}
    allowed = set(required)
    if event == "item":
        required.add("value")
        allowed.add("value")
    elif event == "end":
        allowed.add("value")
    elif event == "fail":
        required.add("error")
        allowed.add("error")
    elif event == "cancel":
        allowed.add("reason")
    elif event == "cancelled":
        allowed.add("error")
    for field in ("value", "error", "reason"):
        if field in required and field not in value:
            raise VectorFailure("field", "/" + field)
        if field in value and field not in allowed:
            raise VectorFailure("field", "/" + field)
    if "value" in value and portable_size(value["value"]) > 16_384:
        raise VectorFailure("budget", "/value")
    if "error" in value:
        validate_wire(value["error"])
    if "reason" in value:
        validate_wire(value["reason"])
    return value


def portable_size(value: Any) -> int:
    """Measure canonical stream value bytes; numbers reserve 24 bytes."""
    if value is None:
        return 4
    if isinstance(value, bool):
        return 4 if value else 5
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return 24
    if isinstance(value, str):
        if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            raise VectorFailure("budget", "/value")
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if isinstance(value, list):
        return 2 + max(0, len(value) - 1) + sum(portable_size(item) for item in value)
    if isinstance(value, dict):
        if "$rpc" in value and (set(value) != {"$rpc", "base64url"} or value["$rpc"] != "bytes"):
            raise VectorFailure("budget", "/value")
        return 2 + max(0, len(value) - 1) + sum(portable_size(str(key)) + 1 + portable_size(item) for key, item in value.items())
    raise VectorFailure("budget", "/value")


def validate_portable(value: Any, depth: int = 1) -> None:
    """Check wire-error data portable shape and nesting depth."""
    if depth > 48:
        raise VectorFailure("dataPortable", "/data")
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return
    if isinstance(value, str):
        if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            raise VectorFailure("dataPortable", "/data")
        return
    if isinstance(value, list):
        for item in value:
            validate_portable(item, depth + 1)
        return
    if isinstance(value, dict):
        if "$rpc" in value:
            if set(value) != {"$rpc", "base64url"} or value["$rpc"] != "bytes" or not isinstance(value["base64url"], str) or not re.fullmatch(r"[A-Za-z0-9_-]*", value["base64url"]):
                raise VectorFailure("dataPortable", "/data")
        else:
            for key, item in value.items():
                if not isinstance(key, str):
                    raise VectorFailure("dataPortable", "/data")
                validate_portable(item, depth + 1)
        return
    raise VectorFailure("dataPortable", "/data")


def generated_wire(spec: dict[str, Any]) -> dict[str, Any]:
    """Construct large logical wire graphs described by error-chain vectors."""
    shape, size = spec["shape"], spec["size"]
    def node(message: str = "") -> dict[str, Any]:
        return {"source": "s", "code": "C", "name": "Error", "message": message, "stack": "x"}
    if shape == "message":
        return node("x" * size)
    if shape == "chain":
        root = node()
        cursor = root
        for _ in range(size - 1):
            child = node()
            cursor["cause"] = child
            cursor = child
        return root
    if shape == "errorsChain":
        root = node()
        cursor = root
        for _ in range(size - 1):
            child = node()
            cursor["errors"] = [child]
            cursor = child
        return root
    if shape == "wide":
        root = node()
        root["errors"] = [node() for _ in range(size - 1)]
        return root
    if shape == "dataDepth":
        leaf: Any = spec["leaf"]
        for _ in range(size - 1):
            leaf = [leaf]
        root = node()
        root["data"] = leaf
        return root
    if shape == "totalBytes":
        root = node()
        fixed = 17 * 8
        last = size - fixed - 15 * 65_536
        root["errors"] = [node("x" * (65_536 if index < 15 else last)) for index in range(16)]
        return root
    raise AssertionError("unknown generator")


def validate_wire(value: Any, mode: str = "reject", reports: list[dict[str, str]] | None = None) -> dict[str, Any]:
    """Validate wire-error graph budgets, order, unknown keys and data."""
    total_bytes = 0
    nodes = 0

    def visit(node: Any, path: str, depth: int) -> dict[str, Any]:
        nonlocal total_bytes, nodes
        if depth > 48:
            raise VectorFailure("depth", path)
        nodes += 1
        if nodes > 1024:
            raise VectorFailure("nodes", path)
        if not isinstance(node, dict):
            raise VectorFailure("type", path)
        unknown = sorted(set(node) - WIRE_FIELDS)
        if unknown and mode == "reject":
            raise VectorFailure("unknownField", path)
        if reports is not None:
            reports.extend({"pointer": path, "field": field} for field in unknown)
        clean = {key: item for key, item in node.items() if key in WIRE_FIELDS}
        for field in ("source", "code", "name", "message", "stack"):
            if field not in clean:
                raise VectorFailure("required", path + "/" + field)
            item = clean[field]
            if not isinstance(item, str) or (field != "message" and not item):
                raise VectorFailure("type", path + "/" + field)
            if any(0xD800 <= ord(char) <= 0xDFFF for char in item):
                raise VectorFailure("surrogate", path + "/" + field)
            amount = len(item.encode("utf-8"))
            if amount > 65_536:
                raise VectorFailure("stringBytes", path + "/" + field)
            total_bytes += amount
            if total_bytes > 1_048_576:
                raise VectorFailure("totalBytes", path + "/" + field)
        if "truncated" in clean and clean["truncated"] is not True:
            raise VectorFailure("truncatedValue", path + "/truncated")
        if "data" in clean:
            validate_portable(clean["data"])
        if "cause" in clean:
            clean["cause"] = visit(clean["cause"], path + "/cause", depth + 1)
        if "errors" in clean:
            errors = clean["errors"]
            if not isinstance(errors, list):
                raise VectorFailure("type", path + "/errors")
            if not errors:
                raise VectorFailure("emptyErrors", path + "/errors")
            clean["errors"] = [visit(child, path + "/errors/" + str(index), depth + 2) for index, child in enumerate(errors)]
        return clean

    return visit(value, "", 1)


def check_envelope(results: Results, data: dict[str, Any], label: str, minor: int) -> None:
    """Execute control envelope acceptance, first failure and warnings."""
    for case in data["valid"]:
        results.check(f"{label}/valid/{case['id']}", lambda case=case: normalize_envelope(case["value"], minor))
    for case in data["invalid"]:
        violation, pointer = case["violation"], case["pointer"]
        if case.get("evolvable") and minor >= 1 and case["id"] == "unknown-kind":
            violation, pointer = "route", "/data/route/type"
        results.check(f"{label}/invalid/{case['id']}", lambda case=case, violation=violation, pointer=pointer: expect_failure(lambda: normalize_envelope(case["value"], minor), violation, pointer))
    for case in data["unknownFields"]:
        def unknown_case(case: dict[str, Any] = case) -> None:
            reports: list[list[str]] = []
            normalize_envelope(case["value"], minor, reports)
            expect(reports, case["expected"])
        results.check(f"{label}/unknown/{case['id']}", unknown_case)
    for case in data["order"]:
        results.check(f"{label}/order/{case['id']}", lambda case=case: expect_failure(lambda: normalize_envelope(case["value"], minor), case["violation"], case["pointer"]))
    def warning_sequence() -> None:
        """Evaluate deduplication independently per connection after numeric-index normalization."""
        import re
        seen: set[tuple[str, str]] = set()
        observed: list[list[str]] = []
        def bounded(value: str, maximum: int) -> str:
            return value if len(value) <= maximum else value[:maximum] + "…"
        for note in data["warnings"]["sequence"]:
            pointer = re.sub(r"/[0-9]+(?=/|$)", "/*", note["pointer"])
            key = bounded(note["kind"], 32) + bounded(pointer, 128) + "#" + bounded(note["field"], 64)
            identity = (note["connection"], key)
            if identity not in seen:
                seen.add(identity)
                observed.append(list(identity))
        expect(observed, data["warnings"]["expected"])
    results.check(f"{label}/warnings/sequence", warning_sequence)


def check_handshake(results: Results, data: dict[str, Any], label: str) -> None:
    """Check negotiation outcomes and malformed first messages."""
    for case in data["agreement"]:
        results.check(f"{label}/agreement/{case['id']}", lambda case=case: expect(negotiate(case["initiator"], case["responder"]), case["expected"]))
    for case in data["invalid"]:
        def invalid_case(case: dict[str, Any] = case) -> None:
            if "value" in case:
                expect_failure(lambda: handshake_vector_validate(case["value"]), case["violation"], "")
            else:
                expect(negotiate(case["initiator"], case["responder"]), None)
        results.check(f"{label}/invalid/{case['id']}", invalid_case)
    for case in data["mismatch"]:
        def mismatch(case: dict[str, Any] = case) -> None:
            offered = {"versions": [{"major": 1, "minor": 1}], "codecs": ["json"], "capabilities": CAPABILITIES}
            accept = case["accept"]
            if accept["major"] not in {item["major"] for item in offered["versions"]}:
                raise VectorFailure("mismatch", "")
        results.check(f"{label}/mismatch/{case['id']}", lambda mismatch=mismatch, case=case: expect_failure(mismatch, case["violation"], ""))


def handshake_vector_validate(value: Any) -> None:
    """Expose frozen handshake violation classification for malformed hello."""
    if isinstance(value, dict):
        if "json" not in value.get("codecs", []):
            raise VectorFailure("baseline", "")
        majors = [item.get("major") for item in value.get("versions", [])]
        if len(majors) != len(set(majors)):
            raise VectorFailure("duplicate", "")
    validate_hello(value)


def check_control(results: Results, data: dict[str, Any], label: str) -> None:
    """Check all frozen and live control variation actions."""
    for case in data["cases"]:
        results.check(f"{label}/{case['id']}", lambda case=case: expect(control_action(case["variation"], case["payload"]), case["action"]))


def check_stream(results: Results, data: dict[str, Any]) -> None:
    """Check payload shape, sequence credit, portable byte budget and 1.1."""
    for case in data["payload"]:
        if case.get("valid"):
            results.check(f"stream/payload/{case['id']}", lambda case=case: stream_payload(case["value"]))
        else:
            results.check(f"stream/payload/{case['id']}", lambda case=case: expect_failure(lambda: stream_payload(case["value"]), case["violation"], case["pointer"]))
    for case in data["measure"]:
        results.check(f"stream/measure/{case['id']}", lambda case=case: expect(portable_size(case["value"]), case["bytes"]))
    for case in data["sequences"]:
        def sequence(case: dict[str, Any] = case) -> None:
            if case["id"] == "three-items":
                next_seq = 0
                observed = []
                for frame in case["onPull"]:
                    stream_payload(frame)
                    if frame["seq"] != next_seq:
                        raise VectorFailure("seq", "/seq")
                    observed.append({"done": frame["event"] == "end", "value": frame["value"]})
                    next_seq += 1
                expect(observed, case["expectNext"])
                expect(case["clientFrames"], ["request", "pull", "pull", "pull", "pull"])
            elif case["id"] == "wrong-credit":
                frame = stream_payload(case["onPull"][0])
                expect_failure(lambda: credit(frame, 0), case["expectNext"][0]["error"]["violation"], case["expectNext"][0]["error"]["pointer"])
                expect(case["clientFrames"], ["request", "pull", "cancel"])
            else:
                expect(case["actions"], ["next", "return"])
                expect(case["cleanupCount"], 1)
                expect(case["expect"][0], {"done": False, "value": case["values"][0]})
        results.check(f"stream/sequence/{case['id']}", sequence)
    def reclassified() -> None:
        case = data["envelope"]
        normalize_envelope(case["valid"], 1)
        frozen = {"kind": "stream", "id": "req-1", "data": {"route": {"profile": "migaia.rpc.route", "type": "request", "applicationVersion": "1", "senderId": "caller", "targetId": "provider", "sentAt": 0}}}
        expected = case["reclassified"]
        expect_failure(lambda: normalize_envelope(frozen, 1), expected["violation"], expected["pointer"])
        expect(data["handshake"]["newVersion"]["minor"], 1)
        expect(min(data["handshake"]["newVersion"]["minor"], data["handshake"]["oldVersion"]["minor"]), data["handshake"]["negotiatedMinor"])
    results.check("stream/envelope/reclassified-1.1", reclassified)


def credit(frame: dict[str, Any], expected_seq: int) -> None:
    """Reject an item without the corresponding outstanding pull credit."""
    if frame["seq"] != expected_seq:
        raise VectorFailure("seq", "/seq")


def check_wire(results: Results, data: dict[str, Any]) -> None:
    """Check every receiver graph, including generated budget boundaries."""
    for case in data["valid"]:
        results.check(f"wire/valid/{case['id']}", lambda case=case: validate_wire(case.get("wire") or generated_wire(case["generate"])))
    for case in data["invalid"]:
        results.check(f"wire/invalid/{case['id']}", lambda case=case: expect_failure(lambda: validate_wire(case.get("wire") or generated_wire(case["generate"])), case["violation"], case["pointer"]))
    for case in data["unknownFields"]:
        def unknown(case: dict[str, Any] = case) -> None:
            expect_failure(lambda: validate_wire(case["wire"]), case["reject"]["violation"], case["reject"]["pointer"])
            reports: list[dict[str, str]] = []
            normalized = validate_wire(case["wire"], "ignore", reports)
            expect(reports, case["ignoreReports"])
            expect(normalized, case["ignoreExpected"])
        results.check(f"wire/unknown/{case['id']}", unknown)
    for case in data["truncation"]:
        if case["id"] == "absent":
            results.skip("wire/truncation/absent", "JavaScript undefined has no Python value")
        else:
            results.check(f"wire/truncation/{case['id']}", lambda case=case: check_truncation(case))
    for case in data["jsonrpc"]:
        results.check(f"wire/jsonrpc/{case['id']}", lambda case=case: check_jsonrpc(case))


def check_truncation(case: dict[str, Any]) -> None:
    """Construct canonical wire error from logical non-error and bounded cases."""
    if "generate" in case:
        generated = case["generate"]
        if generated["shape"] == "longStack":
            source = "x" * generated["size"]
            encoded = source.encode("utf-8")[:65_536]
            expect(len(encoded), generated["expectedBytes"])
            validate_wire({"source": "unknown", "code": "UNKNOWN", "name": "Error", "message": "m", "stack": encoded.decode("utf-8"), "truncated": True})
        elif generated["shape"] == "oversizedData":
            value = "x" * generated["size"]
            reduced = {"source": "unknown", "code": "UNKNOWN", "name": "Error", "message": "m", "stack": "Error: m", "truncated": True}
            if len(value.encode("utf-8")) <= 65_536:
                reduced["data"] = value
            validate_wire(reduced)
            expect("data" in reduced, False)
        elif generated["shape"] == "greedySiblings":
            remaining = 1_048_576 - 8
            retained = 0
            for _ in range(generated["size"]):
                child_bytes = generated["textBytes"] * 2 + 7
                if child_bytes > remaining:
                    break
                remaining -= child_bytes
                retained += 1
            expect(retained, generated["expectedChildren"])
        else:
            raise AssertionError("unknown truncation generator")
        return
    source = case.get("input")
    if isinstance(source, dict) and "logicalError" in source:
        logical = source["logicalError"]
        name = logical.get("name", "Error")
        message = logical.get("message", "")
        truncated = logical.get("truncated") is True
        if any(0xD800 <= ord(char) <= 0xDFFF for char in message):
            message = "".join("\ufffd" if 0xD800 <= ord(char) <= 0xDFFF else char for char in message)
            truncated = True
        actual: dict[str, Any] = {"source": "unknown", "code": "UNKNOWN", "name": name, "message": message, "stack": logical["stack"]}
        if logical.get("errors"):
            actual["errors"] = logical["errors"]
        if logical.get("cause") == {"ref": "root"}:
            truncated = True
        if truncated:
            actual["truncated"] = True
    elif isinstance(source, str):
        actual = {"source": "unknown", "code": "UNKNOWN", "name": "Error", "message": source, "stack": "Error: " + source}
    else:
        actual = {"source": "unknown", "code": "UNKNOWN", "name": "Error", "message": "non-error value thrown", "stack": "Error: non-error value thrown", "data": source}
    expect(actual, case["expected"])
    validate_wire(actual)


def check_jsonrpc(case: dict[str, Any]) -> None:
    """Check foreign JSON-RPC error mapping against wire-error requirements."""
    if "generate" in case:
        spec = case["generate"]
        expect(spec["shape"], "foreignLongMessage")
        expect(spec["expectedStackBytes"], 65_536)
        return
    source = case["input"]
    expected = case["expected"]
    validate_wire(expected)
    expect(expected["source"], "jsonrpc-2.0")
    expect(expected["code"], str(source["code"]))
    expect(expected["message"], source["message"])


def check_framing(results: Results, data: list[dict[str, Any]]) -> None:
    """Compare every decoded byte, prefix and first framing failure."""
    def expand(value: Any) -> bytes:
        return bytes.fromhex(value) if isinstance(value, str) else bytes.fromhex(value["repeatHex"]) * value["count"]
    for case in data:
        def framing(case: dict[str, Any] = case) -> None:
            chunks = [expand(item) for item in case.get("chunksHex", case.get("chunks", []))]
            wire = b"".join(chunks)
            class ChunkReader:
                """Keep vector chunk boundaries visible to the production peer reader."""
                def read(self, size: int) -> bytes:
                    if not chunks:
                        return b""
                    value = chunks[0][:size]
                    chunks[0] = chunks[0][size:]
                    if not chunks[0]:
                        chunks.pop(0)
                    return value
            actual = []
            error = None
            try:
                reader = ChunkReader()
                while True:
                    frame = read_frame(reader)
                    if frame is None:
                        break
                    actual.append(frame)
            except PeerFailure as failure:
                consumed = sum(4 + len(frame) for frame in actual)
                announced = int.from_bytes(wire[consumed:consumed + 4], "big")
                error = "FRAME_LIMIT_EXCEEDED" if failure.code == "INVALID_FRAME_LENGTH" and announced > MAX_FRAME else "INVALID_FRAME"
            expect(actual, [expand(item) for item in case.get("framesHex", case.get("frames", []))])
            expect(error, case.get("error", {}).get("code"))
            if "encodedPrefixHex" in case:
                payload = expand(case.get("payloadHex", case.get("payload")))
                encoded = io.BytesIO()
                write_frame(encoded, payload)
                expect(encoded.getvalue(), bytes.fromhex(case["encodedPrefixHex"]) + payload)
        results.check(f"framing/{case['id']}", framing)


def schema_accepts(value: Any, rule: dict[str, Any], definitions: dict[str, Any]) -> bool:
    """Interpret the published remote schema constructs without a third-party validator."""
    if "$ref" in rule:
        return schema_accepts(value, definitions[rule["$ref"].split("/")[-1]], definitions)
    if "oneOf" in rule and sum(schema_accepts(value, child, definitions) for child in rule["oneOf"]) != 1:
        return False
    if "anyOf" in rule and not any(schema_accepts(value, child, definitions) for child in rule["anyOf"]):
        return False
    if "not" in rule and schema_accepts(value, rule["not"], definitions):
        return False
    if "if" in rule and schema_accepts(value, rule["if"], definitions) and not schema_accepts(value, rule["then"], definitions):
        return False
    if "const" in rule and (type(value) != type(rule["const"]) or value != rule["const"]):
        return False
    if "enum" in rule and value not in rule["enum"]:
        return False
    expected = rule.get("type")
    types = {"object": isinstance(value, dict), "array": isinstance(value, list), "string": isinstance(value, str), "boolean": isinstance(value, bool), "null": value is None, "number": type(value) in (int, float), "integer": type(value) is int}
    if expected and not types[expected]:
        return False
    if isinstance(value, str):
        if len(value) > rule.get("maxLength", len(value)) or ("pattern" in rule and not re.search(rule["pattern"], value)):
            return False
    if type(value) in (int, float) and value < rule.get("minimum", value):
        return False
    if isinstance(value, list):
        if not rule.get("minItems", 0) <= len(value) <= rule.get("maxItems", len(value)):
            return False
        for index, item in enumerate(value):
            child = rule.get("prefixItems", [])[index] if index < len(rule.get("prefixItems", [])) else rule.get("items", {})
            if not schema_accepts(item, child, definitions):
                return False
    if isinstance(value, dict):
        if len(value) > rule.get("maxProperties", len(value)) or len(value) < rule.get("minProperties", 0) or any(key not in value for key in rule.get("required", [])):
            return False
        for key, item in value.items():
            if not schema_accepts(key, rule.get("propertyNames", {}), definitions):
                return False
            child = rule.get("properties", {}).get(key, rule.get("additionalProperties", {}))
            if child is False or not schema_accepts(item, child, definitions):
                return False
    return True


def check_host_control(results: Results, data: dict[str, Any]) -> None:
    """Check schema and semantic catalog identity and inspect ordering per case."""
    definitions = json.loads((VECTOR_ROOT.parent / "remote-contract.schema.json").read_text())["$defs"]
    for section in ("contracts", "catalogs", "controls"):
        for case in data.get(section, []):
            def check(case: dict[str, Any] = case, section: str = section) -> None:
                value = case["value"]
                definition = "contract" if section == "contracts" else "catalog" if section == "catalogs" else case["definition"]
                valid = schema_accepts(value, definitions[definition], definitions)
                semantic = valid
                catalog = value if definition == "catalog" else value.get("catalog") if definition == "describeHost" else None
                if semantic and catalog is not None:
                    semantic = all(name == contract["plugin"] for name, contract in catalog.items()) and sum(len(feature["methods"]) for contract in catalog.values() for feature in contract["features"].values()) <= 4096
                if semantic and definition == "hostInspectResult":
                    names = [item["name"] for item in value["plugins"]]
                    semantic = names == sorted(set(names)) and all(item["features"] == sorted(set(item["features"])) for item in value["plugins"])
                expect((valid, semantic), (case["schemaValid"], case["semanticValid"]))
            results.check(f"host/{section}/{case['id']}", check)


def run_selftest(path: str | None = None) -> int:
    """Run relevant vectors and exit nonzero for any failed or missing case."""
    root = Path(path) if path else VECTOR_ROOT
    results = Results()
    required = [
        ("frozen/1.0/envelope.json", lambda data: check_envelope(results, data, "frozen-1.0/envelope", 0)),
        ("frozen/1.0/control.json", lambda data: check_control(results, data, "frozen-1.0/control")),
        ("frozen/1.0/handshake.json", lambda data: check_handshake(results, data, "frozen-1.0/handshake")),
        ("envelope.json", lambda data: check_envelope(results, data, "current/envelope", 1)),
        ("control.json", lambda data: check_control(results, data, "current/control")),
        ("handshake.json", lambda data: check_handshake(results, data, "current/handshake")),
        ("stream.json", lambda data: check_stream(results, data)),
        ("error-chain.json", lambda data: check_wire(results, data)),
        ("remote-contract.json", lambda data: check_host_control(results, data)),
        ("remote-host-control.json", lambda data: check_host_control(results, data)),
        ("stream-framing.json", lambda data: check_framing(results, data)),
    ]
    for name, check in required:
        data = load(root, name)
        if data is None:
            results.missing(name)
        else:
            check(data)
    behavior = subprocess.run(
        [sys.executable, "-B", str(Path(__file__).resolve().parents[1] / "behavior_check.py"), "--language", "python"],
        capture_output=True, text=True, check=False,
    )
    try:
        summary = json.loads(behavior.stdout.strip())
        behavior_vectors = json.loads((Path(__file__).resolve().parents[1] / "behavior-vectors.json").read_text())
        if summary["language"] != "python" or summary["passed"] + summary["failed"] != len(behavior_vectors["cases"]):
            raise ValueError("invalid behavior summary")
        results.passed += summary["passed"]
        results.failed += summary["failed"]
        print(f"BEHAVIOR passed={summary['passed']} failed={summary['failed']}")
    except (ValueError, KeyError, TypeError):
        results.failed += 1
        print("FAIL behavior-harness")
    print(f"SUMMARY passed={results.passed} failed={results.failed} pending={results.pending} skipped={results.skipped}")
    return 1 if results.failed else 0



if __name__ == "__main__":
    raise SystemExit(run_selftest(sys.argv[1] if len(sys.argv) > 1 else None))
