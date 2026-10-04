//! Dependency-free process peer for RPC protocol conformance.
mod business;
mod json;
mod selftest;

use json::{number, object, string, Value};
use std::env;
use std::io::{self, Read, Write};
use std::os::fd::FromRawFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;

const MAX_FRAME: usize = 16_777_216;
const MAX_HANDSHAKE: usize = 65_536;
/// Every real session uses the U36 directory and native physical batch baseline.
const CAPABILITIES: [&str; 6] = [
    "abort@1",
    "ping@1",
    "close@1",
    "wire-error@1",
    "runtime-api@1",
    "batch@1",
];
/// The only application directory method belongs to the schemaVersion 2 baseline.
const RUNTIME_DESCRIBE: &str = "migaia.remote.runtime.describe";
/// Logical stream methods use the actual production registered route prefix.
const RUNTIME_STREAM_PREFIX: &str = "migaia.remote.runtime.stream.";
/// Whitelist refusal keeps the production core source/code/text contract.
const METHOD_UNAVAILABLE: &str = "Runtime method is not provided by this peer";

/// Require the new baseline at the real session boundary without altering pure negotiation vectors.
fn baseline_agreed(agreement: &Value) -> bool {
    agreement.get("major").and_then(Value::as_u64) == Some(1)
        && agreement.get("minor").and_then(Value::as_u64) == Some(1)
        && negotiated(agreement, "runtime-api@1")
        && negotiated(agreement, "batch@1")
}

/// Describe only explicitly installed routes and safe identity, never source or bootstrap secrets.
fn runtime_description(methods: &[(&str, &[&str])]) -> Value {
    object(&[
        ("schemaVersion", number(2)),
        (
            "self",
            object(&[
                ("name", string("rust-peer")),
                ("instanceId", string("rust-peer")),
            ]),
        ),
        (
            "methods",
            Value::Array(
                methods
                    .iter()
                    .map(|(name, modes)| {
                        object(&[
                            ("name", string(name)),
                            (
                                "supportedModes",
                                Value::Array(modes.iter().map(|mode| string(mode)).collect()),
                            ),
                            ("modeSource", string("declared")),
                        ])
                    })
                    .collect(),
            ),
        ),
    ])
}

/// Decode the native physical batch without changing individual member admission or correlation.
fn physical_envelopes(message: Value) -> io::Result<Vec<Value>> {
    if message.get("kind").and_then(Value::as_str) != Some("batch") {
        return Ok(vec![message]);
    }
    if !matches!(&message, Value::Object(fields) if fields.len() == 2) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "INVALID_ENVELOPE",
        ));
    }
    match message.get("envelopes").and_then(Value::as_array) {
        Some(members) if !members.is_empty() => Ok(members.to_vec()),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "INVALID_ENVELOPE",
        )),
    }
}

/// Admit only current native envelopes; unsupported profile/options never enter business dispatch.
fn native_envelope_valid(message: &Value) -> bool {
    let Some(kind) = message.get("kind").and_then(Value::as_str) else {
        return false;
    };
    if !matches!(
        kind,
        "request" | "response" | "variation" | "discovery" | "stream"
    ) || message
        .get("id")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
        || message.has("options")
        || message.has("task")
        || message.has("profile")
    {
        return false;
    }
    let route = message.get("data").and_then(|data| data.get("route"));
    if route
        .and_then(|route| route.get("profile"))
        .and_then(Value::as_str)
        != Some("migaia.rpc.route")
    {
        return false;
    }
    if kind == "request" {
        return message
            .get("method")
            .and_then(Value::as_str)
            .is_some_and(|method| !method.is_empty())
            && route
                .and_then(|route| route.get("type"))
                .and_then(Value::as_str)
                == Some("request");
    }
    true
}

/// Reject a framing header before allocating attacker-controlled payload length.
fn read_frame(input: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; 4];
    let mut first = [0u8; 1];
    if input.read(&mut first)? == 0 {
        return Ok(None);
    }
    header[0] = first[0];
    input.read_exact(&mut header[1..])?;
    let length = u32::from_be_bytes(header) as usize;
    if !(1..=MAX_FRAME).contains(&length) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    let mut bytes = vec![0; length];
    input.read_exact(&mut bytes)?;
    Ok(Some(bytes))
}

