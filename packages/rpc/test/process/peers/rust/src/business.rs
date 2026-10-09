//! Independent native business; framing/hello/JSON remain owned by the existing peer.
use crate::{
    baseline_agreed, json, native_envelope_valid, negotiate, physical_envelopes, read_frame,
    read_json, required_str, runtime_description, wire_error, write_frame, METHOD_UNAVAILABLE,
    RUNTIME_DESCRIBE, RUNTIME_STREAM_PREFIX,
};
use json::{number, object, string, Value};
use std::{
    collections::HashMap,
    io::{self, Read, Write},
};
/// The executable fixes its actual request declaration before accepting any business session.
pub static REQUEST_IDEMPOTENT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(true);

/// Read absent portable values as null; validated business inputs carry concrete fields.
fn value<'a>(input: &'a Value, key: &str) -> &'a Value {
    input.get(key).unwrap_or(&Value::Null)
}
/// Reply to this exact caller and preserve its trace and receiver binding.
fn route(message: &Value, kind: &str) -> Value {
    let incoming = value(value(message, "data"), "route");
    let mut fields = vec![
        ("profile", string("migaia.rpc.route")),
        ("type", string(kind)),
        (
            "applicationVersion",
            value(incoming, "applicationVersion").clone(),
        ),
        ("senderId", value(incoming, "targetId").clone()),
        ("targetId", value(incoming, "senderId").clone()),
        ("sentAt", number(0)),
    ];
    if incoming.has("receiverId") {
        fields.push(("receiverId", value(incoming, "senderId").clone()));
    }
    if incoming.has("trace") {
        fields.push(("trace", value(incoming, "trace").clone()));
    }
    if kind == "response" {
        fields.push(("method", value(message, "method").clone()));
    }
    object(&fields)
}
/// Add one canonical header field without duplicating a protocol definition.
fn set(input: &mut Value, key: &str, value: Value) {
    if let Value::Object(fields) = input {
        if let Some(field) = fields.iter_mut().find(|(name, _)| name == key) {
            field.1 = value;
        } else {
            fields.push((key.to_owned(), value));
        }
    }
}
/// Produce one response with its original identity and wire error graph.
fn response(message: &Value, payload: Value, error: Option<Value>) -> Value {
    let mut data = object(&[("route", route(message, "response"))]);
    let mut result = object(&[
        ("kind", string("response")),
        ("id", value(message, "id").clone()),
        ("ok", Value::Bool(error.is_none())),
    ]);
    if let Some(error) = error {
        set(&mut result, "code", value(&error, "code").clone());
        set(&mut result, "message", value(&error, "message").clone());
        set(&mut result, "error", error);
    } else {
        set(&mut data, "payload", payload);
    }
    set(&mut result, "data", data);
    result
}
/// A stream event consumes one caller credit; the payload is absent for terminal events.
fn stream(message: &Value, event: &str, seq: usize, item: Option<Value>) -> Value {
    let mut payload = object(&[("event", string(event)), ("seq", number(seq as u64))]);
    if let Some(item) = item {
        set(&mut payload, "value", item);
    }
    object(&[
        ("kind", string("stream")),
        ("id", value(message, "id").clone()),
        (
            "data",
            object(&[("route", route(message, "stream")), ("payload", payload)]),
        ),
    ])
}
/// Session-owned installed definition and credited generator state never escape to another client.
struct Business {
    host: bool,
    installed: bool,
    closing: bool,
    revision: u64,
    pongs: u64,
    closes: u64,
    received: Vec<Value>,
    aborts: Vec<Value>,
    waiting: HashMap<String, Value>,
    streams: HashMap<String, (Value, Vec<Value>, usize)>,
    /// Only a negotiated stream owner may publish or execute the logical generator routes.
    streams_supported: bool,
}
impl Business {
    /// Publish the schemaVersion 2 whitelist for actual scalar and negotiated stream routes.
    fn description(&self) -> Value {
        let mut methods: Vec<(&str, &[&str])> = vec![
            ("echo", &["request", "notify"]),
            ("peer.echo", &["request", "notify"]),
            ("peer.received", &["request", "notify"]),
            ("peer.aborts", &["request", "notify"]),
            ("peer.stats", &["request", "notify"]),
            ("peer.trace", &["request", "notify"]),
            ("peer.error", &["request", "notify"]),
            ("peer.wait", &["request", "notify"]),
            ("peer.busy", &["request", "notify"]),
            ("peer.pause", &["request", "notify"]),
            ("peer.crash", &["request", "notify"]),
            ("p.f.request", &["request"]),
            ("p.f.oneWay", &["notify"]),
        ];
        if self.host {
            methods.extend([
                ("migaia.remote.host.use", &["request"][..]),
                ("migaia.remote.host.unUse", &["request"][..]),
                ("migaia.remote.host.inspect", &["request"][..]),
            ]);
        }
        if self.streams_supported {
            methods.extend([
                ("p.f.generator", &["stream"][..]),
                ("p.f.asyncGenerator", &["stream"][..]),
            ]);
        }
        let mut description = runtime_description(&methods);
        if let Some(Value::Array(entries)) = match &mut description {
            Value::Object(fields) => fields
                .iter_mut()
                .find(|(name, _)| name == "methods")
                .map(|(_, value)| value),
            _ => None,
        } {
            for entry in entries {
                if value(entry, "name").as_str() == Some("p.f.request") {
                    set(
                        entry,
                        "idempotent",
                        Value::Bool(REQUEST_IDEMPOTENT.load(std::sync::atomic::Ordering::Relaxed)),
                    );
                }
            }
        }
        description
    }
    /// Project the actual locally resolved definition without executable code or client config.
    fn item(&self) -> Value {
        object(&[
            ("name", string("p")),
            ("state", string("enabled")),
            ("revision", number(self.revision)),
            ("features", Value::Array(vec![string("f")])),
        ])
    }
    /// Execute the portable business and approved Host controls using only Rust local state.
    fn invoke(&mut self, method: &str, payload: &Value, trace: &Value) -> (Value, Option<Value>) {
        let args = payload.as_array().unwrap_or(&[]);
        match method {
            RUNTIME_DESCRIBE => return (self.description(), None),
            "migaia.remote.host.use" | "migaia.remote.host.unUse" => {
                if !self.host || args.is_empty() || args.len() > 2 || args[0].as_str() != Some("p")
                {
                    return (
                        Value::Null,
                        Some(wire_error(
                            "@migaia/rpc/remote",
                            "REMOTE_CONTRACT_INVALID",
                            "invalid Host control",
                        )),
                    );
                }
                self.installed = method == "migaia.remote.host.use";
                self.revision += 1;
                return (
                    if self.installed {
                        self.item()
                    } else {
                        object(&[("ok", Value::Bool(true))])
                    },
                    None,
                );
            }
            "migaia.remote.host.inspect" => {
                return (
                    object(&[
                        ("revision", number(self.revision)),
                        (
                            "plugins",
                            Value::Array(if self.installed {
                                vec![self.item()]
                            } else {
                                vec![]
                            }),
                        ),
                    ]),
                    None,
                );
            }
            "echo" | "peer.echo" => return (payload.clone(), None),
            "peer.received" => {
                return (
                    object(&[
                        ("count", number(self.received.len() as u64)),
                        ("values", Value::Array(self.received.clone())),
                    ]),
                    None,
                );
            }
            "peer.aborts" => return (Value::Array(self.aborts.clone()), None),
            "peer.stats" => {
                return (
                    object(&[
                        ("pongs", number(self.pongs)),
                        ("closes", number(self.closes)),
                        ("pid", number(std::process::id() as u64)),
                    ]),
                    None,
                );
            }
            "peer.trace" => return (trace.clone(), None),
            "peer.error" => {
                let cause = wire_error("@migaia/rpc/core", "INTERNAL", "peer cause");
                let mut error = wire_error("@migaia/rpc/core", "INTERNAL", "peer error");
                set(&mut error, "name", string("RpcError"));
                set(&mut error, "stack", string("RpcError: peer error"));
                set(&mut error, "cause", cause);
                return (Value::Null, Some(error));
            }
            _ => {}
        }
        if !self.installed {
            return (
                Value::Null,
                Some(wire_error(
                    "@migaia/rpc/remote",
                    "REMOTE_CLOSED",
                    "remote is closed",
                )),
            );
        }
        if method == "p.f.request" {
            return (args.first().unwrap_or(&Value::Null).clone(), None);
        }
        if method == "p.f.oneWay" {
            self.received
                .push(args.first().unwrap_or(&Value::Null).clone());
            return (Value::Null, None);
        }
        (
            Value::Null,
            Some(wire_error(
                "@migaia/rpc/core",
                "PROVIDER_NOT_FOUND",
                METHOD_UNAVAILABLE,
            )),
        )
    }
    /// Dispatch one authenticated frame, requiring exact stream sequence before advancing.
    fn native(&mut self, message: Value) -> io::Result<Vec<Value>> {
        let data = value(&message, "data");
        let header = value(data, "route");
        let payload = value(data, "payload");
        let id = required_str(&message, "id")
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "INVALID_ENVELOPE"))?
            .to_owned();
        match value(&message, "kind").as_str() {
            Some("discovery") if value(header, "type").as_str() == Some("discovery-query") => {
                let mut reply = route(&message, "discovery-response");
                set(
                    &mut reply,
                    "resolvedTargetId",
                    value(header, "targetId").clone(),
                );
                set(&mut reply, "receiverId", value(header, "targetId").clone());
                set(&mut reply, "platform", string("Process"));
                Ok(vec![object(&[
                    ("kind", string("discovery")),
                    ("id", string(&id)),
                    ("version", value(&message, "version").clone()),
                    ("acceptVersions", value(&message, "acceptVersions").clone()),
                    ("data", object(&[("route", reply)])),
                ])])
            }
            Some("variation") => {
                match value(header, "variation").as_str() {
                    Some("ping") => {
                        self.pongs += 1;
                        let mut reply = route(&message, "variation");
                        set(&mut reply, "variation", string("pong"));
                        return Ok(vec![object(&[
                            ("kind", string("variation")),
                            ("id", string(&id)),
                            ("data", object(&[("route", reply)])),
                        ])]);
                    }
                    Some("abort") => {
                        if self.waiting.remove(&id).is_some() {
                            self.aborts.push(payload.clone());
                        }
                    }
                    Some("close") => {
                        self.closes += 1;
                        self.closing = true;
                    }
                    _ => {}
                }
                Ok(vec![])
            }
            Some("stream") => {
                let Some((original, items, seq)) = self.streams.get_mut(&id) else {
                    return Ok(vec![]);
                };
                if value(payload, "event").as_str() == Some("cancel") {
                    let result = stream(original, "cancelled", *seq, None);
                    self.streams.remove(&id);
                    return Ok(vec![result]);
                }
                if value(payload, "event").as_str() != Some("pull")
                    || value(payload, "seq").as_u64() != Some(*seq as u64)
                {
                    return Err(io::Error::new(io::ErrorKind::InvalidData, "INVALID_STREAM"));
                }
                if *seq < items.len() {
                    let result = stream(original, "item", *seq, Some(items[*seq].clone()));
                    *seq += 1;
                    return Ok(vec![result]);
                }
                let result = stream(original, "end", *seq, None);
                self.streams.remove(&id);
                Ok(vec![result])
            }
            Some("request") if !self.closing => {
                let method = value(&message, "method").as_str().unwrap_or("");
                if method == "peer.wait" {
                    if value(header, "dispatchOnly") != &Value::Bool(true) {
                        self.waiting.insert(id, message);
                    }
                    return Ok(vec![]);
                }
                if self.streams_supported
                    && matches!(
                        method.strip_prefix(RUNTIME_STREAM_PREFIX),
                        Some("p.f.generator" | "p.f.asyncGenerator")
                    )
                {
                    let args = payload.as_array().unwrap_or(&[]);
                    let items = args
                        .first()
                        .and_then(Value::as_array)
                        .unwrap_or(&[])
                        .to_vec();
                    let result = stream(&message, "open", 0, None);
                    self.streams.insert(id, (message, items, 0));
                    return Ok(vec![result]);
                }
                let (result, error) = self.invoke(method, payload, value(header, "trace"));
                if value(header, "dispatchOnly") == &Value::Bool(true) {
                    return Ok(vec![]);
                }
                Ok(vec![response(&message, result, error)])
            }
            _ => Ok(vec![]),
        }
    }
}
/// Reuse the strict peer hello, adding only this real business profile's stream capability.
pub fn serve(
    input: &mut impl Read,
    output: &mut impl Write,
    host: bool,
    auth: Option<&str>,
    bridge: bool,
    bare: bool,
) -> io::Result<()> {
    if bridge {
        if bare {
            while let Some(body) = bridge_body(input)? {
                // A10 includes exactly one payload parse and serialization on both sides.
                let payload = json::parse(&body)
                    .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_JSON"))?;
                if value(&payload, "xrtReverse") == &Value::Bool(true) {
                    let result = xrt_reverse(input, output, &payload, true)?;
                    bridge_write_body(output, result.text().as_bytes())?;
                    continue;
                }
                bridge_write_body(output, payload.text().as_bytes())?;
            }
            return Ok(());
        }
        return serve_bridge(input, output, host, auth);
    }
    let hello = read_json(input)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "HANDSHAKE_INVALID"))?;
    let mut agreed = negotiate(&hello)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "HANDSHAKE_INVALID"))?;
    if !baseline_agreed(&agreed) || auth.is_some() && value(&hello, "auth").as_str() != auth {
        return write_frame(
            output,
            &object(&[
                ("kind", string("handshake")),
                ("step", string("reject")),
                ("protocol", string("migaia.rpc")),
                (
                    "error",
                    wire_error(
                        "@migaia/rpc/process",
                        "AUTH_REJECTED",
                        "authentication rejected",
                    ),
                ),
            ]),
        );
    }
    if value(&hello, "capabilities")
        .as_array()
        .unwrap_or(&[])
        .iter()
        .any(|cap| cap.as_str() == Some("stream@1"))
    {
        if let Value::Array(items) = value(&agreed, "capabilities").clone() {
            let mut items = items;
            items.push(string("stream@1"));
            set(&mut agreed, "capabilities", Value::Array(items));
        }
    }
    set(&mut agreed, "kind", string("handshake"));
    set(&mut agreed, "step", string("accept"));
    set(&mut agreed, "protocol", string("migaia.rpc"));
    set(
        &mut agreed,
        "peer",
        object(&[("id", string("rust-peer")), ("runtime", string("rust"))]),
    );
    write_frame(output, &agreed)?;
    let mut business = Business {
        host,
        installed: !host,
        closing: false,
        revision: 0,
        pongs: 0,
        closes: 0,
        received: vec![],
        aborts: vec![],
        waiting: HashMap::new(),
        streams: HashMap::new(),
        streams_supported: value(&agreed, "capabilities")
            .as_array()
            .unwrap_or(&[])
            .iter()
            .any(|cap| cap.as_str() == Some("stream@1")),
    };
    while let Some(physical) = read_json(input)? {
        for message in physical_envelopes(physical)? {
            if !native_envelope_valid(&message) {
                eprintln!("PEER_ERROR PROTOCOL_INVALID");
                continue;
            }
            let method = value(&message, "method").as_str().unwrap_or("");
            if matches!(method, "peer.busy" | "peer.pause" | "peer.crash") {
                if value(value(value(&message, "data"), "route"), "dispatchOnly")
                    != &Value::Bool(true)
                {
                    write_frame(output, &response(&message, string("ACK"), None))?;
                }
                if method == "peer.crash" {
                    std::process::exit(17);
                }
                if method == "peer.pause" {
                    // The platform signal stops the actual reader; SIGCONT resumes the same PID.
                    std::process::Command::new("/bin/kill")
                        .args(["-STOP", &std::process::id().to_string()])
                        .status()?;
                } else {
                    loop {
                        std::hint::spin_loop();
                    }
                }
                continue;
            }
            let replies = match business.native(message) {
                Ok(replies) => replies,
                Err(_) => {
                    eprintln!("PEER_ERROR PROTOCOL_INVALID");
                    continue;
                }
            };
            for reply in replies {
                write_frame(output, &reply)?;
            }
        }
    }
    Ok(())
}
/// Bound Content-Length headers before allocating the exact JSON body.
fn bridge_body(input: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        let mut byte = [0u8];
        if input.read(&mut byte)? == 0 {
            if header.is_empty() {
                return Ok(None);
            }
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "BRIDGE_HEADER",
            ));
        }
        if header.len() >= 1024 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_HEADER"));
        }
        header.push(byte[0]);
    }
    let text = std::str::from_utf8(&header)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_HEADER"))?;
    let lengths: Vec<_> = text
        .split("\r\n")
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            if key.eq_ignore_ascii_case("content-length") {
                Some(value.trim())
            } else {
                None
            }
        })
        .collect();
    if lengths.len() != 1 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_HEADER"));
    }
    let length: usize = lengths[0]
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_LENGTH"))?;
    if !(1..=16_777_216).contains(&length) {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_LENGTH"));
    }
    let mut body = vec![0; length];
    input.read_exact(&mut body)?;
    Ok(Some(body))
}
/// One physical writer is reused by bare echoes and encoded RPC replies.
pub(super) fn bridge_write_body(output: &mut impl Write, body: &[u8]) -> io::Result<()> {
    write!(output, "Content-Length: {}\r\n\r\n", body.len())?;
    output.write_all(body)?;
    output.flush()
}
/// Read a single or batch response with the bridge's original framing and strict JSON codec.
pub(super) fn bridge_read(input: &mut impl Read) -> io::Result<Value> {
    let body = bridge_body(input)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "BRIDGE_RESPONSE"))?;
    json::parse(&body).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_RESPONSE"))
}

