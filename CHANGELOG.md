# Release notes

## Unreleased — 2026-10-15 review closure

### Breaking changes

- Capability topology readers no longer expose `metrics()` or
  `ITopologyIndexMetrics`. Dynamic mutation results no longer contain `metrics`
  or export `IGraphTraversalMetrics`. Use `affected`, `topologyChanged` and
  `generation` for business outcomes; traversal counters and wall-clock sampling
  have been removed from production rather than moved to another public seam.

- CapabilityHost removes `enableResult`, `enableLegacyBoolean` and `disableNow`.
  Use `enable()` for the structured result and derive a boolean from its status
  when needed. `disable()` starts revocation synchronously and returns a Promise
  that settles after physical cleanup; retain and await that Promise.
- Lifecycle keeps unused `createLifecycleUnit` and its option/result types internal.
  Use a generation controller with domain-owned loading state. String-key tracking
  uses the existing `createStringLeaseRegistry`; its old
  `createStringQuiescenceTracker` name is internal. `validateSchedulerTime`,
  `validateSchedulerDelay`, `tagLifecycleError` and `createLifecycleRangeError`
  are removed from root and leaf exports. Explicit scheduler/error entry modules
  prevent internal implementation exports from leaking through package subpaths.

- `@migaia/event-subscriber` subscription helpers now have one public owner:
  import `subscribeOnce`, `subscribeUntil` and `subscribeSubscriber` from
  `@migaia/event-subscriber/subscriber`. Their root aliases and channel
  `subscribeOnce()` / `subscribeUntil()` methods are removed. Replace
  `channel.subscribeUntil(signal, listener)` with
  `subscribeUntil(channel, signal, listener)`; cancellation and listener behavior
  are unchanged. No production consumer used the removed surface.

- `@migaia/lifecycle` no longer re-exports `probeThenable`,
  `assimilateCapturedThen`, `IThenableProbe`, `ThenableProbeKind`, or
  `IThenableProbeKind` from its root or errors entry. Import these helpers and
  types from `@migaia/utils/function`. The utils discriminant has three outcomes:
  `notThenable`, `thenable`, and `failed`. The lifecycle-only `promise` variant
  was an implementation detail and has been removed.
- `@migaia/plugin-host` no longer exports `ILocaleKey`. The unused locale type
  had no runtime effect; the package continues to own its English error text.

### Behavior

- `@migaia/reactive` ownership queries accept registered function references.
  `ownerOf()` returns their runtime instead of `undefined`, and `assertOwnedBy()`
  rejects a different runtime with the existing `CROSS_RUNTIME` error.

- Plugin-host rejects synchronous hook calls to `activate()` before returning a shared
  activation Promise. Outside callers still share that Promise while a hook is pending.
  After an `await`, hook origin cannot be distinguished: activating the same registration
  returns the shared Promise. Awaiting it from that hook fails with
  `MUTATION_EXECUTION_TIMEOUT` when the finite execution budget expires; with
  `mutationTimeoutMs: false`, this self-wait can remain pending.

- Failed lazy plugin activation withdraws stages, shared receipts and extensions,
  releases provisional and committed resources, and keeps the same cold handle
  retryable with a fresh scope and batch-bound core. Cleanup failures remain
  secondary. Previously committed resources leaked or cleanup replaced primary.
  Shared publication failures on non-extensible Hosts retain native TypeError
  with `PLUGIN_INSTALL_FAILED`, and reserve no failed shared family.

- Capability publishes `GraphReadinessState` at its root, `GraphBlockedReason`
  at `/graph`, and `GraphBindingReleaseReason` at `/graph/dynamic` as canonical
  constants for existing string domains. Host error text has one private owner;
  existing messages, codes and state values are preserved.

- Static capability graphs invoke independent starts in each topology level
  before awaiting that level. Previously each node completed serially. A failed
  level fully settles before rollback; its first failure in topology order stays
  primary and later failures remain reachable through `errors`. Release order
  stays reverse topology order. Declare a dependency edge when completion order
  matters; same-level completion order is no longer serial.

- Dynamic capability graph registration and replacement snapshot node identity,
  kind, start and dependencies once when their queued mutation is admitted.
  Later caller mutation no longer rewrites graph facts. Captured starts retain
  their original receiver and return value; throwing getters become coded
  `GRAPH_INVALID_NODE` failures. Pure and incremental topology share private
  edge admission, while static ordinal admission remains local to its owner.
- Capability graph `ctx.own()` rejects a missing or non-callable `force` during
  registration with `GRAPH_INVALID_OPTION`, retaining the lifecycle TypeError on
  `cause`. Previously the facade hid it until disposal. Dynamic graph reporters
  now contain returned Promise rejections while preserving mutation outcomes.
- Middleware pipeline construction snapshots three distinct generator sentinels;
  duplicate identities now throw `INVALID_OPTION` instead of silently halting.
  Later caller mutation no longer changes dispatch. A non-object options argument
  gets its own diagnostic text, and later signal getter failures preserve their
  cause behind a coded `INVALID_OPTION` TypeError.
- Lifecycle adds `abortableDelay`, returning `true` for elapsed time and `false`
  for abort delivery. HTTP backoff and Resource retries share its timer/listener
  ownership; HTTP keeps cancellation successful and Resource keeps its AbortError.
  A registration or scheduling throw remains primary even if an injected host
  invoked its callback before returning. Wait failures carry `DELAY_FAILED`.
- `boundedWait` gains optional `reportCleanup`. Without it, cleanup failures
  still reject. Logger drain uses this existing deadline primitive and reports
  cleanup failures without replacing the task/deadline winner.
- Synchronous lifecycle disposal uses the same descriptor admission and ordering
  as asynchronous disposal. A descriptor changed to an invalid force or order
  after registration reports `INVALID_OPTION` while other valid resources still
  release, rather than leaking a raw TypeError or sorting with NaN.
- Calling lifecycle scope `own()` from outside a synchronous disposer callback
  while teardown is pending reports `SCOPE_CLOSED`. Previously it incorrectly
  reported `SCOPE_REENTRANT_OWN`; actual synchronous disposer reentry retains that
  dedicated code.
- Lifecycle callback-result observation uses the canonical utils thenable
  boundary. It still reads `.then` once and preserves its receiver. A reporter
  throwing while handling a throwing `.then` getter is contained, consistently
  with reporter failures during asynchronous rejection observation.