/// Serialize exactly one JSON payload; header excludes its own four bytes.
fn write_frame(output: &mut impl Write, value: &Value) -> io::Result<()> {
    let bytes = value.text();
    if !(1..=MAX_FRAME).contains(&bytes.len()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    output.write_all(&(bytes.len() as u32).to_be_bytes())?;
    output.write_all(bytes.as_bytes())?;
    output.flush()
}

fn read_json(input: &mut impl Read) -> io::Result<Option<Value>> {
    let frame = match read_frame(input)? {
        Some(frame) => frame,
        None => return Ok(None),
    };
    let value = json::parse(&frame)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "INVALID_ENVELOPE"))?;
    if !matches!(&value, Value::Object(_)) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "INVALID_ENVELOPE",
        ));
    }
    Ok(Some(value))
}

/// This fixed error never includes untrusted input, including handshake auth.
fn wire_error(source: &str, code: &str, message: &str) -> Value {
    object(&[
        ("source", string(source)),
        ("code", string(code)),
        ("name", string("Error")),
        ("message", string(message)),
        ("stack", string(&format!("Error: {message}"))),
    ])
}

fn required_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, &'static str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or("invalid handshake")
}

/// Validate hello and choose the highest shared major, minimum minor, first initiator codec, and ordered capability intersection.
fn negotiate(hello: &Value) -> Result<Value, &'static str> {
    if required_str(hello, "kind")? != "handshake" || required_str(hello, "step")? != "hello" {
        return Err("invalid handshake");
    }
    if required_str(hello, "protocol")? != "migaia.rpc" {
        return Err("incompatible handshake");
    }
    let versions = hello
        .get("versions")
        .and_then(Value::as_array)
        .ok_or("invalid handshake")?;
    if versions.is_empty() || versions.len() > 8 {
        return Err("invalid handshake");
    }
    let mut selected = None;
    let mut seen = Vec::new();
    for version in versions {
        let major = version
            .get("major")
            .and_then(Value::as_u64)
            .ok_or("invalid handshake")?;
        let minor = version
            .get("minor")
            .and_then(Value::as_u64)
            .ok_or("invalid handshake")?;
        if major == 0
            || major > 9_007_199_254_740_991
            || minor > 9_007_199_254_740_991
            || !seen.insert_if_absent(major)
        {
            return Err("invalid handshake");
        }
        if major == 1 {
            selected = Some((major, minor.min(1)));
        }
    }
    let codecs = hello
        .get("codecs")
        .and_then(Value::as_array)
        .ok_or("invalid handshake")?;
    if codecs.is_empty()
        || codecs.len() > 16
        || !codecs.iter().any(|codec| codec.as_str() == Some("json"))
    {
        return Err("invalid handshake");
    }
    if codecs.iter().any(|codec| codec.as_str().is_none()) {
        return Err("invalid handshake");
    }
    let offered = hello
        .get("capabilities")
        .and_then(Value::as_array)
        .ok_or("invalid handshake")?;
    if offered.len() > 64 || offered.iter().any(|cap| cap.as_str().is_none()) {
        return Err("invalid handshake");
    }
    let (major, minor) = selected.ok_or("incompatible handshake")?;
    let capabilities = offered
        .iter()
        .filter_map(|cap| cap.as_str())
        .filter(|cap| CAPABILITIES.contains(cap))
        .map(string)
        .collect();
    Ok(object(&[
        ("major", number(major)),
        ("minor", number(minor)),
        ("codec", string("json")),
        ("capabilities", Value::Array(capabilities)),
    ]))
}

trait InsertIfAbsent<T> {
    fn insert_if_absent(&mut self, value: T) -> bool;
}
impl<T: PartialEq> InsertIfAbsent<T> for Vec<T> {
    fn insert_if_absent(&mut self, value: T) -> bool {
        if self.contains(&value) {
            false
        } else {
            self.push(value);
            true
        }
    }
}

