//! Roundtrip tests for the arena allocator.
//!
//! Run in a wasm host:  `wasm-pack test --node`
//! (or `--headless --firefox` / `--chrome`).

use wasm_bindgen_test::*;
use wasm_provider::{alloc_bytes, byte_len_of, dealloc_bytes, ptr_of};

// Problem 1: every allocation must be 8-byte aligned, whatever the size.
#[wasm_bindgen_test]
fn ptr_is_8_byte_aligned() {
    for len in [0u32, 1, 3, 7, 8, 9, 100, 4096] {
        let id = alloc_bytes(len);
        let ptr = ptr_of(id);
        assert_eq!(ptr % 8, 0, "len={len} gave misaligned ptr={ptr}");
        dealloc_bytes(id);
    }
}

// Problem 1b: byte capacity rounds up to a whole u64 word.
#[wasm_bindgen_test]
fn byte_len_rounds_up_to_8() {
    let cases = [(0u32, 0u32), (1, 8), (8, 8), (9, 16), (12, 16), (16, 16)];
    for (req, want) in cases {
        let id = alloc_bytes(req);
        assert_eq!(byte_len_of(id), want, "req={req}");
        dealloc_bytes(id);
    }
}

// Problem 2: distinct live allocations never share an id, and freeing one
// leaves the other intact (no overwrite/aliasing).
#[wasm_bindgen_test]
fn ids_are_distinct_and_independent() {
    let a = alloc_bytes(16);
    let b = alloc_bytes(16);
    assert_ne!(a, b);
    assert_ne!(ptr_of(a), ptr_of(b), "two live allocs must not alias");

    assert!(dealloc_bytes(a));
    // b survives a's free
    assert_ne!(ptr_of(b), 0);
    assert!(dealloc_bytes(b));
}

// Problem 2b: 0 is the null sentinel — never handed out, and safe to query.
#[wasm_bindgen_test]
fn null_id_is_reserved_and_safe() {
    let ids: Vec<u32> = (0..64).map(|_| alloc_bytes(8)).collect();
    assert!(ids.iter().all(|&id| id != 0), "0 must never be allocated");
    // querying a dead/unknown id returns 0 instead of trapping
    assert_eq!(ptr_of(0), 0);
    assert_eq!(byte_len_of(0), 0);
    assert!(!dealloc_bytes(0));
    for id in ids {
        dealloc_bytes(id);
    }
}

// Problem 3: write a contiguous f64 run through the pointer and read it back —
// proves the aligned buffer is usable as a numeric collection.
#[wasm_bindgen_test]
fn contiguous_f64_roundtrip() {
    let n = 5usize;
    let id = alloc_bytes((n * 8) as u32);
    let ptr = ptr_of(id) as *mut f64;
    let src = [1.5f64, -2.0, 3.25, 4e10, f64::MIN];
    unsafe {
        for (i, &v) in src.iter().enumerate() {
            ptr.add(i).write(v);
        }
        for (i, &v) in src.iter().enumerate() {
            assert_eq!(ptr.add(i).read(), v);
        }
    }
    dealloc_bytes(id);
}

// dealloc twice: second call reports the id was already gone.
#[wasm_bindgen_test]
fn double_free_reports_false() {
    let id = alloc_bytes(8);
    assert!(dealloc_bytes(id));
    assert!(!dealloc_bytes(id));
}

// ---------------------------------------------------------------------------
// Format conversion
// ---------------------------------------------------------------------------

use wasm_provider::{json_to_msgpack, last_error, last_len, msgpack_to_json};

/// Copy bytes into a fresh arena allocation and hand back its id.
fn put(bytes: &[u8]) -> u32 {
    let id = alloc_bytes(bytes.len() as u32);
    assert_ne!(id, 0, "arena refused an allocation of {}", bytes.len());
    let ptr = ptr_of(id) as *mut u8;
    // Safe: the block was just allocated with at least this many bytes.
    unsafe { std::slice::from_raw_parts_mut(ptr, bytes.len()) }
        .copy_from_slice(bytes);
    id
}

/// Read `len` bytes back out of an allocation.
fn take(id: u32, len: u32) -> Vec<u8> {
    let ptr = ptr_of(id) as *const u8;
    unsafe { std::slice::from_raw_parts(ptr, len as usize) }.to_vec()
}

// The conversion has to be lossless in both directions, otherwise an archive
// written as MessagePack could not be read back as the state it came from.
#[wasm_bindgen_test]
fn json_msgpack_roundtrip_preserves_content() {
    let json = br#"{"id":7,"name":"a\"b","ok":true,"nil":null,"nums":[1,-2,3.5],"nested":{"k":"v"}}"#;
    let packed_id = json_to_msgpack(put(json), json.len() as u32);
    assert_ne!(packed_id, 0, "encode failed: {}", last_error());
    let packed = take(packed_id, last_len());

    let back_id = msgpack_to_json(put(&packed), packed.len() as u32);
    assert_ne!(back_id, 0, "decode failed: {}", last_error());
    let back = take(back_id, last_len());

    let original: serde_json::Value = serde_json::from_slice(json).unwrap();
    let restored: serde_json::Value = serde_json::from_slice(&back).unwrap();
    assert_eq!(original, restored);
}

// The whole point of reaching for MessagePack is a smaller archive; if it were
// not smaller there would be no reason to pay the conversion at all.
#[wasm_bindgen_test]
fn msgpack_is_more_compact_than_json() {
    let json = br#"[{"role":"user","tokens":12},{"role":"assistant","tokens":34}]"#;
    let packed_id = json_to_msgpack(put(json), json.len() as u32);
    assert_ne!(packed_id, 0);
    assert!(
        last_len() < json.len() as u32,
        "msgpack {} was not smaller than json {}",
        last_len(),
        json.len()
    );
}

// Empty input is malformed for both formats, not an empty document.
#[wasm_bindgen_test]
fn conversions_report_malformed_input() {
    let broken = b"{ not json";
    assert_eq!(json_to_msgpack(put(broken), broken.len() as u32), 0);
    assert!(last_error().contains("json to msgpack"), "{}", last_error());

    let garbage = &[0xc1u8, 0xc1, 0xc1];
    assert_eq!(msgpack_to_json(put(garbage), garbage.len() as u32), 0);
    assert!(last_error().contains("msgpack to json"), "{}", last_error());
}

// A stale or forged handle must be refused rather than read out of bounds.
#[wasm_bindgen_test]
fn conversions_refuse_a_bad_handle() {
    assert_eq!(json_to_msgpack(0, 4), 0);
    assert!(last_error().contains("unknown allocation id"));

    let id = alloc_bytes(8);
    // capacity is 8 bytes, so 64 is past the end
    assert_eq!(json_to_msgpack(id, 64), 0);
    assert!(last_error().contains("past capacity"));
    dealloc_bytes(id);
}

// last_error has to be cleared by a success, or a later caller would blame a
// failure that already happened.
#[wasm_bindgen_test]
fn success_clears_the_previous_error() {
    let broken = b"nope";
    assert_eq!(json_to_msgpack(put(broken), broken.len() as u32), 0);
    assert!(!last_error().is_empty());

    let good = br#"{"a":1}"#;
    assert_ne!(json_to_msgpack(put(good), good.len() as u32), 0);
    assert!(last_error().is_empty(), "stale error: {}", last_error());
}
