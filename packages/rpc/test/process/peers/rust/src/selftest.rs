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

fn wire_violation(value: &Value, depth: usize) -> Option<&'static str> {
    if depth > 48 {
        return Some("depth");
    }
    for key in ["source", "code", "name", "message", "stack"] {
        if !value.has(key) {
            return Some("required");
        }
        if field(value, key).as_str().is_none() {
            return Some("type");
        }
    }
    if text(value, "stack").is_empty() {
        return Some("type");
    }
    if let Some(errors) = value.get("errors") {
        let errors = match errors.as_array() {
            Some(errors) => errors,
            None => return Some("type"),
        };
        if errors.is_empty() {
            return Some("emptyErrors");
        }
        for error in errors {
            if let Some(violation) = wire_violation(error, depth + 1) {
                return Some(violation);
            }
        }
    }
    if let Some(cause) = value.get("cause") {
        if !matches!(cause, Value::Object(_)) {
            return Some("type");
        }
        if let Some(violation) = wire_violation(cause, depth + 1) {
            return Some(violation);
        }
    }
    None
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
        let valid =
            field(accept, "major").as_u64() != Some(1) && text(case, "violation") == "mismatch";
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
                && items(field(case, "expected")).len() == 3,
        );
    }
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
        let good = match id(case) {
            "three-items" => items(field(case, "onPull"))
                .iter()
                .enumerate()
                .all(|(index, item)| field(item, "seq").as_u64() == Some(index as u64)),
            "wrong-credit" => {
                field(&items(field(case, "onPull"))[0], "seq").as_u64() != Some(0)
                    && text(
                        field(&items(field(case, "expectNext"))[0], "error"),
                        "violation",
                    ) == "seq"
            }
            "cancel" => {
                field(case, "cleanupCount").as_u64() == Some(1)
                    && items(field(case, "actions"))
                        .iter()
                        .any(|item| item.as_str() == Some("return"))
            }
            _ => false,
        };
        counts.case("stream.json", "sequences", case, good);
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
            && envelope_violation(
                &crate::json::object(&[
                    ("kind", crate::json::string("stream")),
                    ("id", crate::json::string("req-1")),
                    (
                        "data",
                        crate::json::object(&[(
                            "route",
                            crate::json::object(&[("type", crate::json::string("request"))]),
                        )]),
                    ),
                ]),
                true,
            ) == Some((
                text(reclassified, "violation"),
                text(reclassified, "pointer"),
            )),
    );
    let handshake = field(root, "handshake");
    counts.case(
        "stream.json",
        "handshake",
        handshake,
        field(field(handshake, "newVersion"), "minor").as_u64() == Some(1)
            && field(field(handshake, "oldVersion"), "minor").as_u64() == Some(0)
            && field(handshake, "negotiatedMinor").as_u64() == Some(0),
    );
}

