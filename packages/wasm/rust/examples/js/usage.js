// Usage example for the wasm arena allocator (target: web / wasm-pack).
//
// Build first:  make wasm   (outputs to ../morning-watch-web/src/wasm)
// then import from wherever wasm-pack wrote the package.

import init, {
  alloc_bytes,
  ptr_of,
  byte_len_of,
  dealloc_bytes,
  // wasm-pack `--target web` re-exports the linear memory as `memory`
  memory
} from './wasm/wasm_provider.js';

/**
 * Borrow an allocation as a Float64Array view over wasm linear memory.
 *
 * IMPORTANT: never cache this view. Any later `alloc_bytes` may grow wasm memory, which DETACHES
 * `memory.buffer` and makes every prior view throw on access. Re-create the view (call this again)
 * after each alloc. The pointer stays valid until `dealloc_bytes`; only the ArrayBuffer identity
 * changes.
 *
 * @param {number} id Allocation id from `alloc_bytes`
 * @returns {Float64Array} View of length `byte_len_of(id) / 8`
 */
function asF64(id) {
  const ptr = ptr_of(id);
  if (ptr === 0) throw new Error(`dead or unknown allocation id: ${id}`);
  const len = byte_len_of(id) / 8; // capacity in f64 slots
  // Legal only because `ptr` is guaranteed 8-byte aligned by the Rust side.
  return new Float64Array(memory.buffer, ptr, len);
}

async function main() {
  await init(); // load + instantiate the wasm module

  // Want a contiguous run of 5 f64s → 40 bytes.
  const n = 5;
  const id = alloc_bytes(n * 8);
  if (id === 0) throw new Error('allocation failed (id space exhausted)');

  // Write through the typed view.
  asF64(id).set([1.5, -2.0, 3.25, 4e10, Number.MIN_VALUE]);

  // Read back — re-fetch the view in case memory grew in between.
  console.log('values:', Array.from(asF64(id)));
  console.log('bytes backing id:', byte_len_of(id)); // 40

  // Always free when done.
  console.log('freed:', dealloc_bytes(id)); // true
  console.log('freed again:', dealloc_bytes(id)); // false — already gone
  console.log('ptr after free:', ptr_of(id)); // 0 — safe, no trap
}

main().catch(console.error);
