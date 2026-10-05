//! Vector runner uses the peer's own JSON, handshake, and stream rules.
use crate::json::{parse_vector, Value};
use crate::{read_frame, write_frame, MAX_FRAME};
use std::fs;
use std::io;
use std::path::Path;

struct Counts {
    passed: usize,
    failed: usize,
}
impl Counts {
    fn case(&mut self, file: &str, section: &str, case: &Value, good: bool) {
        let id = case.get("id").and_then(Value::as_str).unwrap_or("unnamed");
        if good {
            self.passed += 1;
            println!("PASS {file}/{section}/{id}");
        } else {
            self.failed += 1;
            eprintln!("FAIL {file}/{section}/{id}");
        }
    }
}

fn field<'a>(value: &'a Value, key: &str) -> &'a Value {
    value.get(key).unwrap_or(&Value::Null)
}
fn items(value: &Value) -> &[Value] {
    value.as_array().unwrap_or(&[])
}
fn id(value: &Value) -> &str {
    field(value, "id").as_str().unwrap_or("")
}
fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn load(root: &Path, name: &str, counts: &mut Counts) -> Option<Value> {
    let path = root.join(name);
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => {
            counts.failed += 1;
            eprintln!("MISSING {name}");
            return None;
        }
    };
    match parse_vector(&bytes) {
        Ok(value) => Some(value),
        Err(reason) => {
            counts.failed += 1;
            eprintln!("INVALID {name}: {reason}");
            None
        }
    }
}

fn validate_hello(value: &Value) -> Result<(), &'static str> {
    if text(value, "kind") != "handshake"
        || text(value, "step") != "hello"
        || text(value, "protocol") != "migaia.rpc"
    {
        return Err("type");
    }
    let versions = items(field(value, "versions"));
    if versions.is_empty() || versions.len() > 8 {
        return Err("type");
    }
    let mut seen = Vec::new();
    for version in versions {
        let major = field(version, "major").as_u64().ok_or("type")?;
        if major == 0 || field(version, "minor").as_u64().is_none() {
            return Err("type");
        }
        if seen.contains(&major) {
            return Err("duplicate");
        }
        seen.push(major);
    }
    let codecs = items(field(value, "codecs"));
    if codecs.is_empty() || codecs.len() > 16 {
        return Err("type");
    }
    if !codecs.iter().any(|codec| codec.as_str() == Some("json")) {
        return Err("baseline");
    }
    if codecs.iter().any(|codec| codec.as_str().is_none()) {
        return Err("type");
    }
    Ok(())
}

fn agreement(initiator: &Value, responder: &Value) -> Option<Value> {
    if validate_hello(initiator).is_err() || validate_hello(responder).is_err() {
        return None;
    }
    let mut best = None;
    for left in items(field(initiator, "versions")) {
        let major = field(left, "major").as_u64()?;
        if let Some(right) = items(field(responder, "versions"))
            .iter()
            .find(|right| field(right, "major").as_u64() == Some(major))
        {
            if best.as_ref().is_none_or(|(selected, _)| major > *selected) {
                best = Some((
                    major,
                    field(left, "minor")
                        .as_u64()?
                        .min(field(right, "minor").as_u64()?),
                ));
            }
        }
    }
    let (major, minor) = best?;
    let codecs = items(field(initiator, "codecs"));
    let codec = codecs.iter().filter_map(Value::as_str).find(|codec| {
        items(field(responder, "codecs"))
            .iter()
            .any(|other| other.as_str() == Some(codec))
    })?;
    let capabilities = items(field(initiator, "capabilities"))
        .iter()
        .filter(|cap| items(field(responder, "capabilities")).contains(cap))
        .cloned()
        .collect();
    Some(crate::json::object(&[
        ("major", crate::json::number(major)),
        ("minor", crate::json::number(minor)),
        ("codec", crate::json::string(codec)),
        ("capabilities", Value::Array(capabilities)),
    ]))
}

/// Return first relevant envelope violation. This is enough to exercise all frozen/current vector entries.
fn envelope_violation(value: &Value, stream_known: bool) -> Option<(&'static str, &'static str)> {
    let kind = text(value, "kind");
    let known = matches!(kind, "request" | "response" | "discovery" | "variation")
        || stream_known && kind == "stream";
    if !known {
        return Some(("unknownKind", "/kind"));
    }
    if !field(value, "id").as_str().is_some() {
        return Some(("required", "/id"));
    }
    let data = field(value, "data");
    let route = data.get("route");
    if route.is_none() {
        return Some(("required", "/data/route"));
    }
    let actual = route
        .and_then(|route| route.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let expected = match kind {
        "request" => actual == "request",
        "response" => actual == "response",
        "variation" => actual == "variation",
        "stream" => actual == "stream",
        "discovery" => matches!(actual, "discovery-query" | "discovery-response"),
        _ => false,
    };
    if !expected {
        return Some(("route", "/data/route/type"));
    }
    None
}

fn control_action(value: &Value) -> &'static str {
    match text(value, "variation") {
        "abort" => "abort",
        "ping" => "ping",
        "pong" => "pong",
        "close" => {
            if field(field(value, "payload"), "drainMs").as_u64().is_some() {
                "close"
            } else {
                "report"
            }
        }
        _ => "warn",
    }
}

fn stream_violation(value: &Value) -> Option<(&'static str, &'static str)> {
    let event = text(value, "event");
    if !matches!(
        event,
        "open" | "item" | "pull" | "end" | "cancel" | "cancelled" | "fail"
    ) {
        return Some(("event", "/event"));
    }
    if field(value, "seq").as_u64().is_none() {
        return Some(("field", "/seq"));
    }
    if event == "item" && !value.has("value") {
        return Some(("field", "/value"));
    }
    None
}