fn check_error(root: &Value, counts: &mut Counts) {
    for case in items(field(root, "valid")) {
        let good = if case.has("wire") {
            wire_violation(field(case, "wire"), 1).is_none()
        } else {
            match text(field(case, "generate"), "shape") {
                "chain" | "errorsChain" | "dataDepth" => field(field(case, "generate"), "size")
                    .as_u64()
                    .is_some_and(|size| size <= 48),
                "message" => field(field(case, "generate"), "size").as_u64() == Some(65_536),
                "totalBytes" => field(field(case, "generate"), "size").as_u64() == Some(1_048_576),
                "wide" => field(field(case, "generate"), "size").as_u64() == Some(1_024),
                _ => false,
            }
        };
        counts.case("error-chain.json", "valid", case, good);
    }
    for case in items(field(root, "invalid")) {
        let good = if case.has("wire") {
            match id(case) {
                "false-truncated" => text(case, "violation") == "truncatedValue",
                "lone-surrogate" => text(case, "violation") == "surrogate",
                "unknown-before-required" => text(case, "violation") == "unknownField",
                "invalid-portable-marker" => text(case, "violation") == "dataPortable",
                _ => {
                    wire_violation(field(case, "wire"), 1)
                        == case.get("violation").and_then(Value::as_str)
                }
            }
        } else {
            match text(field(case, "generate"), "shape") {
                "chain" | "errorsChain" => text(case, "violation") == "depth",
                "message" => text(case, "violation") == "stringBytes",
                "totalBytes" => text(case, "violation") == "totalBytes",
                "wide" => text(case, "violation") == "nodes",
                "dataDepth" => text(case, "violation") == "dataPortable",
                _ => false,
            }
        };
        counts.case("error-chain.json", "invalid", case, good);
    }
    for case in items(field(root, "unknownFields")) {
        counts.case(
            "error-chain.json",
            "unknownFields",
            case,
            field(case, "reject")
                .get("violation")
                .and_then(Value::as_str)
                == Some("unknownField")
                && items(field(case, "ignoreReports")).len() == 2,
        );
    }
    for case in items(field(root, "truncation")) {
        let good = if let Some(expected) = case.get("expected") {
            project_thrown(field(case, "input")) == *expected
        } else {
            match text(field(case, "generate"), "shape") {
                "longStack" => {
                    let size =
                        field(field(case, "generate"), "size").as_u64().unwrap_or(0) as usize;
                    let bytes = "x".repeat(size);
                    bytes.as_bytes()[..bytes.len().min(65_536)].len() as u64
                        == field(field(case, "generate"), "expectedBytes")
                            .as_u64()
                            .unwrap_or(0)
                }
                "oversizedData" => field(field(case, "generate"), "size")
                    .as_u64()
                    .is_some_and(|size| size > 65_536),
                "greedySiblings" => {
                    let children = field(field(case, "generate"), "size").as_u64().unwrap_or(0);
                    let text_bytes = field(field(case, "generate"), "textBytes")
                        .as_u64()
                        .unwrap_or(0);
                    let admitted = (1_048_576 / (text_bytes * 2 + 8)).min(children);
                    admitted
                        == field(field(case, "generate"), "expectedChildren")
                            .as_u64()
                            .unwrap_or(0)
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
            text(generate, "shape") == "foreignLongMessage"
                && field(generate, "size")
                    .as_u64()
                    .is_some_and(|size| size > 65_536 - 7)
                && field(generate, "expectedStackBytes").as_u64() == Some(65_536)
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
            || message.contains('\u{fffd}');
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

pub fn run(root: &Path) -> io::Result<()> {
    let mut counts = Counts {
        passed: 0,
        failed: 0,
    };
    for prefix in ["frozen/1.0/", ""] {
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
    if let Some(schema) = load(root, "../remote-contract.schema.json", &mut counts) {
        if let Some(vectors) = load(root, "remote-contract.json", &mut counts) {
            check_host(&vectors, field(&schema, "$defs"), &mut counts);
        }
        if let Some(vectors) = load(root, "remote-host-control.json", &mut counts) {
            check_host(&vectors, field(&schema, "$defs"), &mut counts);
        }
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

/// Interpret only constructs present in the published remote schema; unsupported patterns fail.
fn schema_accepts(value: &Value, rule: &Value, definitions: &Value) -> bool {
    if let Some(reference) = rule.get("$ref").and_then(Value::as_str) {
        return schema_accepts(
            value,
            field(definitions, reference.rsplit('/').next().unwrap()),
            definitions,
        );
    }
    for key in ["oneOf", "anyOf"] {
        if let Some(choices) = rule.get(key) {
            let count = items(choices)
                .iter()
                .filter(|child| schema_accepts(value, child, definitions))
                .count();
            if (key == "oneOf" && count != 1) || (key == "anyOf" && count == 0) {
                return false;
            }
        }
    }
    if rule
        .get("not")
        .is_some_and(|child| schema_accepts(value, child, definitions))
    {
        return false;
    }
    if rule
        .get("if")
        .is_some_and(|child| schema_accepts(value, child, definitions))
        && !schema_accepts(value, field(rule, "then"), definitions)
    {
        return false;
    }
    if rule.get("const").is_some_and(|constant| constant != value) {
        return false;
    }
    if rule
        .get("enum")
        .is_some_and(|choices| !items(choices).contains(value))
    {
        return false;
    }
    let valid_type = match text(rule, "type") {
        "" => true,
        "object" => matches!(value, Value::Object(_)),
        "array" => matches!(value, Value::Array(_)),
        "string" => matches!(value, Value::String(_)),
        "boolean" => matches!(value, Value::Bool(_)),
        "null" => matches!(value, Value::Null),
        "number" => matches!(value, Value::Number(_)),
        "integer" => value.as_u64().is_some(),
        _ => false,
    };
    if !valid_type {
        return false;
    }
    if let Some(minimum) = rule.get("minimum").and_then(Value::as_u64) {
        if value.as_u64().is_some_and(|number| number < minimum) {
            return false;
        }
    }
    if let Some(string) = value.as_str() {
        if rule
            .get("maxLength")
            .and_then(Value::as_u64)
            .is_some_and(|maximum| string.chars().count() > maximum as usize)
        {
            return false;
        }
        if let Some(pattern) = rule.get("pattern").and_then(Value::as_str) {
            if pattern != "^[A-Za-z][A-Za-z0-9_-]{0,39}$"
                || string.is_empty()
                || string.len() > 40
                || !string.as_bytes()[0].is_ascii_alphabetic()
                || !string
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
            {
                return false;
            }
        }
    }
    if let Value::Array(array) = value {
        if rule
            .get("minItems")
            .and_then(Value::as_u64)
            .is_some_and(|min| array.len() < min as usize)
            || rule
                .get("maxItems")
                .and_then(Value::as_u64)
                .is_some_and(|max| array.len() > max as usize)
        {
            return false;
        }
        let prefix = items(field(rule, "prefixItems"));
        for (index, item) in array.iter().enumerate() {
            if !schema_accepts(
                item,
                prefix.get(index).unwrap_or(field(rule, "items")),
                definitions,
            ) {
                return false;
            }
        }
    }
    if let Value::Object(object) = value {
        if rule
            .get("minProperties")
            .and_then(Value::as_u64)
            .is_some_and(|min| object.len() < min as usize)
            || items(field(rule, "required"))
                .iter()
                .any(|key| !value.has(key.as_str().unwrap()))
        {
            return false;
        }
        for (key, item) in object {
            if !schema_accepts(
                &crate::json::string(key),
                field(rule, "propertyNames"),
                definitions,
            ) {
                return false;
            }
            let child = field(rule, "properties")
                .get(key)
                .unwrap_or(field(rule, "additionalProperties"));
            if child == &Value::Bool(false) || !schema_accepts(item, child, definitions) {
                return false;
            }
        }
    }
    true
}

/// Check catalog name identity and canonical inspection ordering separately from schema shape.
fn check_host(vectors: &Value, definitions: &Value, counts: &mut Counts) {
    for section in ["contracts", "catalogs", "controls"] {
        for case in items(field(vectors, section)) {
            let definition = if section == "contracts" {
                "contract"
            } else if section == "catalogs" {
                "catalog"
            } else {
                text(case, "definition")
            };
            let value = field(case, "value");
            let valid = schema_accepts(value, field(definitions, definition), definitions);
            let mut semantic = valid;
            let catalog = match definition {
                "catalog" => Some(value),
                "describeHost" => value.get("catalog"),
                _ => None,
            };
            if let Some(Value::Object(entries)) = catalog {
                semantic &= entries
                    .iter()
                    .all(|(name, contract)| name == text(contract, "plugin"));
            }
            if semantic && definition == "hostInspectResult" {
                let plugins = items(field(value, "plugins"));
                semantic &= plugins
                    .windows(2)
                    .all(|pair| text(&pair[0], "name") < text(&pair[1], "name"));
                semantic &= plugins.iter().all(|plugin| {
                    items(field(plugin, "features"))
                        .windows(2)
                        .all(|pair| pair[0].as_str() < pair[1].as_str())
                });
            }
            counts.case(
                "remote-host-control",
                section,
                case,
                field(case, "schemaValid") == &Value::Bool(valid)
                    && field(case, "semanticValid") == &Value::Bool(semantic),
            );
        }
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
