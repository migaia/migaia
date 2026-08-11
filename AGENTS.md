# Project Rules

## Design Documents

- Store every package-specific Software Design Document under `docs/<package>/` at the workspace root.
- Name each SDD `<document-name>.sdd.md`; the complete path must follow `docs/<package>/<document-name>.sdd.md`.
- Use the workspace package directory name for `<package>`, for example `docs/store/`, `docs/worker/`, or `docs/store-web/`.
- Do not place SDDs inside `packages/<package>/docs/` or `.codex/`.

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

## Function Context Rules

- Do not use `bind`, `apply`, or `call` anywhere in project code or tests. Use arrow functions that capture the required context instead.