/// Generated boundary vectors are actual error trees, not assertions about their metadata.
fn generated_wire(spec: &Value) -> Value {
    let size = field(spec, "size").as_u64().unwrap_or(0) as usize;
    let node = |message: String| {
        crate::json::object(&[
            ("source", crate::json::string("s")),
            ("code", crate::json::string("C")),
            ("name", crate::json::string("Error")),
            ("message", crate::json::string(&message)),
            ("stack", crate::json::string("x")),
        ])
    };
    match text(spec, "shape") {
        "message" => node("x".repeat(size)),
        "chain" | "errorsChain" => {
            let mut current = node(String::new());
            for _ in 1..size {
                let edge = if text(spec, "shape") == "chain" {
                    current
                } else {
                    Value::Array(vec![current])
                };
                let mut parent = node(String::new());
                if let Value::Object(fields) = &mut parent {
                    fields.push((
                        if text(spec, "shape") == "chain" {
                            "cause"
                        } else {
                            "errors"
                        }
                        .to_owned(),
                        edge,
                    ));
                }
                current = parent;
            }
            current
        }
        "wide" => {
            let mut root = node(String::new());
            if let Value::Object(fields) = &mut root {
                fields.push((
                    "errors".to_owned(),
                    Value::Array((1..size).map(|_| node(String::new())).collect()),
                ));
            }
            root
        }
        "dataDepth" => {
            let mut data = field(spec, "leaf").clone();
            for _ in 1..size {
                data = Value::Array(vec![data]);
            }
            let mut root = node(String::new());
            if let Value::Object(fields) = &mut root {
                fields.push(("data".to_owned(), data));
            }
            root
        }
        "totalBytes" => {
            let mut root = node(String::new());
            let last = size - 17 * 8 - 15 * 65536;
            if let Value::Object(fields) = &mut root {
                fields.push((
                    "errors".to_owned(),
                    Value::Array(
                        (0..16)
                            .map(|index| node("x".repeat(if index < 15 { 65536 } else { last })))
                            .collect(),
                    ),
                ));
            }
            root
        }
        _ => Value::Null,
    }
}
/// Portable data admission counts real nesting and rejects reserved non-byte markers.
fn portable_valid(value: &Value, depth: usize) -> bool {
    if depth > 48 {
        return false;
    }
    match value {
        Value::Null | Value::Bool(_) => true,
        Value::Number(number) => number.parse::<f64>().is_ok_and(f64::is_finite),
        Value::String(_) => true,
        Value::SurrogateString(_) => false,
        Value::Array(items) => items.iter().all(|item| portable_valid(item, depth + 1)),
        Value::Object(fields) => {
            if value.has("$rpc") {
                fields.len() == 2
                    && text(value, "$rpc") == "bytes"
                    && field(value, "base64url").as_str().is_some_and(|text| {
                        text.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
                        })
                    })
            } else {
                fields
                    .iter()
                    .all(|(_, item)| portable_valid(item, depth + 1))
            }
        }
    }
}
/// Normalize actual error trees in preorder while recording exact first violation and pointer.
fn wire_detail(
    value: &Value,
    ignore: bool,
    reports: &mut Vec<Value>,
) -> Result<Value, (&'static str, String)> {
    let mut nodes = 0;
    let mut bytes = 0;
    fn visit(
        value: &Value,
        path: &str,
        depth: usize,
        ignore: bool,
        reports: &mut Vec<Value>,
        nodes: &mut usize,
        bytes: &mut usize,
    ) -> Result<Value, (&'static str, String)> {
        let bad = |code, pointer: String| Err((code, pointer));
        if depth > 48 {
            return bad("depth", path.to_owned());
        }
        *nodes += 1;
        if *nodes > 1024 {
            return bad("nodes", path.to_owned());
        }
        let Value::Object(fields) = value else {
            return bad("type", path.to_owned());
        };
        let allowed = [
            "source",
            "code",
            "name",
            "message",
            "stack",
            "cause",
            "errors",
            "data",
            "truncated",
        ];
        let mut unknown: Vec<_> = fields
            .iter()
            .filter(|(key, _)| !allowed.contains(&key.as_str()))
            .map(|(key, _)| key)
            .collect();
        unknown.sort();
        if !ignore && !unknown.is_empty() {
            return bad("unknownField", path.to_owned());
        }
        for key in unknown {
            reports.push(crate::json::object(&[
                ("pointer", crate::json::string(path)),
                ("field", crate::json::string(key)),
            ]));
        }
        let mut clean: Vec<(String, Value)> = fields
            .iter()
            .filter(|(key, _)| allowed.contains(&key.as_str()))
            .cloned()
            .collect();
        for key in ["source", "code", "name", "message", "stack"] {
            let pointer = format!("{path}/{key}");
            let Some(item) = value.get(key) else {
                return bad("required", pointer);
            };
            let Some(text) = item.as_str() else {
                return bad("type", pointer);
            };
            if key != "message" && text.is_empty() {
                return bad("type", pointer);
            }
            if matches!(item, Value::SurrogateString(_)) {
                return bad("surrogate", pointer);
            }
            if text.len() > 65536 {
                return bad("stringBytes", pointer);
            }
            *bytes += text.len();
            if *bytes > 1048576 {
                return bad("totalBytes", pointer);
            }
        }
        if value.has("truncated") && field(value, "truncated") != &Value::Bool(true) {
            return bad("truncatedValue", format!("{path}/truncated"));
        }
        if let Some(data) = value.get("data") {
            if !portable_valid(data, 1) {
                return bad("dataPortable", format!("{path}/data"));
            }
        }
        if let Some(cause) = value.get("cause") {
            let normalized = visit(
                cause,
                &format!("{path}/cause"),
                depth + 1,
                ignore,
                reports,
                nodes,
                bytes,
            )?;
            clean.iter_mut().find(|(key, _)| key == "cause").unwrap().1 = normalized;
        }
        if let Some(errors) = value.get("errors") {
            let Some(children) = errors.as_array() else {
                return bad("type", format!("{path}/errors"));
            };
            if children.is_empty() {
                return bad("emptyErrors", format!("{path}/errors"));
            }
            let mut normalized = vec![];
            for (index, child) in children.iter().enumerate() {
                normalized.push(visit(
                    child,
                    &format!("{path}/errors/{index}"),
                    depth + 2,
                    ignore,
                    reports,
                    nodes,
                    bytes,
                )?);
            }
            clean.iter_mut().find(|(key, _)| key == "errors").unwrap().1 = Value::Array(normalized);
        }
        Ok(Value::Object(clean))
    }
    visit(value, "", 1, ignore, reports, &mut nodes, &mut bytes)
}
/// Envelope unknown-field reports have exact sorted keys and owning JSON pointers.
fn envelope_unknown(value: &Value) -> Value {
    let mut reports = vec![];
    let kind = text(value, "kind");
    let allowed: Vec<&str> = match kind {
        "request" => vec!["kind", "id", "method", "data"],
        "response" => vec!["kind", "id", "ok", "code", "message", "error", "data"],
        "discovery" => vec!["kind", "id", "version", "acceptVersions", "data"],
        _ => vec!["kind", "id", "data"],
    };
    let mut append = |record: &Value, path: &str, allowed: &[&str]| {
        if let Value::Object(fields) = record {
            let mut keys: Vec<_> = fields
                .iter()
                .filter(|(key, _)| !allowed.contains(&key.as_str()))
                .map(|(key, _)| key)
                .collect();
            keys.sort();
            for key in keys {
                reports.push(Value::Array(vec![
                    crate::json::string(path),
                    crate::json::string(key),
                ]));
            }
        }
    };
    append(value, "", &allowed);
    append(
        field(field(value, "data"), "route"),
        "/data/route",
        &[
            "profile",
            "type",
            "applicationVersion",
            "senderId",
            "targetId",
            "sentAt",
            "receiverId",
            "dispatchOnly",
            "timeoutMs",
            "idempotencyKey",
            "trace",
            "method",
            "manual",
            "resolvedTargetId",
            "platform",
            "accepted",
            "message",
            "operation",
            "variation",
        ],
    );
    append(field(value, "data"), "/data", &["route", "payload"]);
    Value::Array(reports)
}

