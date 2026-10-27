//! Dependency-free native peer: one ordered JSON owner and the sole migaia.rpc/2 semantic protocol.
mod business;
mod json;
mod selftest;
use json::{number, object, string, Value};
use std::{
    env,
    io::{self, Read, Write},
    os::{
        fd::FromRawFd,
        unix::net::{UnixListener, UnixStream},
    },
    path::PathBuf,
};
const MAX_FRAME: usize = 16_777_216;
const MAX_HANDSHAKE: usize = 65_536;
/// Private native admission precedes the unchanged RPC hello and never appears in public diagnostics.
const NATIVE_CONNECTION_KIND: &str = "rpc-process-connection";
const NATIVE_CONNECTION_VERSION: u64 = 1;
const NATIVE_CONNECTION_REJECTED: &str = "PROCESS_CHANNEL_AUTH_REJECTED";
/// Optional method metadata uses the same closed schema vocabulary as the TS directory owner.
const SCHEMA_FIELDS: [&str; 3] = ["input", "output", "yield"];
const SCHEMA_KEYS: [&str; 9] = [
    "type",
    "properties",
    "required",
    "items",
    "enum",
    "const",
    "anyOf",
    "$defs",
    "$ref",
];
const SCHEMA_TYPES: [&str; 7] = [
    "null", "boolean", "object", "array", "number", "integer", "string",
];

/// Schema values retain the portable recursion limit and finite JSON scalar domain.
fn runtime_schema_data(value: &Value, depth: usize) -> bool {
    if depth > 64 {
        return false;
    }
    match value {
        Value::Null | Value::Bool(_) | Value::String(_) => true,
        Value::Number(number) => number.parse::<f64>().is_ok_and(f64::is_finite),
        Value::SurrogateString(_) => false,
        Value::Array(items) => items
            .iter()
            .all(|item| runtime_schema_data(item, depth + 1)),
        Value::Object(fields) => fields
            .iter()
            .all(|(_, item)| runtime_schema_data(item, depth + 1)),
    }
}

/// Enum equality ignores object insertion order and compares numeric spellings by JSON value.
fn runtime_schema_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => {
            left.parse::<f64>().ok() == right.parse::<f64>().ok()
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(a, b)| runtime_schema_equal(a, b))
        }
        (Value::Object(left), Value::Object(right)) => {
            if left.len() != right.len() {
                return false;
            }
            // Preserve first-field lookup even for manually constructed values; parsed objects are unique.
            let mut indexed = std::collections::HashMap::with_capacity(right.len());
            for (key, value) in right {
                indexed.entry(key.as_str()).or_insert(value);
            }
            left.iter().all(|(key, value)| {
                indexed
                    .get(key.as_str())
                    .is_some_and(|other| runtime_schema_equal(value, other))
            })
        }
        _ => left == right,
    }
}

/// Hash already-admitted JSON once, retaining exact equality for private collision buckets.
/// Arrays stay ordered, object fields combine without key order, and numeric spellings use f64 equality.
fn runtime_schema_hash(value: &Value, hashes: &std::collections::hash_map::RandomState) -> u64 {
    use std::hash::{BuildHasher, Hash, Hasher};
    // This seed is local to one validated directory and never enters the wire.
    let mut hash = hashes.build_hasher();
    match value {
        Value::Null => 0u8.hash(&mut hash),
        Value::Bool(value) => {
            1u8.hash(&mut hash);
            value.hash(&mut hash);
        }
        Value::String(value) | Value::SurrogateString(value) => {
            2u8.hash(&mut hash);
            value.hash(&mut hash);
        }
        Value::Number(value) => {
            3u8.hash(&mut hash);
            // runtime_schema_data already accepted this finite number before hashing.
            let number = value.parse::<f64>().unwrap();
            // JSON numeric equality treats both signed zeros as the same value.
            let normalized = if number == 0.0 { 0.0 } else { number };
            normalized.to_bits().hash(&mut hash);
        }
        Value::Array(values) => {
            4u8.hash(&mut hash);
            values.len().hash(&mut hash);
            for value in values {
                runtime_schema_hash(value, hashes).hash(&mut hash);
            }
        }
        Value::Object(fields) => {
            5u8.hash(&mut hash);
            fields.len().hash(&mut hash);
            // Commutative field accumulation preserves object key-order independence.
            let mut combined = 0u64;
            for (key, value) in fields {
                // Hash the key/value pair before combining it with sibling fields.
                let mut field = hashes.build_hasher();
                key.hash(&mut field);
                runtime_schema_hash(value, hashes).hash(&mut field);
                combined = combined.wrapping_add(field.finish());
            }
            combined.hash(&mut hash);
        }
    }
    hash.finish()
}

/// Validate actual schema positions; references never follow network, file, or recursive targets.
fn valid_runtime_schema(value: &Value) -> bool {
    fn visit<'a>(
        value: &'a Value,
        path: &str,
        nodes: &mut std::collections::HashSet<String>,
        references: &mut Vec<&'a str>,
        hashes: &std::collections::hash_map::RandomState,
    ) -> bool {
        let Value::Object(fields) = value else {
            return false;
        };
        nodes.insert(path.to_owned());
        for (key, child) in fields {
            if !SCHEMA_KEYS.contains(&key.as_str()) {
                return false;
            }
            match key.as_str() {
                "type" | "required" => {
                    let values = if key == "type" && !matches!(child, Value::Array(_)) {
                        std::slice::from_ref(child)
                    } else if let Some(values) = child.as_array() {
                        values
                    } else {
                        return false;
                    };
                    if key == "type" && values.is_empty() {
                        return false;
                    }
                    let mut seen = std::collections::HashSet::new();
                    for member in values {
                        let Value::String(text) = member else {
                            return false;
                        };
                        if !seen.insert(text)
                            || key == "type" && !SCHEMA_TYPES.contains(&text.as_str())
                        {
                            return false;
                        }
                    }
                }
                "properties" | "$defs" => {
                    let Value::Object(members) = child else {
                        return false;
                    };
                    for (name, member) in members {
                        let pointer = name.replace('~', "~0").replace('/', "~1");
                        if !visit(
                            member,
                            &format!("{path}/{key}/{pointer}"),
                            nodes,
                            references,
                            hashes,
                        ) {
                            return false;
                        }
                    }
                }
                "items" => {
                    if !visit(child, &format!("{path}/items"), nodes, references, hashes) {
                        return false;
                    }
                }
                "enum" | "anyOf" => {
                    let Some(members) = child.as_array() else {
                        return false;
                    };
                    if members.is_empty() {
                        return false;
                    }
                    // Structural hashes are only indexes; exact equality still decides collisions.
                    let mut seen: std::collections::HashMap<u64, Vec<&Value>> =
                        std::collections::HashMap::new();
                    for (index, member) in members.iter().enumerate() {
                        if key == "anyOf"
                            && !visit(
                                member,
                                &format!("{path}/anyOf/{index}"),
                                nodes,
                                references,
                                hashes,
                            )
                        {
                            return false;
                        }
                        if key == "enum" {
                            // Only an index; the existing equality decides duplicate membership.
                            let digest = runtime_schema_hash(member, hashes);
                            let bucket = seen.entry(digest).or_default();
                            if bucket
                                .iter()
                                .any(|other| runtime_schema_equal(member, other))
                            {
                                return false;
                            }
                            bucket.push(member);
                        }
                    }
                }
                "$ref" => {
                    let Value::String(pointer) = child else {
                        return false;
                    };
                    if !pointer.starts_with("#/$defs/") {
                        return false;
                    }
                    let mut characters = pointer.chars();
                    while let Some(character) = characters.next() {
                        if character == '~' && !matches!(characters.next(), Some('0' | '1')) {
                            return false;
                        }
                    }
                    references.push(&pointer[1..]);
                }
                _ => {}
            }
        }
        true
    }
    // Directory.methods[index].schema contributes three original portable container levels.
    if !runtime_schema_data(value, 3) {
        return false;
    }
    let mut nodes = std::collections::HashSet::new();
    let mut references = Vec::new();
    // All enum buckets in this single walk share one private standard-library seed.
    let hashes = std::collections::hash_map::RandomState::new();
    visit(value, "", &mut nodes, &mut references, &hashes)
        && references.iter().all(|pointer| nodes.contains(*pointer))
}

