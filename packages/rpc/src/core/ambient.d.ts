/**
 * `tsconfig.core.json` intentionally typechecks the RPC core against `lib: ["ES2023"]` only — no
 * DOM, no Node types — to prove the core is importable independent of any specific host. A handful
 * of core files still need to reference host-provided globals (`AbortController`, `setTimeout`,
 * `crypto`) that exist in every real host this code runs in (browsers, Node, Deno, Bun, workers),
 * just not in the bare ES2023 lib. These are minimal _structural_ ambient declarations — just
 * enough shape for core's own usage to typecheck — not a full reimplementation of the DOM/Node
 * lib.d.ts surface.
 */
declare global {
  interface AbortSignal {
    readonly aborted: boolean
    /** Preserves the first close cause for core-only shutdown consumers. */
    readonly reason: unknown
    addEventListener(
      type: 'abort',
      listener: () => void,
      options?: { readonly once?: boolean }
    ): void
    removeEventListener(type: 'abort', listener: () => void): void
  }

  class AbortController {
    readonly signal: AbortSignal
    abort(reason?: unknown): void
  }

  function setTimeout(callback: () => void, delayMs?: number): unknown
  function clearTimeout(handle: unknown): void
  /** Schedules the memory adapter's deferred delivery in every supported host. */
  function queueMicrotask(callback: () => void): void
  /** All supported hosts clone admitted binary outcomes without requiring DOM declarations. */
  function structuredClone<T>(value: T): T

  // eslint-disable-next-line no-var
  var crypto:
    | {
        randomUUID?: () => string
        getRandomValues?: (array: Uint8Array) => Uint8Array
        /** Optional stateless SHA-256 service; absence prevents native binary qualification. */
        subtle?: { digest(algorithm: 'SHA-256', backing: ArrayBuffer): Promise<ArrayBuffer> }
      }
    | undefined
}

export {}