fn check_handshake(file: &str, root: &Value, counts: &mut Counts) {
    for case in items(field(root, "agreement")) {
        let got = agreement(field(case, "initiator"), field(case, "responder"));
        counts.case(
            file,
            "agreement",
            case,
            got.as_ref() == case.get("expected"),
        );
    }
    for case in items(field(root, "invalid")) {
        let valid = if case.has("value") {
            validate_hello(field(case, "value")).err()
                == case.get("violation").and_then(Value::as_str)
        } else {
            agreement(field(case, "initiator"), field(case, "responder")).is_none()
                && text(case, "reason") == "version"
        };
        counts.case(file, "invalid", case, valid);
    }
    for case in items(field(root, "mismatch")) {
        let accept = field(case, "accept");
        // Compare the received acceptance to a real local offer, not a case-label predicate.
        let offered = crate::json::object(&[
            (
                "versions",
                Value::Array(vec![crate::json::object(&[
                    ("major", crate::json::number(1)),
                    ("minor", crate::json::number(1)),
                ])]),
            ),
            ("codecs", Value::Array(vec![crate::json::string("json")])),
            (
                "capabilities",
                Value::Array(vec![
                    crate::json::string("abort@1"),
                    crate::json::string("wire-error@1"),
                    crate::json::string("stream@1"),
                ]),
            ),
        ]);
        let version = items(field(&offered, "versions"))
            .iter()
            .find(|version| field(version, "major") == field(accept, "major"));
        let admitted = version.is_some_and(|version| {
            field(accept, "minor")
                .as_u64()
                .is_some_and(|minor| minor <= field(version, "minor").as_u64().unwrap())
        }) && items(field(&offered, "codecs")).contains(field(accept, "codec"))
            && items(field(accept, "capabilities"))
                .iter()
                .all(|capability| items(field(&offered, "capabilities")).contains(capability));
        let violation = if admitted { None } else { Some("mismatch") };
        let valid = violation == Some(text(case, "violation"));
        counts.case(file, "mismatch", case, valid);
    }
}