fn peer() -> Value {
    object(&[("id", string("rust-peer")), ("runtime", string("rust"))])
}
fn hello(auth: Option<&str>) -> Value {
    let mut message = object(&[
        ("kind", string("handshake")),
        ("step", string("hello")),
        ("protocol", string("migaia.rpc")),
        (
            "versions",
            Value::Array(vec![object(&[("major", number(1)), ("minor", number(1))])]),
        ),
        ("codecs", Value::Array(vec![string("json")])),
        (
            "capabilities",
            Value::Array(CAPABILITIES.iter().map(|cap| string(cap)).collect()),
        ),
        ("peer", peer()),
    ]);
    if let (Some(auth), Value::Object(fields)) = (auth, &mut message) {
        fields.push(("auth".to_owned(), string(auth)));
    }
    message
}
fn accept(agreement: &Value) -> Value {
    object(&[
        ("kind", string("handshake")),
        ("step", string("accept")),
        ("protocol", string("migaia.rpc")),
        (
            "major",
            agreement.get("major").cloned().unwrap_or(Value::Null),
        ),
        (
            "minor",
            agreement.get("minor").cloned().unwrap_or(Value::Null),
        ),
        ("codec", string("json")),
        (
            "capabilities",
            agreement
                .get("capabilities")
                .cloned()
                .unwrap_or(Value::Array(vec![])),
        ),
        ("peer", peer()),
    ])
}
fn reject() -> Value {
    object(&[
        ("kind", string("handshake")),
        ("step", string("reject")),
        ("protocol", string("migaia.rpc")),
        (
            "error",
            wire_error(
                "@migaia/rpc/contract",
                "HANDSHAKE_INCOMPATIBLE",
                "Handshake rejected",
            ),
        ),
    ])
}

fn route(request: &Value, route_type: &str, method: Option<&str>) -> Value {
    let incoming = request.get("data").and_then(|data| data.get("route"));
    let sender = incoming
        .and_then(|route| route.get("targetId"))
        .and_then(Value::as_str)
        .unwrap_or("rust-peer");
    let target = incoming
        .and_then(|route| route.get("senderId"))
        .and_then(Value::as_str)
        .unwrap_or("caller");
    let version = incoming
        .and_then(|route| route.get("applicationVersion"))
        .and_then(Value::as_str)
        .unwrap_or("1");
    let mut fields = vec![
        ("profile".to_owned(), string("migaia.rpc.route")),
        ("type".to_owned(), string(route_type)),
        ("applicationVersion".to_owned(), string(version)),
        ("senderId".to_owned(), string(sender)),
        ("targetId".to_owned(), string(target)),
        ("sentAt".to_owned(), number(0)),
    ];
    if let Some(method) = method {
        fields.push(("method".to_owned(), string(method)));
    }
    Value::Object(fields)
}

fn response(request: &Value, payload: Value, failure: Option<(&str, &str, &str)>) -> Value {
    let id = request
        .get("id")
        .cloned()
        .unwrap_or_else(|| string("invalid-id"));
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("echo");
    let data = object(&[
        ("route", route(request, "response", Some(method))),
        ("payload", payload),
    ]);
    if let Some((source, code, message)) = failure {
        object(&[
            ("kind", string("response")),
            ("id", id),
            ("ok", Value::Bool(false)),
            ("code", string(code)),
            ("message", string(message)),
            ("data", data),
            ("error", wire_error(source, code, message)),
        ])
    } else {
        object(&[
            ("kind", string("response")),
            ("id", id),
            ("ok", Value::Bool(true)),
            ("data", data),
        ])
    }
}

fn variation(request: &Value, subtype: &str) -> Value {
    let mut output_route = route(request, "variation", None);
    if let Value::Object(fields) = &mut output_route {
        fields.push(("variation".to_owned(), string(subtype)));
    }
    object(&[
        ("kind", string("variation")),
        (
            "id",
            request
                .get("id")
                .cloned()
                .unwrap_or_else(|| string("invalid-id")),
        ),
        ("data", object(&[("route", output_route)])),
    ])
}

fn subtype(value: &Value) -> Option<&str> {
    value.get("data")?.get("route")?.get("variation")?.as_str()
}