/// The only semantic profile is independent from the native launch record's version.
const PROFILE: &str = "migaia.rpc/2";
/// Final lifecycle notification is distinct from drain and has no ACK.
const CONTROL_CLOSE: &str = "close";
/// The route carries its origin plus at most sixteen forwarding hosts; error provenance carries the same forwarded route.
const MAX_FORWARD_ROUTE_NODES: usize = 17;
const METHOD_UNAVAILABLE: &str = "Runtime method is not provided by this peer";

/// Borrow an already parsed own field; absent business data has the original null default.
fn value<'a>(input: &'a Value, key: &str) -> &'a Value {
    input.get(key).unwrap_or(&Value::Null)
}
fn text<'a>(input: &'a Value, key: &str) -> &'a str {
    value(input, key).as_str().unwrap_or("")
}
fn items(input: &Value) -> &[Value] {
    input.as_array().unwrap_or(&[])
}
fn set(input: &mut Value, key: &str, member: Value) {
    if let Value::Object(fields) = input {
        if let Some((_, value)) = fields.iter_mut().find(|(name, _)| name == key) {
            *value = member;
        } else {
            fields.push((key.to_owned(), member));
        }
    }
}
fn invalid(code: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, code)
}

/// Read required known fields and ignore unknown protocol metadata.
fn has_fields(input: &Value, required: &[&str]) -> bool {
    matches!(input, Value::Object(_)) && required.iter().all(|key| input.has(key))
}
fn identifier(input: &Value) -> bool {
    matches!(input,Value::String(text) if (1..=128).contains(&text.encode_utf16().count()))
}
fn safe_integer(input: &Value) -> Option<u64> {
    match input {
        Value::Number(text) => text
            .parse::<f64>()
            .ok()
            .filter(|n| {
                n.is_finite() && *n >= 0.0 && *n <= 9_007_199_254_740_991.0 && n.fract() == 0.0
            })
            .map(|n| n as u64),
        _ => None,
    }
}
fn finite_number(input: &Value, maximum: f64) -> bool {
    matches!(input,Value::Number(text) if text.parse::<f64>().is_ok_and(|n|n.is_finite() && n >= 0.0 && n <= maximum))
}
fn segment(input: &str) -> bool {
    !input.is_empty()
        && input.len() <= 40
        && input.as_bytes()[0].is_ascii_alphabetic()
        && input
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-')
}
fn method_name(input: &Value) -> bool {
    identifier(input)
        && input
            .as_str()
            .is_some_and(|name| name.split('.').all(segment))
}
fn hex_node(input: &Value) -> bool {
    matches!(input,Value::String(id) if id.len() == 32 && id.bytes().all(|ch|ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch)))
}
fn valid_generation(input: &Value) -> bool {
    has_fields(input, &["kind", "value", "providerId"])
        && matches!(text(input, "kind"), "session" | "restart")
        && safe_integer(value(input, "value")).is_some()
        && identifier(value(input, "providerId"))
}
fn identity() -> Value {
    object(&[
        ("name", string("rust-peer")),
        ("instanceId", string("rust-peer")),
        (
            "generation",
            object(&[
                ("kind", string("session")),
                ("value", number(0)),
                ("providerId", string("rust-peer")),
            ]),
        ),
    ])
}

/// Original schema checks remain the sole directory extension owner; schema3 binds the actual generation.
fn valid_runtime_description(input: &Value, remote_id: &str) -> bool {
    let own = value(input, "self");
    if !has_fields(input, &["schemaVersion", "self", "methods"])
        || safe_integer(value(input, "schemaVersion")) != Some(3)
        || !has_fields(own, &["name", "instanceId", "generation"])
        || !identifier(value(own, "name"))
        || text(own, "instanceId") != remote_id
        || !identifier(value(own, "instanceId"))
        || !valid_generation(value(own, "generation"))
        || input.get("nodeId").is_some_and(|node| !hex_node(node))
    {
        return false;
    }
    let Some(methods) = value(input, "methods").as_array() else {
        return false;
    };
    if methods.len() > 4096 {
        return false;
    }
    let mut seen = std::collections::HashSet::new();
    for method in methods {
        if !has_fields(method, &["name", "supportedModes", "modeSource"])
            || !method_name(value(method, "name"))
            || !seen.insert(text(method, "name"))
            || !matches!(text(method, "modeSource"), "declared" | "generated-routes")
            || method
                .get("idempotent")
                .is_some_and(|value| !matches!(value, Value::Bool(_)))
            || method
                .get("forwardedVia")
                .is_some_and(|value| value.as_str().is_none_or(|value| !segment(value)))
            || SCHEMA_FIELDS.iter().any(|key| {
                method
                    .get(key)
                    .is_some_and(|schema| !valid_runtime_schema(schema))
            })
        {
            return false;
        }
        let Some(modes) = value(method, "supportedModes").as_array() else {
            return false;
        };
        if modes.is_empty()
            || modes.len() > 3
            || modes.iter().enumerate().any(|(index, mode)| {
                !matches!(mode.as_str(), Some("request" | "notify" | "stream"))
                    || modes[..index].contains(mode)
            })
        {
            return false;
        }
    }
    true
}

/// Canonical bytes strings use the URL alphabet with unused low bits zero, without a second codec.
fn canonical_base64(input: &str) -> bool {
    let mut last = 0;
    for byte in input.bytes() {
        last = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return false,
        };
    }
    match input.len() % 4 {
        0 => true,
        2 => last & 15 == 0,
        3 => last & 3 == 0,
        _ => false,
    }
}