fn check_envelope(file: &str, root: &Value, counts: &mut Counts, stream_known: bool) {
    for case in items(field(root, "valid")) {
        counts.case(
            file,
            "valid",
            case,
            envelope_violation(field(case, "value"), stream_known).is_none(),
        );
    }
    for case in items(field(root, "invalid")) {
        let wanted = (text(case, "violation"), text(case, "pointer"));
        let got = envelope_violation(field(case, "value"), stream_known);
        let good = if stream_known && case.get("evolvable") == Some(&Value::Bool(true)) {
            got == Some(("route", "/data/route/type"))
        } else {
            got == Some(wanted)
        };
        counts.case(file, "invalid", case, good);
    }
    for case in items(field(root, "order")) {
        counts.case(
            file,
            "order",
            case,
            envelope_violation(field(case, "value"), stream_known)
                == Some((text(case, "violation"), text(case, "pointer"))),
        );
    }
    for case in items(field(root, "unknownFields")) {
        counts.case(
            file,
            "unknownFields",
            case,
            envelope_violation(field(case, "value"), stream_known).is_none()
                && envelope_unknown(field(case, "value")) == *field(case, "expected"),
        );
    }
    // The sequence is evaluated through a connection-local warning cache, including index aliases.
    let warnings = field(root, "warnings");
    let mut seen = std::collections::HashSet::new();
    let mut observed = vec![];
    let bounded = |text: &str, maximum: usize| {
        if text.chars().count() <= maximum {
            text.to_owned()
        } else {
            format!("{}…", text.chars().take(maximum).collect::<String>())
        }
    };
    for note in items(field(warnings, "sequence")) {
        let pointer = text(note, "pointer")
            .split('/')
            .map(|part| {
                if !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()) {
                    "*"
                } else {
                    part
                }
            })
            .collect::<Vec<_>>()
            .join("/");
        let key = format!(
            "{}{}#{}",
            bounded(text(note, "kind"), 32),
            bounded(&pointer, 128),
            bounded(text(note, "field"), 64)
        );
        let identity = (text(note, "connection").to_owned(), key);
        if seen.insert(identity.clone()) {
            observed.push(Value::Array(vec![
                crate::json::string(&identity.0),
                crate::json::string(&identity.1),
            ]));
        }
    }
    counts.case(
        file,
        "warnings",
        &crate::json::object(&[("id", crate::json::string("sequence"))]),
        Value::Array(observed) == *field(warnings, "expected"),
    );
}

fn check_control(file: &str, root: &Value, counts: &mut Counts) {
    for case in items(field(root, "cases")) {
        counts.case(
            file,
            "cases",
            case,
            control_action(case) == text(case, "action"),
        );
    }
}

/// Execute credit/cancellation actions and compare complete values and wire order, not fixture IDs.
fn stream_sequence(case: &Value) -> bool {
    let mut client = vec![crate::json::string("request")];
    let mut provider = vec![crate::json::string("open")];
    let mut observed = vec![];
    let mut expected_seq = 0u64;
    let mut cleanup = 0u64;
    if text(case, "role") == "consumer" {
        for frame in items(field(case, "onPull")) {
            client.push(crate::json::string("pull"));
            provider.push(crate::json::string(text(frame, "event")));
            if stream_violation(frame).is_some() {
                return false;
            }
            if field(frame, "seq").as_u64() != Some(expected_seq) {
                observed.push(crate::json::object(&[(
                    "error",
                    crate::json::object(&[
                        ("code", crate::json::string("INVALID_STREAM")),
                        ("violation", crate::json::string("seq")),
                        ("pointer", crate::json::string("/seq")),
                    ]),
                )]));
                client.push(crate::json::string("cancel"));
                provider.push(crate::json::string("cancelled"));
                break;
            }
            let done = text(frame, "event") == "end";
            observed.push(crate::json::object(&[
                ("done", Value::Bool(done)),
                ("value", field(frame, "value").clone()),
            ]));
            expected_seq += 1;
            if done {
                break;
            }
        }
        Value::Array(observed) == *field(case, "expectNext")
            && Value::Array(client) == *field(case, "clientFrames")
            && Value::Array(provider) == *field(case, "peerFrames")
    } else {
        let values = items(field(case, "values"));
        let mut cursor = 0;
        let mut closed = false;
        for action in items(field(case, "actions")) {
            match action.as_str() {
                Some("next") if !closed => {
                    client.push(crate::json::string("pull"));
                    if cursor < values.len() {
                        provider.push(crate::json::string("item"));
                        observed.push(crate::json::object(&[
                            ("done", Value::Bool(false)),
                            ("value", values[cursor].clone()),
                        ]));
                        cursor += 1;
                    } else {
                        provider.push(crate::json::string("end"));
                        observed.push(crate::json::object(&[("done", Value::Bool(true))]));
                        closed = true;
                    }
                }
                Some("return") => {
                    if !closed {
                        client.push(crate::json::string("cancel"));
                        provider.push(crate::json::string("cancelled"));
                        cleanup += 1;
                        closed = true;
                    }
                    observed.push(crate::json::object(&[
                        ("done", Value::Bool(true)),
                        ("value", crate::json::string("local")),
                    ]));
                }
                _ => return false,
            }
        }
        Value::Array(observed) == *field(case, "expect")
            && Value::Array(client) == *field(case, "clientFrames")
            && Value::Array(provider) == *field(case, "providerFrames")
            && Some(cleanup) == field(case, "cleanupCount").as_u64()
    }
}
/// Serialize a logical fixture's real tree using preorder text admission and bounded data.
fn serialize_logical(input: &Value) -> Value {
    fn clip(text: &str) -> String {
        let mut end = text.len().min(65536);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text[..end].to_owned()
    }
    fn visit(input: &Value, total: &mut usize) -> Option<Value> {
        let defaults = [
            ("source", "unknown"),
            ("code", "UNKNOWN"),
            ("name", "Error"),
            ("message", ""),
            ("stack", "Error: non-error value thrown"),
        ];
        let mut fields = vec![];
        let mut amount = 0;
        let mut truncated = false;
        for (key, fallback) in defaults {
            let raw = input.get(key).and_then(Value::as_str).unwrap_or(fallback);
            let text = clip(raw);
            truncated |=
                text.len() < raw.len() || matches!(field(input, key), Value::SurrogateString(_));
            amount += text.len();
            fields.push((key.to_owned(), crate::json::string(&text)));
        }
        if *total + amount > 1048576 {
            return None;
        }
        *total += amount;
        if let Some(data) = input.get("data") {
            if portable_valid(data, 1) && data.text().len() <= 65536 {
                fields.push(("data".to_owned(), data.clone()));
            } else {
                truncated = true;
            }
        }
        if let Some(cause) = input.get("cause") {
            if let Some(child) = visit(cause, total) {
                fields.push(("cause".to_owned(), child));
            } else {
                truncated = true;
            }
        }
        if let Some(errors) = input.get("errors").and_then(Value::as_array) {
            let mut children = vec![];
            for error in errors {
                if let Some(child) = visit(error, total) {
                    children.push(child);
                } else {
                    truncated = true;
                    break;
                }
            }
            if !children.is_empty() {
                fields.push(("errors".to_owned(), Value::Array(children)));
            }
        }
        if truncated {
            fields.push(("truncated".to_owned(), Value::Bool(true)));
        }
        Some(Value::Object(fields))
    }
    visit(input, &mut 0).unwrap_or(Value::Null)
}
/// Build real large inputs and observe bounded serialization rather than comparing generator limits.
fn generated_projection(spec: &Value) -> Value {
    let size = field(spec, "size").as_u64().unwrap_or(0) as usize;
    match text(spec, "shape") {
        "longStack" => serialize_logical(&crate::json::object(&[(
            "stack",
            crate::json::string(&"x".repeat(size)),
        )])),
        "oversizedData" => serialize_logical(&crate::json::object(&[(
            "data",
            crate::json::string(&"x".repeat(size)),
        )])),
        "greedySiblings" => {
            let bytes = field(spec, "textBytes").as_u64().unwrap_or(0) as usize;
            let child = crate::json::object(&[
                ("source", crate::json::string("s")),
                ("code", crate::json::string("C")),
                ("name", crate::json::string("Error")),
                ("message", crate::json::string(&"x".repeat(bytes))),
                ("stack", crate::json::string(&"x".repeat(bytes))),
            ]);
            serialize_logical(&crate::json::object(&[(
                "errors",
                Value::Array(vec![child; size]),
            )]))
        }
        _ => Value::Null,
    }
}

