# Project Rules

## Design Documents

- Store every package-specific Software Design Document under `docs/<package>/` at the workspace root.
- Name each SDD `<document-name>.sdd.md`; the complete path must follow `docs/<package>/<document-name>.sdd.md`.
- Use the workspace package directory name for `<package>`, for example `docs/store/`, `docs/worker/`, or `docs/store-web/`.
- Do not place SDDs inside `packages/<package>/docs/` or `.codex/`.

### SDD structure and lifecycle

- Every SDD must use this minimum top-level structure, in this order: `0. 状态与闭合规则`, `1. 目标与范围`, `2. 现状与问题`, `3. 架构裁定与依赖方向`, `4. 公开契约/核心设计`, `5. 生命周期与错误语义`, `6. 迁移与实施批次`, `7. 测试与验收矩阵`, `8. 证据与闭合映射`, `9. 风险、deferred 与交付门禁`. A document may add domain sections, but may not omit ownership, dependency direction, verification, or delivery gates.
- The header must state status, scope, owners/affected packages, prerequisites, and linked SDDs. Do not mark a document `approved/complete` while any non-deferred clause is pending, red, implemented-but-unverified, blocked, or lacks evidence.
- Use the status progression `pending → red → implemented → verified`; use `blocked` only for a real external/design blocker, `deferred` only with an independent owner and destination, and `documentation-only` only with existing non-placeholder evidence.
- Every design must state package/layer ownership, allowed dependency direction, reuse decisions, rejected duplicate paths, non-goals, migration order, and verification boundaries before proposing file-level changes. Runtime-neutral foundations must not depend on Store, UI, DOM, Node, Worker, persistence, or adapter layers.
- Every requirement, design decision, and migration invariant receives a unique stable ID. Every test case receives a unique stable ID. Renumbering or reusing IDs is forbidden; moved IDs require a historical note.
- Every non-deferred requirement must map to at least one test case, and every test case must map to at least one requirement or design clause. The mapping is semantic: the assertion text must explicitly prove the clause, not merely mention its ID. Orphan cases and clauses without cases block delivery.
- For migration work, each unit must follow `inventory → red test → contract/error registration → implementation → delete duplicate/compatibility path → docs/exports/dependencies → package gates → direct-consumer gates → repository gates → evidence`. Existing tests are behavior baselines, not substitutes for migration cases.
- Behavior-equivalent migrations must preserve call count/order, disposer order and idempotency, Promise identity, abort/reason semantics, native error type, source/code/cause/errors identity, public exports, and message text unless a separate behavior-change clause authorizes the change.
- Any intentional behavior change must state old behavior, new behavior, impact, rationale, compatibility treatment, and dedicated test cases. Error-message migrations must explicitly update UT, README/USEGUIDE, error registry, and cross-package assertions; removing a legacy prefix is not complete until its old message tests are replaced by contract assertions.
- Every SDD must define failure and concurrency cases: reentrancy, close/dispose races, partial construction rollback, cleanup failure, cancellation, deadline, late rejection, duplicate registration, isolation, and retry/replacement where applicable.
- Every SDD must define the error policy for `throw`, `collect`, `report`, and `firstError` when applicable. A swallowed error must be reported; rollback errors must not replace the original primary error; the original error must remain reachable through `cause` or `AggregateError.errors`.
- Every SDD must separate graph/derivation semantics from lifecycle/resource semantics. Do not merge reactive dependency edges with capability/service edges, and do not reimplement lifecycle scopes, generations, leases, queues, rollback, or schedulers in feature packages.
- Every SDD must distinguish package-local tests, direct-consumer/integration tests, and repository-wide gates. The minimum code gate is `fmt → lint → typecheck → typecheck:test → test`, using the scripts actually present; missing gates must be reported, not treated as passed.
- Every `verified` item must include reproducible evidence: command, result/count, date, and commit or explicit dirty-worktree context. A dirty worktree must include a baseline report and must not be presented as a clean completion claim.
- Before delivery, run a hostile review against boundary inputs, failures, races, idempotency, error traceability, dependency direction, exports, package metadata, and stale documentation. Remaining risks must be classified as verified, implemented-unverified, deferred, blocked, existing defect, or environment failure.

## Completion Verification

- At the end of every implementation task, run formatting before lint and tests: `fmt → lint → test`.
- Use the repository/package formatter when one is configured. If no formatter or `fmt` script exists, report that explicitly instead of claiming formatting passed.
- Report the result of all three gates in the final response.
- Store all test files under the owning package's `test/` directory (for example, `packages/foo/test/`); do not mix test files with main source files.

## TypeScript Type Conventions

- Prefer `type` for every named type that it can express. Use `interface` only when TypeScript specifically requires interface semantics, such as declaration merging or module augmentation; document that reason next to the declaration.
- Prefix every named type with `I` so types remain visually distinct from runtime variables and values. This applies to object shapes, unions, function types, mapped types, conditional types, and exported/public types.
- Generic parameters (`T`, `K`, `V`, and similar) and anonymous inline object types are not named declarations and are exempt from the `I` prefix.
- Do not use TypeScript `enum` or `const enum`.
- Model enum-like domains with one runtime constant object plus a same-named key union. Enum-like constant/type pairs are exempt from the `I` prefix because their shared name intentionally represents one value/type namespace:

```ts
export const LogLevel = {
  debug: 'debug',
  info: 'info',
  error: 'error'
} as const

export type LogLevel = keyof typeof LogLevel
```