/// Initiate the restored bridge profile and require an authenticated v2 directory and batch isolation.
pub fn initiate_bridge(
    input: &mut impl Read,
    output: &mut impl Write,
    auth: Option<&str>,
) -> io::Result<()> {
    if auth.is_none() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "AUTH_REQUIRED",
        ));
    }
    let mut hello = crate::hello(auth);
    set(
        &mut hello,
        "capabilities",
        Value::Array(
            [
                "runtime-api@1",
                "batch@1",
                "jsonrpc-bridge@1",
                "abort@1",
                "wire-error@1",
            ]
            .iter()
            .map(|v| string(v))
            .collect(),
        ),
    );
    let request = |id: &str, method: &str, params: Value| {
        object(&[
            ("jsonrpc", string("2.0")),
            ("id", string(id)),
            ("method", string(method)),
            ("params", params),
        ])
    };
    bridge_write_body(
        output,
        request(
            "hello",
            "migaia.hello",
            object(&[("hello", string(&hello.text()))]),
        )
        .text()
        .as_bytes(),
    )?;
    let response = bridge_read(input)?;
    let accepted = json::parse(
        value(value(&response, "result"), "reply")
            .as_str()
            .unwrap_or("")
            .as_bytes(),
    )
    .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_HELLO"))?;
    if value(&accepted, "step").as_str() != Some("accept") || !baseline_agreed(&accepted) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "HANDSHAKE_INCOMPATIBLE",
        ));
    }
    bridge_write_body(
        output,
        request(
            "directory",
            "migaia.describe",
            object(&[("args", Value::Array(vec![]))]),
        )
        .text()
        .as_bytes(),
    )?;
    let response = bridge_read(input)?;
    let directory = value(&response, "result");
    if value(directory, "schemaVersion").as_u64() != Some(2)
        || value(value(directory, "self"), "instanceId") != value(value(&accepted, "peer"), "id")
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "CONTRACT_INVALID",
        ));
    }
    let invoke = |id: &str, method: &str, args: Vec<Value>| {
        request(
            id,
            "migaia.invoke",
            object(&[("method", string(method)), ("args", Value::Array(args))]),
        )
    };
    let batch = Value::Array(vec![
        invoke("first", "echo", vec![string("bridge-first")]),
        invoke("missing", "absent", vec![]),
        invoke("last", "echo", vec![string("bridge-last")]),
    ]);
    bridge_write_body(output, batch.text().as_bytes())?;
    let response = bridge_read(input)?;
    let replies = response.as_array().unwrap_or(&[]);
    if replies.len() != 3
        || value(&replies[0], "id").as_str() != Some("first")
        || value(&replies[1], "id").as_str() != Some("missing")
        || value(&replies[2], "id").as_str() != Some("last")
        || value(&replies[0], "result").as_array() != Some(&[string("bridge-first")][..])
        || value(&replies[2], "result").as_array() != Some(&[string("bridge-last")][..])
        || value(
            value(
                value(value(&replies[1], "error"), "data"),
                "migaiaWireError",
            ),
            "code",
        )
        .as_str()
            != Some("PROVIDER_NOT_FOUND")
    {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_BATCH"));
    }
    eprintln!("RESULT ok");
    Ok(())
}

