# `@migaia/store-ssr`

Register Stores and Resources for a server render, capture state for hydration, and clean up request-owned objects when the request ends.

## You may have run into this

- Concurrent requests register the same key and see another user’s value: a module-level Runtime and registry give request data a shared owner.
- The count is 2 during rendering but 3 when the response is sent: the response still points at live objects instead of a captured copy.
- One pending request makes the whole cache look timed out: a deadline around Promise.all cannot distinguish ready resources from unfinished work.
- The JSON parses correctly but breaks its HTML element: a closing script tag inside a JSON string is still markup to the HTML parser.

## Why choose it

- **Catch state created for the wrong request when it is registered.** A fresh Runtime is the default and registration checks exact identity, as shown in [Keep two requests in separate runtimes](./USEGUIDE.en.md#keep-two-requests-in-separate-runtimes).
- **Keep captured render values stable and finish request cleanup.** Safe dehydration validates, copies, and freezes data while default ownership releases registered Stores on closure, as shown in [Capture a request snapshot and release its owned store](./USEGUIDE.en.md#capture-a-request-snapshot-and-release-its-owned-store).
- **Distinguish ready cache entries from in-flight timeouts.** The wait classifies Promise settlements and recognizes completed work even with a zero budget, as shown in [Keep ready data when another resource exceeds the wait budget](./USEGUIDE.en.md#keep-ready-data-when-another-resource-exceeds-the-wait-budget).
- **Give embedded JSON one place to handle HTML-sensitive characters.** Serialization escapes five character classes without changing the parsed value, as shown in [Embed JSON without letting data close its script element](./USEGUIDE.en.md#embed-json-without-letting-data-close-its-script-element).
- **Build consistent state elements with validated identifiers.** The helper fixes the JSON MIME type and rejects ids that can break the attribute boundary, as shown in [Reject identifiers that can break the state element attribute](./USEGUIDE.en.md#reject-identifiers-that-can-break-the-state-element-attribute).

## Start here

Install the package and the Store used directly below:

```bash
pnpm add @migaia/store-ssr @migaia/store-light
```

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

Output:

```text
2 3
true
true
```

Next: [isolate two requests](./USEGUIDE.en.md#keep-two-requests-in-separate-runtimes) or [wait for resources before dehydration](./USEGUIDE.en.md#keep-ready-data-when-another-resource-exceeds-the-wait-budget).

## Pitfalls when writing it yourself

This native example is for display only and is not executed; request ownership, capture, and HTML embedding are left to application code.

```ts doc-test=check
const sharedState = { cart: { count: 2 } } // Hazard: module state can be shared by requests.

function renderRequest() {
  const payload = { version: 1, stores: sharedState } // Hazard: nested values remain live references.
  return `<script type="application/json">${JSON.stringify(payload)}</script>` // Hazard: raw data can close the tag.
}

void renderRequest
```

## A three-minute mental model

Create one scope per request, construct state with its Runtime, register it, render, and dehydrate; await cleanup after the response, then hydrate matching keys in the browser.

| Term                    | Meaning                                                              | Package API                                                          |
| ----------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Request scope           | An object holding this request’s registrations and pending hydration | createSSRRequestScope; the application creates one per request       |
| Runtime                 | The owner of state and reactive scheduling                           | scope.runtime; registration checks exact object identity             |
| Dehydration / hydration | Capture JSON data / apply that data to state                         | dehydrate / hydrate; hydration can partially succeed                 |
| Ownership               | Whether request closure must release an object                       | Registration defaults to owned true; detach transfers responsibility |
| State element           | A non-executable script carrying HTML-embedded data                  | createSSRStateScript; reading requires an explicit document          |

## Typical scenarios

| Scenario                                                      | How to combine                                                | Details                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Capture a request snapshot and release its owned store        | `createSSRRequestScope → register → dehydrate → disposeAsync` | [Complete example](./USEGUIDE.en.md#capture-a-request-snapshot-and-release-its-owned-store)        |
| Keep two requests in separate runtimes                        | `createSSRRequestScope × 2 → register → dehydrate`            | [Complete example](./USEGUIDE.en.md#keep-two-requests-in-separate-runtimes)                        |
| Keep ready data when another resource exceeds the wait budget | `registerResource → dehydrateAsync → disposeAsync`            | [Complete example](./USEGUIDE.en.md#keep-ready-data-when-another-resource-exceeds-the-wait-budget) |
| Embed JSON without letting data close its script element      | `serializeSSRState → deserializeSSRState`                     | [Complete example](./USEGUIDE.en.md#embed-json-without-letting-data-close-its-script-element)      |
| Create the complete non-executable state element              | `createSSRStateScript(state)`                                 | [Complete example](./USEGUIDE.en.md#create-the-complete-non-executable-state-element)              |
| Reject identifiers that can break the state element attribute | `createSSRStateScript(state, elementId)`                      | [Complete example](./USEGUIDE.en.md#reject-identifiers-that-can-break-the-state-element-attribute) |

## Installation

```bash
pnpm add @migaia/store-ssr
```

Install this package for the root API; the real Store/Resource examples on this page and in the guide also import these two packages directly:

```bash
pnpm add @migaia/store-ssr @migaia/store-light @migaia/resource
```

## Essential APIs

| API                                       | Purpose                                               |
| ----------------------------------------- | ----------------------------------------------------- |
| `createSSRRequestScope(options?)`         | Create a request registration and cleanup boundary    |
| `scope.register / registerResource`       | Register Stores / Resources from the same Runtime     |
| `scope.hydrate(state)`                    | Hydrate registered objects or keep pending keys       |
| `scope.dehydrate / dehydrateAsync`        | Capture state, optionally after waiting for resources |
| `scope.disposeAsync()`                    | Close the request and await owned cleanup             |
| `createSSRStateScript(state, elementId?)` | Build an escaped JSON state element                   |

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
