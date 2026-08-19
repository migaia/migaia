use std::{cell::RefCell, collections::HashMap};

use wasm_bindgen::prelude::*;

/// Backing store for one allocation.
///
/// Stored as `Vec<u64>` (not `Vec<u8>`) on purpose: `Vec<T>` is allocated with
/// `align_of::<T>()`, so a `Vec<u64>` guarantees an **8-byte-aligned** base
/// pointer. That satisfies the JS side, where
/// `new Float64Array(memory.buffer, ptr, len)` / `BigInt64Array` throw a
/// `RangeError` unless `ptr % 8 == 0`. A `Vec<u8>` is only align-1 and would
/// break for f64/i64 typed views.
type Block = Vec<u64>;

/// Reserved id meaning "no allocation" / null handle. Never handed out, so JS
/// can treat 0 as a sentinel.
const NULL_ID: u32 = 0;

struct Arena {
    map: HashMap<u32, Block>,
    /// Monotonic cursor for the next id to *try*. Wraps intentionally; the
    /// allocator probes forward from here for a free slot.
    cursor: u32,
}

impl Arena {
    fn new() -> Self {
        Self { map: HashMap::new(), cursor: 1 }
    }

    /// Pick an id that is not 0 and not currently live.
    ///
    /// Fixes the wraparound/duplicate bug: a raw `fetch_add` counter wraps at
    /// `u32::MAX` and then `insert` silently overwrites a live allocation,
    /// aliasing two handles onto one buffer. Here we probe forward until we
    /// find a free id, skipping `NULL_ID`. Returns `NULL_ID` only if the id
    /// space is fully exhausted (2^32-1 live allocations — practically OOM
    /// first).
    fn fresh_id(&mut self) -> u32 {
        // At most u32::MAX candidates to inspect (all non-zero ids).
        for _ in 0..u32::MAX {
            let id = self.cursor;
            // advance cursor, skipping the reserved 0 on wrap
            self.cursor = self.cursor.wrapping_add(1);
            if self.cursor == NULL_ID {
                self.cursor = 1;
            }
            if id != NULL_ID && !self.map.contains_key(&id) {
                return id;
            }
        }
        NULL_ID
    }
}

thread_local! {
    static ARENA: RefCell<Arena> = RefCell::new(Arena::new());
}

/// Allocate an 8-byte-aligned, zeroed buffer of at least `byte_len` bytes.
///
/// Returns a stable allocation id, or `0` (`NULL_ID`) if the id space is
/// exhausted. The buffer never moves for the lifetime of the id, so a pointer
/// from [`ptr_of`] stays valid until [`dealloc_bytes`] — suitable for exposing
/// as a contiguous numeric typed array on the JS side.
#[wasm_bindgen]
pub fn alloc_bytes(byte_len: u32) -> u32 {
    // round up to whole u64 words so the whole requested range is backed
    let words = (byte_len as usize).div_ceil(8);

    ARENA.with(|arena| {
        let mut arena = arena.borrow_mut();
        let id = arena.fresh_id();
        if id != NULL_ID {
            arena.map.insert(id, vec![0u64; words]);
        }
        id
    })
}

/// Byte pointer into wasm linear memory for `id`. Guaranteed 8-byte aligned.
///
/// Returns `0` for an unknown/dead id instead of trapping, so a stale handle is
/// recoverable on the JS side rather than aborting the module.
#[wasm_bindgen]
pub fn ptr_of(id: u32) -> u32 {
    ARENA.with(|arena| {
        arena
            .borrow()
            .map
            .get(&id)
            .map_or(0, |buf| buf.as_ptr() as u32)
    })
}

/// Capacity in bytes actually backing `id` (rounded up to 8), or 0 if unknown.
/// Lets JS size a `Float64Array`/`BigInt64Array` view without guessing.
#[wasm_bindgen]
pub fn byte_len_of(id: u32) -> u32 {
    ARENA.with(|arena| {
        arena
            .borrow()
            .map
            .get(&id)
            .map_or(0, |buf| (buf.len() * 8) as u32)
    })
}

/// Free the allocation. Returns `true` if it existed.
#[wasm_bindgen]
pub fn dealloc_bytes(id: u32) -> bool {
    ARENA.with(|arena| arena.borrow_mut().map.remove(&id).is_some())
}

// ---------------------------------------------------------------------------
// Format conversion
// ---------------------------------------------------------------------------
//
// Deliberately byte-in / byte-out: the JS object graph never crosses into wasm.
//
// That constraint comes from measurement, not taste. Copying bytes through wasm
// linear memory costs about the same as the UTF-16 -> UTF-8 conversion JS has to
// do anyway, so the boundary itself is cheap. What is *not* cheap is
// materializing a JS object graph across it — every field would be a separate
// crossing. So these functions take bytes, do all the work inside wasm, and hand
// back bytes. The caller decides whether it ever needs objects.
//
// Because of that, wasm is not here to beat `JSON.parse` — nothing does, for
// JSON. It is here for what V8 has no native parser for, and for producing a
// more compact archive than JSON without touching the main thread's object graph.

