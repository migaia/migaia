use std::{
    alloc::{self, Layout},
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

/// Allocates a zeroed block of `words` u64 words without aborting on OOM.
///
/// Mirrors `vec![0u64; words]` (including its zeroed-allocation fast path) but
/// returns `None` instead of calling `handle_alloc_error`. On wasm32 that
/// handler traps while the caller holds the `ARENA` borrow; the `RefCell` flag
/// is never reset, so every later export traps too and the module is lost.
fn try_zeroed_block(words: usize) -> Option<Block> {
    if words == 0 {
        return Some(Block::new());
    }
    let layout = Layout::array::<u64>(words).ok()?;
    // SAFETY: `layout` has a non-zero size because `words > 0`.
    let data = unsafe { alloc::alloc_zeroed(layout) }.cast::<u64>();
    if data.is_null() {
        return None;
    }
    // SAFETY: `data` comes from the global allocator with the exact layout of
    // a `Vec<u64>` of capacity `words`, and every word is initialised to zero.
    Some(unsafe { Vec::from_raw_parts(data, words, words) })
}

/// Inserts a zeroed `words`-sized block under a fresh id.
///
/// Every allocation on this path is fallible, so exhaustion of linear memory
/// or of the id space returns `None` and leaves the arena usable.
fn insert_zeroed_block(arena: &mut Arena, words: usize) -> Option<u32> {
    let block = try_zeroed_block(words)?;
    arena.map.try_reserve(1).ok()?;
    let id = arena.fresh_id();
    if id == NULL_ID {
        return None;
    }
    arena.map.insert(id, block);
    Some(id)
}

/// Allocates zeroed WASM memory for bytes or aligned numeric typed-array views.
///
/// Call after module initialization. `byte_len` is the requested byte count;
/// capacity rounds up to a multiple of eight. A zero-byte request still returns
/// a live id with zero capacity. The returned nonzero id belongs to the caller
/// and must be released with `dealloc_bytes(id)`.
///
/// Returns `0` if the allocation size, available linear memory, or id space
/// prevents allocation. The pointer returned by `ptr_of(id)` stays fixed until
/// release, but memory growth can detach an existing JavaScript view. Create
/// views from the current `memory.buffer` after any allocation or conversion.
#[wasm_bindgen]
pub fn alloc_bytes(byte_len: u32) -> u32 {
    // round up to whole u64 words so the whole requested range is backed
    let words = (byte_len as usize).div_ceil(8);

    ARENA.with(|arena| insert_zeroed_block(&mut arena.borrow_mut(), words).unwrap_or(NULL_ID))
}

/// Returns the eight-byte-aligned byte offset of a live allocation.
///
/// Use with the initialized module's current `memory.buffer` to create a byte
/// or numeric typed-array view. The offset stays fixed until `dealloc_bytes(id)`;
/// the view must be recreated if WASM memory grows. Reading the pointer does not
/// transfer ownership or keep the allocation alive.
///
/// Unknown ids, released ids, and the reserved id `0` return `0` without a trap.
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

/// Returns an allocation's byte capacity, rounded up to a multiple of eight.
///
/// Use to size a numeric view or check available storage. Capacity includes
/// alignment padding; it is not the document length passed to a converter.
/// Read `ConversionResult.len` for the exact length of converted output.
///
/// Unknown ids, released ids, and the reserved id `0` return `0`. A live
/// zero-byte allocation also has zero capacity, so this is not an existence test.
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

/// Releases one caller-owned arena allocation and reports whether it existed.
///
/// Call when the input or converted output is no longer needed. Returns `true`
/// only for a live id; unknown ids, repeated release, and id `0` return `false`.
/// Any pointer or view into the released allocation must no longer be used.
/// This does not release a `ConversionResult` wrapper; call its `free()` separately.
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

/// Owns the metadata returned by one JSON or MessagePack conversion.
///
/// Read `id`, `len`, and `error` together: success has a nonzero output id, exact
/// output length, and an empty error; failure has id `0`, length `0`, and a reason.
/// Each result is independent, so later conversions do not overwrite its fields.
///
/// JavaScript callers release every result, including failed results, once with
/// `free()` or `Symbol.dispose`. Do not read its properties after release. Result
/// disposal does not release the input or output arena allocation; their owner
/// must call `dealloc_bytes(id)` separately.
#[wasm_bindgen]
pub struct ConversionResult {
    id: u32,
    len: u32,
    error: String,
}

#[wasm_bindgen]
impl ConversionResult {
    /// Returns the new output allocation id, or `0` when conversion failed.
    ///
    /// A nonzero id belongs to the caller and remains live after this result's
    /// `free()`. Read the exact output range with `len` and release the allocation
    /// with `dealloc_bytes(id)` when finished. The input id is never consumed.
    #[wasm_bindgen(getter)]
    pub fn id(&self) -> u32 {
        self.id
    }

    /// Returns the exact number of output bytes, or `0` on failure.
    ///
    /// Use this length when reading output or passing it to another converter.
    /// `byte_len_of(id)` includes arena padding and can exceed this value.
    #[wasm_bindgen(getter)]
    #[allow(
        clippy::len_without_is_empty,
        reason = "Operation byte metadata is not a collection API"
    )]
    pub fn len(&self) -> u32 {
        self.len
    }

    /// Returns an empty string on success or the current operation's failure reason.
    ///
    /// Invalid handles and lengths report `unknown allocation id or length past
    /// capacity`. Initial output allocation failure reports `arena exhausted`.
    /// Parse and write failures start with `json to msgpack failed:` or
    /// `msgpack to json failed:`.
    /// Read before freeing this metadata wrapper; no global error lookup is needed.
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
            let words = doubled.max(required).div_ceil(8);
            // Fallible growth: an aborting `resize` would trap inside the arena
            // borrow, so OOM fails this conversion through `io::Error` instead.
            block.try_reserve_exact(words - block.len()).map_err(|_| {
                io::Error::new(
                    io::ErrorKind::OutOfMemory,
                    "conversion output allocation failed",
                )
            })?;
            block.resize(words, 0);
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
    insert_zeroed_block(arena, byte_len.div_ceil(8))
}