/// Text-only data quota is distinct from portable stream's JSON punctuation accounting.
fn error_data_text(input: &Value, depth: usize) -> Option<usize> {
    if depth > 64 {
        return None;
    }
    let count = match input {
        Value::Null | Value::Bool(_) => 0,
        Value::Number(text) if text.parse::<f64>().is_ok_and(f64::is_finite) => 0,
        Value::String(text) => text.len(),
        Value::Array(values) => {
            let mut sum = 0;
            for value in values {
                sum += error_data_text(value, depth + 1)?;
            }
            sum
        }
        Value::Object(fields) if input.has("$rpc") => {
            let encoded = text(input, "base64url");
            if fields.len() != 2
                || text(input, "$rpc") != "bytes"
                || !matches!(value(input, "base64url"), Value::String(_))
                || !canonical_base64(encoded)
            {
                return None;
            }
            encoded.len()
        }
        Value::Object(fields) => {
            let mut sum = 0;
            for (key, value) in fields {
                sum += key.len() + error_data_text(value, depth + 1)?;
            }
            sum
        }
        _ => return None,
    };
    (count <= 65_536).then_some(count)
}

/// Validate flat graph edges by integer index; cycles and repeated references retain their topology.
fn valid_flat_error(input: &Value) -> bool {
    let Some(nodes) = value(input, "nodes").as_array() else {
        return false;
    };
    let Some(root) = safe_integer(value(input, "root")) else {
        return false;
    };
    if !has_fields(input, &["root", "nodes"])
        || nodes.is_empty()
        || nodes.len() > 1024
        || root as usize >= nodes.len()
    {
        return false;
    }
    let mut bytes = 0;
    for node in nodes {
        if !has_fields(node, &["source", "code", "name", "message", "stack"]) {
            return false;
        }
        for key in ["source", "code", "name", "message", "stack"] {
            let Value::String(part) = value(node, key) else {
                return false;
            };
            if key != "message" && part.is_empty() || part.len() > 65_536 {
                return false;
            }
            bytes += part.len();
        }
        if node.get("cause").is_some_and(|edge| {
            safe_integer(edge).is_none_or(|index| index as usize >= nodes.len())
        }) {
            return false;
        }
        if let Some(edges) = node.get("errors") {
            let Some(edges) = edges.as_array() else {
                return false;
            };
            if edges.is_empty()
                || edges.iter().any(|edge| {
                    safe_integer(edge).is_none_or(|index| index as usize >= nodes.len())
                })
            {
                return false;
            }
        }
        if let Some(data) = node.get("data") {
            if error_data_text(data, 17).is_none() {
                return false;
            }
            bytes += data.text().len();
        }
        if let Some(route) = node.get("route") {
            let Some(route) = route.as_array() else {
                return false;
            };
            if route.is_empty()
                || route.len() > MAX_FORWARD_ROUTE_NODES
                || !route.iter().all(hex_node)
            {
                return false;
            }
            bytes += route.len() * 32;
        }
        if bytes > 1_048_576
            || node
                .get("truncated")
                .is_some_and(|flag| flag != &Value::Bool(true))
        {
            return false;
        }
    }
    true
}

/// The original conservative portable counter validates in the same walk that charges semantic bytes.
fn portable_bytes(input: &Value, depth: usize) -> Option<usize> {
    if depth > 64 {
        return None;
    }
    let count = match input {
        Value::Null => 4,
        Value::Bool(true) => 4,
        Value::Bool(false) => 5,
        Value::Number(text) if text.parse::<f64>().is_ok_and(f64::is_finite) => 24,
        Value::String(text) => {
            2 + text
                .chars()
                .map(|ch| match ch {
                    '"' | '\\' => 2,
                    ch if ch <= '\u{1f}' => 6,
                    ch => ch.len_utf8(),
                })
                .sum::<usize>()
        }
        Value::Array(values) => {
            let mut count = 2 + values.len().saturating_sub(1);
            for value in values {
                count += portable_bytes(value, depth + 1)?;
            }
            count
        }
        Value::Object(fields) if input.has("$rpc") => {
            if fields.len() != 2
                || text(input, "$rpc") != "bytes"
                || !matches!(value(input, "base64url"), Value::String(_))
                || !canonical_base64(text(input, "base64url"))
            {
                return None;
            }
            input.text().len()
        }
        Value::Object(fields) => {
            let mut count = 2 + fields.len().saturating_sub(1);
            for (key, value) in fields {
                count += portable_bytes(&string(key), depth + 1)?
                    + 1
                    + portable_bytes(value, depth + 1)?;
            }
            count
        }
        _ => return None,
    };
    Some(count)
}
fn valid_stream(input: &Value) -> bool {
    let Some(seq) = safe_integer(value(input, "seq")) else {
        return false;
    };
    let (field, required) = match text(input, "event") {
        "open" if seq == 0 => ("", false),
        "pull" => ("", false),
        "item" => ("value", true),
        "end" => ("value", false),
        "fail" => ("error", true),
        "cancelled" => ("error", false),
        "finish-without-items" => ("reason", false),
        _ => return false,
    };
    if !has_fields(input, &["event", "seq"]) || required && !input.has(field) {
        return false;
    }
    match input.get(field) {
        None => true,
        Some(value) if field == "value" => {
            portable_bytes(value, 0).is_some_and(|count| count <= 16_384)
        }
        Some(value) => valid_flat_error(value),
    }
}

fn valid_route(input: &Value) -> bool {
    has_fields(input,&["applicationVersion","senderId","receiverId","targetId"]) &&
    ["applicationVersion","senderId","receiverId","targetId"].iter().all(|key|identifier(value(input,key))) &&
    input.get("sentAt").is_none_or(|value|finite_number(value,f64::MAX)) &&
    input.get("remainingMs").is_none_or(|value|finite_number(value,2_147_483_647.0)) &&
    input.get("trace").is_none_or(|value|matches!(value,Value::String(text) if (1..=256).contains(&text.len()) && text.bytes().all(|ch|(32..=126).contains(&ch)))) &&
    input.get("forwardRoute").is_none_or(|route|route.as_array().is_some_and(|route|route.len() <= MAX_FORWARD_ROUTE_NODES && route.iter().all(identifier)))
}
fn valid_task(input: &Value) -> bool {
    if !has_fields(
        input,
        &["mode", "callerId", "callerGeneration", "targetGeneration"],
    ) || !identifier(value(input, "callerId"))
        || !valid_generation(value(input, "callerGeneration"))
        || !valid_generation(value(input, "targetGeneration"))
    {
        return false;
    }
    match text(input, "mode") {
        "request" | "notify" | "stream" => method_name(value(input, "method")),
        "group" | "outcome" => true,
        _ => false,
    }
}
fn valid_options(input: &Value, mode: &str) -> bool {
    has_fields(input, &[])
        && ["orderKey", "idempotencyKey"]
            .iter()
            .all(|key| input.get(key).is_none_or(identifier))
        && input
            .get("cancel")
            .is_none_or(|value| value.as_str() == Some("before-start"))
        && (mode != "notify"
            || !input.has("idempotencyKey")
            || text(input, "cancel") == "before-start")
}
fn valid_outcomes(input: &Value) -> bool {
    let Some(outcomes) = input.as_array() else {
        return false;
    };
    if outcomes.is_empty() {
        return false;
    }
    let mut failed = false;
    for outcome in outcomes {
        match text(outcome, "state") {
            "success" => {
                if failed
                    || !has_fields(outcome, &["state"])
                    || outcome
                        .get("result")
                        .is_some_and(|result| portable_bytes(result, 0).is_none())
                {
                    return false;
                }
            }
            "failure" => {
                if failed
                    || !has_fields(outcome, &["state", "error"])
                    || !valid_flat_error(value(outcome, "error"))
                {
                    return false;
                }
                failed = true;
            }
            "not-executed" => {
                if !failed || !has_fields(outcome, &["state"]) {
                    return false;
                }
            }
            _ => return false,
        }
    }
    true
}