/// The bounded foreign initiator reuses bridge_read/bridge_write_body without a language SDK.
fn xrt_reverse(
    input: &mut impl Read,
    output: &mut impl Write,
    control: &Value,
    bare: bool,
) -> io::Result<Value> {
    let n = value(control, "count").as_u64().unwrap_or(0);
    let payload = value(control, "payload").clone();
    if n < 1 || n > 10000 || payload.as_str().is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "INVALID_ENVELOPE",
        ));
    }
    // One bounded inner-clock sample exists for every actual completed request.
    let mut latencies = Vec::with_capacity(n as usize);
    let start = std::time::Instant::now();
    for index in 0..n {
        let round = std::time::Instant::now();
        let id = format!("xrt-reverse-{}", index);
        let request = if bare {
            payload.clone()
        } else {
            object(&[
                ("jsonrpc", string("2.0")),
                ("id", string(&id)),
                ("method", string("migaia.invoke")),
                (
                    "params",
                    object(&[
                        ("method", string("bench.echo")),
                        ("args", Value::Array(vec![payload.clone()])),
                    ]),
                ),
            ])
        };
        bridge_write_body(output, request.text().as_bytes())?;
        let reply = bridge_read(input)?;
        let valid = if bare {
            reply == payload
        } else {
            value(&reply, "id").as_str() == Some(&id)
                && value(&reply, "result") == &payload
                && !reply.has("error")
        };
        if !valid {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "INVALID_ENVELOPE",
            ));
        }
        latencies.push(number(round.elapsed().as_nanos() as u64));
    }
    Ok(object(&[
        ("xrtReceipt", Value::Bool(true)),
        ("calls", number(n)),
        ("elapsedNs", number(start.elapsed().as_nanos() as u64)),
        ("latenciesNs", Value::Array(latencies)),
        ("clientInFlightPeak", number(1)),
        ("burstSize", number(1)),
    ]))
}

