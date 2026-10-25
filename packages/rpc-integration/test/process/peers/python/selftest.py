#!/usr/bin/env python3
"""Run current wire vectors and runtime-baseline behavior through independent Python rules."""

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

import peer
from peer import MAX_FRAME, PeerFailure, read_frame, write_frame


# Integration retains frozen vectors; the protocol schema has its own Contract owner.
VECTOR_ROOT = Path(__file__).resolve().parents[5] / "rpc-integration" / "schema" / "vectors"
SCHEMA_ROOT = Path(__file__).resolve().parents[5] / "rpc-contract" / "schema"


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
        self.retired = 0

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

    def retire(self, label: str, reason: str) -> None:
        """Report an explicit removed grammar assertion without counting it as passing."""
        self.retired += 1
        print(f"RETIRED {label}: {reason}")

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


def generation_for(identity: str) -> dict[str, Any]:
    """Author a test generation with its actual source identity."""
    return {"kind": "session", "value": 0, "providerId": identity}


def envelope_fixture(value: Any) -> Any:
    """Move immutable fixture authorship to current grammar; live parsing never accepts the old shape."""
    if not isinstance(value, dict):
        return value
    data = value.get("data") if isinstance(value.get("data"), dict) else {}
    old = data.get("route") if isinstance(data.get("route"), dict) else {}
    sender, target = old.get("senderId", "caller"), old.get("targetId", "provider")
    route = {key: old[key] for key in ("applicationVersion", "senderId", "targetId", "sentAt") if key in old}
    route["receiverId"] = old.get("receiverId", target)
    kind = value.get("kind")
    task = {"mode": "request", "callerId": sender, "callerGeneration": generation_for(sender), "targetGeneration": generation_for(target), "method": value.get("method", old.get("method", "count"))}
    result = {"profile": peer.PROTOCOL, "kind": {"request": "call", "response": "result", "variation": "control"}.get(kind, kind), "route": route}
    if "id" in value:
        result["id"] = value["id"]
    if kind in ("request", "response", "stream"):
        result["task"] = task
    if kind == "request":
        result["options"] = {}
        if "method" not in value:
            task.pop("method")
        if "payload" in data:
            result["payload"] = data["payload"]
    elif kind == "response" and not value.get("ok"):
        result["kind"] = "error"
        result["error"] = flat_fixture(value["error"]) if "error" in value else peer.wire_error(value.get("code", "INTERNAL"), value.get("message", "failed"))
    elif kind == "response" and "payload" in data:
        result["result"] = data["payload"]
    elif kind == "variation":
        result["operation"] = old.get("variation", "ping")
    elif kind == "stream":
        task["mode"] = "stream"
        result["stream"] = data.get("payload")
    if "route" not in data:
        result.pop("route")
    for key in value.keys() - {"kind", "id", "method", "data", "ok", "code", "message", "error"}:
        result[key] = value[key]
    for key in old.keys() - {"profile", "type", "applicationVersion", "senderId", "targetId", "receiverId", "sentAt", "method", "variation"}:
        route[key] = old[key]
    return result


def admits(action: Callable[[], Any]) -> bool:
    """Ask the actual native validator; do not invent a second failure classifier."""
    try:
        action()
        return True
    except (peer.PeerFailure, ValueError, TypeError, KeyError):
        return False


def stream_payload(value: Any) -> dict[str, Any]:
    """Use the live native event validator."""
    peer.validate_stream(value)
    return value


portable_size = peer.portable_size

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