- New and modified code must follow these rules. Pre-existing violations are migration debt: fix them when their owning API is intentionally changed, but do not perform unrelated mass renames inside a scoped task.
- **Relative import/export/dynamic-import specifiers must carry an explicit `.js` extension** (`from './foo.js'`, `from './bar/index.js'`), even though the source file is `.ts`/`.tsx`. `tsconfig.base.json` sets `moduleResolution: "bundler"`, which resolves `.js`-suffixed specifiers against `.ts`/`.tsx` sources at typecheck time and leaves the extension untouched in compiled output. Every package also sets `"type": "module"`, so a real Node ESM loader (as opposed to Vite/Vitest's own extension-tolerant resolver) requires the extension on the compiled `dist/*.js` — omitting it produces `ERR_MODULE_NOT_FOUND` for any consumer that isn't going through a bundler. This bug existed repo-wide (~640 specifiers across 19 packages) until it was fixed in bulk; do not reintroduce it.

## JSDoc for State and Behavior

- Use ECMAScript `#` private fields for private class state; do not use TypeScript `private` for new private state.
- Every `#` private field must have an adjacent JSDoc comment explaining the state it stores and why it exists.
- Every named variable must have an adjacent JSDoc comment explaining its purpose. Trivial loop indices and immediately-obvious destructuring bindings are exempt.
- Every function, method, callback with non-obvious behavior, and constructor must have JSDoc describing what it does, its important inputs/outputs, and lifecycle or failure semantics where applicable.
- JSDoc must explain intent and ownership, not restate syntax or duplicate TypeScript types.

## Architecture-First Work

- Apply architecture-first reasoning to design, review, and implementation work. Before changing code, identify the owning package/layer, its public boundary, allowed dependency direction, and the existing abstraction that should own the behavior.
- Start from repository-wide structure and dependency flow, not from the nearest file that can be patched. A local change is acceptable only when it preserves or improves the intended package and layer boundaries.
- Search for existing implementations, protocols, lifecycle managers, adapters, utilities, and tests before adding code. Reuse or extend the canonical owner instead of creating a parallel implementation.
- Do not duplicate behavior, state machines, validation, codecs, platform detection, lifecycle handling, or type contracts across packages. Extract a shared lower-level abstraction when multiple legitimate consumers need the same semantics.
- Do not add wrappers, facades, aliases, or compatibility layers unless they enforce a real boundary or support an explicitly documented migration. Every temporary compatibility layer must name its removal condition.
- Keep dependency direction acyclic: runtime-neutral foundations must not depend on Store, UI frameworks, DOM, Node/Bun, Worker, persistence, or diagnostics adapters. Host and feature adapters depend inward on foundations, never the reverse.
- In code review, treat architectural duplication, misplaced ownership, new reverse dependencies, and repeated implementations as correctness issues, not optional cleanup.
- In design documents, state package ownership, dependency direction, reuse decisions, rejected duplicate paths, migration order, and verification boundaries before proposing file-level changes.

## Error Code Contract

Canonical definition and the full registry live in `docs/contracts/error-codes.md`. Read it before adding, renaming, or removing any error. The rules below are binding on every package.

- **Every error that leaves a package boundary carries a unique semantic code.** The pair `(source, code)` — package name plus a `SCREAMING_SNAKE` code unique within that package — must resolve to exactly one row in the registry. Bare `throw new Error('...')` is a defect, not a shortcut.
- **Codes are public API.** Renaming or removing one is a breaking change. Add the registry row before writing the throw site, never after.
- **Attach, do not replace.** Codes are added as properties via `Object.defineProperty`; never rebuild the error object. `DOMException`/`AbortError`, `RangeError`, `TypeError`, and `AggregateError` keep their runtime types because callers branch on them.
- **The original error must stay reachable.** Wrapping must place the original on `cause`; `AggregateError.errors[]` counts as a reachable path. Traversing `cause` (and `errors[]`) must reach the `=== originalError` instance in a bounded number of steps. Rewriting the top-level code is allowed as long as the original stays on the chain and stays first.
- **Never overwrite `stack`.** Every thrown value must carry a non-empty stack, and a wrapper must not substitute its own stack for the original's — the original stack survives on the cause chain.
- **Never swallow silently.** A `catch` that does not rethrow must `report`. Swallowing severs traceability.
- **Cross-realm boundaries serialize the whole chain.** Worker/RPC/persistence boundaries must transfer `source`, `code`, `name`, `message`, `stack`, and the flattened cause chain, and must not regenerate `stack` on the receiving side.
- **States are not error codes.** Availability (`blocked`/`failed`/`ready`), gate status (`gated`), lifecycle phases (`open`/`closing`/`terminal`), and graceful-timeout degradation are events or return values, never thrown codes.
- **Every package maintains `src/error-code.ts`.** It is the single in-code declaration site for that package's codes — one constant object plus its value union, following the enum-like convention above. No code may be declared inline at a throw site or scattered across modules. A package with no errors yet still ships the file with an empty constant and a comment stating why.
- **Every code entry carries JSDoc describing its scenario**: what state or input triggers it, which contract clause it enforces, and what the caller is expected to do. Restating the code name is not a description.

```ts
// packages/foo/src/error-code.ts
export const FooErrorCode = {
  /**
   * Thrown when `own()` is called after `close()`.
   * The container stopped accepting work; the caller must create a new scope
   * instead of reviving this one. Enforces the two-phase contract.
   */
  scopeClosed: 'SCOPE_CLOSED'
} as const

export type IFooErrorCode = (typeof FooErrorCode)[keyof typeof FooErrorCode]
```

- Packages whose code table is not finalized yet still obey the structural and traceability rules above: register the code in `docs/contracts/error-codes.md` and declare it in `src/error-code.ts` first, then use it.

## Function Context Rules

- Do not use `bind`, `apply`, or `call` anywhere in project code or tests. Use arrow functions that capture the required context instead.
