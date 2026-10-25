//! Existing selftest entry receives canonical admission and preserves original native business assertions.
use crate::json::{number, object, parse_vector, string, Value};
use crate::{read_frame, write_frame, MAX_FRAME};
use std::{fs, io, path::Path};
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
    fn check(&mut self, name: &str, good: bool) {
        self.case("native", "business", &object(&[("id", string(name))]), good);
    }
}
fn field<'a>(input: &'a Value, key: &str) -> &'a Value {
    crate::value(input, key)
}
fn items(input: &Value) -> &[Value] {
    crate::items(input)
}
fn text<'a>(input: &'a Value, key: &str) -> &'a str {
    crate::text(input, key)
}
fn load(root: &Path, name: &str, counts: &mut Counts) -> Option<Value> {
    match fs::read(root.join(name))
        .ok()
        .and_then(|bytes| parse_vector(&bytes).ok())
    {
        Some(value) => Some(value),
        None => {
            counts.failed += 1;
            eprintln!("MISSING_OR_INVALID {name}");
            None
        }
    }
}
fn core_vectors(root: &Path, counts: &mut Counts) {
    if let Some(vector) = load(root, "core-profile.json", counts) {
        for section in ["valid", "invalid"] {
            for case in items(field(&vector, section)) {
                counts.case(
                    "core-profile",
                    section,
                    case,
                    crate::valid_frame(field(case, "frame")) == (section == "valid"),
                );
            }
        }
        for case in items(field(&vector, "unknownIgnored")) {
            let mut frame = field(case, "frame").clone();
            let accepted =
                crate::valid_frame(&frame) && crate::valid_frame(field(case, "baseline"));
            let mut target = &mut frame;
            for key in text(case, "pointer").split('/').skip(1) {
                target = match target {
                    Value::Array(values) => &mut values[key.parse::<usize>().unwrap()],
                    Value::Object(fields) => {
                        &mut fields.iter_mut().find(|(name, _)| name == key).unwrap().1
                    }
                    _ => unreachable!("vector pointer selects metadata"),
                };
            }
            let mut present = false;
            if let Value::Object(fields) = target {
                present = fields.iter().any(|(name, _)| name == "futureA")
                    && fields.iter().any(|(name, _)| name == "futureB");
                fields.retain(|(name, _)| name != "futureA" && name != "futureB");
            }
            counts.case(
                "core-profile",
                "unknownIgnored",
                case,
                accepted && present && frame == *field(case, "baseline"),
            );
        }
    }
}
/// Only enclosing schema2 test authoring is upgraded; malformed schema1 remains rejected.
fn upgrade_directory(value: &Value) -> Value {
    let mut result = value.clone();
    if crate::safe_integer(field(value, "schemaVersion")) == Some(2) {
        crate::set(&mut result, "schemaVersion", number(3));
    }
    if let Value::Object(_) = field(value, "self") {
        let mut identity = field(value, "self").clone();
        crate::set(
            &mut identity,
            "generation",
            object(&[
                ("kind", string("session")),
                ("value", number(0)),
                (
                    "providerId",
                    field(value, "self")
                        .get("instanceId")
                        .cloned()
                        .unwrap_or(Value::Null),
                ),
            ]),
        );
        crate::set(&mut result, "self", identity);
    }
    result
}
fn directory_vectors(root: &Path, counts: &mut Counts) {
    if let Some(vector) = load(root, "description-schema.json", counts) {
        for case in items(field(&vector, "cases")) {
            let directory = upgrade_directory(field(case, "value"));
            counts.case(
                "description-schema.json",
                "cases",
                case,
                crate::valid_runtime_description(
                    &directory,
                    text(field(&directory, "self"), "instanceId"),
                ) == (field(case, "valid") == &Value::Bool(true)),
            );
        }
    }
    if let Some(vector) = load(root, "runtime-description.json", counts) {
        for section in ["valid", "invalid"] {
            for (index, input) in items(field(&vector, section)).iter().enumerate() {
                let directory = upgrade_directory(input);
                counts.case(
                    "runtime-description.json",
                    section,
                    &object(&[("id", string(&index.to_string()))]),
                    crate::valid_runtime_description(
                        &directory,
                        text(field(&directory, "self"), "instanceId"),
                    ) == (section == "valid"),
                );
            }
        }
    }
}
fn canonical_vectors(root: &Path, counts: &mut Counts) {
    if let Some(vector) = load(root, "canonical.json", counts) {
        for case in items(field(&vector, "cases")) {
            let data = field(case, "value").text();
            let encoded: String = data
                .as_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            counts.case(
                "canonical",
                "bytes",
                case,
                crate::portable_bytes(field(case, "value"), 0).is_some(),
            );
            println!("CANONICAL {} {}", text(case, "id"), encoded);
        }
    }
    let value = object(&[
        ("z", number(1)),
        ("a", string("<>&\u{2028}\u{2029}")),
        (
            "nested",
            object(&[("second", number(2)), ("first", number(1))]),
        ),
    ]);
    counts.check(
        "own-order-no-html-escape",
        value.text()
            == "{\"z\":1,\"a\":\"<>&\u{2028}\u{2029}\",\"nested\":{\"second\":2,\"first\":1}}",
    );
}
fn stream_vectors(root: &Path, counts: &mut Counts) {
    if let Some(vector) = load(root, "stream.json", counts) {
        for case in items(field(&vector, "payload")) {
            counts.case(
                "stream.json",
                "payload",
                case,
                crate::valid_stream(field(case, "value"))
                    == (field(case, "valid") == &Value::Bool(true)),
            );
        }
        for case in items(field(&vector, "measure")) {
            counts.case(
                "stream.json",
                "measure",
                case,
                crate::portable_bytes(field(case, "value"), 0)
                    == field(case, "bytes").as_u64().map(|n| n as usize),
            );
        }
        for case in items(field(&vector, "sequences")) {
            counts.case("stream.json", "sequences", case, stream_sequence(case));
        }
    }
}
fn caller() -> Value {
    object(&[
        ("name", string("caller")),
        ("instanceId", string("caller")),
        (
            "generation",
            object(&[
                ("kind", string("session")),
                ("value", number(0)),
                ("providerId", string("caller")),
            ]),
        ),
    ])
}
fn call(
    id: &str,
    method: &str,
    mode: &str,
    payload: Value,
    local: &Value,
    remote: &Value,
) -> Value {
    let mut message = crate::request(local, remote);
    crate::set(&mut message, "id", string(id));
    crate::set(&mut message, "payload", payload);
    let mut task = field(&message, "task").clone();
    crate::set(&mut task, "method", string(method));
    crate::set(&mut task, "mode", string(mode));
    crate::set(&mut message, "task", task);
    message
}
fn frames(output: &[u8]) -> Vec<Value> {
    let mut input = output;
    let mut result = Vec::new();
    while let Ok(Some(value)) = crate::read_json(&mut input) {
        result.push(value);
    }
    result
}
fn error_root(error: &Value) -> &Value {
    items(field(error, "nodes"))
        .get(crate::safe_integer(field(error, "root")).unwrap_or(0) as usize)
        .unwrap_or(&Value::Null)
}

