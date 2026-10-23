# `@migaia/store-wasm` usage guide

Each independent example loads the real published WASM and uses createStore as the field owner. Choose a task, then consult the capacity, notification, disposal, and native-error contracts.

## Find a scenario

| Scenario                                                   | API          | Details                                                                         |
| ---------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| Share one readiness Promise before creating fields         | `ensureWasm` | [Complete example](#share-one-readiness-promise-before-creating-fields)         |
| Keep a numeric field usable after native memory grows      | `number`     | [Complete example](#keep-a-numeric-field-usable-after-native-memory-grows)      |
| Reject a UTF-8 overflow without truncating the old value   | `string`     | [Complete example](#reject-a-utf-8-overflow-without-truncating-the-old-value)   |
| Track one array index and keep copied views isolated       | `array`      | [Complete example](#track-one-array-index-and-keep-copied-views-isolated)       |
| Reject unreadable range input before changing array bytes  | `array`      | [Complete example](#reject-unreadable-range-input-before-changing-array-bytes)  |
| Observe one named coordinate without tracking its siblings | `record`     | [Complete example](#observe-one-named-coordinate-without-tracking-its-siblings) |

## Running the examples

```bash
pnpm add @migaia/store-wasm @migaia/store-light @migaia/wasm @migaia/reactive
```

Examples are standalone Node TypeScript files importing the listed packages directly. readFile loads sibling wasm_provider_bg.wasm relative to @migaia/wasm's main entry; initWasm.module_or_path receives those bytes. Omission uses the default resource URL, whose file URL is unsuitable for Node fetch; the underlying loader also accepts Promise input. ensureWasm itself takes no arguments. Stores and observers are explicitly released, without fake WASM or field contexts.

## Share one readiness Promise before creating fields

Several startup paths need WASM fields and may ask for readiness at the same time.

Starting a new initialization Promise on every read can give each caller a different readiness token, even after loading succeeds.

Initialize the native module from its published file in Node, then call ensureWasm() without arguments; it keeps one Promise while pending and after success.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm } from '@migaia/store-wasm'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
const first = ensureWasm()
const second = ensureWasm()
console.log(first === second)
const memory = await first
console.log(memory instanceof WebAssembly.Memory)
console.log(first === ensureWasm())
```

Output:

```text
true
true
true
```

The output is true, true, true on separate lines: both pending calls match, the resolved value is native memory, and the settled call still matches.

The Promise establishes readiness and does not allocate fields or transfer memory ownership. Failure clears its attempt cache; synchronous field creation must still wait for a successful call.

### Example parameters

ensureWasm takes no arguments, allocates no fields, and returns the shared `Promise<WebAssembly.Memory>` while pending and after success. url selects the published file relative to its entry; initWasm.module_or_path receives readFile's Uint8Array bytes. The WebAssembly.Memory check verifies native memory without transferring its entire lifetime.

## Keep a numeric field usable after native memory grows

Other WASM allocations can grow linear memory while an existing numeric field remains in use.

A DataView kept against the old buffer becomes detached, so hand-written readers and writers can fail after growth.

Put number() in createStore after readiness; the field refreshes its view of current memory and the Store owns its cleanup.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm, number } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
const memory = await ensureWasm()
const store = createStore({ score: number() })
const field = store.score
try {
  console.log(field.value)
  field.value = 12.5
  const before = memory.buffer
  memory.grow(1)
  console.log(memory.buffer !== before, field.value)
  field.value = 19
  console.log(field.value)
} finally {
  await store.$dispose()
}
console.log(field.disposed)
try {
  console.log(field.value)
} catch (error) {
  console.log((error as { code?: string }).code)
}
```

Output:

```text
0
true 12.5
19
true
FIELD_DISPOSED
```

The lines are 0, true 12.5, 19, true, FIELD_DISPOSED: the buffer changes while the stored value survives, later writes work, and Store disposal closes the retained field.

A numeric field starts at 0 and uses f64 storage. This demonstrates ordinary memory growth, not recovery from a native trap; a poisoned shared instance requires restarting its owner.

### Example parameters

number takes no arguments and starts at zero, with f64 reads/writes through .value. createStore's score is a builder declaration owned by that Store. memory.grow(1) grows one WASM page; the field uses the new buffer at its original allocation offset. The retained field then demonstrates disposed state and access failure after Store.$dispose.

## Reject a UTF-8 overflow without truncating the old value

A label fits a character limit but exceeds its fixed byte budget once encoded for WASM storage.

Counting characters underestimates multibyte text, while truncating encoded bytes can split a character and silently replace valid data.

Use string(6) for a six-byte capacity, overriding the default 256; an oversized assignment fails before the field commits any replacement.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm, string } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
await ensureWasm()
const store = createStore({ title: string(6) })
try {
  store.title.value = 'ééé'
  console.log(store.title.value, new TextEncoder().encode(store.title.value).length)
  try {
    store.title.value = 'éééé'
  } catch (error) {
    console.log((error as { code?: string }).code)
  }
  console.log(store.title.value)
} finally {
  await store.$dispose()
}
```

Output:

```text
ééé 6
INVALID_OPTION
ééé
```

The output is ééé 6, INVALID_OPTION, then ééé: three accented characters consume six bytes and the longer assignment leaves that value intact.

Capacity counts TextEncoder UTF-8 bytes and stays fixed. Overflow neither truncates nor grows the field; choose a larger capacity when longer values are part of the input contract.

### Example parameters

string maxBytes defaults to 256 and is overridden with 6, a safe integer within the supported range. TextEncoder measures assignment by UTF-8 bytes rather than characters. readFile/initWasm follows the preparation above. Store cleanup releases the field, and overflow preserves its prior contents.

## Track one array index and keep copied views isolated

A view reads only one sample, but updates elsewhere in a large numeric array keep invalidating that reader.

Sharing one notification bucket across many indices makes unrelated readers rerun, and exposing writable native memory would bypass tracked writes.

Use array(3, 1) to give each index its own bucket instead of the default 64; write through setAt and use view only for an independent copy.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm, array } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'
import { createRuntime } from '@migaia/reactive'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
await ensureWasm()
const runtime = createRuntime()
const store = createStore({ samples: array(3, 1) }, { runtime })
const seen: number[] = []
const effect = runtime.effect(() => {
  seen.push(store.samples.at(0))
})
try {
  store.samples.setAt(1, 7)
  runtime.flush()
  console.log(seen.join(','))
  store.samples.setAt(0, 5)
  runtime.flush()
  console.log(seen.join(','))
  const copy = store.samples.view()
  copy[0] = 99
  console.log(copy[0], store.samples.at(0))
} finally {
  effect.dispose()
  await store.$dispose()
}
```

Output:

```text
0
0,5
99 5
```

The output is 0, then 0,5, then 99 5: changing index 1 does not rerun the index-0 reader, changing index 0 does, and modifying the copy leaves the field at 5.

Indices must be safe integers in [0, length); negative Array.at-style indices are unsupported. view() does not track reads or write back, and coarser buckets can invalidate neighboring readers.

### Example parameters

array requires length, here 3, and defaults granularity to 64, overridden here with 1. createStore options.runtime receives the explicit Runtime. seen includes the initial effect run, and runtime.flush completes scheduling. setAt requires a valid nonnegative safe index and numeric value; view takes no arguments and does not track.

## Reject unreadable range input before changing array bytes

A batch update reads numbers from an ArrayLike object whose accessor can fail midway through the input.

Writing each number immediately after reading it leaves a partially updated field when a later accessor throws.

setRange reads the complete input before writing its half-open [lo, hi) range, so an input failure is classified without changing the existing bytes.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm, array } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
await ensureWasm()
const store = createStore({ samples: array(3) })
const failureText = 'range input cannot be read'
const failure = new TypeError(failureText)
const input: ArrayLike<number> = {
  length: 3,
  0: 9,
  get 1(): number {
    throw failure
  },
  2: 9
}
try {
  store.samples.setRange(0, 3, [1, 2, 3])
  try {
    store.samples.setRange(0, 3, input)
  } catch (error) {
    console.log(error === failure, (error as { code?: string }).code)
  }
  console.log([...store.samples.view()].join(','))
  store.samples.setRange(0, 2, [4, 5])
  console.log([...store.samples.view()].join(','))
} finally {
  await store.$dispose()
}
```

Output:

```text
true INVALID_OPTION
1,2,3
4,5,3
```

The output is true INVALID_OPTION, then 1,2,3, then 4,5,3: the exact TypeError is retained, the rejected input changes nothing, and a later valid range can still be applied.

values.length must equal hi - lo and every value must be a number. This proves admission before writes; it does not promise rollback of external accessor side effects or earlier observer notifications.

### Example parameters

array(3) uses default granularity 64. setRange uses half-open lo/hi endpoints, values.length equal to hi-lo, and number items. input is a real ArrayLike with a throwing getter. After [1,2,3] is stored, rejecting input retains the exact TypeError with INVALID_OPTION; a later [0,2) update accepts [4,5].

## Observe one named coordinate without tracking its siblings

A component reads the horizontal coordinate while only the vertical coordinate changes.

Tracking the entire position object would rerun that reader for any property change, even when its own input stays the same.

Build a fixed record from number() descriptors; each named numeric property has its own source and is read directly as position.x rather than through .value.

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm, record, number } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'
import { createRuntime } from '@migaia/reactive'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
await ensureWasm()
const runtime = createRuntime()
const store = createStore({ position: record({ x: number(), y: number() }) }, { runtime })
const seen: number[] = []
const effect = runtime.effect(() => {
  seen.push(store.position.x)
})
try {
  store.position.y = 9
  runtime.flush()
  console.log(seen.join(','))
  store.position.x = 3
  runtime.flush()
  console.log(seen.join(','))
  console.log(Object.keys(store.position).join(','))
  console.log(store.position.x, store.position.y)
} finally {
  effect.dispose()
  await store.$dispose()
}
```

Output:

```text
0
0,3
x,y
3 9
```

The output is 0, then 0,3, then x,y, then 3 9: updating y leaves the x reader alone, updating x reruns it, and enumeration exposes only business keys.

Record values begin at 0. The shape is fixed and supports number() builders only; nested fields and dynamic keys are unsupported, while dispose and disposed remain reserved lifecycle names.

### Example parameters

record shape supports number() builders only, with x/y initially zero. Properties are read/written directly without .value. Store options.runtime matches the observing effect, and flush completes scheduling. Object.keys lists only business keys; dispose/disposed are nonenumerable. Release the observer before its Store.

## Contract details

### Ownership, entry point, and intended use

The package has one root entry: ensureWasm, the number/boolean/string/array/record builders, eight error codes, four error factories, and WasmReservedKey/IWasmReservedKey. Concrete field types are exposed through builder return types, but names such as IWasmNumberField are not named root reexports. Namespace imports such as `import * as wasm from '@migaia/store-wasm'` avoid common-name collisions.

Dependencies are reactive, store-light, wasm, and utils. Field payloads live in WebAssembly.Memory; reactive Sources, descriptors, and decoded strings still use JavaScript objects. The entire Store or application state is not moved off the JS heap. Use fixed numeric layouts or explicitly bounded data where useful; ordinary small state, class instances, functions, and cyclic JS objects need not become WASM fields. Without measurements, layout and notification mechanisms are not speed claims.

Internal arena/field/number implementation files are not subpath exports. One internal allocator validates Wasm32 byte lengths and tracks memory, allocation id, pointer, and release registration. Synchronous allocation requires readiness; internal async allocation waits for ensureWasm first. New field types should be published by this package rather than relying on deep imports or another allocator implementation.

### Initialization and real Node loading

`ensureWasm():Promise<WebAssembly.Memory>` takes no arguments. It makes the underlying module memory ready without allocating fields. Pending and successful calls preserve the same Promise identity and memory. Failure clears the corresponding cache so a later call can retry. A builder itself allocates nothing; await readiness before the Store calls its synchronous create(context), otherwise NOT_INITIALIZED is thrown rather than waiting or substituting a JS field.

Node fetch cannot directly load the default file URL. The examples first read bytes from the published sibling WASM file in `@migaia/wasm`, invoke its default initWasm({module_or_path:bytes}), then call ensureWasm. module_or_path belongs to the underlying loader, not a field option. Here it contains readFile bytes; omission fetches the package's sibling WASM URL, and Promise input is also accepted. node:fs/promises reads the real file, and the examples use a real WASM instance.

Hosts with a suitable fetch path, such as browsers, can await ensureWasm directly. store-react StoreProvider can gate children with features.wasm:true and a stable ready:[ensureWasm], but cannot postpone a Store already constructed outside render. Prefer initialization and Store creation in an application/request owner, then register it with the matching Runtime Registry. This package has no reverse React dependency. The application owns an external Registry by default, and SSR has no effect cleanup. Enabling wasm without ready creates a rejected configuration barrier subsequently thrown during render, in production as well as development.

### Store integration and public protocols

Every builder uses store-light's StoreFieldMode.sync and the synchronous `IFieldBuilder` branch. Put it directly in createStore(shape); no special async Store factory is required. Async module loading and synchronous field construction are separate operations.

| Declaration                | Resulting Store field                                         |
| -------------------------- | ------------------------------------------------------------- |
| number()                   | Read/write number through field.value                         |
| boolean()                  | Read/write boolean through field.value                        |
| string(maxBytes?)          | Read/write string through field.value                         |
| array(length,granularity?) | Use at/setAt/setRange/view                                    |
| record(shape)              | Read/write numeric properties such as field.x, without .value |

The Store owns fields created by its builders and invokes their cleanup from store.$dispose(). Do not dispose individual fields while their Store remains in use. Extensions that explicitly own an IFieldContext may call builder.create(context) directly: runtime, signal, and createSource belong to store-light's protocol, must use a real owner, and leave field lifetime to the caller. signal is checked during construction, not a continuous automatic stop switch.

The real allocator zero-fills memory: number starts at 0, boolean at false, string at an empty string, and array/record numeric values at 0. Builders take no initial-value argument; set values through their write methods after creation. number/boolean/string expose readonly observed and disposed. array has readonly length/disposed; record has readonly disposed. Disposed payload access rejects, while metadata such as disposed and array.length remains readable.

### number and boolean

| Builder / layout                   | Reading, equality, and boundaries                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| number(): 8-byte little-endian f64 | value:number; Object.is-equal writes do not commit; a nonnumber JavaScript value is TypeError/INVALID_OPTION  |
| boolean(): 1 byte                  | value:boolean; true/false write 1/0 and nonzero reads as true; nonboolean writes are TypeError/INVALID_OPTION |

number accepts JS numbers, including NaN, Infinity, and negative zero, using f64 storage rather than integer-only semantics. Reading value tracks its Source; writing uses Source.commit. Scalar writes obtain the current DataView inside the commit callback so an owner growing memory at that boundary does not leave a write on the old buffer. No-argument dispose is synchronous and idempotent. Later value reads/writes produce FIELD_DISPOSED.

### string(maxBytes?)

maxBytes defaults to 256 and must be a safe integer in 0..0xffff_ffff-4. Invalid capacity produces RangeError/INVALID_OPTION when creating the builder. The allocation request is 4+maxBytes bytes: a little-endian Uint32 UTF-8 length followed by a fixed-capacity byte region. Underlying allocation capacity can round for alignment; a longer string does not resize the field.

value must be string, otherwise TypeError/INVALID_OPTION. TextEncoder output exceeding maxBytes produces INVALID_OPTION, retains the old value, and never truncates. Chinese characters and emoji count by UTF-8 bytes rather than character count. A write decodes the current value for === comparison and skips an equal commit; that comparison still costs a decode. Every getter decodes current memory.buffer bytes according to the prefix rather than caching a value solely by local setter revision. A stored length exceeding maxBytes is ALLOCATION_FAILED, indicating corrupted data rather than normal truncation. observed/disposed/dispose follow scalar semantics.

### array(length,granularity?)

| Parameter           | Default and constraint                                         |
| ------------------- | -------------------------------------------------------------- |
| length:number       | Required safe integer in 0..floor(0xffff_ffff/8), or 536870911 |
| granularity?:number | 64; a positive safe integer; 1 gives one bucket per position   |

Invalid arguments produce RangeError/INVALID_OPTION at builder creation. Layout is length*8 contiguous f64 bytes. Nonempty allocation requires an eight-byte-aligned pointer, otherwise ALLOCATION_FAILED. Empty arrays use an independent zero-length view without depending on zero-byte sentinel alignment. Length is fixed; there is no push/splice/resize.

| Field member                                                  | Arguments and behavior                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| length:number                                                 | Readonly fixed length                                                                                                                       |
| at(index:number):number                                       | Requires a nonnegative safe integer in [0,length); invalid/out-of-range reads are RangeError/INVALID_OPTION, without negative-index support |
| setAt(index:number,value:number):void                         | Same index checks; nonnumber values are TypeError/INVALID_OPTION; Object.is-equal writes do not commit                                      |
| `setRange(lo:number,hi:number,values:ArrayLike<number>):void` | Half-open [lo,hi), safe integer endpoints with 0≤lo≤hi≤length; values.length must equal hi-lo and every value must be number                |
| view():Float64Array                                           | No arguments; a new writable independent copy, without tracking, exposing linear memory, or writing back                                    |
| dispose():void / disposed:boolean                             | Idempotent cleanup / readonly closed state                                                                                                  |

Each contiguous granularity-sized bucket shares a Source, created on demand when touched. at tracks that bucket; an actual setAt/setRange change may notify other readers in the same bucket. There are at most ceil(length/granularity) buckets, not necessarily all created immediately. Finer granularity increases Source count and does not imply a measured speed advantage.

setRange captures length and every input item before writing field bytes. Invalid shape, length, numeric type, or an unclassified getter failure becomes INVALID_OPTION with original identity/cause retained; an error with complete foreign ownership keeps its source/code. Only Object.is-changed values are grouped by bucket; each affected bucket commits once and cross-bucket changes share one runtime.batch. Commit failure attempts reverse restoration of affected field bytes, without undoing Source/notification or external callback effects. Owned initialization/rollback failures remain traceable.

Private typed views and DataViews refresh when memory.buffer identity changes. memory.grow uses the current buffer; setAt and each bucket commit obtain it again inside the callback. Existing view() snapshots stay independent of that growth. Direct external memory writes bypass Source and therefore are not reactive writes.

### record(shape)

shape is required and typed as `Record<string,ReturnType<typeof number>>`. This is a fixed named f64 structure, not an arbitrary JS record. Only number builders are supported, without nested record/array fields; casting a boolean/string builder does not create a supported combination. Runtime admission checks object/keys and the FIELD_BUILDER brand, without separately proving that the brand came from number.

Object.keys(shape) order determines offsets in a keys.length*8 allocation. Each key occupies eight little-endian f64 bytes. Business properties are enumerable getters/setters: field.x tracks/commits its own Source. Nonnumber writes are TypeError/INVALID_OPTION and Object.is-equal writes are skipped. Lifecycle dispose/disposed properties are nonenumerable, so Object.keys/JSON.stringify expose only business keys.

WasmReservedKey/IWasmReservedKey contains dispose/disposed. record(shape) creates a description first; reserved names are rejected with RESERVED_FIELD_NAME TypeError during field create(context), usually called by createStore. Invalid shapes, failed key reads, or failed builder-brand reads produce INVALID_OPTION with the original cause.

### Lifetime, memory, and failure

One owner manages a field's allocation and created Sources. If signal is already aborted, every builder uses the same reason boundary. An extensible native reason keeps its type/message/stack/identity with INIT_ABORTED attached; foreign identity remains intact, and other reasons stay reachable through cause/errors. Failed construction attempts to release created Sources and the allocation rather than publishing a half-built field.

Normal disposal marks the field terminal and unregisters its GC entry, then attempts every Source cleanup before releasing the block. A Source failure does not prevent block cleanup. Repeated/reentrant dispose does not run cleanup again; the first call can throw cleanup errors. One error retains the original; multiple errors produce CLEANUP_FAILED AggregateError with originals in execution order. If construction and rollback both fail, a primary that can accept secondary errors is retained with nonenumerable errors appended. Otherwise [primary,cleanup] is aggregated, without replacing the primary's cause or stack.

When available, FinalizationRegistry registers created fields and explicit release unregisters them. Its absence is tolerated. GC fallback timing is unpredictable and cannot replace store.$dispose()/field.dispose(). Internal deallocation ignores unknown/released ids, and allocation validates the WASM32 byte range; arena primitives are not root API.

Native WebAssembly.CompileError/LinkError/RuntimeError pass unchanged through supported WASM boundaries. The first RuntimeError trap from an arena export also passes unchanged. The arena then marks itself unusable: later allocation rejects INSTANCE_POISONED with that original trap as cause, while release becomes a no-op to avoid another trap. This does not claim that every existing field getter calls an export or necessarily traps again. The shared wasm-bindgen instance cannot be rebuilt in the same module; reload the page or restart the process rather than retrying allocation as recovery. Poisoning does not promise reclamation of all earlier native memory.

### Error codes, factories, and diagnostics

| StoreWasmErrorCode property | code                | Situation                                                                           |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| notInitialized              | NOT_INITIALIZED     | Synchronous field creation before ensureWasm completes                              |
| fieldDisposed               | FIELD_DISPOSED      | Disposed payload access                                                             |
| initAborted                 | INIT_ABORTED        | Construction signal already aborted, preserving its reason                          |
| reservedFieldName           | RESERVED_FIELD_NAME | Lifecycle name used by record creation                                              |
| allocationFailed            | ALLOCATION_FAILED   | No usable allocation id/pointer, failed alignment, or corrupt string length         |
| invalidOption               | INVALID_OPTION      | Invalid capacity, length, granularity, index, range, value type, or input reads     |
| cleanupFailed               | CLEANUP_FAILED      | Multiple cleanup errors, or rollback failure that cannot be attached to its primary |
| instancePoisoned            | INSTANCE_POISONED   | Allocation after an arena trap, with the original trap on cause                     |

STORE_WASM_SOURCE is `'store.wasm'`, identifying errors created here rather than rewriting foreign owners. A native input-read failure that can accept identity receives INVALID_OPTION in place; otherwise cause/errors retain it. Do not forcibly replace declared native WASM pass-through errors with ordinary Error wrappers.

All four public factories require code:IStoreWasmErrorCode and message:string. `createStoreWasmError(code,message,options?)` returns Error and `createStoreWasmTypeError(...)` returns TypeError. options defaults to undefined, contains only optional cause, and forwards it when not undefined. `createStoreWasmRangeError(code,message)` has no third argument. `createStoreWasmAggregateError(code,errors:readonly unknown[],message)` retains each original error. They construct without automatically throwing, attach nonwritable source/code, and leave stack intact.

| Stable diagnostic                                                                                 | Boundary                                                       |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `[store] WASM is not initialized; await ensureWasm() or use StoreProvider`                        | Initialization incomplete                                      |
| `[store] cannot use a disposed wasm field`                                                        | Closed payload access                                          |
| `[store] field init aborted`                                                                      | Cancellation fallback when native reason cannot carry identity |
| `wasm.allocate: byteLen must fit an unsigned 32-bit integer`                                      | Invalid internal allocation size                               |
| `wasm.array: length exceeds the Wasm32 allocation limit`                                          | Invalid length                                                 |
| `wasm.array: granularity must be a positive safe integer`                                         | Invalid granularity                                            |
| `wasm.array: index out of bounds (i)` / `wasm.array: invalid range [lo, hi)`                      | Invalid index or range                                         |
| `wasm.array: values must be array-like` / `wasm.array: values length must match the target range` | Invalid shape or input length                                  |
| `wasm.array: allocation not 8-byte aligned (ptr=...)`                                             | Nonempty numeric-view alignment failure                        |
| `wasm.string: maxBytes exceeds the Wasm32 allocation limit`                                       | Invalid string capacity                                        |
| `wasm.string: value exceeds maxBytes (bytes > maxBytes)`                                          | UTF-8 capacity exceeded                                        |
| `wasm.string: corrupted byte length`                                                              | Corrupt stored prefix                                          |
| `wasm.<field>: value must be a <type>`                                                            | Invalid field value type                                       |
| `[store] wasm.record field name is reserved: key`                                                 | Reserved record name                                           |
| `[store] WASM cleanup failed`                                                                     | Aggregate cleanup failure                                      |
| `[store] WASM instance trapped earlier and is permanently unusable`                               | Poisoned arena                                                 |

### Migration, troubleshooting, and development commands

Replace the old array(number(),n,g) with array(n,g). The unused item argument was removed, encoding remains f64, and no compatibility entry remains. WasmFieldMode/IWasmFieldMode were withdrawn in favor of store-light StoreFieldMode.sync. Use typeof StoreFieldMode.sync for a sync-only type; the full IStoreFieldMode union includes async and is not an equivalent alias.

Fix initialization order after NOT_INITIALIZED. Size strings by UTF-8 bytes. Choose granularity=1 for separate index notifications. view returns a copy, so writes must use setAt/setRange. Fixed records do not support arbitrary nested field types. Builders describe layout; keep allocation outside React render under an application/request owner that initializes, constructs, and releases it.

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
pnpm run build
```

Some fault-injection tests use a fake WASM provider to isolate layout, cleanup, and reentry behavior; the API audit and this guide's examples load real WASM, and neither replaces the wasm package's Rust tests. Listing commands does not claim this documentation task ran them.