fn negotiated(agreement: &Value, capability: &str) -> bool {
    agreement
        .get("capabilities")
        .and_then(Value::as_array)
        .unwrap_or(&[])
        .iter()
        .any(|value| value.as_str() == Some(capability))
}

fn valid_close(value: &Value) -> bool {
    value
        .get("data")
        .and_then(|data| data.get("payload"))
        .and_then(|payload| payload.get("drainMs"))
        .and_then(Value::as_u64)
        .is_some_and(|duration| duration < 2_147_483_648)
}

/// Own one connection. Never print or serialize untrusted handshake fields.
fn serve(
    input: &mut impl Read,
    output: &mut impl Write,
    required_auth: Option<&str>,
) -> io::Result<()> {
    let handshake_invalid = || io::Error::new(io::ErrorKind::InvalidData, "HANDSHAKE_INVALID");
    let frame = read_frame(input)
        .map_err(|_| handshake_invalid())?
        .ok_or_else(|| handshake_invalid())?;
    if frame.len() > MAX_HANDSHAKE {
        return Err(handshake_invalid());
    }
    let first = json::parse(&frame).map_err(|_| handshake_invalid())?;
    let agreement = match negotiate(&first) {
        Ok(value)
            if required_auth
                .is_none_or(|auth| first.get("auth").and_then(Value::as_str) == Some(auth))
                && baseline_agreed(&value) =>
        {
            value
        }
        Ok(_) => {
            write_frame(output, &reject())?;
            return Err(handshake_invalid());
        }
        Err("incompatible handshake") => {
            write_frame(output, &reject())?;
            return Err(handshake_invalid());
        }
        _ => return Err(handshake_invalid()),
    };
    write_frame(output, &accept(&agreement))?;
    let mut waiting: Option<Value> = None;
    let mut one_way_receipts = 0u64;
    let mut draining = false;
    'session: while let Some(physical) = read_json(input)? {
        for message in physical_envelopes(physical)? {
            // Unknown wire kinds are diagnostic-only and cannot retire later baseline calls.
            if message
                .get("kind")
                .and_then(Value::as_str)
                .is_some_and(|kind| {
                    !matches!(
                        kind,
                        "request" | "response" | "variation" | "discovery" | "stream"
                    )
                })
            {
                eprintln!("PEER_WARN UNKNOWN_KIND");
                continue;
            }
            if !native_envelope_valid(&message) {
                eprintln!("PEER_ERROR PROTOCOL_INVALID");
                continue;
            }
            match message.get("kind").and_then(Value::as_str) {
                Some("request") => {
                    if draining
                        && message.get("method").and_then(Value::as_str) != Some("peer.finish")
                    {
                        continue;
                    }
                    let route = message.get("data").and_then(|data| data.get("route"));
                    if route
                        .and_then(|route| route.get("profile"))
                        .and_then(Value::as_str)
                        != Some("migaia.rpc.route")
                        || route
                            .and_then(|route| route.get("type"))
                            .and_then(Value::as_str)
                            != Some("request")
                    {
                        continue;
                    }
                    let one_way = route.and_then(|route| route.get("dispatchOnly"))
                        == Some(&Value::Bool(true));
                    if one_way {
                        one_way_receipts += 1;
                    }
                    match message.get("method").and_then(Value::as_str) {
                        Some(RUNTIME_DESCRIBE) => {
                            if !one_way {
                                let directory = runtime_description(&[
                                    ("echo", &["request", "notify"]),
                                    ("peer.echo", &["request", "notify"]),
                                    ("peer.wait", &["request", "notify"]),
                                    ("peer.finish", &["request", "notify"]),
                                    ("peer.error", &["request", "notify"]),
                                    ("peer.receipts", &["request", "notify"]),
                                ]);
                                write_frame(output, &response(&message, directory, None))?;
                            }
                        }
                        Some("peer.wait") => {
                            if !one_way {
                                waiting = Some(message);
                            }
                        }
                        Some("peer.finish") => {
                            if let Some(pending) = waiting.take() {
                                write_frame(output, &response(&pending, Value::Null, None))?;
                            }
                            if !one_way {
                                write_frame(output, &response(&message, Value::Null, None))?;
                            }
                            if draining {
                                break 'session;
                            }
                        }
                        Some("peer.error") => {
                            if !one_way {
                                write_frame(
                                    output,
                                    &response(
                                        &message,
                                        Value::Null,
                                        Some((
                                            "@migaia/rpc/core",
                                            "INTERNAL",
                                            "Peer requested failure",
                                        )),
                                    ),
                                )?;
                            }
                        }
                        Some("peer.receipts") => {
                            if !one_way {
                                write_frame(
                                    output,
                                    &response(&message, number(one_way_receipts), None),
                                )?;
                            }
                        }
                        Some("echo") | Some("peer.echo") => {
                            if !one_way {
                                write_frame(
                                    output,
                                    &response(
                                        &message,
                                        message
                                            .get("data")
                                            .and_then(|data| data.get("payload"))
                                            .cloned()
                                            .unwrap_or(Value::Null),
                                        None,
                                    ),
                                )?;
                            }
                        }
                        _ => {
                            if !one_way {
                                write_frame(
                                    output,
                                    &response(
                                        &message,
                                        Value::Null,
                                        Some((
                                            "@migaia/rpc/core",
                                            "PROVIDER_NOT_FOUND",
                                            METHOD_UNAVAILABLE,
                                        )),
                                    ),
                                )?;
                            }
                        }
                    }
                }
                Some("variation") => match subtype(&message) {
                    Some("ping") if negotiated(&agreement, "ping@1") => {
                        write_frame(output, &variation(&message, "pong"))?
                    }
                    Some("abort") if negotiated(&agreement, "abort@1") => {
                        if draining {
                            eprintln!("PEER_EVENT ABORT_DURING_DRAIN");
                        }
                        if let Some(pending) = waiting.take() {
                            if pending.get("id") == message.get("id") {
                                if draining {
                                    break 'session;
                                }
                            } else {
                                waiting = Some(pending);
                            }
                        }
                    }
                    Some("close") if negotiated(&agreement, "close@1") => {
                        if !valid_close(&message) {
                            eprintln!("PEER_ERROR PROTOCOL_INVALID");
                            continue;
                        }
                        if waiting.is_some() {
                            draining = true;
                        } else {
                            break 'session;
                        }
                    }
                    _ => {}
                },
                Some("response") | Some("discovery") | Some("stream") => {}
                _ => eprintln!("PEER_WARN UNKNOWN_KIND"),
            }
        }
    }
    Ok(())
}

