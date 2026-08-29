use std::{
    cell::RefCell,
    collections::HashMap,
    io::{self, Cursor, Write},
    ptr,
};

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
        Self {
            map: HashMap::new(),
            cursor: 1,
        }
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

/// Metadata returned by one conversion operation.
///
/// Keeping the output id, exact byte length, and error on the same value makes
/// each conversion self-contained. Re-entrant callers cannot observe a later
/// operation's result through global side channels.
#[wasm_bindgen]
pub struct ConversionResult {
    id: u32,
    len: u32,
    error: String,
}

#[wasm_bindgen]
impl ConversionResult {
    /// Allocation id containing the conversion output, or zero on failure.
    #[wasm_bindgen(getter)]
    pub fn id(&self) -> u32 {
        self.id
    }

    /// Exact output byte length; zero on failure.
    #[wasm_bindgen(getter)]
    pub fn len(&self) -> u32 {
        self.len
    }

    /// Empty on success, otherwise the operation-specific failure reason.
    #[wasm_bindgen(getter)]
    pub fn error(&self) -> String {
        self.error.clone()
    }
}

fn fail(message: impl Into<String>) -> ConversionResult {
    ConversionResult {
        id: NULL_ID,
        len: 0,
        error: message.into(),
    }
}

/// Initial output capacity; subsequent growth is owned by the same arena block.
const INITIAL_OUTPUT_BYTES: usize = 64;

/// A geometric writer that emits conversion bytes directly into an arena block.
/// The input and output remain borrowed only while the conversion transaction
/// owns the arena borrow; neither borrow escapes into the returned metadata.
struct ArenaWriter<'a> {
    arena: &'a mut Arena,
    id: u32,
    position: usize,
}

impl Write for ArenaWriter<'_> {
    /// Writes one serializer chunk, growing only the owned output block as needed.
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let required = self.position.checked_add(bytes.len()).ok_or_else(|| {
            io::Error::new(io::ErrorKind::WriteZero, "conversion output is too large")
        })?;
        let block = self
            .arena
            .map
            .get_mut(&self.id)
            .expect("conversion output allocation");
        let capacity = block.len().checked_mul(8).ok_or_else(|| {
            io::Error::new(io::ErrorKind::WriteZero, "conversion output is too large")
        })?;
        if required > capacity {
            let doubled = capacity.max(8).checked_mul(2).ok_or_else(|| {
                io::Error::new(io::ErrorKind::WriteZero, "conversion output is too large")
            })?;
            block.resize(doubled.max(required).div_ceil(8), 0);
        }
        let destination = unsafe {
            std::slice::from_raw_parts_mut(block.as_mut_ptr() as *mut u8, block.len() * 8)
        };
        // The serializer owns `bytes`, while this writer owns a disjoint arena
        // range. The copy completes before either borrow can leave this call.
        unsafe {
            ptr::copy_nonoverlapping(
                bytes.as_ptr(),
                destination.as_mut_ptr().add(self.position),
                bytes.len(),
            );
        }
        self.position += bytes.len();
        Ok(bytes.len())
    }

    /// The arena writer has no buffered state to flush.
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Allocates an output block while the caller already owns the arena borrow.
fn allocate_output(arena: &mut Arena, byte_len: usize) -> Option<u32> {
    let words = byte_len.div_ceil(8);
    let id = arena.fresh_id();
    if id == NULL_ID {
        return None;
    }
    arena.map.insert(id, vec![0u64; words]);
    Some(id)
}

/// Returns the input pointer and requested byte length without cloning input.
fn input_range(arena: &Arena, id: u32, len: u32) -> Option<(*const u8, usize)> {
    let block = arena.map.get(&id)?;
    let input_len = len as usize;
    if input_len > block.len() * 8 {
        return None;
    }
    Some((block.as_ptr() as *const u8, input_len))
}

/// Converts JSON to MessagePack while borrowing input and writing output in one arena transaction.
fn convert_json_to_msgpack(arena: &mut Arena, id: u32, len: u32) -> ConversionResult {
    let Some((input_ptr, input_len)) = input_range(arena, id, len) else {
        return fail("unknown allocation id or length past capacity");
    };
    let Some(output_id) = allocate_output(arena, INITIAL_OUTPUT_BYTES) else {
        return fail("arena exhausted");
    };
    let outcome = {
        // The source block remains heap-stable while the distinct output entry
        // is inserted into the map, so this operation-bound pointer is valid.
        let input = unsafe { std::slice::from_raw_parts(input_ptr, input_len) };
        let mut writer = ArenaWriter {
            arena,
            id: output_id,
            position: 0,
        };
        let mut deserializer = serde_json::Deserializer::from_slice(input);
        let mut serializer = rmp_serde::Serializer::new(&mut writer).with_struct_map();
        let result = serde_transcode::transcode(&mut deserializer, &mut serializer);
        drop(serializer);
        match result {
            Ok(()) => match deserializer.end() {
                Ok(()) => Ok(writer.position),
                Err(error) => Err(format!("json to msgpack failed: {error}")),
            },
            Err(error) => Err(format!("json to msgpack failed: {error}")),
        }
    };
    match outcome {
        Ok(output_len) => ConversionResult {
            id: output_id,
            len: output_len as u32,
            error: String::new(),
        },
        Err(error) => {
            arena.map.remove(&output_id);
            fail(error)
        }
    }
}

/// Converts MessagePack to JSON while borrowing input and writing output in one arena transaction.
fn convert_msgpack_to_json(arena: &mut Arena, id: u32, len: u32) -> ConversionResult {
    let Some((input_ptr, input_len)) = input_range(arena, id, len) else {
        return fail("unknown allocation id or length past capacity");
    };
    let Some(output_id) = allocate_output(arena, INITIAL_OUTPUT_BYTES) else {
        return fail("arena exhausted");
    };
    let outcome = {
        let input = unsafe { std::slice::from_raw_parts(input_ptr, input_len) };
        let mut writer = ArenaWriter {
            arena,
            id: output_id,
            position: 0,
        };
        let mut cursor = Cursor::new(input);
        let mut deserializer = rmp_serde::Deserializer::new(&mut cursor);
        let mut serializer = serde_json::Serializer::new(&mut writer);
        let result = serde_transcode::transcode(&mut deserializer, &mut serializer);
        drop(serializer);
        match result {
            Ok(()) if cursor.position() == input_len as u64 => Ok(writer.position),
            Ok(()) => Err("msgpack to json failed: trailing bytes".to_string()),
            Err(error) => Err(format!("msgpack to json failed: {error}")),
        }
    };
    match outcome {
        Ok(output_len) => ConversionResult {
            id: output_id,
            len: output_len as u32,
            error: String::new(),
        },
        Err(error) => {
            arena.map.remove(&output_id);
            fail(error)
        }
    }
}

/// JSON bytes in, MessagePack bytes out. Returns operation-bound output metadata.
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
pub fn json_to_msgpack(id: u32, len: u32) -> ConversionResult {
    ARENA.with(|arena| convert_json_to_msgpack(&mut arena.borrow_mut(), id, len))
}

/// MessagePack bytes in, JSON bytes out. Returns operation-bound output metadata.
#[wasm_bindgen]
pub fn msgpack_to_json(id: u32, len: u32) -> ConversionResult {
    ARENA.with(|arena| convert_msgpack_to_json(&mut arena.borrow_mut(), id, len))
}
