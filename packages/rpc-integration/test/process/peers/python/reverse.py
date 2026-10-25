"""Session-local reverse RPC state; the native reader never waits for a response."""
from __future__ import annotations

import re
import math
from typing import Any
import peer

NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,39}$")
LIMIT = 2

# These optional method fields share the closed JSON Schema subset with the TS directory owner.
SCHEMA_FIELDS = ("input", "output", "yield")
SCHEMA_KEYS = {"type", "properties", "required", "items", "enum", "const", "anyOf", "$defs", "$ref"}
SCHEMA_TYPES = {"null", "boolean", "object", "array", "number", "integer", "string"}


def schema_value(value, depth=0):
    """Compare portable JSON values structurally, keeping booleans distinct from numbers."""
    if depth > 64:
        raise ValueError("invalid method")
    if value is None:
        return ("null",)
    if type(value) is bool:
        return ("boolean", value)
    if type(value) in (int, float) and math.isfinite(value):
        return ("number", value)
    if isinstance(value, str) and not any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        return ("string", value)
    if isinstance(value, list):
        return ("array", tuple(schema_value(item, depth + 1) for item in value))
    if isinstance(value, dict):
        return ("object", frozenset((key, schema_value(item, depth + 1)) for key, item in value.items()))
    raise ValueError("invalid method")


def _visit_runtime_schema(schema, path, nodes, references):
    """Walk one schema using the caller-owned node/reference context."""
    if not isinstance(schema, dict) or set(schema) - SCHEMA_KEYS:
        return False
    nodes.add(path)
    for key, child in schema.items():
        if key == "type":
            values = child if isinstance(child, list) else [child]
            if not values or any(not isinstance(item, str) or item not in SCHEMA_TYPES for item in values) or len(set(values)) != len(values):
                return False
        elif key in ("properties", "$defs"):
            if not isinstance(child, dict):
                return False
            for name, member in child.items():
                pointer = name.replace("~", "~0").replace("/", "~1")
                if not _visit_runtime_schema(member, f"{path}/{key}/{pointer}", nodes, references):
                    return False
        elif key == "required":
            if not isinstance(child, list) or any(not isinstance(item, str) for item in child) or len(set(child)) != len(child):
                return False
        elif key == "items":
            if not _visit_runtime_schema(child, f"{path}/items", nodes, references):
                return False
        elif key == "enum":
            if not isinstance(child, list) or not child:
                return False
            values = [schema_value(item) for item in child]
            if len(set(values)) != len(values):
                return False
        elif key == "anyOf":
            if not isinstance(child, list) or not child or any(not _visit_runtime_schema(member, f"{path}/anyOf/{index}", nodes, references) for index, member in enumerate(child)):
                return False
        elif key == "$ref":
            if not isinstance(child, str) or not child.startswith("#/$defs/") or re.search(r"~(?![01])", child):
                return False
            references.append(child[1:])
    return True


def valid_runtime_schema(value, depth=0):
    """Validate schema nodes and local references without following references or executing text."""
    nodes, references = set(), []


    try:
        schema_value(value, depth)
        return _visit_runtime_schema(value, "", nodes, references) and all(reference in nodes for reference in references)
    except (ValueError, TypeError, RecursionError):
        return False



def error(code: str, message: str) -> dict[str, Any]:
    """Reuse the peer's sole flat-error constructor; never expose untrusted fields in diagnostics."""
    return peer.wire_error(code, message)


class ReverseCalls:
    """Own bounded pending work and compile the already authenticated schema3 provider directory."""

    def __init__(self, identity, remote, reply):
        self.identity = identity
        self.remote = remote
        self.reply = reply
        self.pending: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
        self.whitelist: dict[str, set[str]] = {}
        self.sequence = 0
        self.closed = False
        self.directory(remote)

    def directory(self, value):
        """Replace only this actual peer's cold whitelist; no reserved discovery request is issued."""
        peer.directory(value)
        if value["self"] != self.remote["self"]:
            raise peer.PeerFailure("PROTOCOL_INVALID")
        self.whitelist = {method["name"]: set(method["supportedModes"]) for method in value["methods"]}

    def fail(self, original, code, message):
        """Settle this exact incoming operation without replacing its selected task."""
        return self.reply(original, error=error(code, message))

    def start(self, original, payload, other_active=0):
        """Reserve before write; the original native reader processes responses without blocking."""
        if self.closed:
            return [self.fail(original, "TRANSPORT", "Reverse session is closed")]
        if len(self.pending) + other_active >= LIMIT:
            return [self.fail(original, "OVERLOADED", "Reverse provider concurrency limit reached")]
        method = payload.get("method") if isinstance(payload, dict) else None
        if not isinstance(method, str) or len(method) > 128 or not all(NAME.fullmatch(part) for part in method.split(".")) or method not in self.whitelist:
            return [self.fail(original, "PROVIDER_NOT_FOUND", "Runtime method is not provided by this peer")]
        if "request" not in self.whitelist[method]:
            return [self.fail(original, "CAPABILITY_UNSUPPORTED", "Runtime operation capability is unavailable")]
        self.sequence += 1
        identifier = f"python-reverse-{self.sequence}"
        task = {"mode": "request", "callerId": self.identity["instanceId"], "callerGeneration": self.identity["generation"], "targetGeneration": self.remote["self"]["generation"], "method": method}
        header = {"id": identifier, "task": task}
        self.pending[identifier] = original, header
        return [{"profile": peer.PROTOCOL, "kind": "call", **header, "route": peer.route(self.identity["instanceId"], self.remote["self"]["instanceId"]), "options": {}, "payload": payload.get("payload")}]

    def response(self, message):
        """Resolve only an exact id/task/generation/authenticated-peer match."""
        pending = self.pending.get(message["id"])
        if pending is None:
            return []
        original, outbound = pending
        routing = message["route"]
        if message["task"] != outbound["task"] or routing["senderId"] != self.remote["self"]["instanceId"] or routing["receiverId"] != self.identity["instanceId"] or routing["targetId"] != self.identity["instanceId"]:
            return []
        del self.pending[message["id"]]
        return [self.reply(original, message.get("result", peer.ABSENT), message.get("error"))]

    def cancel(self, message):
        """Retire this provider's exact reverse work and propagate the original reason graph."""
        replies = []
        for identifier, (original, outbound) in tuple(self.pending.items()):
            if original["id"] == message["id"] and original["task"] == message["task"]:
                del self.pending[identifier]
                cancel = {"profile": peer.PROTOCOL, "kind": "cancel", **outbound, "route": peer.route(self.identity["instanceId"], self.remote["self"]["instanceId"])}
                if "reason" in message:
                    cancel["reason"] = message["reason"]
                replies.append(cancel)
        return replies

    def close(self):
        """Release existing pending/whitelist state once when the actual native input ends."""
        self.closed = True
        replies = [self.fail(original, "TRANSPORT", "Reverse session is closed") for original, _ in self.pending.values()]
        self.pending.clear()
        self.whitelist.clear()
        return replies
