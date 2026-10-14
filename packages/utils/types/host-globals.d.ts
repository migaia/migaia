/**
 * Workspace-internal host globals for packages that typecheck against the ES library only.
 *
 * Every supported runtime (browsers, workers, Node, Deno, Bun) provides these globals, but the
 * ES library does not declare them. Packages include this file from their source `tsconfig.json`
 * instead of DOM or Node types, so no public declaration can depend on a host environment. It is a
 * compile-time input only: tsc never emits a `.d.ts` input, and the file is not published.
 *
 * `AbortSignal`, `MessageEvent` and `Transferable` are deliberately absent: public types use the
 * structural `IAbortSignal` from `@migaia/utils/promise`, `unknown[]` transfer lists and
 * structural event shapes instead, and a direct reference fails to compile.
 */
declare global {
  function setTimeout(callback: (...args: unknown[]) => void, delayMs?: number, ...args: unknown[]): unknown
  function clearTimeout(handle: unknown): void
  function setInterval(callback: (...args: unknown[]) => void, delayMs?: number, ...args: unknown[]): unknown
  function clearInterval(handle: unknown): void
  function queueMicrotask(callback: () => void): void
  function structuredClone<T>(value: T, options?: { readonly transfer?: readonly unknown[] }): T
  function btoa(data: string): string
  function atob(data: string): string

  // eslint-disable-next-line no-var
  var console: {
    error(...values: unknown[]): void
    warn(...values: unknown[]): void
    info(...values: unknown[]): void
    log(...values: unknown[]): void
    debug(...values: unknown[]): void
  }
  // eslint-disable-next-line no-var
  var performance: { now(): number }
  // eslint-disable-next-line no-var
  var crypto:
    | {
        randomUUID?: () => string
        getRandomValues?: <T extends ArrayBufferView>(array: T) => T
        subtle?: { digest(algorithm: 'SHA-256', backing: ArrayBuffer): Promise<ArrayBuffer> }
      }
    | undefined

  class AbortController {
    /** Same shape as `IAbortSignal` in `@migaia/utils/promise`; inlined so this file imports nothing. */
    readonly signal: {
      readonly aborted: boolean
      readonly reason?: unknown
      addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
      removeEventListener(type: 'abort', listener: () => void): void
    }
    abort(reason?: unknown): void
  }
  class DOMException extends Error {
    constructor(message?: string, name?: string)
    readonly code: number
  }
  class TextEncoder {
    encode(input?: string): Uint8Array<ArrayBuffer>
    encodeInto(input: string, destination: Uint8Array): { read: number; written: number }
  }
  class TextDecoder {
    constructor(label?: string, options?: { readonly fatal?: boolean; readonly ignoreBOM?: boolean })
    decode(input?: ArrayBuffer | ArrayBufferView, options?: { readonly stream?: boolean }): string
  }
  class URL {
    constructor(input: string, base?: string)
    readonly href: string
    readonly protocol: string
    readonly host: string
    readonly hostname: string
    readonly port: string
    readonly pathname: string
    readonly search: string
    readonly hash: string
    readonly origin: string
  }
}

export {}