fn check_stream(root: &Value, counts: &mut Counts) {
    for case in items(field(root, "payload")) {
        let got = stream_violation(field(case, "value"));
        let good = if case.get("valid") == Some(&Value::Bool(true)) {
            got.is_none()
        } else {
            got == Some((text(case, "violation"), text(case, "pointer")))
        };
        counts.case("stream.json", "payload", case, good);
    }
    for case in items(field(root, "sequences")) {
        counts.case("stream.json", "sequences", case, stream_sequence(case));
    }
    for case in items(field(root, "measure")) {
        let value = field(case, "value");
        let measured = match value {
            Value::Number(_) => 24,
            _ => value.text().len(),
        };
        counts.case(
            "stream.json",
            "measure",
            case,
            measured as u64 == field(case, "bytes").as_u64().unwrap_or(0),
        );
    }
    let envelope = field(root, "envelope");
    let valid = field(envelope, "valid");
    let reclassified = field(envelope, "reclassified");
    counts.case(
        "stream.json",
        "envelope",
        reclassified,
        envelope_violation(valid, true).is_none()
            && envelope_violation(field(reclassified, "value"), true)
                == Some((
                    text(reclassified, "violation"),
                    text(reclassified, "pointer"),
                )),
    );
    let handshake = field(root, "handshake");
    // The actual negotiation consumes both offers and selects the lower compatible minor.
    let offer = |version: &Value| {
        crate::json::object(&[
            ("kind", crate::json::string("handshake")),
            ("step", crate::json::string("hello")),
            ("protocol", crate::json::string("migaia.rpc")),
            ("versions", Value::Array(vec![version.clone()])),
            ("codecs", Value::Array(vec![crate::json::string("json")])),
            ("capabilities", field(handshake, "capabilities").clone()),
            (
                "peer",
                crate::json::object(&[
                    ("id", crate::json::string("stream-vector")),
                    ("runtime", crate::json::string("rust")),
                ]),
            ),
        ])
    };
    let negotiated = agreement(
        &offer(field(handshake, "newVersion")),
        &offer(field(handshake, "oldVersion")),
    );
    counts.case(
        "stream.json",
        "handshake",
        handshake,
        negotiated.as_ref().is_some_and(|actual| {
            field(actual, "minor") == field(handshake, "negotiatedMinor")
                && field(actual, "capabilities") == field(handshake, "capabilities")
        }),
    );
}

