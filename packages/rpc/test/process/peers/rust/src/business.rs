//! Independent native business; framing/hello/JSON remain owned by the existing peer.
use crate::{json, negotiate, read_frame, read_json, required_str, wire_error, write_frame};
use json::{number, object, string, Value};
use std::{
    collections::HashMap,
    io::{self, Read, Write},
    path::Path,
};

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
    contract: Value,
}
impl Business {
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
            "migaia.remote.describe" => {
                return (
                    if self.host {
                        object(&[
                            ("schemaVersion", number(1)),
                            ("catalog", object(&[("p", self.contract.clone())])),
                        ])
                    } else {
                        self.contract.clone()
                    },
                    None,
                )
            }
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
                )
            }
            "echo" | "peer.echo" => return (payload.clone(), None),
            "peer.received" => {
                return (
                    object(&[
                        ("count", number(self.received.len() as u64)),
                        ("values", Value::Array(self.received.clone())),
                    ]),
                    None,
                )
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
                )
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
                "METHOD_NOT_FOUND",
                "native peer method unavailable",
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
                    self.waiting.insert(id, message);
                    return Ok(vec![]);
                }
                if method == "p.f.generator" || method == "p.f.asyncGenerator" {
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
    contract: &Value,
) -> io::Result<()> {
    let hello = read_json(input)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "HANDSHAKE_INVALID"))?;
    let mut agreed = negotiate(&hello)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "HANDSHAKE_INVALID"))?;
    if auth.is_some() && value(&hello, "auth").as_str() != auth {
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
        contract: contract.clone(),
    };
    while let Some(message) = read_json(input)? {
        for reply in business.native(message)? {
            write_frame(output, &reply)?;
        }
    }
    Ok(())
}
/// Read the published contract vector, rather than hand-maintaining another TS/Rust schema.
pub fn contract(path: &Path) -> io::Result<Value> {
    let document = json::parse(&std::fs::read(path)?)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "INVALID_CONTRACT"))?;
    Ok(value(
        &value(&document, "contracts").as_array().unwrap()[0],
        "value",
    )
    .clone())
}
/// Read native stdin bootstrap with the existing bounded length reader before starting hello.
pub fn bootstrap(input: &mut impl Read) -> io::Result<String> {
    String::from_utf8(
        read_frame(input)?
            .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "BOOTSTRAP_INVALID"))?,
    )
    .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "BOOTSTRAP_INVALID"))
}