fn valid_completion(input: &Value, mode: &str) -> bool {
    if value(input, "ok") == &Value::Bool(false) {
        return has_fields(input, &["ok", "error"]) && valid_flat_error(value(input, "error"));
    }
    if value(input, "ok") != &Value::Bool(true) || !has_fields(input, &["ok"]) {
        return false;
    }
    if mode == "group" {
        valid_outcomes(value(input, "result"))
    } else {
        input
            .get("result")
            .is_none_or(|result| portable_bytes(result, 0).is_some())
    }
}

fn valid_outcome_store(input: &Value) -> bool {
    text(input, "kind") == "unavailable"
        && has_fields(input, &["kind", "continuity"])
        && text(input, "continuity") == "unavailable"
        || has_fields(input, &["kind", "epoch", "continuity"])
            && matches!(text(input, "kind"), "memory" | "external")
            && identifier(value(input, "epoch"))
            && matches!(text(input, "continuity"), "retained" | "lost-since-restart")
}

fn codec_name(input: &str) -> bool {
    !input.is_empty()
        && input.len() <= 32
        && input.as_bytes()[0].is_ascii_lowercase()
        && input
            .bytes()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, b'.' | b'-'))
}
fn extension_name(input: &str) -> bool {
    let Some((name, version)) = input.split_once('@') else {
        return false;
    };
    !name.is_empty()
        && name.as_bytes()[0].is_ascii_lowercase()
        && name
            .bytes()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, b'.' | b'-'))
        && !version.is_empty()
        && version.as_bytes()[0] != b'0'
        && version.bytes().all(|ch| ch.is_ascii_digit())
}
fn names(input: &Value, maximum: usize, valid: fn(&str) -> bool) -> bool {
    let Some(values) = input.as_array() else {
        return false;
    };
    if values.len() > maximum {
        return false;
    }
    let mut seen = std::collections::HashSet::new();
    values.iter().all(|value| {
        value
            .as_str()
            .is_some_and(|name| valid(name) && seen.insert(name))
    })
}