fn request(remote_id: &str) -> Value {
    object(&[
        ("kind", string("request")),
        ("id", string("rust-echo-1")),
        ("method", string("echo")),
        (
            "data",
            object(&[
                (
                    "route",
                    object(&[
                        ("profile", string("migaia.rpc.route")),
                        ("type", string("request")),
                        ("applicationVersion", string("1")),
                        ("senderId", string("rust-peer")),
                        ("targetId", string(remote_id)),
                        ("sentAt", number(0)),
                    ]),
                ),
                ("payload", string("rust-echo")),
            ]),
        ),
    ])
}

/// Cross-language initiator proves the new directory and native batch before closing.
fn initiate(input: &mut impl Read, output: &mut impl Write, auth: Option<&str>) -> io::Result<()> {
    write_frame(output, &hello(auth))?;
    let accepted = read_json(input)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "missing accept"))?;
    if accepted.get("kind").and_then(Value::as_str) != Some("handshake")
        || accepted.get("step").and_then(Value::as_str) != Some("accept")
        || accepted.get("protocol").and_then(Value::as_str) != Some("migaia.rpc")
        || accepted.get("codec").and_then(Value::as_str) != Some("json")
        || accepted.get("major").and_then(Value::as_u64) != Some(1)
        || accepted.get("minor").and_then(Value::as_u64) != Some(1)
        || accepted
            .get("capabilities")
            .and_then(Value::as_array)
            .is_none_or(|caps| {
                caps.iter().any(|cap| {
                    !CAPABILITIES
                        .iter()
                        .any(|offered| cap.as_str() == Some(offered))
                })
            })
    {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "invalid accept"));
    }
    if !baseline_agreed(&accepted) {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "invalid accept"));
    }
    let remote_id = accepted
        .get("peer")
        .and_then(|peer| peer.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid accept"))?;
    let mut describe = request(remote_id);
    if let Value::Object(fields) = &mut describe {
        fields.iter_mut().find(|(name, _)| name == "id").unwrap().1 = string("rust-describe-1");
        fields
            .iter_mut()
            .find(|(name, _)| name == "method")
            .unwrap()
            .1 = string(RUNTIME_DESCRIBE);
    }
    write_frame(output, &describe)?;
    let description = read_json(input)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "missing description"))?;
    let directory = description.get("data").and_then(|data| data.get("payload"));
    if description.get("kind").and_then(Value::as_str) != Some("response")
        || description.get("id") != describe.get("id")
        || description.get("ok") != Some(&Value::Bool(true))
        || directory
            .and_then(|value| value.get("schemaVersion"))
            .and_then(Value::as_u64)
            != Some(2)
        || directory
            .and_then(|value| value.get("self"))
            .and_then(|value| value.get("instanceId"))
            != accepted.get("peer").and_then(|peer| peer.get("id"))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid description",
        ));
    }
    let outgoing = request(remote_id);
    write_frame(
        output,
        &object(&[
            ("kind", string("batch")),
            ("envelopes", Value::Array(vec![outgoing.clone()])),
        ]),
    )?;
    let incoming = read_json(input)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "missing response"))?;
    if incoming.get("kind").and_then(Value::as_str) != Some("response")
        || incoming.get("id") != outgoing.get("id")
        || incoming.get("ok") != Some(&Value::Bool(true))
        || incoming.get("data").and_then(|data| data.get("payload"))
            != outgoing.get("data").and_then(|data| data.get("payload"))
    {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "echo mismatch"));
    }
    let close = object(&[
        ("kind", string("variation")),
        ("id", string("rust-close-1")),
        (
            "data",
            object(&[
                (
                    "route",
                    object(&[
                        ("profile", string("migaia.rpc.route")),
                        ("type", string("variation")),
                        ("applicationVersion", string("1")),
                        ("senderId", string("rust-peer")),
                        ("targetId", string(remote_id)),
                        ("sentAt", number(0)),
                        ("variation", string("close")),
                    ]),
                ),
                ("payload", object(&[("drainMs", number(0))])),
            ]),
        ),
    ]);
    write_frame(output, &close)?;
    eprintln!("RESULT ok");
    Ok(())
}

