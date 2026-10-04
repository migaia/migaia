"""Session-local reverse RPC state; the native reader never waits for a response."""
from __future__ import annotations

import re
from typing import Any
import peer

# Reserved cold exchange and admitted application paths mirror the Runtime API wire directory.
DESCRIBE = "migaia.remote.runtime.describe"
NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,39}$")
LIMIT = 2


def error(code: str, message: str) -> dict[str, Any]:
    """Reuse registered core codes; never expose arbitrary peer fields in diagnostics."""
    return {**peer.wire_error(code, message), "source": "@migaia/rpc/core"}


class ReverseCalls:
    """Own a bounded pending map and the authenticated remote provider whitelist."""

    def __init__(self, remote_id: str, reply):
        self.remote_id = remote_id
        self.reply = reply
        self.pending: dict[str, tuple[dict[str, Any], str, str, Any]] = {}
        self.whitelist: dict[str, set[str]] | None = None
        self.sequence = 0
        self.closed = False

    def outbound(self, original, method, payload, stage):
        """Reserve correlation before writing; the same reader resumes this operation later."""
        self.sequence += 1
        identifier = f"python-reverse-{self.sequence}"
        self.pending[identifier] = (original, method, stage, payload)
        return {"kind": "request", "id": identifier, "method": method, "data": {
            "route": peer.route("request", "python-peer", self.remote_id, receiverId=self.remote_id),
            "payload": payload}}

    def fail(self, original, code, message):
        """Settle the incoming request while preserving its receiver and route identity."""
        return self.reply(original, None, error(code, message))

    def start(self, original, other_active=0):
        """Admit one reverse provider without blocking on discovery or a business response."""
        if self.closed:
            return [self.fail(original, "TRANSPORT", "Reverse session is closed")]
        if len(self.pending) + other_active >= LIMIT:
            return [self.fail(original, "OVERLOADED", "Reverse provider concurrency limit reached")]
        payload = original["data"].get("payload")
        method = payload.get("method") if isinstance(payload, dict) else None
        if not isinstance(method, str) or len(method) > 128 or not all(NAME.fullmatch(part) for part in method.split(".")) or method.startswith("migaia.remote."):
            return [self.fail(original, "PROVIDER_NOT_FOUND", "Runtime method is not provided by this peer")]
        if self.whitelist is None:
            return [self.outbound(original, DESCRIBE, None, "describe")]
        if method not in self.whitelist:
            return [self.fail(original, "PROVIDER_NOT_FOUND", "Runtime method is not provided by this peer")]
        if "request" not in self.whitelist[method]:
            return [self.fail(original, "CAPABILITY_UNSUPPORTED", "Runtime operation capability is unavailable")]
        return [self.outbound(original, method, payload.get("payload"), "call")]

    def directory(self, value):
        """Compile request providers from a closed v2 directory bound to the handshake identity."""
        if not isinstance(value, dict) or set(value) != {"schemaVersion", "self", "methods"} or value["schemaVersion"] != 2:
            raise ValueError("invalid directory")
        identity = value["self"]
        if not isinstance(identity, dict) or set(identity) != {"name", "instanceId"} or identity["instanceId"] != self.remote_id or not isinstance(identity["name"], str) or not 1 <= len(identity["name"]) <= 128:
            raise ValueError("invalid directory identity")
        methods = value["methods"]
        if not isinstance(methods, list) or len(methods) > 4096:
            raise ValueError("invalid directory methods")
        names, requests = set(), {}
        for method in methods:
            if not isinstance(method, dict) or not {"name", "supportedModes", "modeSource"} <= set(method) or set(method) - {"name", "supportedModes", "modeSource", "idempotent"}:
                raise ValueError("invalid method")
            name, modes = method["name"], method["supportedModes"]
            if not isinstance(name, str) or len(name) > 128 or name in names or not all(NAME.fullmatch(part) for part in name.split(".")):
                raise ValueError("invalid name")
            if not isinstance(modes, list) or not modes or any(mode not in ("request", "notify", "stream") for mode in modes) or len(set(modes)) != len(modes) or method["modeSource"] not in ("declared", "generated-routes") or ("idempotent" in method and type(method["idempotent"]) is not bool):
                raise ValueError("invalid modes")
            names.add(name)
            if not name.startswith("migaia.remote."):
                requests[name] = set(modes)
        return requests

    def response(self, message):
        """Resolve only an id/method/authenticated-peer match; all other reader work remains live."""
        identifier = message["id"]
        pending = self.pending.get(identifier)
        if pending is None:
            return []
        original, method, stage, _ = pending
        route = message["data"]["route"]
        if route.get("type") != "response" or route.get("senderId") != self.remote_id or route.get("targetId") != "python-peer" or route.get("receiverId") != "python-peer" or route.get("method") != method or type(message.get("ok")) is not bool:
            print("PEER_ERROR CONTRACT_INVALID", file=peer.sys.stderr, flush=True)
            return []
        del self.pending[identifier]
        if not message["ok"]:
            remote_error = message.get("error")
            if not isinstance(remote_error, dict) or not all(isinstance(remote_error.get(key), str) for key in ("source", "code", "name", "message", "stack")):
                return [self.fail(original, "PROTOCOL_INVALID", "Reverse response is invalid")]
            return [self.reply(original, None, remote_error)]
        if stage == "describe":
            try:
                self.whitelist = self.directory(message["data"].get("payload"))
            except (ValueError, TypeError):
                return [self.fail(original, "CONTRACT_INVALID", "Runtime method description is invalid")]
            return self.start(original)
        return [self.reply(original, message["data"].get("payload"))]

    def cancel(self, original_id, reason=None):
        """Retire this incoming provider and cancel its exact outbound request without blocking."""
        replies = []
        for identifier, (original, _, _, _) in tuple(self.pending.items()):
            if original["id"] == original_id:
                del self.pending[identifier]
                replies.append(peer.variation(identifier, "abort", "python-peer", self.remote_id, reason))
        return replies

    def close(self):
        """Settle every incoming waiter and release pending/whitelist state once."""
        self.closed = True
        replies = [self.fail(original, "TRANSPORT", "Reverse session is closed")
                   for original, _, _, _ in self.pending.values()]
        self.pending.clear()
        self.whitelist = None
        return replies