use std::cell::Cell;

thread_local! {
    /// Exact byte length of the buffer produced by the last conversion.
    ///
    /// The arena rounds capacity up to whole `u64` words, so `byte_len_of` reports
    /// capacity rather than content length. Conversions need the exact figure, and
    /// returning a pair from `#[wasm_bindgen]` would mean allocating a JS object
    /// per call, so it is read back through this instead.
    static LAST_LEN: Cell<u32> = const { Cell::new(0) };
    static LAST_ERROR: RefCell<String> = const { RefCell::new(String::new()) };
}

/// Exact length in bytes of the last conversion's output. Only meaningful
/// immediately after a conversion that returned a non-zero id.
#[wasm_bindgen]
pub fn last_len() -> u32 {
    LAST_LEN.with(|len| len.get())
}

/// Why the last conversion returned 0. Empty when the last call succeeded.
#[wasm_bindgen]
pub fn last_error() -> String {
    LAST_ERROR.with(|error| error.borrow().clone())
}

fn fail(message: impl Into<String>) -> u32 {
    LAST_ERROR.with(|error| *error.borrow_mut() = message.into());
    LAST_LEN.with(|len| len.set(0));
    NULL_ID
}

fn succeed(bytes: Vec<u8>) -> u32 {
    LAST_ERROR.with(|error| error.borrow_mut().clear());
    let id = alloc_bytes(bytes.len() as u32);
    if id == NULL_ID {
        return fail("arena exhausted");
    }
    ARENA.with(|arena| {
        // Must be a mutable borrow all the way down. Taking a shared `&Vec<u64>`
        // and casting `as_ptr()` to `*mut u8` writes through a pointer derived
        // from a shared reference, which is undefined behaviour under Rust's
        // aliasing rules even though it happens to work today.
        let mut arena = arena.borrow_mut();
        if let Some(block) = arena.map.get_mut(&id) {
            let destination = unsafe {
                std::slice::from_raw_parts_mut(
                    block.as_mut_ptr() as *mut u8,
                    bytes.len(),
                )
            };
            destination.copy_from_slice(&bytes);
        }
    });
    LAST_LEN.with(|len| len.set(bytes.len() as u32));
    id
}

/// Read exactly `len` bytes out of the allocation, or `None` if the id is dead
/// or `len` exceeds what was actually reserved.
fn read_bytes(id: u32, len: u32) -> Option<Vec<u8>> {
    ARENA.with(|arena| {
        let arena = arena.borrow();
        let block = arena.map.get(&id)?;
        let capacity = block.len() * 8;
        if len as usize > capacity {
            return None;
        }
        // Read-only, so a shared borrow and `as_ptr()` are correct here; the
        // mutable counterpart in `succeed` must not copy this pattern.
        let source = unsafe {
            std::slice::from_raw_parts(block.as_ptr() as *const u8, len as usize)
        };
        Some(source.to_vec())
    })
}

/// JSON bytes in, MessagePack bytes out. Returns the new allocation id, or 0 on
/// failure with the reason available from [`last_error`].
///
/// Transcodes straight from the JSON reader into the MessagePack writer. Going
/// through `serde_json::Value` first was measurably worse: a million four-field
/// records meant roughly four million String allocations for a tree that gets
/// thrown away one statement later.
///
/// Map keys stay strings (`with_struct_map`) so the conversion is schema-less
/// and reversible — a compact struct encoding would need both ends to agree on
/// a schema, which a general-purpose store cannot assume.
#[wasm_bindgen]
pub fn json_to_msgpack(id: u32, len: u32) -> u32 {
    let Some(input) = read_bytes(id, len) else {
        return fail("unknown allocation id or length past capacity");
    };
    let mut deserializer = serde_json::Deserializer::from_slice(&input);
    // 输出通常比 JSON 小，按输入大小预留即可，基本不会再扩容
    let mut output = Vec::with_capacity(input.len());
    let mut serializer = rmp_serde::Serializer::new(&mut output).with_struct_map();
    match serde_transcode::transcode(&mut deserializer, &mut serializer) {
        Ok(()) => succeed(output),
        Err(error) => fail(format!("json to msgpack failed: {error}")),
    }
}

/// MessagePack bytes in, JSON bytes out.
#[wasm_bindgen]
pub fn msgpack_to_json(id: u32, len: u32) -> u32 {
    let Some(input) = read_bytes(id, len) else {
        return fail("unknown allocation id or length past capacity");
    };
    let mut deserializer = rmp_serde::Deserializer::new(input.as_slice());
    // JSON 比 MessagePack 冗长，预留两倍减少扩容次数
    let mut output = Vec::with_capacity(input.len() * 2);
    let mut serializer = serde_json::Serializer::new(&mut output);
    match serde_transcode::transcode(&mut deserializer, &mut serializer) {
        Ok(()) => succeed(output),
        Err(error) => fail(format!("msgpack to json failed: {error}")),
    }
}
