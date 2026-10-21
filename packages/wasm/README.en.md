# `@migaia/wasm`

[中文](./README.md)

`@migaia/wasm` provides aligned WASM byte storage and synchronous JSON–MessagePack conversion, with explicit ownership instead of passing JavaScript object graphs across the WASM boundary. MessagePack is a binary data format.

## Sound familiar?

- **A numeric view throws `RangeError`.** A byte allocator supplied an offset that was not aligned for `Float64Array` or `BigInt64Array`.
- **A reading disappears after a large allocation.** A typed-array view was cached across memory growth and now points to a detached buffer.
- **The second export overwrites the first result.** Output metadata was held in a shared last-result slot rather than attached to each operation.
- **An archive looks valid but loses its tail.** Parsing accepted the first document without checking that all non-whitespace input was consumed.
- **A background upload changes after cleanup.** The queue retained a view into freed WASM memory rather than a JavaScript-owned copy.

## Why choose it

- **Numeric views need no separate alignment layer.** Rust stores arena blocks as `Vec<u64>`, aligning addresses and rounding capacity to eight bytes; the [numeric readings example](./USEGUIDE.en.md#store-numeric-readings-without-guessing-alignment) constructs a `Float64Array` directly.
- **Interleaved conversions keep their own results.** Each call returns its own output ID, exact length and error; the [interleaving example](./USEGUIDE.en.md#retain-two-conversions-without-a-shared-last-result-slot) retains two results before reading either.
- **A broken concatenation fails explicitly.** The converters enforce one document rather than silently discarding a second; the [trailing document example](./USEGUIDE.en.md#reject-a-second-document-instead-of-silently-dropping-it) returns zero output with an operation-specific failure.
- **The boundary carries bytes throughout.** The JSON reader writes directly to the MessagePack writer without building a `serde_json::Value` tree first; the [interleaving example](./USEGUIDE.en.md#retain-two-conversions-without-a-shared-last-result-slot) passes JSON bytes to the converter and retains each operation’s own output. This explains the mechanism, without claiming a speed advantage over native JSON operations.

## Start here

Install the package, save this example as a `.ts` file, and run it with Node 24. It reads the bundled WASM file explicitly, so initialization does not depend on fetching a local file URL.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, dealloc_bytes } from '@migaia/wasm'

await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const id = alloc_bytes(9)
if (id === 0) throw new Error('allocation failed')
console.log('capacity:', byte_len_of(id))
console.log('release:', dealloc_bytes(id), dealloc_bytes(id))
```

Output:

```text
capacity: 16
release: true false
```

For numeric alignment, read [numeric readings](./USEGUIDE.en.md#store-numeric-readings-without-guessing-alignment); for conversion ownership, read [interleaved conversions](./USEGUIDE.en.md#retain-two-conversions-without-a-shared-last-result-slot).

## What hand-written code gets wrong

For illustration only; do not run. This manual allocator uses native WebAssembly memory for the byte allocation shown above.

```ts doc-test=check
const memory = new WebAssembly.Memory({ initial: 1 })
let cursor = 0
const allocate = (byteLen: number) => {
  const offset = cursor
  cursor += byteLen // Pitfall 1: neither the address nor capacity is aligned.
  return offset // Pitfall 2: no allocation ID or live record to detect repeated release.
}
allocate(1)
const offset = allocate(9)
const values = new Float64Array(memory.buffer, offset, 1)
memory.grow(1) // Pitfall 3: cached views detach even though offsets look unchanged.
console.log(values[0])
```

The numeric view above throws `RangeError` because its offset is misaligned. Even with alignment fixed, memory growth requires fresh views. The package uses Rust `Vec<u64>` for alignment and stable IDs for live allocations; the first release returns true and a repeated release returns false.

## The model in three minutes

| Your question                          | Tool                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------- |
| How do I obtain the module and memory? | Async init or synchronous `initSync`                                    |
| How do I store numbers or raw bytes?   | Allocate with `alloc_bytes` and locate the current buffer with `ptr_of` |
| How do I change archive format?        | `json_to_msgpack` or `msgpack_to_json`                                  |
| Who releases the allocations?          | `dealloc_bytes` for input/output IDs, free for result metadata          |

| Term               | Meaning                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| arena              | The module’s store for allocated bytes.                                                  |
| id                 | A stable allocation identifier; zero means no allocation.                                |
| pointer            | A byte offset into current linear memory, not an allocation identifier.                  |
| capacity           | Storage rounded to eight bytes, rather than document length.                             |
| `ConversionResult` | One conversion’s output ID, exact length and error; its metadata needs separate release. |

## Typical scenarios

| Scenario                                                 | Building blocks   | Details                                                                                       |
| -------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| Share one arena when two features start together         | `init`            | [Runnable example](./USEGUIDE.en.md#share-one-arena-when-two-features-start-together)         |
| Store numeric readings without guessing alignment        | `alloc_bytes`     | [Runnable example](./USEGUIDE.en.md#store-numeric-readings-without-guessing-alignment)        |
| Read the same allocation after memory grows              | `ptr_of`          | [Runnable example](./USEGUIDE.en.md#read-the-same-allocation-after-memory-grows)              |
| Keep a JavaScript copy after releasing WASM bytes        | `dealloc_bytes`   | [Runnable example](./USEGUIDE.en.md#keep-a-javascript-copy-after-releasing-wasm-bytes)        |
| Retain two conversions without a shared last-result slot | `json_to_msgpack` | [Runnable example](./USEGUIDE.en.md#retain-two-conversions-without-a-shared-last-result-slot) |
| Reject a second document instead of silently dropping it | `json_to_msgpack` | [Runnable example](./USEGUIDE.en.md#reject-a-second-document-instead-of-silently-dropping-it) |
| Decode only the received MessagePack bytes               | `msgpack_to_json` | [Runnable example](./USEGUIDE.en.md#decode-only-the-received-messagepack-bytes)               |

## Install

```bash
pnpm add @migaia/wasm
```

The package includes the generated ES module and `.wasm` asset. In a browser with asset loading configured, `await init()` loads that bundled asset. Node hosts should pass bytes or a precompiled `WebAssembly.Module`, as above.

## Essential API

| API                 | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `init()`            | Loads the module asynchronously and returns shared memory. |
| `initSync()`        | Initializes synchronously from bytes or a compiled module. |
| `alloc_bytes()`     | Owns an aligned, zeroed byte allocation.                   |
| `dealloc_bytes()`   | Releases an input or successful output arena allocation.   |
| `json_to_msgpack()` | Converts a complete JSON document to MessagePack.          |
| `msgpack_to_json()` | Converts exact-length MessagePack bytes to JSON.           |

## Contract details

An arena is the module's byte store. `alloc_bytes(byte_len)` returns a stable nonzero allocation ID, or `0` on memory or identifier exhaustion. `ptr_of(id)` returns its byte offset; `byte_len_of(id)` returns capacity rounded up to eight bytes. Unknown or released IDs return `0` from both queries. `dealloc_bytes(id)` returns whether it removed a live block. Every successful allocation, including a zero-length allocation, needs explicit release.

`json_to_msgpack(id, len)` and `msgpack_to_json(id, len)` return a separate `ConversionResult` for each call. On success it holds a new output `id`, exact output `len` and empty `error`. On failure `id` and `len` are zero and `error` explains this operation's failure. Conversion never releases the input. Release input and successful output IDs with `dealloc_bytes`; separately call `result.free()` for metadata on both success and failure. `free()` does not release the output arena block.

The converters consume one complete document. JSON permits trailing whitespace; MessagePack must consume exactly the supplied length. Use the exact payload length, never rounded capacity. JSON object keys remain strings. JSON objects serialize directly as maps, independently of struct-map configuration. Roundtrip preservation is limited to the JSON data model and representable numbers; arbitrary MessagePack bin/ext values, non-JSON map keys and integers outside JSON's numeric range may change or be rejected.

Pointers stay stable until release, but memory growth replaces `memory.buffer`. Construct each view from the current buffer immediately before use. `.slice()` creates a JavaScript-owned copy that survives arena release. A zero-copy view requires its allocation to stay live until the last read. `@migaia/store-wasm` adds field ownership and a `FinalizationRegistry` fallback; it does not replace deterministic disposal or duplicate this arena.

The first completed initialization publishes the module exports. Concurrent calls and named wrappers use that same memory and arena; concurrent instantiation may still happen, and Promise identity or a single compilation is not guaranteed. Native `WebAssembly.CompileError`, `LinkError` and `RuntimeError` cross unchanged, without package `source` or `code`. Conversion failures are returned values rather than those native exceptions.

### Build and verify

```bash
pnpm run build
pnpm run test
pnpm run test:rust
pnpm run typecheck
```

After editing Rust, `build` runs `wasm-pack build --target web --release --out-dir ../src` from `rust/`, then runs `scripts/finalize-glue.ts` to preserve the first published exports. Do not hand-edit generated glue, declarations or WASM bytes. Release verification includes two deterministic builds, a real nonzero WASM host, and packed installation/import/instantiation. `test` runs the WASM Rust host tests and the JS initialization regression; `test:rust` runs native Rust tests.