/// Temporarily owns the input while reserving its handle in the arena.
///
/// The placeholder prevents a wrapping cursor from reusing the input id for output.
/// Conversion borrows bytes from this independent block, so map growth and output
/// resizing cannot invalidate that borrow. Every normal success/failure restores it.
fn with_input(
    arena: &mut Arena,
    id: u32,
    len: u32,
    convert: impl FnOnce(&mut Arena, &[u8]) -> ConversionResult,
) -> ConversionResult {
    let Some(block) = arena.map.get_mut(&id) else {
        return fail("unknown allocation id or length past capacity");
    };
    if len as usize > block.len() * 8 {
        return fail("unknown allocation id or length past capacity");
    }
    let input = std::mem::take(block);
    // SAFETY: input owns the aligned initialized allocation independently of arena;
    // len was checked before taking it, and convert cannot access this local owner.
    let bytes = unsafe { std::slice::from_raw_parts(input.as_ptr().cast::<u8>(), len as usize) };
    let result = convert(arena, bytes);
    *arena.map.get_mut(&id).expect("reserved conversion input") = input;
    result
}

/// Converts JSON to MessagePack while borrowing input and writing output in one arena transaction.
fn convert_json_to_msgpack(arena: &mut Arena, input: &[u8]) -> ConversionResult {
    let Some(output_id) = allocate_output(arena, INITIAL_OUTPUT_BYTES) else {
        return fail("arena exhausted");
    };
    let outcome = {
        let mut writer = ArenaWriter {
            arena,
            id: output_id,
            position: 0,
        };
        let mut deserializer = serde_json::Deserializer::from_slice(input);
        let result = {
            let mut serializer = rmp_serde::Serializer::new(&mut writer);
            serde_transcode::transcode(&mut deserializer, &mut serializer)
        };
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
fn convert_msgpack_to_json(arena: &mut Arena, input: &[u8]) -> ConversionResult {
    let Some(output_id) = allocate_output(arena, INITIAL_OUTPUT_BYTES) else {
        return fail("arena exhausted");
    };
    let outcome = {
        let mut writer = ArenaWriter {
            arena,
            id: output_id,
            position: 0,
        };
        let mut cursor = Cursor::new(input);
        let mut deserializer = rmp_serde::Deserializer::new(&mut cursor);
        let result = {
            let mut serializer = serde_json::Serializer::new(&mut writer);
            serde_transcode::transcode(&mut deserializer, &mut serializer)
        };
        match result {
            Ok(()) if cursor.position() == input.len() as u64 => Ok(writer.position),
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

/// Converts one UTF-8 JSON document into a new MessagePack arena allocation.
///
/// Call after initialization when JSON bytes are already stored under live `id`.
/// `len` is the exact input byte count, excluding unused arena capacity. The
/// reader writes directly to the MessagePack writer without building a JSON
/// value tree. Object keys remain strings without a schema.
///
/// Success returns an independent `ConversionResult` with the output id, exact
/// byte length, and empty error. Invalid ids, lengths beyond capacity, empty or
/// malformed JSON, and a trailing second document return id `0`, length `0`, and
/// an error reason. Whitespace after the JSON document is accepted.
///
/// Input bytes and ownership are preserved on success and ordinary failure.
/// Release input and successful output ids with `dealloc_bytes`; release the
/// result metadata with `free()` even on failure. A native WASM trap still throws.
/// Roundtrip preservation covers the JSON data model and representable numbers,
/// not arbitrary MessagePack bin/ext values, map keys, or integer ranges.
#[wasm_bindgen]
pub fn json_to_msgpack(id: u32, len: u32) -> ConversionResult {
    ARENA.with(|arena| with_input(&mut arena.borrow_mut(), id, len, convert_json_to_msgpack))
}

/// Converts one complete MessagePack document into a new UTF-8 JSON allocation.
///
/// Call after initialization with live input `id` and its exact byte count `len`.
/// Use a previous conversion's `len`, not `byte_len_of(id)`, because arena padding
/// counts as trailing input. The converter must consume every input byte.
///
/// Success returns an independent `ConversionResult` with a nonzero output id,
/// exact output length, and empty error. Unknown ids, excessive lengths, empty
/// or malformed MessagePack, values JSON cannot represent, and trailing bytes return
/// id `0`, length `0`, and an error reason. A native WASM trap still throws.
///
/// Input bytes and ownership survive success and ordinary failure. Release input
/// and successful output ids with `dealloc_bytes`, and release every result with
/// `free()`. Arbitrary bin/ext values, non-JSON map keys, and out-of-range integers
/// are not guaranteed a reversible JSON representation.
#[wasm_bindgen]
pub fn msgpack_to_json(id: u32, len: u32) -> ConversionResult {
    ARENA.with(|arena| with_input(&mut arena.borrow_mut(), id, len, convert_msgpack_to_json))
}
