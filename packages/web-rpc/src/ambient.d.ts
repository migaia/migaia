/**
 * `AbortController`/`AbortSignal`/timers/`structuredClone`/`crypto.randomUUID` are universal
 * runtime globals (Node ≥15/17, every evergreen browser, Deno, Bun, Workers) but TypeScript only
 * ships their types bundled inside `lib.dom.d.ts` (or `@types/node`, which pulls in a much larger
 * Node-shaped global surface than this file wants to claim) — there's no DOM-free, Node-free lib
 * fragment that has just these. This file exists solely so
 * `tsconfig.core.json`/`tsconfig.node-adapter.json` (see their own comments) can typecheck against
 * a lib set with _no_ DOM/Worker/Node types at all, to prove the RPC core doesn't accidentally pick
 * up some other DOM/Node global along the way. It declares only the members actually called.
 *
 * Must never be visible to a program that also has DOM lib — `packages/web-rpc/ tsconfig.json`
 * (this package's own dev typecheck) and the app's `tsconfig.app.json` both already get the real,
 * complete versions of all of these from `lib.dom.d.ts`, and a second declaration here would
 * collide with them. See both configs' `exclude` lists (the app never reaches this file at all — it
 * lives outside `src/` — but the exclude is there too, for anyone who later widens that config's
 * `include`).
 */
declare global {
  interface AbortSignal {
    readonly aborted: boolean;
    addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
    removeEventListener(type: 'abort', listener: () => void): void;
  }

  class AbortController {
    readonly signal: AbortSignal;
    abort(reason?: unknown): void;
  }

  function setTimeout(handler: () => void, timeoutMs?: number): number;
  function clearTimeout(handle: number): void;
  function structuredClone<T>(value: T): T;

  var crypto: { randomUUID(): string };
}

export {};
