# `@migaia/store-wasm`

Store numeric, boolean, fixed-capacity text, array, and record fields in real WASM memory, with tracked reads and writes through field methods.

## You may have run into this

- Startup paths each wait on a new initialization Promise because readiness identity is not retained centrally.
- A short-looking label is truncated incorrectly because UTF-8 capacity was estimated by character count.
- Reading one sample reruns after a neighboring write because several positions share a notification bucket.
- A batch source fails halfway after half its values were written because input reading and memory commits were interleaved.
- A horizontal-coordinate reader reruns on vertical edits because the whole position object is one dependency.

## Why choose it

- **Reuse one readiness token while pending and after success.** ensureWasm caches the actual Promise instead of wrapping its result on every call as shown in [Share one readiness Promise before creating fields](./USEGUIDE.en.md#share-one-readiness-promise-before-creating-fields).
- **Reject UTF-8 overflow while retaining the old string.** The fixed-capacity field encodes and validates before committing, without truncation as shown in [Reject a UTF-8 overflow without truncating the old value](./USEGUIDE.en.md#reject-a-utf-8-overflow-without-truncating-the-old-value).
- **Choose array notification granularity and isolate exported copies.** granularity=1 separates indices and view returns an independent copy without write-back as shown in [Track one array index and keep copied views isolated](./USEGUIDE.en.md#track-one-array-index-and-keep-copied-views-isolated).
- **Read batch input completely before changing field bytes.** setRange materializes every number first and preserves the original failure and old contents as shown in [Reject unreadable range input before changing array bytes](./USEGUIDE.en.md#reject-unreadable-range-input-before-changing-array-bytes).
- **Observe each numeric property of a fixed record independently.** record gives each key its own Source, so editing y leaves an x-only observer alone as shown in [Observe one named coordinate without tracking its siblings](./USEGUIDE.en.md#observe-one-named-coordinate-without-tracking-its-siblings).

## Start here

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm, number } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
await ensureWasm()
const store = createStore({ score: number() })
store.score.value = 12.5
console.log(store.score.value)
await store.$dispose()
```

Output:

```text
12.5
```

Next: see [string capacity](./USEGUIDE.en.md#reject-a-utf-8-overflow-without-truncating-the-old-value) for multibyte labels, or [range updates](./USEGUIDE.en.md#reject-unreadable-range-input-before-changing-array-bytes) for batch samples.

## Pitfalls when writing it yourself

This native memory view implements the same numeric field manually. It is for display only; the comments identify stale views and writes that bypass notification.

```ts doc-test=check
const memory = new WebAssembly.Memory({ initial: 1 })
const view = new DataView(memory.buffer) // Pitfall: this cached buffer view becomes invalid after growth.
const offset = 8
view.setFloat64(offset, 12.5, true) // Pitfall: raw writes bypass reactive commits and notify no observer.
memory.grow(1)
function readScore() {
  return view.getFloat64(offset, true)
}
void readScore
```

The quick start gives the number field responsibility for memory views and reactive commits, with Store-owned cleanup; the detailed scenario demonstrates reads and writes after growth.

## A three-minute mental model

Load real WASM, then give field builders to createStore. A builder describes layout; its field owns the allocation. Reads track a Source, the notification entry point, writes commit through it, and the Store releases the field.

| Task / term                          | Tool                            | Meaning                                                                         |
| ------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------- |
| Load before construction / readiness | ensureWasm                      | Initialize the module before synchronous field allocation                       |
| One value / scalar                   | number, boolean, string         | Read/write a fixed type through .value                                          |
| Contiguous numbers / bucket          | array(length,granularity)       | One notification source per bucket, with per-index observation at granularity 1 |
| Fixed named structure / record       | record({x:number(),y:number()}) | Independent properties read/written as field.x                                  |
| Export current contents / view       | arrayField.view()               | An independent numeric copy, not writable linear memory                         |
| Release responsibility / owner       | createStore → $dispose          | The Store owns fields and native allocations                                    |

## Typical scenarios

| Scenario                                                   | How to combine                                     | Details                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Share one readiness Promise before creating fields         | `initWasm(bytes) → ensureWasm → identity`          | [Complete example](./USEGUIDE.en.md#share-one-readiness-promise-before-creating-fields)         |
| Keep a numeric field usable after native memory grows      | `ensureWasm → number → memory.grow → $dispose`     | [Complete example](./USEGUIDE.en.md#keep-a-numeric-field-usable-after-native-memory-grows)      |
| Reject a UTF-8 overflow without truncating the old value   | `string(maxBytes) → encode → assign`               | [Complete example](./USEGUIDE.en.md#reject-a-utf-8-overflow-without-truncating-the-old-value)   |
| Track one array index and keep copied views isolated       | `array(length,1) → effect / setAt → view`          | [Complete example](./USEGUIDE.en.md#track-one-array-index-and-keep-copied-views-isolated)       |
| Reject unreadable range input before changing array bytes  | `setRange(lo,hi,ArrayLike) → admit → commit`       | [Complete example](./USEGUIDE.en.md#reject-unreadable-range-input-before-changing-array-bytes)  |
| Observe one named coordinate without tracking its siblings | `record(number fields) → effect → property writes` | [Complete example](./USEGUIDE.en.md#observe-one-named-coordinate-without-tracking-its-siblings) |

## Installation

```bash
pnpm add @migaia/store-wasm @migaia/store-light @migaia/wasm
```

Node examples directly load the wasm package's published binary. Tracking examples also import a Runtime directly:

```bash
pnpm add @migaia/reactive
```

## Essential APIs

| API                          | Purpose                                          |
| ---------------------------- | ------------------------------------------------ |
| `ensureWasm()`               | Await shared module readiness                    |
| `number()`                   | Declare one f64 numeric field                    |
| `boolean()`                  | Declare a one-byte boolean field                 |
| `string(maxBytes?)`          | Declare fixed UTF-8 byte capacity                |
| `array(length,granularity?)` | Declare a fixed-length numeric sample array      |
| `record(shape)`              | Declare individually observed numeric properties |

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

STORE_WASM_SOURCE is `'@migaia/store-wasm'`, identifying errors created here rather than rewriting foreign owners. A native input-read failure that can accept identity receives INVALID_OPTION in place; otherwise cause/errors retain it. Do not forcibly replace declared native WASM pass-through errors with ordinary Error wrappers.

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