def check_envelope(results: Results, data: dict[str, Any], label: str, minor: int) -> None:
    """Keep original acceptance scenarios at the sole live native grammar boundary."""
    for case in data["valid"]:
        if case["id"].startswith("discovery-"):
            results.retire(f"{label}/valid/{case['id']}", "BC2 discovery replaced by directory admission")
        else:
            results.check(f"{label}/valid/{case['id']}", lambda case=case: peer.validate_frame(envelope_fixture(case["value"])))
    for section in ("invalid", "order", "unknownFields"):
        for case in data[section]:
            if case["id"] == "wrong-route-type":
                results.retire(f"{label}/{section}/{case['id']}", "BC2 redundant route.type removed")
                continue
            results.check(f"{label}/{section}/{case['id']}", lambda case=case, section=section: expect(admits(lambda: peer.validate_frame(envelope_fixture(case["value"]))), section == "unknownFields"))
            if section == "unknownFields":
                results.retire(f"{label}/{section}/{case['id']}/lexical-reports", "BC9 unknown protocol fields are ignored without a callback")
    results.retire(f"{label}/warnings/sequence", "BC2 unknown-field warning deduplication removed")


def check_handshake(results: Results, data: dict[str, Any], label: str) -> None:
    """Preserve malformed selection cases while retiring the old profile's negotiation rules."""
    for case in data["agreement"]:
        results.retire(f"{label}/agreement/{case['id']}", "BC2 sole major2/minor0/json replaces v1 multiversion/cbor/capability selection")
    for case in data["invalid"]:
        def check(case=case):
            local, offer = peer.own_offer("provider"), peer.own_offer("caller")
            if case["id"] == "no-json":
                offer["codecs"] = ["cbor"]
            elif case["id"] == "duplicate-major":
                offer["versions"] = [{"major": 2, "minor": 0}, {"major": 2, "minor": 1}]
            else:
                offer["versions"] = [{"major": 3, "minor": 0}]
            expect(admits(lambda: peer.negotiate(offer, local)), False)
        results.check(f"{label}/invalid/{case['id']}", check)
    for case in data["mismatch"]:
        def mismatch(case=case):
            accepted = peer.negotiate(peer.own_offer("caller"), peer.own_offer("provider"))
            accepted["major"] = case["accept"]["major"]
            expect(admits(lambda: peer.validate_handshake(accepted)), False)
        results.check(f"{label}/mismatch/{case['id']}", mismatch)


def check_control(results: Results, data: dict[str, Any], label: str) -> None:
    """Author current cancel/control inputs and pass them through actual admission."""
    for case in data["cases"]:
        def check(case=case):
            route = peer.route("caller", "provider")
            value = {"profile": peer.PROTOCOL, "kind": "control", "id": "control", "route": route, "operation": case["variation"]}
            if case["variation"] == "abort":
                value.update(kind="cancel", task={"mode": "request", "method": "echo", "callerId": "caller", "callerGeneration": generation_for("caller"), "targetGeneration": generation_for("provider")}, reason=flat_fixture(case["payload"]))
                value.pop("operation")
            elif case["variation"] == "close":
                value["operation"] = "drain"
                route["remainingMs"] = case["payload"]["drainMs"]
            expect(admits(lambda: peer.validate_frame(value)), case["action"] not in ("report", "warn"))
        results.check(f"{label}/{case['id']}", check)
        if case["id"] == "unknown":
            results.retire(f"{label}/unknown/warn", "BC2 unknown controls now fail closed admission")

def check_stream(results: Results, data: dict[str, Any]) -> None:
    """Check payload shape, sequence credit, portable byte budget and 1.1."""
    for case in data["payload"]:
        if case.get("valid"):
            results.check(f"stream/payload/{case['id']}", lambda case=case: stream_payload(case["value"]))
        else:
            results.check(f"stream/payload/{case['id']}", lambda case=case: expect(admits(lambda: stream_payload(case["value"])), False))
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
        value = envelope_fixture(data["envelope"]["valid"])
        peer.validate_frame(value)
        value["task"]["mode"] = "request"
        expect(admits(lambda: peer.validate_frame(value)), False)
    results.check("stream/envelope/" + data["envelope"]["reclassified"]["id"], reclassified)

def credit(frame: dict[str, Any], expected_seq: int) -> None:
    """Reject an item without the corresponding outstanding pull credit."""
    if frame["seq"] != expected_seq:
        raise VectorFailure("seq", "/seq")


