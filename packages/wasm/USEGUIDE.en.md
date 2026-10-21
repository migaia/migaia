# `@migaia/wasm` usage guide

[中文](./USEGUIDE.md)

Start with the [README](./README.en.md) for package selection. Every example below runs as a standalone `.ts` file with Node 24 after package installation. Each reads the packaged WASM bytes explicitly.

## Find your scenario

| Problem                                                  | API               | Read                                                                                                                  |
| -------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Share one arena when two features start together         | `init`            | [Share one arena when two features start together](#share-one-arena-when-two-features-start-together)                 |
| Store numeric readings without guessing alignment        | `alloc_bytes`     | [Store numeric readings without guessing alignment](#store-numeric-readings-without-guessing-alignment)               |
| Read the same allocation after memory grows              | `ptr_of`          | [Read the same allocation after memory grows](#read-the-same-allocation-after-memory-grows)                           |
| Keep a JavaScript copy after releasing WASM bytes        | `dealloc_bytes`   | [Keep a JavaScript copy after releasing WASM bytes](#keep-a-javascript-copy-after-releasing-wasm-bytes)               |
| Retain two conversions without a shared last-result slot | `json_to_msgpack` | [Retain two conversions without a shared last-result slot](#retain-two-conversions-without-a-shared-last-result-slot) |
| Reject a second document instead of silently dropping it | `json_to_msgpack` | [Reject a second document instead of silently dropping it](#reject-a-second-document-instead-of-silently-dropping-it) |
| Decode only the received MessagePack bytes               | `msgpack_to_json` | [Decode only the received MessagePack bytes](#decode-only-the-received-messagepack-bytes)                             |

## Share one arena when two features start together

Two features can initialize the module at the same time. Publishing the last instance would make one feature hold memory that the named wrappers no longer use. The initializer keeps the first completed exports, and every completed call returns that object. This does not promise one compilation or identical Promises.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, dealloc_bytes } from '@migaia/wasm'

const bytes = await readFile(
  new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
)
const [first, second] = await Promise.all([
  init({ module_or_path: bytes }),
  init({ module_or_path: bytes })
])
const id = alloc_bytes(8)
if (id === 0) throw new Error('allocation failed')
try {
  console.log('same exports:', first === second)
  console.log('same allocation:', first.byte_len_of(id) === byte_len_of(id))
} finally {
  dealloc_bytes(id)
}
```

Output:

```text
same exports: true
same allocation: true
```

Prints `same exports: true` and `same allocation: true`. Both initialization results and the named allocator address the same published arena.

## Store numeric readings without guessing alignment

A byte offset that works for a byte array may throw RangeError when reused for Float64Array. Hand-written allocators must align the address and round capacity separately. alloc_bytes does both: a request for 9 bytes owns 16 zeroed bytes at an eight-byte-aligned address.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, ptr_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const id = alloc_bytes(9)
if (id === 0) throw new Error('allocation failed')
try {
  const values = new Float64Array(wasm.memory.buffer, ptr_of(id), 2)
  values.set([21.5, 23])
  console.log('capacity:', byte_len_of(id))
  console.log('alignment remainder:', ptr_of(id) % 8)
  console.log('readings:', values[0], values[1])
} finally {
  dealloc_bytes(id)
}
```

Output:

```text
capacity: 16
alignment remainder: 0
readings: 21.5 23
```

Prints capacity 16, alignment remainder 0 and readings 21.5 23. The rounded allocation can hold two Float64 values, and the pointer satisfies the native typed-array alignment requirement.

## Read the same allocation after memory grows

A cached typed-array view can become detached after another allocation grows WebAssembly memory. A stable pointer does not keep its old ArrayBuffer alive. Keep the arena ID, query ptr_of, and create the view from the current memory.buffer immediately before reading.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const id = alloc_bytes(8)
if (id === 0) throw new Error('allocation failed')
try {
  const offset = ptr_of(id)
  const previous = new Float64Array(wasm.memory.buffer, offset, 1)
  previous[0] = 42
  wasm.memory.grow(1)
  const current = new Float64Array(wasm.memory.buffer, ptr_of(id), 1)
  console.log('same offset:', ptr_of(id) === offset)
  console.log('old view bytes:', previous.byteLength)
  console.log('current reading:', current[0])
} finally {
  dealloc_bytes(id)
}
```

Output:

```text
same offset: true
old view bytes: 0
current reading: 42
```

Prints `same offset: true`, `old view bytes: 0` and `current reading: 42`. The live arena allocation stays at its offset while memory growth detaches the old non-shared buffer.

## Keep a JavaScript copy after releasing WASM bytes

An upload queue may outlive the conversion that produced its bytes. Keeping a view into a released arena block lets later allocations overwrite queued data. Copy the bytes before dealloc_bytes. A second release returns false and never frees a different live block.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, byte_len_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const id = alloc_bytes(3)
if (id === 0) throw new Error('allocation failed')
try {
  const view = new Uint8Array(wasm.memory.buffer, ptr_of(id), 3)
  view.set([1, 2, 3])
  const ownedCopy = view.slice()
  console.log('release:', dealloc_bytes(id), dealloc_bytes(id))
  console.log('copy:', ownedCopy.join(','))
  console.log('released queries:', ptr_of(id), byte_len_of(id))
} finally {
  dealloc_bytes(id)
}
```

Output:

```text
release: true false
copy: 1,2,3
released queries: 0 0
```

Prints `release: true false`, `copy: 1,2,3` and `released queries: 0 0`. The JavaScript copy survives; the released ID is no longer readable through the arena queries.

## Retain two conversions without a shared last-result slot

A batch exporter may start another conversion before reading the first result. A global last-result slot makes the first output easy to confuse with the second. Each json_to_msgpack call returns its own output ID, exact length and error, so retaining both result objects keeps both operations distinct.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, {
  alloc_bytes,
  ptr_of,
  dealloc_bytes,
  json_to_msgpack,
  type ConversionResult
} from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const inputs: number[] = []
const results: ConversionResult[] = []
try {
  for (const json of ['{"first":true}', '{"second":true}']) {
    const bytes = new TextEncoder().encode(json)
    const id = alloc_bytes(bytes.length)
    if (id === 0) throw new Error('allocation failed')
    inputs.push(id)
    new Uint8Array(wasm.memory.buffer, ptr_of(id), bytes.length).set(bytes)
    results.push(json_to_msgpack(id, bytes.length))
  }
  console.log(
    'both succeeded:',
    results.every((result) => result.id !== 0 && result.error === '')
  )
  console.log('separate outputs:', results[0].id !== results[1].id)
  console.log('first result retained:', results[0].len > 0)
} finally {
  for (const result of results) {
    if (result.id !== 0) dealloc_bytes(result.id)
    result.free()
  }
  for (const id of inputs) dealloc_bytes(id)
}
```

Output:

```text
both succeeded: true
separate outputs: true
first result retained: true
```

All three lines end in true. The second call leaves the first result intact. The finally block releases successful output IDs, both input IDs and both metadata objects independently.

## Reject a second document instead of silently dropping it

A concatenated export can contain two JSON documents by mistake. Parsing only the first would report success while losing the second. json_to_msgpack requires one complete document and reports a failed result for trailing non-whitespace bytes; the input remains owned by the caller.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, dealloc_bytes, json_to_msgpack } from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const bytes = new TextEncoder().encode('{}{}')
const id = alloc_bytes(bytes.length)
if (id === 0) throw new Error('allocation failed')
try {
  new Uint8Array(wasm.memory.buffer, ptr_of(id), bytes.length).set(bytes)
  const result = json_to_msgpack(id, bytes.length)
  try {
    console.log('output allocation:', result.id, 'bytes:', result.len)
    console.log('second document rejected:', result.error.startsWith('json to msgpack failed:'))
    console.log('input still owned:', ptr_of(id) !== 0)
    if (result.id !== 0) dealloc_bytes(result.id)
  } finally {
    result.free()
  }
} finally {
  dealloc_bytes(id)
}
```

Output:

```text
output allocation: 0 bytes: 0
second document rejected: true
input still owned: true
```

Prints output allocation 0 and length 0, followed by two true values. No failed output allocation survives; the caller still frees the input and the failure metadata.

## Decode only the received MessagePack bytes

A five-byte message can occupy an eight-byte arena block. Passing capacity as document length feeds padding to the decoder and turns valid input into a trailing-bytes failure. Pass the received byte length to msgpack_to_json and read exactly result.len bytes from its output.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, {
  alloc_bytes,
  byte_len_of,
  ptr_of,
  dealloc_bytes,
  msgpack_to_json
} from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const packed = new Uint8Array([0x81, 0xa2, 0x6f, 0x6b, 0xc3])
const id = alloc_bytes(packed.length)
if (id === 0) throw new Error('allocation failed')
try {
  new Uint8Array(wasm.memory.buffer, ptr_of(id), packed.length).set(packed)
  const result = msgpack_to_json(id, packed.length)
  try {
    if (result.id === 0) throw new Error(result.error)
    const json = new Uint8Array(wasm.memory.buffer, ptr_of(result.id), result.len).slice()
    console.log('document:', new TextDecoder().decode(json))
    console.log('input bytes:', packed.length, 'capacity:', byte_len_of(id))
  } finally {
    if (result.id !== 0) dealloc_bytes(result.id)
    result.free()
  }
} finally {
  dealloc_bytes(id)
}
```

Output:

```text
document: {"ok":true}
input bytes: 5 capacity: 8
```

Prints `document: {"ok":true}` and `input bytes: 5 capacity: 8`. Document length and rounded arena capacity are different, and the conversion uses only the supplied document bytes.

## Initialization and parameters

Import the default initializer as `init`. `init({ module_or_path })` accepts a request string, `Request`, `URL`, `Response`, `BufferSource` or precompiled `WebAssembly.Module`, including a Promise of that input. Omitting the argument selects the packaged `wasm_provider_bg.wasm` URL. Request strings, requests and URLs use `fetch`; byte and module inputs instantiate directly. The Node examples read the resource beside the resolved package entry and pass its bytes. Loading failures reject the Promise.

`initSync({ module })` accepts bytes or a precompiled `WebAssembly.Module` and never fetches. `module` is required. Both initializers return the already published exports when initialized. The positional forms remain accepted but emit a deprecation warning; use the object forms.

`InitOutput.memory` is native `WebAssembly.Memory`. Its other functions are the raw generated ABI: notably, its conversion functions return numeric metadata pointers and its release function returns a numeric boolean. Application code should use the named imported wrappers to receive `ConversionResult` and boolean results. Do not pass an arena ID as a raw metadata pointer.

| Parameter             | Meaning                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `byte_len`            | Requested byte count, a nonnegative unsigned 32-bit integer. Capacity rounds upward to a multiple of eight. Zero-length allocations still return an owned ID on success. |
| `id`                  | A live ID returned by `alloc_bytes` or a successful `ConversionResult.id` in this initialized module. Zero is reserved, not an allocation. Never substitute a pointer.   |
| `len`                 | Exact count of document bytes written to the input, no greater than `byte_len_of(id)`. It is not rounded capacity.                                                       |
| `init.module_or_path` | Optional module source described above. The omitted argument defaults to the bundled WASM URL; supplied bytes work without network fetching.                             |
| `initSync.module`     | Required bytes or precompiled module. No network-capable source and no default.                                                                                          |

## Arena and conversion ownership

Rust owns one arena backed by `Vec<u64>`. The allocation ID remains stable and is not reused while live. A pointer remains valid until its ID is released. A view must be recreated from the current `memory.buffer` after any call that may allocate or grow memory.

`alloc_bytes` returns `0` on memory or identifier exhaustion. Unknown and released IDs return `0` from `ptr_of` and `byte_len_of`; `dealloc_bytes` returns `false`. A live zero-length allocation also has capacity zero, so capacity alone does not identify a live allocation.

Both converters are synchronous and byte-in/byte-out. Success returns `{ id: nonzero, len: exactBytes, error: '' }`; failure returns `{ id: 0, len: 0, error: reason }`. Each call has independent metadata. Both the input ID and successful output ID belong to the caller. Release each with `dealloc_bytes`. Every returned metadata object, including a failure, separately needs `free()` or `[Symbol.dispose]()`. Read required fields before releasing metadata; never read or free that metadata again. Releasing metadata does not release arena bytes, and releasing arena bytes does not release metadata.

Conversion rejects unknown IDs, lengths beyond capacity, empty documents, malformed data and a trailing second document. JSON allows trailing whitespace. MessagePack must consume exactly the supplied length. Failure leaves no output block and preserves the caller's input allocation and bytes. The JSON reader transcodes directly to the MessagePack writer without an intermediate `serde_json::Value` tree; map keys remain strings. JSON objects serialize directly as maps, independently of struct-map configuration.

JSON roundtrips cover the JSON data model and representable numbers. Arbitrary MessagePack bin/ext values, non-JSON map keys and out-of-range integers are not guaranteed reversible; they may be rewritten or rejected.

## Failures and recovery

A failed conversion carries text in its own `error` property, not a global error slot. Invalid IDs and oversized lengths return `unknown allocation id or length past capacity`; output allocation exhaustion returns `arena exhausted`. Parsing errors begin with `json to msgpack failed:` or `msgpack to json failed:`. Check `id` before reading an output, retain the exact error for diagnostics, and always free failure metadata and the input.

Native `WebAssembly.CompileError`, `WebAssembly.LinkError` and `WebAssembly.RuntimeError` pass through unchanged, retaining their type, identity and stack without package `source` or `code`. They are separate from a normal conversion failure result. The package defines no custom error codes.

## Using store-wasm

`@migaia/wasm` owns arena storage and transcoding. `@migaia/store-wasm` owns field allocations, numeric views and field lifetimes; it does not copy the arena or conversion state machine. Its field owner reuses one initialization Promise through `ensureWasm()`, releases allocations on explicit disposal, and rolls back already-created resources before surfacing a construction failure with the original error preserved. Record fields accept numbers and use `DataView` over the current `memory.buffer`. Its `FinalizationRegistry` is a fallback, not a replacement for explicit disposal.

## Build and verification

```bash
pnpm run build
pnpm run test
pnpm run test:rust
pnpm run typecheck
```

`build` runs wasm-pack from `rust/`, regenerates `src/wasm_provider.js`, declarations and `.wasm`, then runs `scripts/finalize-glue.ts` to preserve the first published exports. Do not hand-edit generated output. Verification also includes a real nonzero WASM host, byte comparison of two deterministic builds, and packed installation/import/instantiation. Consumers such as `@migaia/store-wasm` run their own format, lint, type and runtime gates against the real WASM package.
