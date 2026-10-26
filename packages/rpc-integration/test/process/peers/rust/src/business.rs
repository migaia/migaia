//! Real provider/task ownership for the canonical native protocol; native IO remains in main.
use crate::{
    error_node, handshake, hello, invalid, items,
    json::{number, object, string, Value},
    read_json, reply_route, runtime_schema_equal, set, text, valid_frame, value, wire_error,
    write_frame, CONTROL_CLOSE, METHOD_UNAVAILABLE,
};
use std::{
    collections::HashMap,
    io::{self, Read, Write},
};

/// Normal native teardown retains the Host lifecycle reason text.
const SESSION_CLOSED_TEXT: &str = "Endpoint disposed";

/// The original declaration switch is fixed before any native session is admitted.
pub static REQUEST_IDEMPOTENT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(true);

/// One actual provider inventory supplies both admission and the public handshake directory.
fn methods(business: bool) -> Vec<(&'static str, &'static [&'static str])> {
    let mut methods: Vec<(&str, &[&str])> = vec![
        ("echo", &["request", "notify"]),
        ("peer.echo", &["request", "notify"]),
        ("peer.wait", &["request", "notify"]),
        ("peer.finish", &["request", "notify"]),
        ("peer.error", &["request", "notify"]),
        ("peer.receipts", &["request", "notify"]),
    ];
    if business {
        methods.extend([
            ("peer.received", &["request", "notify"][..]),
            ("peer.aborts", &["request", "notify"]),
            ("peer.stats", &["request", "notify"]),
            ("peer.trace", &["request", "notify"]),
            ("peer.busy", &["request", "notify"]),
            ("peer.pause", &["request", "notify"]),
            ("peer.crash", &["request", "notify"]),
            ("p.f.request", &["request"]),
            ("p.f.oneWay", &["notify"]),
            ("p.f.generator", &["stream"]),
            ("p.f.asyncGenerator", &["stream"]),
        ]);
    }
    methods
}

/// No reserved describe or Host-control method is needed to publish actual native identity and modes.
pub(super) fn description(own: &Value, business: bool) -> Value {
    let methods = methods(business)
        .into_iter()
        .map(|(name, modes)| {
            let mut method = object(&[
                ("name", string(name)),
                (
                    "supportedModes",
                    Value::Array(modes.iter().map(|mode| string(mode)).collect()),
                ),
                ("modeSource", string("declared")),
            ]);
            if name == "p.f.request" {
                set(
                    &mut method,
                    "idempotent",
                    Value::Bool(REQUEST_IDEMPOTENT.load(std::sync::atomic::Ordering::Relaxed)),
                );
            }
            method
        })
        .collect();
    object(&[
        ("schemaVersion", number(3)),
        ("self", own.clone()),
        ("methods", Value::Array(methods)),
    ])
}

/// Pending operations retain exact task/route correlation but drop original payload and local options.
pub(super) fn header(original: &Value) -> Value {
    object(&[
        ("profile", value(original, "profile").clone()),
        ("kind", value(original, "kind").clone()),
        ("id", value(original, "id").clone()),
        ("route", value(original, "route").clone()),
        ("task", value(original, "task").clone()),
    ])
}
fn response(original: &Value, result: Value, error: Option<Value>) -> Value {
    let mut reply = object(&[
        ("profile", string(crate::PROFILE)),
        (
            "kind",
            string(if error.is_some() { "error" } else { "result" }),
        ),
        ("id", value(original, "id").clone()),
        ("route", reply_route(original)),
        ("task", value(original, "task").clone()),
    ]);
    if let Some(error) = error {
        set(&mut reply, "error", error);
    } else {
        set(&mut reply, "result", result);
    }
    reply
}
fn stream(original: &Value, event: &str, seq: usize, item: Option<Value>) -> Value {
    let mut data = object(&[("event", string(event)), ("seq", number(seq as u64))]);
    if let Some(item) = item {
        set(&mut data, "value", item);
    }
    object(&[
        ("profile", string(crate::PROFILE)),
        ("kind", string("stream")),
        ("id", value(original, "id").clone()),
        ("route", reply_route(original)),
        ("task", value(original, "task").clone()),
        ("stream", data),
    ])
}

/// One native connection owns receipts, exact pending tasks and credited generators.
pub(super) struct Business {
    /// Actual launch or explicit borrowed identity, never a guessed accepted peer.
    own: Value,
    /// The admitted remote directory self supplies exact source and generation admission.
    remote: Value,
    /// Distinguishes the original basic and full business fixture inventories, not protocol profiles.
    business: bool,
    /// Original drain policy stops new work while allowing existing work/abort/finish to settle.
    closing: bool,
    /// The complete admitted close/drain graph stays intact until this native connection ends.
    close_reason: Option<Value>,
    /// A received final close never creates a response close or acknowledgement.
    close_received: bool,
    /// Actual control replies and drain admissions remain observable through peer.stats.
    pongs: u64,
    closes: u64,
    /// Original ordinary one-way calls are counted without a receipt/ACK protocol.
    one_way_receipts: u64,
    /// Receipt order is the actual provider execution order.
    received: Vec<Value>,
    /// The original flat reason's root node is exposed by the test provider unchanged.
    aborts: Vec<Value>,
    /// Request ids index compact pending headers in O(1).
    waiting: HashMap<String, Value>,
    /// Each generator retains its compact header, actual input values and next credit.
    streams: HashMap<String, (Value, Vec<Value>, usize)>,
    /// A genuine admitted fault executes only after its original ACK is physically written.
    pending_fault: Option<String>,
}
impl Business {
    pub(super) fn new(own: &Value, remote: &Value, business: bool) -> Self {
        Self {
            own: own.clone(),
            remote: remote.clone(),
            business,
            closing: false,
            close_reason: None,
            close_received: false,
            pongs: 0,
            closes: 0,
            one_way_receipts: 0,
            received: vec![],
            aborts: vec![],
            waiting: HashMap::new(),
            streams: HashMap::new(),
            pending_fault: None,
        }
    }
    /// Syntactic validity never substitutes for the exact native source/target/task authority.
    fn admit(&self, message: &Value) -> bool {
        let route = value(message, "route");
        if text(route, "senderId") != text(&self.remote, "instanceId")
            || text(route, "receiverId") != text(&self.own, "instanceId")
            || text(route, "targetId") != text(&self.own, "instanceId")
        {
            return false;
        }
        if let Some(task) = message.get("task") {
            text(task, "callerId") == text(&self.remote, "instanceId")
                && runtime_schema_equal(
                    value(task, "callerGeneration"),
                    value(&self.remote, "generation"),
                )
                && runtime_schema_equal(
                    value(task, "targetGeneration"),
                    value(&self.own, "generation"),
                )
        } else {
            true
        }
    }
    fn matches(original: &Value, message: &Value) -> bool {
        value(original, "id") == value(message, "id")
            && runtime_schema_equal(value(original, "task"), value(message, "task"))
    }
    /// Reuse the original business methods, native error fields and receipt order without the deleted Host facade.
    fn invoke(&mut self, method: &str, payload: &Value, trace: &Value) -> (Value, Option<Value>) {
        let args = items(payload);
        match method {
            "echo" | "peer.echo" => (payload.clone(), None),
            "peer.received" => (
                object(&[
                    ("count", number(self.received.len() as u64)),
                    ("values", Value::Array(self.received.clone())),
                ]),
                None,
            ),
            "peer.aborts" => (Value::Array(self.aborts.clone()), None),
            "peer.receipts" => (number(self.one_way_receipts), None),
            "peer.stats" => (
                object(&[
                    ("pongs", number(self.pongs)),
                    ("closes", number(self.closes)),
                    ("pid", number(std::process::id() as u64)),
                ]),
                None,
            ),
            "peer.trace" => (trace.clone(), None),
            "peer.error" => {
                let error = if self.business {
                    let mut root = error_node("rpc.endpoint", "INTERNAL", "RpcError", "peer error");
                    set(&mut root, "cause", number(1));
                    object(&[
                        ("root", number(0)),
                        (
                            "nodes",
                            Value::Array(vec![
                                root,
                                error_node("rpc.endpoint", "INTERNAL", "Error", "peer cause"),
                            ]),
                        ),
                    ])
                } else {
                    wire_error("rpc.endpoint", "INTERNAL", "Peer requested failure")
                };
                (Value::Null, Some(error))
            }
            "p.f.request" if args.len() == 1 => (args[0].clone(), None),
            "p.f.oneWay" if args.len() == 1 => {
                self.received.push(args[0].clone());
                (Value::Null, None)
            }
            "p.f.request" | "p.f.oneWay" => (
                Value::Null,
                Some(wire_error(
                    "rpc.endpoint",
                    "PAYLOAD_INVALID",
                    "Runtime method payload is invalid",
                )),
            ),
            "peer.busy" | "peer.pause" | "peer.crash" => {
                self.pending_fault = Some(method.to_owned());
                (string("ACK"), None)
            }
            _ => (
                Value::Null,
                Some(wire_error(
                    "rpc.endpoint",
                    "PROVIDER_NOT_FOUND",
                    METHOD_UNAVAILABLE,
                )),
            ),
        }
    }
    /// Each received pull consumes exactly one sequence credit; cancellation releases this same operation.
    fn stream_control(&mut self, message: &Value) -> io::Result<Vec<Value>> {
        let id = text(message, "id");
        let Some((original, values, seq)) = self.streams.get_mut(id) else {
            return Ok(vec![]);
        };
        if !Self::matches(original, message) {
            return Ok(vec![]);
        }
        if text(message, "kind") == "cancel" {
            let result = stream(original, "cancelled", *seq, None);
            self.streams.remove(id);
            return Ok(vec![result]);
        }
        let event = value(message, "stream");
        if text(event, "event") != "pull"
            || crate::safe_integer(value(event, "seq")) != Some(*seq as u64)
        {
            return Err(invalid("INVALID_STREAM"));
        }
        if *seq < values.len() {
            let result = stream(original, "item", *seq, Some(values[*seq].clone()));
            *seq += 1;
            return Ok(vec![result]);
        }
        let result = stream(original, "end", *seq, None);
        self.streams.remove(id);
        Ok(vec![result])
    }
    /// Process one real admitted frame; no malformed/misrouted input can arm a native fault.
    pub(super) fn native(&mut self, message: &Value) -> io::Result<Vec<Value>> {
        if !valid_frame(message) || !self.admit(message) {
            return Err(invalid("PROTOCOL_INVALID"));
        }
        let id = text(message, "id");
        if text(message, "kind") == "control" {
            match text(message, "operation") {
                "ping" => {
                    self.pongs += 1;
                    let mut pong = object(&[
                        ("profile", string(crate::PROFILE)),
                        ("kind", string("control")),
                        ("id", string(id)),
                        ("route", reply_route(message)),
                        ("operation", string("pong")),
                    ]);
                    if let Some(reason) = message.get("reason") {
                        set(&mut pong, "reason", reason.clone());
                    }
                    return Ok(vec![pong]);
                }
                CONTROL_CLOSE => {
                    self.closing = true;
                    self.closes += 1;
                    self.close_received = true;
                    self.close_reason = message.get("reason").cloned();
                    self.waiting.clear();
                    self.streams.clear();
                }
                "drain" => {
                    self.close_reason = message.get("reason").cloned();
                    self.closing = true;
                    self.closes += 1;
                }
                _ => {}
            }
            return Ok(vec![]);
        }
        if text(message, "kind") == "cancel" {
            if self
                .waiting
                .get(id)
                .is_some_and(|original| Self::matches(original, message))
            {
                self.waiting.remove(id);
                let reason = value(message, "reason");
                let root = crate::safe_integer(value(reason, "root")).unwrap_or(0) as usize;
                self.aborts.push(
                    items(value(reason, "nodes"))
                        .get(root)
                        .cloned()
                        .unwrap_or(Value::Null),
                );
            }
            return self.stream_control(message);
        }
        if text(message, "kind") == "stream" {
            return self.stream_control(message);
        }
        if text(message, "kind") == "group" {
            if self.closing {
                return Ok(vec![]);
            }
            return Ok(vec![self.group(message)]);
        }
        if text(message, "kind") != "call" {
            return Ok(vec![]);
        }
        let task = value(message, "task");
        let mode = text(task, "mode");
        let method = text(task, "method");
        if self.closing && method != "peer.finish" {
            return Ok(vec![]);
        }
        let admitted = methods(self.business)
            .iter()
            .any(|(name, modes)| *name == method && modes.contains(&mode));
        if !admitted {
            return Ok(if mode == "notify" {
                vec![]
            } else {
                vec![response(
                    message,
                    Value::Null,
                    Some(wire_error(
                        "rpc.endpoint",
                        "PROVIDER_NOT_FOUND",
                        METHOD_UNAVAILABLE,
                    )),
                )]
            });
        }
        if mode == "notify" {
            self.one_way_receipts += 1;
        }
        let payload = value(message, "payload");
        if method == "peer.wait" || method == "p.f.request" && items(payload) == [string("__wait")]
        {
            if mode != "notify" {
                self.waiting.insert(id.to_owned(), header(message));
            }
            return Ok(vec![]);
        }
        if mode == "stream" {
            let args = items(payload);
            let values = args
                .first()
                .and_then(Value::as_array)
                .unwrap_or(&[])
                .to_vec();
            self.streams
                .insert(id.to_owned(), (header(message), values, 0));
            return Ok(vec![stream(message, "open", 0, None)]);
        }
        if method == "peer.finish" {
            let mut ids: Vec<_> = self.waiting.keys().cloned().collect();
            ids.sort();
            let mut replies = Vec::new();
            for id in ids {
                if let Some(original) = self.waiting.remove(&id) {
                    replies.push(response(&original, Value::Null, None));
                }
            }
            if mode != "notify" {
                replies.push(response(message, Value::Null, None));
            }
            return Ok(replies);
        }
        let (result, error) = self.invoke(method, payload, value(value(message, "route"), "trace"));
        if mode == "notify" {
            Ok(vec![])
        } else {
            Ok(vec![response(message, result, error)])
        }
    }
    /// The existing native writer emits this final control only after all prior reply writes.
    fn close_frame(&self) -> Value {
        object(&[
            ("profile", string(crate::PROFILE)),
            ("kind", string("control")),
            ("id", string(CONTROL_CLOSE)),
            (
                "route",
                object(&[
                    ("applicationVersion", string("1")),
                    ("senderId", value(&self.own, "instanceId").clone()),
                    ("receiverId", value(&self.remote, "instanceId").clone()),
                    ("targetId", value(&self.remote, "instanceId").clone()),
                    ("sentAt", number(0)),
                ]),
            ),
            ("operation", string(CONTROL_CLOSE)),
            (
                "reason",
                self.close_reason.clone().unwrap_or_else(|| {
                    wire_error("rpc.endpoint", "ENDPOINT_DISPOSED", SESSION_CLOSED_TEXT)
                }),
            ),
        ])
    }

    /// Canonical groups use one fail-stop outcome sequence; the original independent physical batch is retired.
    fn group(&mut self, message: &Value) -> Value {
        let mut outcomes = Vec::new();
        let mut failed = false;
        for step in items(value(message, "steps")) {
            if failed {
                outcomes.push(object(&[("state", string("not-executed"))]));
                continue;
            }
            let method = text(step, "method");
            let (result, error) = if methods(self.business)
                .iter()
                .any(|(name, modes)| *name == method && modes.contains(&"request"))
            {
                self.invoke(
                    method,
                    value(step, "payload"),
                    value(value(message, "route"), "trace"),
                )
            } else {
                (
                    Value::Null,
                    Some(wire_error(
                        "rpc.endpoint",
                        "PROVIDER_NOT_FOUND",
                        METHOD_UNAVAILABLE,
                    )),
                )
            };
            if let Some(error) = error {
                outcomes.push(object(&[("state", string("failure")), ("error", error)]));
                failed = true;
                continue;
            }
            outcomes.push(object(&[("state", string("success")), ("result", result)]));
        }
        response(message, Value::Array(outcomes), None)
    }
}

/// Keep the original single native reader and ACK-before-fault/EOF cleanup ownership.
pub fn serve(
    input: &mut impl Read,
    output: &mut impl Write,
    own: &Value,
    parent: Option<&str>,
    auth: Option<&str>,
    business: bool,
) -> io::Result<()> {
    let remote = handshake(input, output, &hello(own, business, auth), auth, parent)?;
    let mut state = Business::new(own, value(value(&remote, "directory"), "self"), business);
    while let Some(message) = read_json(input)? {
        let replies = match state.native(&message) {
            Ok(replies) => replies,
            Err(_) => {
                eprintln!("PEER_ERROR PROTOCOL_INVALID");
                continue;
            }
        };
        for reply in replies {
            write_frame(output, &reply)?;
        }
        if let Some(fault) = state.pending_fault.take() {
            match fault.as_str() {
                "peer.crash" => std::process::exit(17),
                "peer.pause" => {
                    std::process::Command::new("/bin/kill")
                        .args(["-STOP", &std::process::id().to_string()])
                        .status()?;
                }
                "peer.busy" => loop {
                    std::hint::spin_loop();
                },
                _ => {}
            }
        }
        if state.closing && state.waiting.is_empty() && state.streams.is_empty() {
            break;
        }
    }
    state.waiting.clear();
    state.streams.clear();
    if !state.close_received {
        write_frame(output, &state.close_frame())?;
    }
    Ok(())
}