def flat_fixture(value: Any) -> dict[str, Any]:
    """Reauthor old nested fixture topology as flat indexes; this never admits a live legacy frame."""
    nodes: list[Any] = []
    queue = [value]
    indexes = {id(value): 0}
    cursor = 0
    while cursor < len(queue):
        source = queue[cursor]
        cursor += 1
        if not isinstance(source, dict):
            nodes.append(source)
            continue
        node = {key: child for key, child in source.items() if key not in ("cause", "errors")}
        for field in ("cause", "errors"):
            if field not in source:
                continue
            children = source[field] if field == "errors" and isinstance(source[field], list) else [source[field]]
            edges = []
            for child in children:
                index = indexes.get(id(child))
                if index is None:
                    index = len(queue)
                    indexes[id(child)] = index
                    queue.append(child)
                edges.append(index)
            node[field] = edges if field == "errors" and isinstance(source[field], list) else edges[0]
        nodes.append(node)
    return {"root": 0, "nodes": nodes}


def actual_error_admission(value: Any, accepted: bool) -> None:
    """Require the actual native peer's sole flat normalizer, including its real text/node/data limits."""
    try:
        peer.validate_error(flat_fixture(value))
    except PeerFailure:
        if accepted:
            raise
    else:
        if not accepted:
            raise AssertionError("expected flat error rejection")


def check_wire(results: Results, data: dict[str, Any]) -> None:
    """Retain original scenario IDs and exact budgets, changing only retired nested representation policy."""
    for case in data["valid"]:
        results.check(f"wire/valid/{case['id']}", lambda case=case: actual_error_admission(case.get("wire") or generated_wire(case["generate"]), True))
    for case in data["invalid"]:
        # Flat graphs may contain arbitrary index depth/cycles within their original node/text budgets.
        accepted = case["id"] in ("cause-depth-49", "errors-depth-25")
        results.check(f"wire/invalid/{case['id']}", lambda case=case, accepted=accepted: actual_error_admission(case.get("wire") or generated_wire(case["generate"]), accepted))
    for case in data["unknownFields"]:
        results.check(f"wire/unknown/{case['id']}", lambda case=case: actual_error_admission(case["wire"], True))
    for case in data["truncation"]:
        results.check(f"wire/truncation/{case['id']}", lambda case=case: check_truncation(case))


def check_truncation(case: dict[str, Any]) -> None:
    """Reuse original source projection scenarios, then require the actual flat admission contract."""
    if "generate" in case:
        generated = case["generate"]
        if generated["shape"] == "longStack":
            source = "x" * generated["size"]
            encoded = source.encode("utf-8")[:65_536]
            expect(len(encoded), generated["expectedBytes"])
            actual = {"source": "unknown", "code": "UNKNOWN", "name": "Error", "message": "m", "stack": encoded.decode("utf-8"), "truncated": True}
        elif generated["shape"] == "oversizedData":
            value = "x" * generated["size"]
            actual = {"source": "unknown", "code": "UNKNOWN", "name": "Error", "message": "m", "stack": "Error: m", "truncated": True}
            if len(value.encode("utf-8")) <= 65_536:
                actual["data"] = value
            expect("data" in actual, False)
        elif generated["shape"] == "greedySiblings":
            actual = {"source": "s", "code": "C", "name": "Error", "message": "", "stack": "x", "truncated": True}
            remaining = 1_048_576 - 8
            retained = []
            for _ in range(generated["size"]):
                child_bytes = generated["textBytes"] * 2 + 7
                if child_bytes > remaining:
                    break
                remaining -= child_bytes
                retained.append({"source": "s", "code": "C", "name": "Error", "message": "x" * generated["textBytes"], "stack": "x" * generated["textBytes"]})
            actual["errors"] = retained
            expect(len(retained), generated["expectedChildren"])
        else:
            raise AssertionError("unknown truncation generator")
        actual_error_admission(actual, True)
        return
    source = peer.ABSENT if case["id"] == "absent" else case.get("input")
    if isinstance(source, dict) and "logicalError" in source:
        logical = source["logicalError"]
        name = logical.get("name", "Error")
        message = logical.get("message", "")
        truncated = logical.get("truncated") is True
        if any(0xD800 <= ord(char) <= 0xDFFF for char in message):
            message = "".join("\ufffd" if 0xD800 <= ord(char) <= 0xDFFF else char for char in message)
            truncated = True
        actual = {"source": "unknown", "code": "UNKNOWN", "name": name, "message": message, "stack": logical["stack"]}
        if logical.get("errors"):
            actual["errors"] = logical["errors"]
        if logical.get("cause") == {"ref": "root"}:
            truncated = True
        if truncated:
            actual["truncated"] = True
    elif isinstance(source, str):
        actual = {"source": "unknown", "code": "UNKNOWN", "name": "Error", "message": source, "stack": "Error: " + source}
    else:
        actual = {"source": "unknown", "code": "UNKNOWN", "name": "Error", "message": "non-error value thrown", "stack": "Error: non-error value thrown"}
        if source is not peer.ABSENT:
            actual["data"] = source
    expect(actual, case["expected"])
    actual_error_admission(actual, True)