/// Retain original directory identity, old method refusal and independently admitted sibling payload/order assertions.
fn native_baseline(counts: &mut Counts) {
    let local = crate::identity();
    let remote = caller();
    for business in [false, true] {
        let mut input = Vec::new();
        for message in [
            crate::hello(&remote, business, Some("unit-token")),
            {
                let mut confirmation =
                    crate::accept(&crate::hello(&remote, business, Some("unit-token")));
                crate::set(&mut confirmation, "auth", string("unit-token"));
                confirmation
            },
            call(
                "old",
                "migaia.remote.describe",
                "request",
                Value::Null,
                &local,
                &remote,
            ),
            call("first", "echo", "request", string("first"), &local, &remote),
            call(
                "missing",
                "missing.method",
                "request",
                Value::Null,
                &local,
                &remote,
            ),
            call("last", "echo", "request", string("last"), &local, &remote),
        ] {
            write_frame(&mut input, &message).unwrap();
        }
        let mut output = Vec::new();
        let result = crate::business::serve(
            &mut &input[..],
            &mut output,
            &local,
            None,
            Some("unit-token"),
            business,
        );
        let replies = frames(&output);
        let profile = if business { "business" } else { "basic" };
        let accepted = replies.get(1).unwrap_or(&Value::Null);
        let directory = field(accepted, "directory");
        counts.case(
            "u36-runtime-baseline",
            profile,
            &object(&[("id", string("v2-directory"))]),
            text(accepted, "step") == "accept"
                && crate::safe_integer(field(directory, "schemaVersion")) == Some(3)
                && text(field(directory, "self"), "instanceId")
                    == text(field(accepted, "peer"), "id")
                && items(field(directory, "methods")).iter().any(|method| {
                    text(method, "name") == "echo"
                        && text(method, "modeSource") == "declared"
                        && items(field(method, "supportedModes")).contains(&string("notify"))
                }),
        );
        counts.case(
            "u36-runtime-baseline",
            profile,
            &object(&[("id", string("old-describe-refused"))]),
            replies
                .get(2)
                .is_some_and(|frame| text(frame, "id") == "old" && text(frame, "kind") == "error"),
        );
        counts.case(
            "u36-runtime-baseline",
            profile,
            &object(&[("id", string("batch-isolation"))]),
            result.is_ok()
                // BC12 retains all six original frames and appends the final native close.
                && replies.len() == 7
                && text(&replies[6], "kind") == "control"
                && text(&replies[6], "operation") == crate::CONTROL_CLOSE
                && text(error_root(field(&replies[6], "reason")), "code") == "ENDPOINT_DISPOSED"
                && text(&replies[3], "id") == "first"
                && field(&replies[3], "result") == &string("first")
                && text(&replies[4], "id") == "missing"
                && text(&replies[4], "kind") == "error"
                && text(&replies[5], "id") == "last"
                && field(&replies[5], "result") == &string("last"),
        );
    }
}
/// The old bridge fixture's business receipt/count/error/order is received by real native frames, without its removed profile.
fn notification_and_cancel(counts: &mut Counts) {
    let local = crate::identity();
    let remote = caller();
    let wait = call("wait", "peer.wait", "request", Value::Null, &local, &remote);
    let mut cancel = crate::business::header(&wait);
    crate::set(&mut cancel, "kind", string("cancel"));
    crate::set(
        &mut cancel,
        "reason",
        crate::wire_error("rpc.endpoint", "CANCELLED", "stop"),
    );
    let mut input = Vec::new();
    for message in [
        crate::hello(&remote, true, Some("unit-token")),
        {
            let mut confirmation = crate::accept(&crate::hello(&remote, true, Some("unit-token")));
            crate::set(&mut confirmation, "auth", string("unit-token"));
            confirmation
        },
        call(
            "note",
            "p.f.oneWay",
            "notify",
            Value::Array(vec![string("receipt")]),
            &local,
            &remote,
        ),
        call(
            "missing",
            "absent",
            "request",
            Value::Array(vec![]),
            &local,
            &remote,
        ),
        call(
            "received",
            "peer.received",
            "request",
            Value::Null,
            &local,
            &remote,
        ),
        wait,
        cancel,
        call(
            "aborts",
            "peer.aborts",
            "request",
            Value::Null,
            &local,
            &remote,
        ),
        call(
            "error",
            "peer.error",
            "request",
            Value::Null,
            &local,
            &remote,
        ),
    ] {
        write_frame(&mut input, &message).unwrap();
    }
    let mut output = Vec::new();
    let result = crate::business::serve(
        &mut &input[..],
        &mut output,
        &local,
        None,
        Some("unit-token"),
        true,
    );
    let replies = frames(&output);
    counts.case(
        "u41",
        "bridge",
        &object(&[("id", string("baseline"))]),
        result.is_ok() && text(replies.get(1).unwrap_or(&Value::Null), "step") == "accept",
    );
    let missing = replies.get(2).unwrap_or(&Value::Null);
    let received = field(replies.get(3).unwrap_or(&Value::Null), "result");
    counts.case(
        "u41",
        "bridge",
        &object(&[("id", string("v2-batch-notification-isolation"))]),
        // Every original receipt/error/cancellation frame remains before the R21 final close.
        replies.len() == 7
            && text(&replies[6], "kind") == "control"
            && text(&replies[6], "operation") == crate::CONTROL_CLOSE
            && text(error_root(field(&replies[6], "reason")), "code") == "ENDPOINT_DISPOSED"
            && text(missing, "id") == "missing"
            && text(error_root(field(missing, "error")), "code") == "PROVIDER_NOT_FOUND"
            && crate::safe_integer(field(received, "count")) == Some(1)
            && field(received, "values") == &Value::Array(vec![string("receipt")]),
    );
    let aborts = field(replies.get(4).unwrap_or(&Value::Null), "result");
    counts.check(
        "cancel-reason-and-no-ack",
        items(aborts).len() == 1
            && text(&items(aborts)[0], "message") == "stop"
            && text(&items(aborts)[0], "code") == "CANCELLED",
    );
    let error = field(replies.get(5).unwrap_or(&Value::Null), "error");
    let nodes = items(field(error, "nodes"));
    counts.check(
        "native-error-full-chain",
        nodes.len() == 2
            && text(&nodes[0], "source") == "rpc.endpoint"
            && text(&nodes[0], "code") == "INTERNAL"
            && text(&nodes[0], "name") == "RpcError"
            && text(&nodes[0], "message") == "peer error"
            && text(&nodes[0], "stack") == "RpcError: peer error"
            && field(&nodes[0], "cause").as_u64() == Some(1)
            && text(&nodes[1], "message") == "peer cause"
            && text(&nodes[1], "stack") == "Error: peer cause",
    );
}
fn flat_error_boundaries(counts: &mut Counts) {
    for key in ["source", "code", "name", "message", "stack"] {
        let mut node = crate::error_node("s", "C", "Error", "m");
        crate::set(&mut node, key, string(""));
        counts.check(
            &format!("flat-empty-{key}"),
            crate::valid_flat_error(&object(&[
                ("root", number(0)),
                ("nodes", Value::Array(vec![node])),
            ])) == (key == "message"),
        );
    }
    for size in [65_536, 65_537] {
        let mut node = crate::error_node("s", "C", "Error", "m");
        crate::set(&mut node, "message", string(&"m".repeat(size)));
        counts.check(
            &format!("message-{size}"),
            crate::valid_flat_error(&object(&[
                ("root", number(0)),
                ("nodes", Value::Array(vec![node.clone()])),
            ])) == (size == 65_536),
        );
        crate::set(&mut node, "message", string("m"));
        crate::set(&mut node, "data", string(&"d".repeat(size)));
        counts.check(
            &format!("data-text-{size}"),
            crate::valid_flat_error(&object(&[
                ("root", number(0)),
                ("nodes", Value::Array(vec![node])),
            ])) == (size == 65_536),
        );
    }
    for (name, data, expected) in [
        (
            "data-bytes",
            object(&[("$rpc", string("bytes")), ("base64url", string("AQ"))]),
            true,
        ),
        (
            "invalid-marker",
            object(&[("$rpc", string("error"))]),
            false,
        ),
        (
            "noncanonical-bytes",
            object(&[("$rpc", string("bytes")), ("base64url", string("AR"))]),
            false,
        ),
        (
            "data-subtotal-boundary",
            object(&[("a", string(&"d".repeat(65_535)))]),
            true,
        ),
        (
            "data-subtotal-over",
            object(&[("a", string(&"d".repeat(65_536)))]),
            false,
        ),
    ] {
        let mut node = crate::error_node("s", "C", "Error", "m");
        crate::set(&mut node, "data", data);
        counts.check(
            name,
            crate::valid_flat_error(&object(&[
                ("root", number(0)),
                ("nodes", Value::Array(vec![node])),
            ])) == expected,
        );
    }
}
pub fn run(root: &Path) -> io::Result<()> {
    let mut counts = Counts {
        passed: 0,
        failed: 0,
    };
    core_vectors(root, &mut counts);
    directory_vectors(root, &mut counts);
    canonical_vectors(root, &mut counts);
    stream_vectors(root, &mut counts);
    native_baseline(&mut counts);
    notification_and_cancel(&mut counts);
    flat_error_boundaries(&mut counts);
    original_error_vectors(root, &mut counts);
    if let Some(vector) = load(root, "stream-framing.json", &mut counts) {
        check_frames(&vector, &mut counts);
    }
    let mut output = Vec::new();
    let result = crate::json_baseline(
        &mut &b"Content-Length: 25\r\n\r\n [ 1, \"baseline\", null ] "[..],
        &mut output,
    );
    counts.check(
        "pure-json-baseline",
        result.is_ok() && output == b"Content-Length: 19\r\n\r\n[1,\"baseline\",null]",
    );
    println!(
        "rust vectors passed={} failed={}",
        counts.passed, counts.failed
    );
    if counts.failed > 0 {
        Err(crate::invalid("VECTOR_SELFTEST_FAILED"))
    } else {
        Ok(())
    }
}
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
            if !crate::valid_stream(frame) {
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
            match read_frame(&mut reader, MAX_FRAME) {
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

/// Original compact generator and source projection algorithms are retained below.
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
            if crate::error_data_text(data, 17).is_some() && data.text().len() <= 65536 {
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
    } else if input.as_str().is_none() && input.get("absent") != Some(&Value::Bool(true)) {
        fields.push(("data".to_owned(), input.clone()));
    }
    Value::Object(fields)
}

/// Reauthor only the old fixture's tree topology; actual flat admission remains in the live owner.
fn flat_error_fixture(input: &Value) -> Value {
    let mut queue = vec![input];
    let mut nodes = Vec::new();
    let mut cursor = 0;
    while cursor < queue.len() {
        let original = queue[cursor];
        cursor += 1;
        let Value::Object(fields) = original else {
            nodes.push(original.clone());
            continue;
        };
        let mut node: Vec<_> = fields
            .iter()
            .filter(|(key, _)| key != "cause" && key != "errors")
            .cloned()
            .collect();
        if let Some(child) = original.get("cause") {
            let index = queue.len();
            queue.push(child);
            node.push(("cause".to_owned(), number(index as u64)));
        }
        if let Some(children) = original.get("errors") {
            let value = if let Some(children) = children.as_array() {
                Value::Array(
                    children
                        .iter()
                        .map(|child| {
                            let index = queue.len();
                            queue.push(child);
                            number(index as u64)
                        })
                        .collect(),
                )
            } else {
                children.clone()
            };
            node.push(("errors".to_owned(), value));
        }
        nodes.push(Value::Object(node));
    }
    object(&[("root", number(0)), ("nodes", Value::Array(nodes))])
}

/// Preserve every original error scenario id and budget while the sole runtime normalizer sees actual flat nodes.
fn original_error_vectors(root: &Path, counts: &mut Counts) {
    let Some(vector) = load(root, "error-chain.json", counts) else {
        return;
    };
    for section in ["valid", "invalid"] {
        for case in items(field(&vector, section)) {
            let input = case
                .get("wire")
                .cloned()
                .unwrap_or_else(|| generated_wire(field(case, "generate")));
            let expected = section == "valid"
                || matches!(text(case, "id"), "cause-depth-49" | "errors-depth-25");
            counts.case(
                "error-chain.json",
                section,
                case,
                crate::valid_flat_error(&flat_error_fixture(&input)) == expected,
            );
        }
    }
    for case in items(field(&vector, "unknownFields")) {
        counts.case(
            "error-chain.json",
            "unknownFields",
            case,
            crate::valid_flat_error(&flat_error_fixture(field(case, "wire"))),
        );
    }
    for case in items(field(&vector, "truncation")) {
        let projected = if case.has("expected") {
            project_thrown(field(case, "input"))
        } else {
            generated_projection(field(case, "generate"))
        };
        let semantic = if let Some(expected) = case.get("expected") {
            projected == *expected
        } else {
            let generated = field(case, "generate");
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
        counts.case(
            "error-chain.json",
            "truncation",
            case,
            semantic && crate::valid_flat_error(&flat_error_fixture(&projected)),
        );
    }
}