fn run() -> io::Result<()> {
    let mut role = "responder";
    let mut listener_path: Option<PathBuf> = None;
    let mut connect_path: Option<PathBuf> = None;
    let mut vectors: Option<PathBuf> = None;
    let mut auth_fd: Option<i32> = None;
    let mut selftest = false;
    let mut business_profile = false;
    let mut descendant = false;
    let mut bridge_profile = false;
    let mut bare_profile = false;
    let mut host_profile = false;
    let mut bootstrap_stdin = false;
    let mut arguments = env::args().skip(1);
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--role" => {
                let value = arguments
                    .next()
                    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing role"))?;
                if value != "initiator" && value != "responder" {
                    return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid role"));
                }
                role = if value == "initiator" {
                    "initiator"
                } else {
                    "responder"
                };
            }
            "--business" => business_profile = true,
            "--descendant" => descendant = true,
            "--jsonrpc" => bridge_profile = true,
            "--bare-jsonrpc" => bare_profile = true,
            "--host" => host_profile = true,
            "--bootstrap" => bootstrap_stdin = arguments.next().as_deref() == Some("stdin"),
            // Deployment callers may still supply this path; U36 never reads a v1 contract.
            "--contract" => {
                arguments.next();
            }
            "--stdio" => {}
            "--listen-unix" => listener_path = arguments.next().map(PathBuf::from),
            "--connect-unix" => connect_path = arguments.next().map(PathBuf::from),
            "--selftest" => selftest = true,
            "--vectors" => vectors = arguments.next().map(PathBuf::from),
            "--auth-fd" => {
                auth_fd = Some(
                    arguments
                        .next()
                        .ok_or_else(|| {
                            io::Error::new(io::ErrorKind::InvalidInput, "missing auth descriptor")
                        })?
                        .parse()
                        .map_err(|_| {
                            io::Error::new(io::ErrorKind::InvalidInput, "invalid auth descriptor")
                        })?,
                )
            }
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "unknown argument",
                ));
            }
        }
    }
    if selftest {
        return selftest::run(
            &vectors.ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "missing vectors path")
            })?,
        );
    }
    let mut auth = if let Some(fd) = auth_fd {
        if fd < 3 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "reserved auth descriptor",
            ));
        }
        // Caller transfers ownership of a dedicated inherited descriptor; no token enters argv or environment.
        let input = unsafe { std::fs::File::from_raw_fd(fd) };
        let mut token = String::new();
        input.take(4097).read_to_string(&mut token)?;
        let token = token.trim_end_matches(['\n', '\r']).to_owned();
        if token.is_empty() || token.len() > 4096 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid auth token",
            ));
        }
        Some(token)
    } else {
        None
    };
    if listener_path.is_some() && connect_path.is_some() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "ambiguous connection",
        ));
    }
    if let Some(path) = listener_path {
        let listener = UnixListener::bind(&path)?;
        eprintln!("READY pid={}", std::process::id());
        loop {
            let (stream, _) = listener.accept()?;
            let mut input = stream.try_clone()?;
            let mut output = stream;
            let result = if business_profile {
                business::serve(
                    &mut input,
                    &mut output,
                    host_profile,
                    auth.as_deref(),
                    bridge_profile,
                    bare_profile,
                )
            } else if role == "initiator" {
                initiate(&mut input, &mut output, auth.as_deref())
            } else {
                serve(&mut input, &mut output, auth.as_deref())
            };
            if role == "initiator" {
                let _ = std::fs::remove_file(&path);
                return result;
            }
            if result.is_err() {
                eprintln!("SESSION_FAIL");
            }
        }
    }
    if let Some(path) = connect_path {
        let stream = UnixStream::connect(path)?;
        eprintln!("READY pid={}", std::process::id());
        let mut input = stream.try_clone()?;
        let mut output = stream;
        return if business_profile {
            business::serve(
                &mut input,
                &mut output,
                host_profile,
                auth.as_deref(),
                bridge_profile,
                bare_profile,
            )
        } else if role == "initiator" {
            initiate(&mut input, &mut output, auth.as_deref())
        } else {
            serve(&mut input, &mut output, auth.as_deref())
        };
    }
    eprintln!("READY pid={}", std::process::id());
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    if business_profile && bootstrap_stdin {
        auth = Some(business::bootstrap(&mut input)?);
    }
    if business_profile {
        // This real child is owned through EOF and reaped before the peer returns.
        let mut child = if descendant {
            Some(
                std::process::Command::new("/bin/sleep")
                    .arg("600")
                    .spawn()?,
            )
        } else {
            None
        };
        let result = business::serve(
            &mut input,
            &mut output,
            host_profile,
            auth.as_deref(),
            bridge_profile,
            bare_profile,
        );
        if let Some(child) = &mut child {
            let _ = child.kill();
            child.wait()?;
        }
        result
    } else if role == "initiator" {
        initiate(&mut input, &mut output, auth.as_deref())
    } else {
        serve(&mut input, &mut output, auth.as_deref())
    }
}

fn main() {
    if let Err(error) = run() {
        let label = if error.kind() == io::ErrorKind::InvalidData
            && error.to_string() == "HANDSHAKE_INVALID"
        {
            "HANDSHAKE_INVALID"
        } else if error.kind() == io::ErrorKind::InvalidData
            && error.to_string() == "INVALID_ENVELOPE"
        {
            "INVALID_ENVELOPE"
        } else if error.kind() == io::ErrorKind::InvalidData {
            "INVALID_DATA"
        } else {
            "IO"
        };
        eprintln!("PEER_FAIL {label}");
        std::process::exit(1);
    }
}