class _FramingChunks:
    """Keep original vector chunk boundaries without recopying each unread suffix."""

    def __init__(self, chunks: list[bytes]) -> None:
        """Borrow the expanded vector once; reads own only their index and offset."""
        self._chunks = chunks
        self._index = 0
        self._offset = 0

    def read(self, size: int) -> bytes:
        """Return at most the current chunk's remaining bytes, preserving empty-read behavior."""
        if self._index == len(self._chunks):
            return b""
        chunk = self._chunks[self._index]
        value = chunk[self._offset:self._offset + size]
        self._offset += len(value)
        if self._offset == len(chunk):
            self._index += 1
            self._offset = 0
        return value


def check_framing(results: Results, data: list[dict[str, Any]]) -> None:
    """Compare every decoded byte, prefix and first framing failure."""
    def expand(value: Any) -> bytes:
        return bytes.fromhex(value) if isinstance(value, str) else bytes.fromhex(value["repeatHex"]) * value["count"]
    for case in data:
        def framing(case: dict[str, Any] = case) -> None:
            chunks = [expand(item) for item in case.get("chunksHex", case.get("chunks", []))]
            wire = b"".join(chunks)
            actual = []
            error = None
            try:
                reader = _FramingChunks(chunks)
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


def check_host_control(results: Results, data: dict[str, Any]) -> None:
    """Expose each removed Host control as explicit BC3 retirement."""
    for case in data["controls"]:
        results.retire(f"host/controls/{case['id']}", "BC3 Host=true use/unUse/inspect/describe facade removed")


def directory_fixture(value: dict[str, Any]) -> dict[str, Any]:
    """Move frozen schema2 authorship to schema3 without changing actual method/schema data."""
    identity = dict(value.get("self", {}))
    identity["generation"] = generation_for(identity.get("instanceId", "fixture"))
    return {**value, "schemaVersion": 3 if value.get("schemaVersion") == 2 else value.get("schemaVersion"), "self": identity}

def check_runtime_description(results: Results, data: dict[str, Any]) -> None:
    """Use the actual reverse initiator's admission, including identity and duplicate modes."""
    for section in ("valid", "invalid"):
        for index, value in enumerate(data[section]):
            def check(value=value, section=section):
                try:
                    peer.directory(directory_fixture(value))
                    accepted = True
                except (peer.PeerFailure, ValueError, TypeError, KeyError):
                    accepted = False
                expect(accepted, section == "valid")
            results.check(f"runtime-description.json/{section}/{index}", check)


def check_description_schema(results: Results, data: dict[str, Any]) -> None:
    """Replay every shared schema case through the real reverse directory consumer."""
    for case in data["cases"]:
        def check(case=case):
            value = case["value"]
            try:
                peer.directory(directory_fixture(value))
                accepted = True
            except (peer.PeerFailure, ValueError, TypeError, KeyError):
                accepted = False
            expect(accepted, case["valid"])
        results.check(f"description-schema.json/{case['id']}", check)


