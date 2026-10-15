# Release notes

## Unreleased — 2026-10-15 review closure

### Breaking changes

- `@migaia/lifecycle` no longer re-exports `probeThenable`,
  `assimilateCapturedThen`, `IThenableProbe`, `ThenableProbeKind`, or
  `IThenableProbeKind` from its root or errors entry. Import these helpers and
  types from `@migaia/utils/function`. The utils discriminant has three outcomes:
  `notThenable`, `thenable`, and `failed`. The lifecycle-only `promise` variant
  was an implementation detail and has been removed.
- `@migaia/plugin-host` no longer exports `ILocaleKey`. The unused locale type
  had no runtime effect; the package continues to own its English error text.

### Behavior

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