/// Pure handshake checks known fields; semantic/auth selection occurs only in handshake().
fn valid_handshake(input: &Value) -> bool {
    if text(input, "profile") != PROFILE || text(input, "kind") != "handshake" {
        return false;
    }
    if text(input, "step") == "reject" {
        return has_fields(input, &["profile", "kind", "step", "error"])
            && valid_flat_error(value(input, "error"));
    }
    let own = value(input, "peer");
    if !has_fields(own, &["id", "runtime"])
        || !identifier(value(own, "id"))
        || !codec_name(text(own, "runtime"))
        || text(own, "runtime").contains('.')
        || own
            .get("runtimeVersion")
            .is_some_and(|value| !matches!(value, Value::String(_)))
        || own.get("implementation").is_some_and(|value| {
            !has_fields(value, &["name", "version"])
                || ["name", "version"]
                    .iter()
                    .any(|key| !matches!(self::value(value, key), Value::String(_)))
        })
        || (text(input, "step") != "pending"
            && (!valid_runtime_description(value(input, "directory"), text(own, "id"))
                || !names(value(input, "extensions"), 64, extension_name)))
        || input
            .get("auth")
            .is_some_and(|auth| portable_bytes(auth, 0).is_none())
    {
        return false;
    }
    match text(input, "step") {
        "pending" => {
            has_fields(input, &["profile", "kind", "step", "peer", "remainingMs"])
                && finite_number(value(input, "remainingMs"), 2_147_483_647.0)
        }
        "hello" => {
            if !has_fields(
                input,
                &[
                    "profile",
                    "kind",
                    "step",
                    "versions",
                    "codecs",
                    "extensions",
                    "peer",
                    "directory",
                ],
            ) {
                return false;
            }
            let Some(versions) = value(input, "versions").as_array() else {
                return false;
            };
            let mut seen = std::collections::HashSet::new();
            !versions.is_empty()
                && versions.len() <= 8
                && versions.iter().all(|version| {
                    has_fields(version, &["major", "minor"])
                        && safe_integer(value(version, "major"))
                            .is_some_and(|major| major > 0 && seen.insert(major))
                        && safe_integer(value(version, "minor")).is_some()
                })
                && names(value(input, "codecs"), 16, codec_name)
                && items(value(input, "codecs")).contains(&string("json"))
                && input.get("requiredExtensions").is_none_or(|required| {
                    names(required, 64, extension_name)
                        && items(required)
                            .iter()
                            .all(|item| items(value(input, "extensions")).contains(item))
                })
        }
        "accept" => {
            has_fields(
                input,
                &[
                    "profile",
                    "kind",
                    "step",
                    "major",
                    "minor",
                    "codec",
                    "extensions",
                    "peer",
                    "directory",
                ],
            ) && safe_integer(value(input, "major")).is_some_and(|major| major > 0)
                && safe_integer(value(input, "minor")).is_some()
                && codec_name(text(input, "codec"))
        }
        _ => false,
    }
}
/// All live input and selftest vectors use this same single semantic admission function.
fn valid_frame(input: &Value) -> bool {
    if text(input, "kind") == "handshake" {
        return valid_handshake(input);
    }
    if text(input, "profile") != PROFILE {
        return false;
    }
    let (required, optional): (&[&str], &[&str]) = match text(input, "kind") {
        "call" => (&["task", "options"], &["payload", "extensions"]),
        "group" => (&["task", "options", "steps"], &["extensions"]),
        "result" => (&["task"], &["result", "extensions"]),
        "error" => (&["task", "error"], &["extensions"]),
        "cancel" => (&["task"], &["reason", "extensions"]),
        "stream" => (&["task", "stream"], &["extensions"]),
        "control" => (&["operation"], &["reason"]),
        "directory" => (&["directory"], &[]),
        "outcome" => (
            &["task", "operation"],
            &["idempotencyKey", "state", "store", "outcome", "extensions"],
        ),
        _ => return false,
    };
    let mut fields = vec!["profile", "kind", "id", "route"];
    fields.extend_from_slice(required);
    if !has_fields(input, &fields)
        || !identifier(value(input, "id"))
        || !valid_route(value(input, "route"))
        || required.contains(&"task") && !valid_task(value(input, "task"))
        || optional.contains(&"extensions")
            && input.get("extensions").is_some_and(|extension| {
                !matches!(extension, Value::Object(_)) || portable_bytes(extension, 0).is_none()
            })
        || ["error", "reason"].iter().any(|key| {
            (required.contains(key) || optional.contains(key))
                && input.get(key).is_some_and(|error| !valid_flat_error(error))
        })
    {
        return false;
    }
    let mode = text(value(input, "task"), "mode");
    match text(input, "kind") {
        "call" => {
            matches!(mode, "request" | "notify" | "stream")
                && valid_options(value(input, "options"), mode)
                && input
                    .get("payload")
                    .is_none_or(|payload| portable_bytes(payload, 0).is_some())
        }
        "group" => {
            mode == "group"
                && valid_options(value(input, "options"), mode)
                && value(input, "steps").as_array().is_some_and(|steps| {
                    !steps.is_empty()
                        && steps.iter().all(|step| {
                            has_fields(step, &["method"])
                                && method_name(value(step, "method"))
                                && step
                                    .get("payload")
                                    .is_none_or(|payload| portable_bytes(payload, 0).is_some())
                        })
                })
        }
        "result" if mode == "group" => valid_outcomes(value(input, "result")),
        "result" => input
            .get("result")
            .is_none_or(|result| portable_bytes(result, 0).is_some()),
        "stream" => mode == "stream" && valid_stream(value(input, "stream")),
        "control" => matches!(
            text(input, "operation"),
            "ping" | "pong" | "drain" | CONTROL_CLOSE
        ),
        "directory" => valid_runtime_description(
            value(input, "directory"),
            text(value(value(input, "directory"), "self"), "instanceId"),
        ),
        "outcome" => {
            if mode != "outcome" {
                return false;
            }
            match text(input, "operation") {
                "lookup" => identifier(value(input, "idempotencyKey")),
                "result" => {
                    valid_outcome_store(value(input, "store"))
                        && match text(input, "state") {
                            "pending" | "unknown" => true,
                            "done" => {
                                let outcome = value(input, "outcome");
                                has_fields(outcome, &["mode", "targetGeneration", "completion"])
                                    && matches!(
                                        text(outcome, "mode"),
                                        "request" | "notify" | "stream" | "group"
                                    )
                                    && valid_generation(value(outcome, "targetGeneration"))
                                    && valid_completion(
                                        value(outcome, "completion"),
                                        text(outcome, "mode"),
                                    )
                            }
                            _ => false,
                        }
                }
                _ => false,
            }
        }
        _ => true,
    }
}
/// Apply the current connection-phase limit before allocating or reading its payload.
fn read_frame(input: &mut impl Read, max_bytes: usize) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; 4];
    let mut first = [0u8; 1];
    if input.read(&mut first)? == 0 {
        return Ok(None);
    }
    header[0] = first[0];
    input.read_exact(&mut header[1..])?;
    let length = u32::from_be_bytes(header) as usize;
    if !(1..=max_bytes).contains(&length) {
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
    let frame = match read_frame(input, MAX_FRAME)? {
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

/// Stable diagnostic factory retains native type/name/source/code and remote stack text in the flat graph.
fn error_node(source: &str, code: &str, name: &str, message: &str) -> Value {
    object(&[
        ("source", string(source)),
        ("code", string(code)),
        ("name", string(name)),
        ("message", string(message)),
        ("stack", string(&format!("{name}: {message}"))),
    ])
}
fn wire_error(source: &str, code: &str, message: &str) -> Value {
    object(&[
        ("root", number(0)),
        (
            "nodes",
            Value::Array(vec![error_node(source, code, "Error", message)]),
        ),
    ])
}
fn hello(own: &Value, business: bool, auth: Option<&str>) -> Value {
    let mut hello = object(&[
        ("profile", string(PROFILE)),
        ("kind", string("handshake")),
        ("step", string("hello")),
        (
            "versions",
            Value::Array(vec![object(&[("major", number(2)), ("minor", number(0))])]),
        ),
        ("codecs", Value::Array(vec![string("json")])),
        ("extensions", Value::Array(vec![])),
        (
            "peer",
            object(&[
                ("id", value(own, "instanceId").clone()),
                ("runtime", string("rust")),
            ]),
        ),
        ("directory", business::description(own, business)),
    ]);
    if let Some(auth) = auth {
        set(&mut hello, "auth", string(auth));
    }
    hello
}
fn accept(local: &Value) -> Value {
    object(&[
        ("profile", string(PROFILE)),
        ("kind", string("handshake")),
        ("step", string("accept")),
        ("major", number(2)),
        ("minor", number(0)),
        ("codec", string("json")),
        ("extensions", Value::Array(vec![])),
        ("peer", value(local, "peer").clone()),
        ("directory", value(local, "directory").clone()),
    ])
}

/// Both sides send hello; the lexicographically larger actual peer id owns acceptance and exact auth checks.
fn handshake(
    input: &mut impl Read,
    output: &mut impl Write,
    local: &Value,
    auth: Option<&str>,
    parent: Option<&str>,
) -> io::Result<Value> {
    write_frame(output, local)?;
    let mut remote_hello: Option<Value> = None;
    let mut selected: Option<Value> = None;
    loop {
        let frame =
            read_frame(input, MAX_HANDSHAKE)?.ok_or_else(|| invalid("HANDSHAKE_INVALID"))?;
        let remote = json::parse(&frame).map_err(|_| invalid("HANDSHAKE_INVALID"))?;
        if !valid_handshake(&remote) {
            return Err(invalid("HANDSHAKE_INVALID"));
        }
        let local_id = text(value(local, "peer"), "id");
        let remote_id = text(value(&remote, "peer"), "id");
        if local_id == remote_id || parent.is_some_and(|expected| expected != remote_id) {
            return Err(invalid("HANDSHAKE_INVALID"));
        }
        match text(&remote, "step") {
            "pending" => {
                let original = remote_hello
                    .as_ref()
                    .ok_or_else(|| invalid("HANDSHAKE_INVALID"))?;
                if value(original, "peer") != value(&remote, "peer") {
                    return Err(invalid("HANDSHAKE_INVALID"));
                }
                if auth.is_some_and(|expected| text(&remote, "auth") != expected) {
                    return Err(invalid("AUTH_REJECTED"));
                }
                continue;
            }
            "hello" => {
                if auth.is_some_and(|expected| text(&remote, "auth") != expected) {
                    return Err(invalid("AUTH_REJECTED"));
                }
                if !items(value(&remote, "versions"))
                    .iter()
                    .any(|version| safe_integer(value(version, "major")) == Some(2))
                    || !items(value(&remote, "requiredExtensions")).is_empty()
                {
                    write_frame(
                        output,
                        &object(&[
                            ("profile", string(PROFILE)),
                            ("kind", string("handshake")),
                            ("step", string("reject")),
                            (
                                "error",
                                wire_error(
                                    "rpc.contract",
                                    "HANDSHAKE_INCOMPATIBLE",
                                    "rpc handshake incompatible",
                                ),
                            ),
                        ]),
                    )?;
                    return Err(invalid("HANDSHAKE_INCOMPATIBLE"));
                }
                if local_id > remote_id {
                    let mut accepted = accept(local);
                    if let Some(auth) = local.get("auth") {
                        set(&mut accepted, "auth", auth.clone());
                    }
                    write_frame(output, &accepted)?;
                    selected = Some(accepted);
                    remote_hello = Some(remote);
                    continue;
                }
                remote_hello = Some(remote);
            }
            "accept" => {
                if auth.is_some_and(|expected| text(&remote, "auth") != expected) {
                    return Err(invalid("AUTH_REJECTED"));
                }
                if let Some(accepted) = selected.as_ref() {
                    let original = remote_hello
                        .as_ref()
                        .ok_or_else(|| invalid("HANDSHAKE_INVALID"))?;
                    if ["major", "minor", "codec", "extensions"]
                        .iter()
                        .any(|key| !runtime_schema_equal(value(&remote, key), value(accepted, key)))
                        || value(original, "peer") != value(&remote, "peer")
                        || !runtime_schema_equal(
                            value(original, "directory"),
                            value(&remote, "directory"),
                        )
                    {
                        return Err(invalid("HANDSHAKE_INVALID"));
                    }
                    return Ok(original.clone());
                }
                if local_id > remote_id
                    || safe_integer(value(&remote, "major")) != Some(2)
                    || safe_integer(value(&remote, "minor")) != Some(0)
                    || text(&remote, "codec") != "json"
                    || !items(value(&remote, "extensions")).is_empty()
                {
                    return Err(invalid("HANDSHAKE_INVALID"));
                }
                if let Some(hello) = remote_hello.as_ref() {
                    if value(hello, "peer") != value(&remote, "peer")
                        || !runtime_schema_equal(
                            value(hello, "directory"),
                            value(&remote, "directory"),
                        )
                    {
                        return Err(invalid("HANDSHAKE_INVALID"));
                    }
                } else if auth.is_some() {
                    return Err(invalid("AUTH_REJECTED"));
                }
                let mut confirmation = accept(local);
                for key in ["major", "minor", "codec", "extensions"] {
                    set(&mut confirmation, key, value(&remote, key).clone());
                }
                if let Some(auth) = local.get("auth") {
                    set(&mut confirmation, "auth", auth.clone());
                }
                write_frame(output, &confirmation)?;
                return Ok(remote);
            }
            _ => return Err(invalid("HANDSHAKE_INCOMPATIBLE")),
        }
    }
}

/// Actual response routing reverses the admitted direct sender while retaining trace and transparent forward facts.
fn reply_route(original: &Value) -> Value {
    let incoming = value(original, "route");
    let mut route = object(&[
        (
            "applicationVersion",
            value(incoming, "applicationVersion").clone(),
        ),
        ("senderId", value(incoming, "receiverId").clone()),
        ("receiverId", value(incoming, "senderId").clone()),
        ("targetId", value(incoming, "senderId").clone()),
        ("sentAt", number(0)),
    ]);
    for key in ["trace", "forwardRoute"] {
        if let Some(value) = incoming.get(key) {
            set(&mut route, key, value.clone());
        }
    }
    route
}
fn request(remote: &Value, own: &Value) -> Value {
    object(&[
        ("profile", string(PROFILE)),
        ("kind", string("call")),
        ("id", string("rust-echo-1")),
        (
            "route",
            object(&[
                ("applicationVersion", string("1")),
                ("senderId", value(own, "instanceId").clone()),
                ("receiverId", value(remote, "instanceId").clone()),
                ("targetId", value(remote, "instanceId").clone()),
                ("sentAt", number(0)),
            ]),
        ),
        (
            "task",
            object(&[
                ("mode", string("request")),
                ("callerId", value(own, "instanceId").clone()),
                ("callerGeneration", value(own, "generation").clone()),
                ("targetGeneration", value(remote, "generation").clone()),
                ("method", string("echo")),
            ]),
        ),
        ("options", object(&[])),
        ("payload", string("rust-echo")),
    ])
}
fn initiate(input: &mut impl Read, output: &mut impl Write, auth: Option<&str>) -> io::Result<()> {
    let own = identity();
    let accepted = handshake(input, output, &hello(&own, false, auth), auth, None)?;
    let request = request(value(value(&accepted, "directory"), "self"), &own);
    write_frame(output, &request)?;
    let incoming = read_json(input)?.ok_or_else(|| invalid("PROTOCOL_INVALID"))?;
    if !valid_frame(&incoming)
        || text(&incoming, "kind") != "result"
        || value(&incoming, "id") != value(&request, "id")
        || value(&incoming, "task") != value(&request, "task")
        || value(&incoming, "result") != value(&request, "payload")
        || text(value(&incoming, "route"), "senderId") != text(value(&accepted, "peer"), "id")
        || text(value(&incoming, "route"), "receiverId") != text(&own, "instanceId")
        || text(value(&incoming, "route"), "targetId") != text(&own, "instanceId")
    {
        return Err(invalid("PROTOCOL_INVALID"));
    }
    eprintln!("RESULT ok");
    Ok(())
}

/// The historical accounting carrier parses one bounded Content-Length body with no semantic dispatch.
fn baseline_body(input: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        let mut byte = [0];
        if input.read(&mut byte)? == 0 {
            return if header.is_empty() {
                Ok(None)
            } else {
                Err(invalid("INVALID_FRAME_LENGTH"))
            };
        }
        if header.len() >= 1024 {
            return Err(invalid("INVALID_FRAME_LENGTH"));
        }
        header.push(byte[0]);
    }
    let header = std::str::from_utf8(&header).map_err(|_| invalid("INVALID_FRAME_LENGTH"))?;
    let lengths: Vec<_> = header
        .split("\r\n")
        .filter_map(|line| line.split_once(':'))
        .filter(|(key, _)| key.eq_ignore_ascii_case("content-length"))
        .collect();
    if lengths.len() != 1 {
        return Err(invalid("INVALID_FRAME_LENGTH"));
    }
    let length = lengths[0]
        .1
        .trim()
        .parse::<usize>()
        .map_err(|_| invalid("INVALID_FRAME_LENGTH"))?;
    if !(1..=MAX_FRAME).contains(&length) {
        return Err(invalid("INVALID_FRAME_LENGTH"));
    }
    let mut body = vec![0; length];
    input.read_exact(&mut body)?;
    Ok(Some(body))
}
fn baseline_write(output: &mut impl Write, body: &[u8]) -> io::Result<()> {
    write!(output, "Content-Length: {}\r\n\r\n", body.len())?;
    output.write_all(body)?;
    output.flush()
}
fn baseline_read(input: &mut impl Read) -> io::Result<Value> {
    let raw = baseline_body(input)?.ok_or_else(|| invalid("INVALID_JSON"))?;
    json::parse(&raw).map_err(|_| invalid("INVALID_JSON"))
}
fn json_baseline(input: &mut impl Read, output: &mut impl Write) -> io::Result<()> {
    while let Some(body) = baseline_body(input)? {
        let value = json::parse(&body).map_err(|_| invalid("INVALID_JSON"))?;
        let result = if value.get("xrtReverse") == Some(&Value::Bool(true)) {
            baseline_reverse(input, output, &value)?
        } else {
            value
        };
        baseline_write(output, result.text().as_bytes())?;
    }
    Ok(())
}

/// Preserve the original bare JSON reverse accounting loop, without a protocol or method dispatcher.
fn baseline_reverse(
    input: &mut impl Read,
    output: &mut impl Write,
    control: &Value,
) -> io::Result<Value> {
    let count = value(control, "count").as_u64().unwrap_or(0);
    let payload = value(control, "payload");
    if !(1..=10000).contains(&count) || payload.as_str().is_none() {
        return Err(invalid("INVALID_ENVELOPE"));
    }
    let mut latencies = Vec::with_capacity(count as usize);
    let start = std::time::Instant::now();
    for _ in 0..count {
        let round = std::time::Instant::now();
        baseline_write(output, payload.text().as_bytes())?;
        if baseline_read(input)? != *payload {
            return Err(invalid("INVALID_ENVELOPE"));
        }
        latencies.push(number(round.elapsed().as_nanos() as u64));
    }
    Ok(object(&[
        ("xrtReceipt", Value::Bool(true)),
        ("calls", number(count)),
        ("elapsedNs", number(start.elapsed().as_nanos() as u64)),
        ("latenciesNs", Value::Array(latencies)),
        ("clientInFlightPeak", number(1)),
        ("burstSize", number(1)),
    ]))
}

/// Native-v1 launch custody supplies exact self/generation/parent/token; it never admits a semantic-v1 frame.
fn bootstrap(input: &mut impl Read) -> io::Result<(Value, String, String)> {
    let raw = read_frame(input, MAX_HANDSHAKE)?.ok_or_else(|| invalid("BOOTSTRAP_INVALID"))?;
    let bootstrap = json::parse(&raw).map_err(|_| invalid("BOOTSTRAP_INVALID"))?;
    let own = value(&bootstrap, "self");
    if !has_fields(
        &bootstrap,
        &["kind", "version", "self", "parentInstanceId", "token"],
    ) || text(&bootstrap, "kind") != "rpc-runtime-api-bootstrap"
        || safe_integer(value(&bootstrap, "version")) != Some(1)
        || !has_fields(own, &["name", "instanceId"])
        || !identifier(value(own, "name"))
        || !identifier(value(own, "instanceId"))
        || !identifier(value(&bootstrap, "parentInstanceId"))
        || text(&bootstrap, "token").is_empty()
    {
        return Err(invalid("BOOTSTRAP_INVALID"));
    }
    let generation = bootstrap.get("generation").cloned().unwrap_or_else(|| {
        object(&[
            ("kind", string("session")),
            ("value", number(0)),
            ("providerId", value(own, "instanceId").clone()),
        ])
    });
    if !valid_generation(&generation) {
        return Err(invalid("BOOTSTRAP_INVALID"));
    }
    Ok((
        object(&[
            ("name", value(own, "name").clone()),
            ("instanceId", value(own, "instanceId").clone()),
            ("generation", generation),
        ]),
        text(&bootstrap, "token").to_owned(),
        text(&bootstrap, "parentInstanceId").to_owned(),
    ))
}

/// Read exactly one original bounded frame, leaving any coalesced RPC tail with the same reader.
fn read_native_connection(input: &mut impl Read) -> io::Result<Value> {
    let raw =
        read_frame(input, MAX_HANDSHAKE)?.ok_or_else(|| invalid(NATIVE_CONNECTION_REJECTED))?;
    let record = json::parse(&raw).map_err(|_| invalid(NATIVE_CONNECTION_REJECTED))?;
    if !has_fields(&record, &["kind", "version", "step"])
        || text(&record, "kind") != NATIVE_CONNECTION_KIND
        || safe_integer(value(&record, "version")) != Some(NATIVE_CONNECTION_VERSION)
    {
        return Err(invalid(NATIVE_CONNECTION_REJECTED));
    }
    Ok(record)
}

/// Prove the actual launch identity; the parent retains the sole admission deadline and close owner.
fn connect_native(
    input: &mut impl Read,
    output: &mut impl Write,
    token: &str,
    own: &Value,
) -> io::Result<()> {
    write_frame(
        output,
        &object(&[
            ("kind", string(NATIVE_CONNECTION_KIND)),
            ("version", number(NATIVE_CONNECTION_VERSION)),
            ("step", string("hello")),
            ("token", string(token)),
            ("peer", value(&hello(own, true, None), "peer").clone()),
        ]),
    )?;
    if text(&read_native_connection(input)?, "step") != "accept" {
        return Err(invalid(NATIVE_CONNECTION_REJECTED));
    }
    Ok(())
}

/// Reject a borrowed native connection before the RPC directory or providers are published.
fn accept_native(input: &mut impl Read, output: &mut impl Write, token: &str) -> io::Result<()> {
    let record = read_native_connection(input)?;
    let remote = value(&record, "peer");
    if text(&record, "step") != "hello"
        || text(&record, "token") != token
        || !identifier(value(remote, "id"))
        || !identifier(value(remote, "runtime"))
    {
        write_frame(
            output,
            &object(&[
                ("kind", string(NATIVE_CONNECTION_KIND)),
                ("version", number(NATIVE_CONNECTION_VERSION)),
                ("step", string("reject")),
                ("code", string(NATIVE_CONNECTION_REJECTED)),
            ]),
        )?;
        return Err(invalid(NATIVE_CONNECTION_REJECTED));
    }
    write_frame(
        output,
        &object(&[
            ("kind", string(NATIVE_CONNECTION_KIND)),
            ("version", number(NATIVE_CONNECTION_VERSION)),
            ("step", string("accept")),
        ]),
    )
}

/// Consume the dedicated inherited auth descriptor exactly once without exposing credential text.
fn read_auth(auth_fd: Option<i32>) -> io::Result<Option<String>> {
    let auth = if let Some(fd) = auth_fd {
        if fd < 3 {
            return Err(invalid("INVALID_AUTH_DESCRIPTOR"));
        }
        // Exact original inherited resource ownership; the token never enters argv, environment or diagnostics.
        let input = unsafe { std::fs::File::from_raw_fd(fd) };
        let mut token = String::new();
        input.take(4097).read_to_string(&mut token)?;
        let token = token.trim_end_matches(['\n', '\r']).to_owned();
        if token.is_empty() || token.len() > 4096 {
            return Err(invalid("INVALID_AUTH_TOKEN"));
        }
        Some(token)
    } else {
        None
    };
    Ok(auth)
}
/// One borrowed native socket owns its cloned reader and writer until the same session returns.
fn serve_socket(
    stream: UnixStream,
    role: &str,
    auth: Option<&str>,
    business: bool,
    native_admission: bool,
) -> io::Result<()> {
    let mut input = stream.try_clone()?;
    let mut output = stream;
    if native_admission {
        accept_native(
            &mut input,
            &mut output,
            auth.ok_or_else(|| invalid(NATIVE_CONNECTION_REJECTED))?,
        )?;
        return self::business::serve(&mut input, &mut output, &identity(), None, None, business);
    }
    if role == "initiator" {
        initiate(&mut input, &mut output, auth)
    } else {
        self::business::serve(&mut input, &mut output, &identity(), None, auth, business)
    }
}
/// CLI keeps the original native acquisition, fd custody and finally cleanup; removed profiles have no aliases.
fn run() -> io::Result<()> {
    let mut role = "responder";
    let mut listener_path: Option<PathBuf> = None;
    let mut connect_path: Option<PathBuf> = None;
    let mut vectors: Option<PathBuf> = None;
    let mut auth_fd: Option<i32> = None;
    let mut selftest = false;
    let mut business_profile = false;
    let mut descendant = false;
    let mut baseline_label = false;
    let mut bare_profile = false;
    let mut bootstrap_stdin = false;
    let mut arguments = env::args().skip(1);
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--role" => {
                let next = arguments
                    .next()
                    .ok_or_else(|| invalid("INVALID_ARGUMENT"))?;
                role = match next.as_str() {
                    "responder" => "responder",
                    "initiator" => "initiator",
                    _ => return Err(invalid("INVALID_ARGUMENT")),
                };
            }
            "--business" => business_profile = true,
            "--descendant" => descendant = true,
            "--jsonrpc" => baseline_label = true,
            "--bare-jsonrpc" => bare_profile = true,
            "--bootstrap" => bootstrap_stdin = arguments.next().as_deref() == Some("stdin"),
            "--non-idempotent-request" => {
                business::REQUEST_IDEMPOTENT.store(false, std::sync::atomic::Ordering::Relaxed)
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
                        .ok_or_else(|| invalid("INVALID_ARGUMENT"))?
                        .parse()
                        .map_err(|_| invalid("INVALID_ARGUMENT"))?,
                )
            }
            _ => return Err(invalid("INVALID_ARGUMENT")),
        }
    }
    if baseline_label != bare_profile
        || bare_profile && (!business_profile || listener_path.is_some() || connect_path.is_some())
    {
        return Err(invalid("RETIRED_PROFILE"));
    }
    if selftest {
        return selftest::run(&vectors.ok_or_else(|| invalid("MISSING_VECTORS"))?);
    }
    let mut auth = read_auth(auth_fd)?;
    if listener_path.is_some() && connect_path.is_some() {
        return Err(invalid("AMBIGUOUS_CONNECTION"));
    }
    if let Some(path) = listener_path {
        let listener = UnixListener::bind(&path)?;
        eprintln!("READY pid={}", std::process::id());
        loop {
            let (stream, _) = listener.accept()?;
            let result = serve_socket(
                stream,
                role,
                auth.as_deref(),
                business_profile,
                business_profile && role == "responder",
            );
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
        return serve_socket(stream, role, auth.as_deref(), business_profile, false);
    }
    eprintln!("READY pid={}", std::process::id());
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    if bare_profile {
        return json_baseline(&mut input, &mut output);
    }
    let mut own = identity();
    let mut parent = None;
    if business_profile && bootstrap_stdin {
        let (next, token, owner) = bootstrap(&mut input)?;
        own = next;
        connect_native(&mut input, &mut output, &token, &own)?;
        auth = None;
        parent = Some(owner);
    }
    if business_profile {
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
            &own,
            parent.as_deref(),
            auth.as_deref(),
            true,
        );
        if let Some(child) = &mut child {
            let _ = child.kill();
            child.wait()?;
        }
        result
    } else if role == "initiator" {
        initiate(&mut input, &mut output, auth.as_deref())
    } else {
        business::serve(
            &mut input,
            &mut output,
            &own,
            parent.as_deref(),
            auth.as_deref(),
            false,
        )
    }
}
fn main() {
    if let Err(error) = run() {
        let label = if error.kind() == io::ErrorKind::InvalidData
            && error.to_string() == "HANDSHAKE_INCOMPATIBLE"
        {
            "HANDSHAKE_INCOMPATIBLE"
        } else if error.kind() == io::ErrorKind::InvalidData
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
#[cfg(test)]
mod review_tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn handshake_oversize_is_rejected_before_payload_read() {
        let mut input = Cursor::new(((MAX_HANDSHAKE + 1) as u32).to_be_bytes());
        let error = read_frame(&mut input, MAX_HANDSHAKE).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert_eq!(input.position(), 4);
    }

    #[test]
    fn phase_limits_accept_their_exact_boundary_without_narrowing_ready_frames() {
        for (size, limit) in [
            (MAX_HANDSHAKE, MAX_HANDSHAKE),
            (MAX_HANDSHAKE + 1, MAX_FRAME),
        ] {
            let mut bytes = (size as u32).to_be_bytes().to_vec();
            bytes.resize(size + 4, b' ');
            assert_eq!(
                read_frame(&mut Cursor::new(bytes), limit)
                    .unwrap()
                    .unwrap()
                    .len(),
                size
            );
        }
    }

    #[test]
    fn duplicate_json_names_are_rejected_after_decoding_at_every_depth() {
        for input in [
            br#"{"auth":"a","auth":"b"}"#.as_slice(),
            br#"{"auth":"a","\u0061uth":"b"}"#.as_slice(),
            br#"{"outer":{"key":1,"key":2}}"#.as_slice(),
        ] {
            assert!(json::parse(input)
                .unwrap_err()
                .starts_with("duplicate JSON field at offset "));
        }
        assert!(json::parse(br#"{"auth":"a","nested":{"auth":"b"}}"#).is_ok());
    }
}