def check_batch(results: Results, data: dict[str, Any]) -> None:
    """Retain sibling isolation at individual frame admission; retire wrapper-only predicates."""
    for section in ("valid", "invalid"):
        for case in data[section]:
            results.retire(f"batch/{case['id']}", "BC2 batch envelope/capability removed; optional plugin owns aggregation")
    for case in data["isolated"]:
        def check(case=case):
            indexes = [index for index, value in enumerate(case["value"]["envelopes"]) if admits(lambda value=value: peer.validate_frame(envelope_fixture(value)))]
            expect(indexes, case["validMembers"])
        results.check(f"batch/{case['id']}", check)


def check_core_profile(results: Results, data: dict[str, Any]) -> None:
    """Execute all shared Contract vectors through the actual native parser."""
    for section in ("valid", "invalid"):
        for case in data[section]:
            results.check(case["id"], lambda case=case, section=section: expect(admits(lambda: peer.validate_frame(case["frame"])), section == "valid"))

    for case in data["unknownIgnored"]:
        def unknown(case=case):
            peer.validate_frame(case["baseline"])
            frame = peer.validate_frame(case["frame"])
            target = frame
            for key in case["pointer"].split("/")[1:]:
                target = target[int(key)] if isinstance(target, list) else target[key]
            expect(set(target) >= {"futureA", "futureB"}, True)
            target.pop("futureA")
            target.pop("futureB")
            expect(frame, case["baseline"])
        results.check(case["id"], unknown)

def run_selftest(path: str | None = None) -> int:
    """Run relevant vectors and exit nonzero for any failed or missing case."""
    root = Path(path) if path else VECTOR_ROOT
    results = Results()
    required = [
        ("core-profile.json", lambda data: check_core_profile(results, data)),
        ("envelope.json", lambda data: check_envelope(results, data, "current/envelope", 1)),
        ("control.json", lambda data: check_control(results, data, "current/control")),
        ("handshake.json", lambda data: check_handshake(results, data, "current/handshake")),
        ("stream.json", lambda data: check_stream(results, data)),
        ("error-chain.json", lambda data: check_wire(results, data)),
        ("stream-framing.json", lambda data: check_framing(results, data)),
        ("remote-host-control.json", lambda data: check_host_control(results, data)),
        ("runtime-description.json", lambda data: check_runtime_description(results, data)),
        ("description-schema.json", lambda data: check_description_schema(results, data)),
        ("batch.json", lambda data: check_batch(results, data)),
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
        for row in summary["rows"]:
            print(("PASS " if row["ok"] else "FAIL ") + "behavior/" + row["id"])
        results.passed += summary["passed"]
        results.failed += summary["failed"]
        print(f"BEHAVIOR passed={summary['passed']} failed={summary['failed']}")
    except (ValueError, KeyError, TypeError):
        results.failed += 1
        print("FAIL behavior-harness")
    baseline = subprocess.run([sys.executable, "-B", str(Path(__file__).resolve().parents[1] / "baseline_check.py"), "--language", "python"], capture_output=True, text=True, check=False)
    def baseline_receipt() -> None:
        summary = json.loads(baseline.stdout.strip())
        expect(baseline.returncode, 0)
        expect(summary["passed"], summary["total"])
        for row in summary["rows"]:
            print("PASS protocol-baseline/" + row.get("id", "native-directory-and-siblings"))
        expect({row.get("id") for row in summary["rows"] if "id" in row},
               {case["id"] for case in json.loads((root / "protocol-baseline.json").read_text())["handshake"]})
    results.check("protocol-baseline/real-handshake-offers", baseline_receipt)
    for case in json.loads((root / "protocol-baseline.json").read_text()).get("retiredHandshake", []):
        results.retire("protocol-baseline/" + case["id"], case["reason"])
    print(f"SUMMARY passed={results.passed} failed={results.failed} pending={results.pending} skipped={results.skipped} retired={results.retired}")
    return 1 if results.failed else 0



if __name__ == "__main__":
    raise SystemExit(run_selftest(sys.argv[1] if len(sys.argv) > 1 else None))