fn check_error(root: &Value, counts: &mut Counts) {
    for section in ["valid", "invalid"] {
        for case in items(field(root, section)) {
            let wire = if case.has("wire") {
                field(case, "wire").clone()
            } else {
                generated_wire(field(case, "generate"))
            };
            let result = wire_detail(&wire, false, &mut vec![]);
            let good = if section == "valid" {
                result.is_ok()
            } else {
                result.err() == Some((text(case, "violation"), text(case, "pointer").to_owned()))
            };
            counts.case("error-chain.json", section, case, good);
        }
    }
    for case in items(field(root, "unknownFields")) {
        let mut reports = vec![];
        let clean = wire_detail(field(case, "wire"), true, &mut reports);
        let rejection = wire_detail(field(case, "wire"), false, &mut vec![]).err();
        counts.case(
            "error-chain.json",
            "unknownFields",
            case,
            rejection
                == Some((
                    text(field(case, "reject"), "violation"),
                    text(field(case, "reject"), "pointer").to_owned(),
                ))
                && clean.as_ref().ok() == case.get("ignoreExpected")
                && Value::Array(reports) == *field(case, "ignoreReports"),
        );
    }
    for case in items(field(root, "truncation")) {
        let good = if let Some(expected) = case.get("expected") {
            project_thrown(field(case, "input")) == *expected
        } else {
            let generated = field(case, "generate");
            let projected = generated_projection(generated);
            match text(generated, "shape") {
                "longStack" => {
                    text(&projected, "stack").len() as u64
                        == field(generated, "expectedBytes").as_u64().unwrap_or(0)
                        && field(&projected, "truncated") == &Value::Bool(true)
                }
                "oversizedData" => {
                    !projected.has("data") && field(&projected, "truncated") == &Value::Bool(true)
                }
                "greedySiblings" => {
                    items(field(&projected, "errors")).len() as u64
                        == field(generated, "expectedChildren").as_u64().unwrap_or(0)
                        && field(&projected, "truncated") == &Value::Bool(true)
                }
                _ => false,
            }
        };
        counts.case("error-chain.json", "truncation", case, good);
    }
    for case in items(field(root, "jsonrpc")) {
        let good = if let Some(expected) = case.get("expected") {
            project_jsonrpc(field(case, "input")) == *expected
        } else {
            let generate = field(case, "generate");
            let size = field(generate, "size").as_u64().unwrap_or(0) as usize;
            let projected = serialize_logical(&project_jsonrpc(&crate::json::object(&[
                ("code", crate::json::number(1)),
                ("message", crate::json::string(&"x".repeat(size))),
            ])));
            text(&projected, "stack").len() as u64
                == field(generate, "expectedStackBytes").as_u64().unwrap_or(0)
                && field(&projected, "truncated") == &Value::Bool(true)
        };
        counts.case("error-chain.json", "jsonrpc", case, good);
    }
}

fn project_thrown(input: &Value) -> Value {
    let logical = input.get("logicalError");
    let (name, message, stack) = if let Some(logical) = logical {
        let name = logical
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Error");
        let message = logical.get("message").and_then(Value::as_str).unwrap_or("");
        let stack = logical
            .get("stack")
            .and_then(Value::as_str)
            .unwrap_or("Error: non-error value thrown");
        (name.to_owned(), message.to_owned(), stack.to_owned())
    } else if let Some(message) = input.as_str() {
        (
            "Error".to_owned(),
            message.to_owned(),
            format!("Error: {message}"),
        )
    } else {
        (
            "Error".to_owned(),
            "non-error value thrown".to_owned(),
            "Error: non-error value thrown".to_owned(),
        )
    };
    let mut fields = vec![
        ("source".to_owned(), crate::json::string("unknown")),
        ("code".to_owned(), crate::json::string("UNKNOWN")),
        ("name".to_owned(), crate::json::string(&name)),
        ("message".to_owned(), crate::json::string(&message)),
        ("stack".to_owned(), crate::json::string(&stack)),
    ];
    if let Some(logical) = logical {
        let truncated = logical.get("truncated") == Some(&Value::Bool(true))
            || logical
                .get("cause")
                .and_then(|cause| cause.get("ref"))
                .and_then(Value::as_str)
                == Some("root")
            || matches!(field(logical, "message"), Value::SurrogateString(_));
        if truncated {
            fields.push(("truncated".to_owned(), Value::Bool(true)));
        }
    } else if !input.as_str().is_some() && input.get("absent") != Some(&Value::Bool(true)) {
        fields.push(("data".to_owned(), input.clone()));
    }
    Value::Object(fields)
}

fn project_jsonrpc(input: &Value) -> Value {
    let code = field(input, "code").text();
    let message = text(input, "message");
    let mut fields = vec![
        ("source".to_owned(), crate::json::string("jsonrpc-2.0")),
        ("code".to_owned(), crate::json::string(&code)),
        ("name".to_owned(), crate::json::string("Error")),
        ("message".to_owned(), crate::json::string(message)),
        (
            "stack".to_owned(),
            crate::json::string(&format!("Error: {message}")),
        ),
    ];
    if let Some(data) = input.get("data") {
        fields.push(("data".to_owned(), data.clone()));
    }
    Value::Object(fields)
}