/// Bridge extensions share the existing business owner and explicitly exclude streams.
pub(super) fn serve_bridge(
    input: &mut impl Read,
    output: &mut impl Write,
    host: bool,
    auth: Option<&str>,
) -> io::Result<()> {
    let mut business = Business {
        host,
        installed: !host,
        closing: false,
        revision: 0,
        pongs: 0,
        closes: 0,
        received: vec![],
        aborts: vec![],
        waiting: HashMap::new(),
        streams: HashMap::new(),
        streams_supported: false,
    };
    let mut authenticated = false;
    while let Some(body) = bridge_body(input)? {
        let physical = json::parse(&body)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_JSON"))?;
        let batched = matches!(physical, Value::Array(_));
        let messages = match physical {
            Value::Array(items) if authenticated && !items.is_empty() => items,
            Value::Array(_) => {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_BATCH"))
            }
            message => vec![message],
        };
        let mut replies = vec![];
        for message in messages {
            if value(&message, "jsonrpc").as_str() != Some("2.0") {
                if batched {
                    eprintln!("PEER_ERROR PROTOCOL_INVALID");
                    continue;
                }
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "BRIDGE_ENVELOPE",
                ));
            }
            let params = value(&message, "params");
            let (result, failure) = match value(&message, "method").as_str() {
                Some("migaia.hello") => {
                    let hello =
                        json::parse(value(params, "hello").as_str().unwrap_or("").as_bytes())
                            .map_err(|_| {
                                io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_HELLO")
                            })?;
                    let mut agreed = negotiate(&hello)
                        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "BRIDGE_HELLO"))?;
                    let baseline = baseline_agreed(&agreed);
                    authenticated =
                        baseline && auth.is_some() && value(&hello, "auth").as_str() == auth;
                    if authenticated {
                        set(
                            &mut agreed,
                            "capabilities",
                            Value::Array(
                                value(&hello, "capabilities")
                                    .as_array()
                                    .unwrap_or(&[])
                                    .iter()
                                    .filter(|cap| {
                                        matches!(
                                            cap.as_str(),
                                            Some(
                                                "runtime-api@1"
                                                    | "batch@1"
                                                    | "abort@1"
                                                    | "jsonrpc-bridge@1"
                                                    | "wire-error@1"
                                                    | "deadline@1"
                                                    | "trace@1"
                                                    | "idempotency@1"
                                            )
                                        )
                                    })
                                    .cloned()
                                    .collect(),
                            ),
                        );
                        set(&mut agreed, "kind", string("handshake"));
                        set(&mut agreed, "step", string("accept"));
                        set(&mut agreed, "protocol", string("migaia.rpc"));
                        set(
                            &mut agreed,
                            "peer",
                            object(&[("id", string("rust-peer")), ("runtime", string("rust"))]),
                        );
                    } else {
                        agreed = object(&[
                            ("kind", string("handshake")),
                            ("step", string("reject")),
                            ("protocol", string("migaia.rpc")),
                            (
                                "error",
                                wire_error(
                                    "@migaia/rpc/process",
                                    if baseline {
                                        "AUTH_REJECTED"
                                    } else {
                                        "HANDSHAKE_INCOMPATIBLE"
                                    },
                                    if baseline {
                                        "authentication rejected"
                                    } else {
                                        "rpc handshake incompatible: version"
                                    },
                                ),
                            ),
                        ]);
                    }
                    (
                        object(&[
                            ("reply", string(&agreed.text())),
                            (
                                "methods",
                                Value::Array(
                                    [
                                        "migaia.hello",
                                        "migaia.describe",
                                        "migaia.invoke",
                                        "migaia.cancel",
                                    ]
                                    .iter()
                                    .map(|name| string(name))
                                    .collect(),
                                ),
                            ),
                        ]),
                        None,
                    )
                }
                _ if !authenticated => {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "AUTH_REQUIRED",
                    ));
                }
                Some("migaia.describe") => {
                    let mut description = business.description();
                    let mut methods: Vec<Value> = value(&description, "methods")
                        .as_array()
                        .unwrap_or(&[])
                        .iter()
                        .filter(|method| {
                            !matches!(
                                value(method, "name").as_str(),
                                Some("peer.pause" | "peer.busy" | "peer.crash")
                            )
                        })
                        .cloned()
                        .collect();
                    // Only this Content-Length owner installs the reverse initiator.
                    methods.push(object(&[
                        ("name", string("peer.reverse")),
                        ("supportedModes", Value::Array(vec![string("request")])),
                        ("modeSource", string("declared")),
                    ]));
                    set(&mut description, "methods", Value::Array(methods));
                    (description, None)
                }
                Some("migaia.cancel") => {
                    if let Some(id) = value(params, "id").as_str() {
                        if business.waiting.remove(id).is_some() {
                            business.aborts.push(value(params, "reason").clone());
                            replies.push(object(&[
                                ("jsonrpc", string("2.0")),
                                ("id", string(id)),
                                ("result", string("late-after-cancel")),
                            ]));
                        }
                    }
                    continue;
                }
                Some("migaia.invoke") => {
                    let called = value(params, "method").as_str().unwrap_or("");
                    let args = value(params, "args");
                    if called == "peer.wait"
                        || called == "p.f.request"
                            && args.as_array() == Some(&[string("__wait")][..])
                    {
                        business.waiting.insert(
                            value(&message, "id").as_str().unwrap_or("").to_owned(),
                            message,
                        );
                        continue;
                    }
                    if called == "peer.reverse"
                        && args.as_array().map_or(true, |items| items.len() != 1)
                    {
                        (
                            Value::Null,
                            Some(wire_error(
                                "@migaia/rpc/core",
                                "PAYLOAD_INVALID",
                                "Runtime method payload is invalid",
                            )),
                        )
                    } else if called == "peer.reverse" {
                        (
                            xrt_reverse(input, output, &args.as_array().unwrap()[0], false)?,
                            None,
                        )
                    } else {
                        business.invoke(called, args, value(value(params, "meta"), "trace"))
                    }
                }
                _ => (
                    Value::Null,
                    Some(wire_error(
                        "@migaia/rpc/core",
                        "METHOD_NOT_FOUND",
                        "bridge peer method unavailable",
                    )),
                ),
            };
            if message.has("id") {
                let mut reply = object(&[
                    ("jsonrpc", string("2.0")),
                    ("id", value(&message, "id").clone()),
                ]);
                if let Some(error) = failure {
                    set(
                        &mut reply,
                        "error",
                        object(&[
                            ("code", Value::Number("-32000".into())),
                            ("message", value(&error, "message").clone()),
                            ("data", object(&[("migaiaWireError", error)])),
                        ]),
                    );
                } else {
                    set(&mut reply, "result", result);
                }
                replies.push(reply);
            }
        }
        if !replies.is_empty() {
            let reply = if batched {
                Value::Array(replies)
            } else {
                replies.remove(0)
            };
            bridge_write_body(output, reply.text().as_bytes())?;
        }
    }
    Ok(())
}
/// Read native stdin bootstrap with the existing bounded length reader before starting hello.
pub fn bootstrap(input: &mut impl Read) -> io::Result<String> {
    String::from_utf8(
        read_frame(input)?
            .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "BOOTSTRAP_INVALID"))?,
    )
    .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "BOOTSTRAP_INVALID"))
}
