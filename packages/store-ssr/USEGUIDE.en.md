# `@migaia/store-ssr` Usage guide

Choose a request boundary, then run its complete example; these examples use real public entries without a rendering framework or global document.

| Problem to solve                                              | Public entry          | Complete scenario                                                       |
| ------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------- |
| Capture a request snapshot and release its owned store        | createSSRRequestScope | [Start](#capture-a-request-snapshot-and-release-its-owned-store)        |
| Keep two requests in separate runtimes                        | createSSRRequestScope | [Start](#keep-two-requests-in-separate-runtimes)                        |
| Keep ready data when another resource exceeds the wait budget | createSSRRequestScope | [Start](#keep-ready-data-when-another-resource-exceeds-the-wait-budget) |
| Embed JSON without letting data close its script element      | serializeSSRState     | [Start](#embed-json-without-letting-data-close-its-script-element)      |
| Create the complete non-executable state element              | createSSRStateScript  | [Start](#create-the-complete-non-executable-state-element)              |
| Reject identifiers that can break the state element attribute | createSSRStateScript  | [Start](#reject-identifiers-that-can-break-the-state-element-attribute) |

## Before running the examples

Store examples import store-light directly, and the resource-wait example imports resource directly; install both explicitly rather than relying on access to transitive dependencies. Run the code in an ESM TypeScript environment that supports top-level await.

```bash
pnpm add @migaia/store-ssr @migaia/store-light @migaia/resource
```

## Capture a request snapshot and release its owned store

A page finishes rendering, but the live store changes before its state is serialized. The exported state should retain the values captured for that render, and request cleanup must release its owned store.

Keeping a live nested object as the response payload lets later mutations rewrite the earlier result. A request handler that forgets store disposal also leaves subscriptions and cleanup jobs behind.

Install store-ssr and store-light directly. Create the Store with scope.runtime, register it, then call dehydrate() for a checked frozen snapshot and await disposeAsync() when the request ends.

### Arguments used here

createSSRRequestScope() uses no options and creates a Runtime; register requires the key and Store, defaults owned to true, and receives a Store created with scope.runtime.

```ts doc-test=run
import { createSSRRequestScope } from '@migaia/store-ssr'
import { createStore } from '@migaia/store-light'

const scope = createSSRRequestScope()
const cart = createStore({ count: 2 }, { runtime: scope.runtime })
scope.register('cart', cart)
const snapshot = scope.dehydrate()
cart.count = 3
console.log(snapshot.stores.cart?.count, cart.count)
console.log(Object.isFrozen(snapshot.stores.cart))
await scope.disposeAsync()
console.log(cart.$disposed)
```

### Output and boundaries

```text
2 3
true
true
```

Prints `2 3`, `true`, then `true`. The dehydrated count stays 2 after the live Store reaches 3; its snapshot is frozen, and the owned Store is disposed at request completion.

Registration owns the Store by default. dehydrate() validates, copies and freezes JSON data; dehydrateTrusted() retains live references instead. Scope cleanup does not dispose the Runtime itself, and the caller chooses one scope per request.

## Keep two requests in separate runtimes

Concurrent requests register the same profile key for different users. They need separate state and must reject a Store accidentally created for the other request.

A module-level Runtime or shared registry lets request-specific state share one owner. Giving scopes different names cannot correct a Store that was constructed with the wrong Runtime.

createSSRRequestScope creates a new Runtime by default. Build each real store-light Store with its own scope.runtime; register() checks exact Runtime identity before accepting the foreign candidate.

### Arguments used here

Both scopes use their default fresh Runtime; identical keys belong to separate registries, and register checks Store.$runtime before admission.

```ts doc-test=run
import { createSSRRequestScope } from '@migaia/store-ssr'
import { createStore } from '@migaia/store-light'

const first = createSSRRequestScope()
const second = createSSRRequestScope()
const alice = createStore({ user: 'Alice' }, { runtime: first.runtime })
const bob = createStore({ user: 'Bob' }, { runtime: second.runtime })
first.register('profile', alice)
second.register('profile', bob)
console.log(first.runtime === second.runtime)
console.log(first.dehydrate().stores.profile?.user, second.dehydrate().stores.profile?.user)
try {
  first.register('foreign', bob)
} catch (error) {
  console.log((error as { code: string }).code)
}
await Promise.all([first.disposeAsync(), second.disposeAsync()])
```

### Output and boundaries

```text
false
Alice Bob
CROSS_RUNTIME
```

Prints `false`, `Alice Bob`, and `CROSS_RUNTIME`. The default scopes have different Runtimes, identical keys hold separate user values, and the foreign registration is refused.

Passing the same explicit runtime to multiple scopes reuses it and does not create request isolation. runtime and runtimeOptions are mutually exclusive. Failed registration retains caller ownership; closing one scope does not release objects owned by the other.

## Keep ready data when another resource exceeds the wait budget

A render has one ready cache entry and one request still pending when its waiting budget ends. The completed entry should remain usable without being mislabeled as a timeout.

Timing out an entire Promise.all call loses which resources actually settled. Retrying every resource discards available cache data and repeats work that already succeeded.

Install resource directly. dehydrateAsync({ timeoutMs: 0 }) classifies already-settled promises without waiting for pending work; onResourceError collects failures, and the ready Resource uses a 60000 ms cache TTL.

### Arguments used here

Resources use scope.runtime; ttl defaults to Infinity, and this example overrides ready to 60000 ms; timeoutMs: 0 is a zero budget for the whole wait, and onResourceError replaces default reporting.

```ts doc-test=run
import { createSSRRequestScope, type ISSRResourceFailure } from '@migaia/store-ssr'
import { Resource } from '@migaia/resource'

const scope = createSSRRequestScope()
const ready = new Resource(async () => 7, scope.runtime, { ttl: 60_000 })
await ready.promise
let finish!: (value: number) => void
const pending = new Resource(
  () =>
    new Promise<number>((resolve) => {
      finish = resolve
    }),
  scope.runtime
)
scope.registerResource('ready', ready)
scope.registerResource('pending', pending)
const failures: ISSRResourceFailure[] = []
const state = await scope.dehydrateAsync({
  timeoutMs: 0,
  onResourceError: (failure) => {
    failures.push(failure)
  }
})
console.log(failures[0]?.key, (failures[0]?.error as Error & { code: string }).code)
console.log(state.resources?.ready?.data)
finish(9)
await pending.promise
await scope.disposeAsync()
```

### Output and boundaries

```text
pending RESOURCE_TIMEOUT
7
```

Prints `pending RESOURCE_TIMEOUT` and `7`. Only the unresolved resource is reported; the successfully cached value remains in the dehydrated resource state. The example then resolves the pending loader and closes the scope.

timeoutMs defaults to no deadline and applies to the whole wait. A timeout does not abort underlying work. Resource inclusion follows resource.dehydrate(), without independently filtering failure keys; a stale cache can remain eligible.

## Embed JSON without letting data close its script element

A user-supplied text contains `</script>`, an ampersand or Unicode line separators. Inlining ordinary JSON into an HTML script element can make the HTML parser treat data as markup.

JSON.stringify escapes JSON syntax but does not remove a literal closing script tag from string contents. Escaping the whole document afterward can instead corrupt the JSON representation.

serializeSSRState first validates the version-1 state and then escapes &, <, >, U+2028 and U+2029 with JSON-compatible sequences. deserializeSSRState reads the escaped text back and verifies the same value.

### Arguments used here

state must be a valid version-1 SSR envelope; serializeSSRState and deserializeSSRState each take one required argument without options.

```ts doc-test=run
import { serializeSSRState, deserializeSSRState } from '@migaia/store-ssr'

const value = '</script>&\u2028\u2029'
const state = { version: 1 as const, stores: { page: { text: value } } }
const text = serializeSSRState(state)
console.log(
  text.includes('<'),
  text.includes('&'),
  text.includes('\u2028'),
  text.includes('\u2029')
)
console.log(deserializeSSRState(text).stores.page?.text === value)
```

### Output and boundaries

```text
false false false false
true
```

Prints `false false false false` and `true`. The serialized text contains none of the checked raw HTML-sensitive characters or line separators, while JSON parsing recovers the original string exactly.

Use the returned text as JSON script content; the function does not add a script element. State version must be 1 and values must meet the supported JSON domain. Invalid parsed JSON retains SyntaxError with INVALID_STATE_SCRIPT.

## Create the complete non-executable state element

A renderer has a validated state envelope but still needs a consistently named element for browser hydration. The response should include data without turning that JSON into executable JavaScript.

Hand-written tag templates can disagree about the element id or MIME type. Inlining the JSON without its matching escaping also reintroduces closing-tag handling into every renderer.

createSSRStateScript validates the state and element id, serializes with HTML-compatible JSON escapes, and wraps the result in an application/json script. Omit elementId to use `__STORE_STATE__`.

### Arguments used here

state is required, elementId defaults to `__STORE_STATE__`, and the result is tag text rather than a DOM insertion.

```ts doc-test=run
import { createSSRStateScript } from '@migaia/store-ssr'

const state = { version: 1 as const, stores: { app: { count: 2 } } }
console.log(createSSRStateScript(state))
```

### Output and boundaries

```text
<script type="application/json" id="__STORE_STATE__">{"version":1,"stores":{"app":{"count":2}}}</script>
```

Prints `<script type="application/json" id="__STORE_STATE__">{"version":1,"stores":{"app":{"count":2}}}</script>`. The default id and non-executable JSON MIME type appear in the complete tag.

This function builds HTML text and does not insert DOM nodes or hydrate Stores. A browser reader can use readSSRStateFromDocument with the same id and an explicitly supplied document; that reader does not obtain a global document automatically.

## Reject identifiers that can break the state element attribute

A renderer selects an element id from configuration. If quotes or whitespace are accepted, the value can escape its id attribute and change the generated markup.

Interpolating an arbitrary configuration string into a tag treats that value as HTML syntax. Merely agreeing on an id between server and browser does not validate the attribute boundary.

createSSRStateScript requires an id beginning with a letter or underscore, followed by letters, digits, underscores, colons, dots or hyphens. Show a valid custom id, then reject one containing a quote and spaces.

### Arguments used here

elementId is the second argument and defaults to `__STORE_STATE__`; it must match /^[A-Za-z_][A-Za-z0-9_:.-]*$/, otherwise INVALID_STATE_SCRIPT is thrown.

```ts doc-test=run
import { createSSRStateScript } from '@migaia/store-ssr'

const state = { version: 1 as const, stores: {} }
const html = createSSRStateScript(state, 'page-state')
console.log(html.includes('id="page-state"'))
try {
  createSSRStateScript(state, 'state" onclick="bad')
} catch (error) {
  console.log((error as Error).name, (error as { code: string }).code)
}
```

### Output and boundaries

```text
true
Error INVALID_STATE_SCRIPT
```

Prints `true` and `Error INVALID_STATE_SCRIPT`. The valid page-state id is rendered; the attempted attribute-breaking id is rejected before a tag is returned.

The default id is `__STORE_STATE__`, and empty or nonmatching ids reject. State data is separately validated and JSON-escaped; this identifier rule does not provide a general HTML sanitization policy for other markup.

## Contract details

### Ownership, entry point, and request isolation

The only entry is `@migaia/store-ssr`. It connects reactive-driven Stores/Resources to SSR snapshots, owning registration, prefetch waits, dehydration, hydration, and cleanup of accepted objects. Dependencies are reactive, resource, serialize, and utils. It has no rendering-framework binding and never reads globalThis.document.

A new SSRRequestScope creates a new Runtime by default. Store registration checks $runtime, and Resource registration checks runtime, against scope.runtime. Mismatches fail with CROSS_RUNTIME. claimOwnership records the scope object's owner; it does not exclusively reserve a Runtime. Two scopes may explicitly receive the same Runtime, so the application still owns request isolation. Create one independent scope per request, create its state with scope.runtime, and await disposeAsync in finally.

createStore and the Resource class already satisfy the respective interfaces below. A purely client-side application does not need this bridge, and this is not an arbitrary-object JSON converter. Whether the client refetches depends on Resource cache, TTL, and startup policy; hydration does not guarantee that every application request is eliminated.

### Construction and structural interfaces

createSSRRequestScope(options?) is equivalent to new SSRRequestScope(options?). Options default to an empty object.

| Field                            | Default and boundary                                                   |
| -------------------------------- | ---------------------------------------------------------------------- |
| runtime?: IRuntime               | Create a Runtime when omitted; otherwise reuse the supplied one        |
| runtimeOptions?: IRuntimeOptions | undefined; forwarded to createRuntime, mutually exclusive with runtime |

runtimeOptions belongs to reactive, including onError, onTrace, maxFlushPasses, and scheduleIdle. This package does not define another Runtime configuration model. Supplying both fields produces INVALID_OPTION. scope.runtime is readonly; scope.disposed becomes true when synchronous closure starts.

| Store port                                       | Resource port                                                 |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `readonly $runtime: IRuntime`                    | `readonly runtime: IRuntime`                                  |
| `readonly $disposed: boolean`                    | `readonly disposed: boolean`                                  |
| `$plain(): Record<string, unknown>`              | `readonly promise: Promise<unknown>`                          |
| `$hydrate(state: Record<string, unknown>): void` | `dehydrate(): IResourceCacheSnapshot<unknown>` or `undefined` |
| `$dispose(): void` or `PromiseLike<void>`        | `hydrate(snapshot): void`; `dispose(): void`                  |

A Resource without a dehydrated cache can return undefined. The $-prefixed Store names and unprefixed Resource names follow their existing contracts. The scope observes asynchronous Store cleanup; the Resource port has synchronous disposal. Structural adapters must define their own dehydrate/cache policy rather than expect the failure list to choose cached output for them.

### Registration and ownership transfer

| Method                                    | Arguments, defaults, and result                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| register(key, store, options?)            | Required key/store, options defaults to {}, owned defaults to true; returns void    |
| unregister(key, disposeOwned?)            | Required key, disposeOwned defaults to true; returns whether a registration existed |
| detach(key)                               | Return the original Store or undefined without disposal                             |
| registerResource(key, resource, options?) | Resource equivalent, also owned by default                                          |
| unregisterResource(key, disposeOwned?)    | Resource equivalent returning whether it existed                                    |
| detachResource(key)                       | Return the original Resource or undefined without disposal                          |

Keys must be nonempty and cannot be `__proto__`. Duplicate Store or Resource keys fail with INVALID_OPTION rather than replacing registrations. Objects must belong to the scope Runtime. Owned entries are cleaned up on exit; owned false leaves lifecycle responsibility with the caller while participating in dehydration/hydration.

When hydration arrived before registration, the pending matching snapshot is applied before registration commits. If the callback fails while the scope remains active, the key stays free, the pending snapshot remains available for retry, and the candidate stays caller-owned. If the callback closes the scope, closure clears pending state and a post-hydration SCOPE_DISPOSED check rejects admission, even if the candidate has already received values.

Store unregistration removes the entry before invoking $dispose and tracks returned thenables. Resource unregistration calls dispose first; synchronous failure leaves the registration present for caller handling or detach. Detach never disposes and transfers lifecycle responsibility back to the caller.

### Hydration can partially succeed

hydrate(state) requires one state argument without options. It first validates the whole structure with assertSSRState, then applies $hydrate/hydrate to registered objects and stores unknown keys for later registration. Each call replaces the pending tables; absent keys from older pending state are not retained.

This is best-effort application rather than an atomic transaction. One callback failure does not prevent the other entries being attempted, and successful updates are not rolled back. One failure is thrown unchanged; multiple failures use HYDRATE_FAILED with AggregateError.errors retaining original objects and order. Matching keys, presence in the server payload, and whether an object was disposed before dehydration all affect restoration.

### Safe dehydration and the trusted path

dehydrate() takes no arguments. It visits active registrations in sorted key order. Store $plain results are JSON-validated, deeply copied, and frozen. A Resource returning undefined is omitted. Otherwise its data receives the same validation/copying, while version, ageMs, and remainingTtlMs are preserved. The outer state, stores, and resources are frozen. Later source changes do not change this safe snapshot.

dehydrateTrusted() also takes no arguments, but it is **not a snapshot**. It retains live $plain()/dehydrate() references without JSON validation, deep copies, or deep freezing. An outer wrapper does not make all descendants immutable. The ITrustedSSRState brand prevents accidental typed input to serializeTrustedSSRState; it is not proof that untrusted application data is safe.

Use this path only when every value is already valid and cannot change before immediate serializeTrustedSSRState, with no intervening await or mutation. Prefer dehydrate by default. A brand is not validation of request input. dehydrate and dehydrateAsync produce data only; they do not perform HTML character escaping.

### Resource waits and failure reporting

awaitResources(options?) returns readonly ISSRResourceFailure[], whose entries contain key and original error. Options default to {} and timeoutMs to undefined, meaning no deadline. A supplied timeout must be finite within [0, 2147483647], including fractional values. Invalid values reject the returned promise with RangeError / INVALID_OPTION.

The budget covers the whole wait, not a new allocation for every Resource. Successive rounds deduplicate by Promise identity. A retry/refetch promise or a Resource registered after another completes is still awaited. More than 64 rounds rejects with RESOURCE_ROUND_LIMIT.

A throwing promise getter is recorded once per key. A rejected promise retains its original reason. Deadline exhaustion marks only still-pending promises with RESOURCE_TIMEOUT, without misclassifying existing successes. Zero waits for no in-flight work but still recognizes settled promises. Scope closure promptly returns already collected failures without marking every remaining resource as timed out or cancelling its underlying work.

dehydrateAsync(options?) waits before safe dehydration. timeoutMs has the same contract. Optional onResourceError(failure) replaces default reporting; without it, each failure goes to runtime.reportError(error, { phase: 'ssr-resource' }). Failure keys are not a second payload filter: Resource.dehydrate decides whether cached data is included. An unbounded wait for a never-settled promise can remain pending; choose timeoutMs to match the request budget.

Resource v2 hydration restores captured remaining TTL. The caller accounts for known transport/storage delay by increasing ageMs and subtracting from finite remainingTtlMs, floored at zero. The outer ISSRState version remains 1.

### Closing a scope and stable completion

dispose() takes no arguments, closes synchronously, and starts cleanup. disposeAsync() takes no arguments and returns a stable Promise<void>. First closure marks disposed, clears registrations/pending hydration, and publishes completion before invoking cleanup. Synchronous reentry sees the same promise. Concurrent, completed, and failed repeated calls reuse it without another cleanup pass.

Owned Resources release in reverse registration order, then owned Stores in reverse order; already disposed objects are skipped. Failure never prevents later entries being attempted. Synchronous dispose can throw synchronous failures without waiting for Store thenables. disposeAsync waits for tracked jobs, preserves a single failure, and aggregates multiple failures under SCOPE_DISPOSAL_FAILED. It also waits for still-tracked Store cleanup started by earlier unregister calls.

The scope does not dispose the Runtime itself. After closure, registration, removal, detach, hydrate, dehydration, and resource waits fail with SCOPE_DISPOSED. Synchronous methods throw; asynchronous wait methods reject. Reading runtime/disposed and repeated closure remain available. A scope cannot be revived.

### ISSRState and the JSON domain

ISSRState requires version 1 and a plain stores record; resources is optional. Each Store value must be a JSON object, with a nonempty key other than `__proto__`. Resource snapshots require version 2, data, finite non-negative ageMs, and remainingTtlMs that is null or finite/non-negative. assertSSRState(value) takes one required value without options and narrows its type; it does not create a deep copy.

The JSON domain is null, strings, booleans, finite numbers, ordinary records, and arrays. It rejects Date/Map/Set/class instances, nonfinite numbers, undefined/functions/symbols/bigint, ancestor cycles, depth above 256, and node counts above 1000000. Paths identify locations such as stores.app.count or resources.user.data[2].name. Acyclic repeated references are not ancestor cycles. Copying and validation share rejection order.

INVALID_SNAPSHOT covers store/resource structure and Resource snapshots. Invalid outer versions use INVALID_STATE_SCRIPT. Unreadable unknown snapshot properties preserve the native object or cause rather than replacing the failure with text. Unsupported JSON values produce TypeError / SERIALIZE_UNSUPPORTED.

### JSON text, HTML embedding, and explicit documents

serializeSSRState(state) validates, JSON-stringifies, and escapes &, <, >, U+2028, and U+2029 using JSON-compatible escapes. It returns text without a tag. serializeTrustedSSRState(state) skips validation but still escapes these characters. Both require one argument and are not general-purpose escaping for arbitrary HTML contexts.

The output contains literal escape sequences \u0026, \u003c, \u003e, \u2028, and \u2029, preventing a payload's `</script>` from ending its enclosing element while JSON.parse restores the original characters. deserializeSSRState(text) parses and validates; malformed JSON keeps native SyntaxError and its stack while receiving INVALID_STATE_SCRIPT.

createSSRStateScript(state, elementId?) wraps safe text in a complete application/json script element. State is required. The id defaults to `__STORE_STATE__` and must match `/^[A-Za-z_][A-Za-z0-9_:.-]*$/`, allowing the leading underscore but excluding whitespace/quotes. Invalid ids produce INVALID_STATE_SCRIPT.

readSSRStateFromDocument(elementId?, document?) uses the same default id. Document defaults to undefined; the package never discovers a global DOM. getElementById(id) returns an element with textContent/getAttribute(name), or null. Missing elements or empty content return undefined. A browser document satisfies the minimal interface, and another host can explicitly provide it. Returned state still passes SSR validation.

### Codec-specific script writing and reading

createSSRStateScriptWith(state, options) and readSSRStateFromDocumentWith(options) are asynchronous and require options.

| Field                      | Requirement / default                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| codecs: ISerializeRegistry | Required without a default; primaryType chooses the written format                        |
| elementId?: string         | `__STORE_STATE__`; writers validate the grammar above, readers look up the id as supplied |
| signal?                    | undefined; forwarded to registry encode/decode                                            |
| document?: ISSRDocument    | Read only, optional; omission returns undefined                                           |

A value chunk fails with TypeError / CODEC_CONTRACT because SSR needs wire text or bytes. Json primaryType plus a text chunk uses JSON escaping and data-codec="json" data-wire="text". Every other case, including JSON bytes, uses base64 with data-wire="b64" and type="text/plain". Applying JSON escapes to YAML or binary would corrupt their syntax. The base64 alphabet avoids the relevant HTML delimiters and increases encoded size by roughly one third; this is an encoding property rather than a speed measurement.

Codec script id and codec attributes escape &, double/single quotes, <, and > as HTML attributes, in addition to id admission. Reading uses data-codec, default json, and data-wire, default text. An unregistered writer type fails with CODEC_CONTRACT; decoded output still passes assertSSRState. Writer and reader registries must be compatible. registry.encode alone does not provide the SSR helper's embedding policy.

SsrWireType is { json: 'json', text: 'text', bytes: 'bytes' }, and ISsrWireType is its value union. Json is a codec-type comparison, while text/bytes identify chunk kinds. Internal wait outcomes SsrWorkOutcome/ISsrWorkOutcome were removed from the root without a compatibility alias. awaitResources still returns its failure array directly.

### Error identity and factories

Package-created errors use STORE_SSR_SOURCE, store.ssr. Complete foreign source/code identities retain their original owner. StoreSsrErrorCode contains these 12 values.

| Property / code                              | Trigger                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| scopeDisposed / SCOPE_DISPOSED               | Use after scope closure                                                             |
| scopeDisposalFailed / SCOPE_DISPOSAL_FAILED  | Multiple owned cleanup failures retained in AggregateError.errors                   |
| hydrateFailed / HYDRATE_FAILED               | Multiple hydration failures; successful updates remain applied                      |
| invalidSnapshot / INVALID_SNAPSHOT           | Invalid stores/resources, Resource snapshot, or property access                     |
| invalidStateScript / INVALID_STATE_SCRIPT    | Invalid outer version, script id, or JSON syntax                                    |
| invalidStoreKey / INVALID_STORE_KEY          | Empty key or `__proto__`                                                            |
| serializeUnsupported / SERIALIZE_UNSUPPORTED | Invalid JSON domain, cycles, or depth/node budget                                   |
| invalidOption / INVALID_OPTION               | Invalid timeout, mutually exclusive Runtime options, owned option, or duplicate key |
| crossRuntime / CROSS_RUNTIME                 | Registration belongs to another Runtime                                             |
| codecContract / CODEC_CONTRACT               | Value chunk or unavailable writer codec                                             |
| resourceRoundLimit / RESOURCE_ROUND_LIMIT    | More than 64 resource-registration rounds                                           |
| resourceTimeout / RESOURCE_TIMEOUT           | Pending Resource reaches the total deadline; recorded in the failure array          |

createStoreSsrError(code, message, options?) creates Error and accepts an optional cause. createStoreSsrRangeError(code, message) and createStoreSsrTypeError(code, message) have only two arguments and no cause option. Code/message are required without defaults. createStoreSsrAggregateError(code, errors, message) requires all three arguments and retains error objects/order. Factories attach identity through utils without rewriting stacks. Existing mutable native SyntaxError/TypeError failures retain instance/class/stack when tagged; immutable or non-Error causes remain reachable.

### End-to-end integration and maintenance

On the server, create a scope per request and real Stores/Resources using its Runtime. Register keys, dehydrateAsync when prefetching, emit through the corresponding serialize/script helper, then await disposeAsync in finally. In the browser, create independent state/Runtime, explicitly read the same id, and hydrate matching keys. Resource startup, caching, and TTL belong to resource and the application. Supplying initial snapshots, sending responses, and rendering are host responsibilities.

For CROSS_RUNTIME, check the Runtime supplied at object creation. For missing hydration, check keys, server entries, and disposal. For absent resource output, inspect dehydrate rather than interpreting failure keys as filtering. Script read failures call for matching ids/codecs. A stalled wait requires distinguishing unbounded Resource work from cleanup completion.

```bash
pnpm --filter @migaia/store-ssr run fmt
pnpm --filter @migaia/store-ssr run lint
pnpm --filter @migaia/store-ssr run typecheck
pnpm --filter @migaia/store-ssr run typecheck:test
pnpm --filter @migaia/store-ssr run test
pnpm --filter @migaia/store-ssr run build
```

Existing tests cover isolation, dehydration/hydration, JSON boundaries, waits, cleanup order, and error identity. Report command results only after actual execution.