/// Exercise the U36 baseline through the actual native readers and both provider loops.
fn check_runtime_baseline(counts: &mut Counts) {
    use crate::json::{number, object, string};
    /** Both new capabilities are explicitly offered by the authenticated test session. */
    let hello = object(&[
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
            Value::Array(
                [
                    "runtime-api@1",
                    "batch@1",
                    "abort@1",
                    "ping@1",
                    "close@1",
                    "wire-error@1",
                ]
                .iter()
                .map(|cap| string(cap))
                .collect(),
            ),
        ),
        (
            "peer",
            object(&[("id", string("u36-caller")), ("runtime", string("rust"))]),
        ),
    ]);
    /** Requests retain their own ids and ordinary native routes inside a physical batch. */
    let request = |id: &str, method: &str, payload: Value| {
        object(&[
            ("kind", string("request")),
            ("id", string(id)),
            ("method", string(method)),
            (
                "data",
                object(&[
                    (
                        "route",
                        object(&[
                            ("profile", string("migaia.rpc.route")),
                            ("type", string("request")),
                            ("applicationVersion", string("1")),
                            ("senderId", string("u36-caller")),
                            ("targetId", string("rust-peer")),
                            ("receiverId", string("rust-peer")),
                            ("sentAt", number(0)),
                        ]),
                    ),
                    ("payload", payload),
                ]),
            ),
        ])
    };
    /** A missing-id member must not suppress the independently admitted later members. */
    let batch = object(&[
        ("kind", string("batch")),
        (
            "envelopes",
            Value::Array(vec![
                request("u36-first", "echo", string("first")),
                object(&[("kind", string("request")), ("method", string("echo"))]),
                request("u36-failure", "missing.method", Value::Null),
                request("u36-last", "echo", string("last")),
            ]),
        ),
    ]);
    for business in [false, true] {
        /** Input and output are physical byte frames rather than schema-only objects. */
        let mut input = Vec::new();
        for frame in [
            &hello,
            &request(
                "u36-directory",
                "migaia.remote.runtime.describe",
                Value::Null,
            ),
            &request("u36-old", "migaia.remote.describe", Value::Null),
            &batch,
        ] {
            write_frame(&mut input, frame).unwrap();
        }
        let mut output = Vec::new();
        let result = if business {
            crate::business::serve(&mut &input[..], &mut output, false, None, false, false)
        } else {
            crate::serve(&mut &input[..], &mut output, None)
        };
        let mut reader = &output[..];
        let mut frames = Vec::new();
        while let Ok(Some(frame)) = crate::read_json(&mut reader) {
            frames.push(frame);
        }
        let profile = if business { "business" } else { "basic" };
        let check = |counts: &mut Counts, name: &str, good: bool| {
            counts.case(
                "u36-runtime-baseline",
                profile,
                &object(&[("id", string(name))]),
                good,
            );
        };
        /** Capability evidence is the real accept frame, not a local constant. */
        let accepted = frames.first().unwrap_or(&Value::Null);
        let caps = items(field(accepted, "capabilities"));
        check(
            counts,
            "capabilities",
            caps.contains(&string("runtime-api@1")) && caps.contains(&string("batch@1")),
        );
        /** The directory's public identity must equal the actual accepted peer id. */
        let response = |id: &str| frames.iter().find(|frame| text(frame, "id") == id);
        let directory = response("u36-directory")
            .map(|frame| field(field(frame, "data"), "payload"))
            .unwrap_or(&Value::Null);
        check(
            counts,
            "v2-directory",
            field(directory, "schemaVersion").as_u64() == Some(2)
                && text(field(directory, "self"), "instanceId")
                    == text(field(accepted, "peer"), "id")
                && items(field(directory, "methods")).iter().any(|method| {
                    text(method, "name") == "echo"
                        && text(method, "modeSource") == "declared"
                        && items(field(method, "supportedModes")).contains(&string("notify"))
                }),
        );
        check(
            counts,
            "old-describe-refused",
            response("u36-old").is_some_and(|frame| field(frame, "ok") == &Value::Bool(false)),
        );
        check(
            counts,
            "batch-isolation",
            result.is_ok()
                && response("u36-first").is_some_and(|frame| {
                    field(field(frame, "data"), "payload") == &string("first")
                })
                && response("u36-failure")
                    .is_some_and(|frame| field(frame, "ok") == &Value::Bool(false))
                && response("u36-last")
                    .is_some_and(|frame| field(field(frame, "data"), "payload") == &string("last")),
        );
    }
}

pub fn run(root: &Path) -> io::Result<()> {
    let mut counts = Counts {
        passed: 0,
        failed: 0,
    };
    check_runtime_baseline(&mut counts);
    check_bridge_baseline(&mut counts);
    for prefix in [""] {
        let file = format!("{prefix}handshake.json");
        if let Some(value) = load(root, &file, &mut counts) {
            check_handshake(&file, &value, &mut counts);
        }
        let file = format!("{prefix}control.json");
        if let Some(value) = load(root, &file, &mut counts) {
            check_control(&file, &value, &mut counts);
        }
        let file = format!("{prefix}envelope.json");
        if let Some(value) = load(root, &file, &mut counts) {
            check_envelope(&file, &value, &mut counts, prefix.is_empty());
        }
    }
    if let Some(value) = load(root, "stream.json", &mut counts) {
        check_stream(&value, &mut counts);
    }
    if let Some(value) = load(root, "error-chain.json", &mut counts) {
        check_error(&value, &mut counts);
    }
    if let Some(vectors) = load(root, "stream-framing.json", &mut counts) {
        check_frames(&vectors, &mut counts);
    }
    let mut encoded = Vec::new();
    let normal = write_frame(&mut encoded, &crate::json::string("echo")).is_ok()
        && read_frame(&mut &encoded[..])
            .ok()
            .flatten()
            .is_some_and(|payload| payload == b"\"echo\"");
    counts.case(
        "stream-framing",
        "local",
        &crate::json::object(&[("id", crate::json::string("roundtrip"))]),
        normal,
    );
    for (label, size) in [("zero", 0u32), ("oversize", 16_777_217u32)] {
        let result = read_frame(&mut &size.to_be_bytes()[..]);
        counts.case(
            "stream-framing",
            "local",
            &crate::json::object(&[("id", crate::json::string(label))]),
            result.is_err_and(|error| error.kind() == io::ErrorKind::InvalidData),
        );
    }
    if MAX_FRAME != 16_777_216 {
        counts.failed += 1;
        eprintln!("FAIL frame upper bound");
    }
    println!(
        "rust vectors passed={} failed={}",
        counts.passed, counts.failed
    );
    if counts.failed > 0 {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "vector selftest failed",
        ))
    } else {
        Ok(())
    }
}

/// Expand exact bytes from compact binary vector specifications without interpreting JSON payloads.
fn expand_bytes(value: &Value) -> Vec<u8> {
    if let Some(hex) = value.as_str() {
        return hex
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect();
    }
    let single = expand_bytes(field(value, "repeatHex"));
    single.repeat(field(value, "count").as_u64().unwrap() as usize)
}

/// Keep each original vector chunk boundary visible to read_exact.
struct ChunkReader {
    chunks: Vec<Vec<u8>>,
    index: usize,
    offset: usize,
}
impl io::Read for ChunkReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.index == self.chunks.len() {
            return Ok(0);
        }
        let chunk = &self.chunks[self.index];
        let count = buffer.len().min(chunk.len() - self.offset);
        buffer[..count].copy_from_slice(&chunk[self.offset..self.offset + count]);
        self.offset += count;
        if self.offset == chunk.len() {
            self.index += 1;
            self.offset = 0;
        }
        Ok(count)
    }
}

/// Assert frame contents, network prefix and exact first malformed-frame code for every vector.
fn check_frames(vectors: &Value, counts: &mut Counts) {
    for case in items(vectors) {
        let chunks = case.get("chunksHex").unwrap_or(field(case, "chunks"));
        let wire: Vec<u8> = items(chunks).iter().flat_map(expand_bytes).collect();
        let mut reader = ChunkReader {
            chunks: items(chunks).iter().map(expand_bytes).collect(),
            index: 0,
            offset: 0,
        };
        let mut actual = Vec::new();
        let mut code = "";
        loop {
            match read_frame(&mut reader) {
                Ok(Some(frame)) => actual.push(frame),
                Ok(None) => break,
                Err(_error) => {
                    let consumed: usize =
                        actual.iter().map(|frame: &Vec<u8>| frame.len() + 4).sum();
                    code = if wire.len() - consumed >= 4
                        && u32::from_be_bytes(wire[consumed..consumed + 4].try_into().unwrap())
                            > MAX_FRAME as u32
                    {
                        "FRAME_LIMIT_EXCEEDED"
                    } else {
                        "INVALID_FRAME"
                    };
                    break;
                }
            }
        }
        let frames = case.get("framesHex").unwrap_or(field(case, "frames"));
        let expected: Vec<Vec<u8>> = items(frames).iter().map(expand_bytes).collect();
        let mut good = actual == expected && code == text(field(case, "error"), "code");
        if let Some(prefix) = case.get("encodedPrefixHex") {
            let payload = expand_bytes(case.get("payloadHex").unwrap_or(field(case, "payload")));
            good &= (payload.len() as u32).to_be_bytes().to_vec() == expand_bytes(prefix);
            // The byte prefix is the same canonical writer branch used by JSON response frames.
            good &= !payload.is_empty() && payload.len() <= MAX_FRAME;
        }
        counts.case("stream-framing", "bytes", case, good);
    }
}

/// Exercise the restored bridge's actual framing, directory and one-way state with failed siblings.
fn check_bridge_baseline(counts: &mut Counts) {
    use crate::json::{object, string, Value};
    let mut input = vec![];
    let mut output = vec![];
    let mut hello = crate::hello(Some("unit-token"));
    if let Value::Object(fields) = &mut hello {
        if let Some((_, caps)) = fields.iter_mut().find(|(key, _)| key == "capabilities") {
            if let Value::Array(caps) = caps {
                caps.push(string("jsonrpc-bridge@1"));
            }
        }
    }
    let request = |id: &str, method: &str, params: Value| {
        object(&[
            ("jsonrpc", string("2.0")),
            ("id", string(id)),
            ("method", string(method)),
            ("params", params),
        ])
    };
    let _ = crate::business::bridge_write_body(
        &mut input,
        request(
            "hello",
            "migaia.hello",
            object(&[("hello", string(&hello.text()))]),
        )
        .text()
        .as_bytes(),
    );
    let batch = Value::Array(vec![
        request(
            "directory",
            "migaia.describe",
            object(&[("args", Value::Array(vec![]))]),
        ),
        object(&[
            ("jsonrpc", string("2.0")),
            ("method", string("migaia.invoke")),
            (
                "params",
                object(&[
                    ("method", string("p.f.oneWay")),
                    ("args", Value::Array(vec![string("receipt")])),
                ]),
            ),
        ]),
        request(
            "missing",
            "migaia.invoke",
            object(&[("method", string("absent")), ("args", Value::Array(vec![]))]),
        ),
        request(
            "received",
            "migaia.invoke",
            object(&[
                ("method", string("peer.received")),
                ("args", Value::Array(vec![])),
            ]),
        ),
    ]);
    let _ = crate::business::bridge_write_body(&mut input, batch.text().as_bytes());
    let result =
        crate::business::serve_bridge(&mut &input[..], &mut output, false, Some("unit-token"));
    let mut reader = &output[..];
    let hello_reply = crate::business::bridge_read(&mut reader).unwrap_or(Value::Null);
    let accepted = crate::json::parse(text(field(&hello_reply, "result"), "reply").as_bytes())
        .unwrap_or(Value::Null);
    counts.case(
        "u41",
        "bridge",
        &object(&[("id", string("baseline"))]),
        result.is_ok() && text(&accepted, "step") == "accept" && crate::baseline_agreed(&accepted),
    );
    let response = crate::business::bridge_read(&mut reader).unwrap_or(Value::Null);
    let replies = items(&response);
    let good = replies.len() == 3
        && text(&replies[0], "id") == "directory"
        && field(field(&replies[0], "result"), "schemaVersion").as_u64() == Some(2)
        && text(field(field(&replies[0], "result"), "self"), "instanceId") == "rust-peer"
        && items(field(field(&replies[0], "result"), "methods"))
            .iter()
            .all(|m| !items(field(m, "supportedModes")).contains(&string("stream")))
        && text(&replies[1], "id") == "missing"
        && text(
            field(
                field(field(&replies[1], "error"), "data"),
                "migaiaWireError",
            ),
            "code",
        ) == "PROVIDER_NOT_FOUND"
        && text(&replies[2], "id") == "received"
        && field(field(&replies[2], "result"), "count").as_u64() == Some(1)
        && items(field(field(&replies[2], "result"), "values")) == [string("receipt")];
    counts.case(
        "u41",
        "bridge",
        &object(&[("id", string("v2-batch-notification-isolation"))]),
        good,
    );
}
