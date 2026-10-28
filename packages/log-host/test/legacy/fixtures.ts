import type { ILogEntry, ILogPluginCore, IShutdownReason } from '../../src/index.ts'

/** Keep peer deadline policy out of tests of the logging owner's own drain boundary. */
export const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

/** Optional observations are registered during the real plugin installation window. */
type ICaptureOptions = {
  sinks?: readonly ((entry: ILogEntry) => void | Promise<void>)[]
  flush?: () => void | Promise<void>
  shutdown?: (reason: IShutdownReason) => void | Promise<void>
  dispose?: () => void | Promise<void>
}

/** A real plugin observes the public core without adding a compatibility facade to the host. */
export class CapturePlugin {
  /** Every fixture installs one capture registration in its own host. */
  readonly name = 'legacy-capture'
  /** Independent shallow snapshots make entry and ordering assertions observable. */
  readonly entries: ILogEntry[] = []
  /** Returned handles allow a case to revoke its own sink during delivery. */
  readonly removals: Array<() => void> = []
  /** The actual core remains available for capabilities absent from the new public facade. */
  core!: ILogPluginCore
  /** Optional callbacks belong to this fixture and are registered only during install. */
  #options: ICaptureOptions

  /** Capture observation callbacks before the host admits the plugin. */
  constructor(options: ICaptureOptions = {}) {
    this.#options = options
  }

  /** Register through the supported core and keep resource ownership with plugin-host. */
  install(core: ILogPluginCore): Record<string, never> {
    this.core = core
    core.useSink((entry) => this.receive(entry))
    for (const sink of this.#options.sinks ?? []) this.removals.push(core.useSink(sink))
    if (this.#options.flush) core.onFlush(this.#options.flush)
    if (this.#options.shutdown) core.onShutdown(this.#options.shutdown)
    if (this.#options.dispose) core.onDispose(this.#options.dispose)
    return {}
  }

  /** Keep exactly the snapshot passed by the owner rather than reconstructing an entry. */
  receive(entry: ILogEntry): void {
    this.entries.push(entry)
  }
}

/** A controlled Promise leaves settlement under the business scenario's explicit control. */
export class Deferred<T = void> {
  /** The externally observable operation retains its original Promise identity. */
  readonly promise: Promise<T>
  /** Fulfillment is captured once by the Promise constructor. */
  resolve!: (value: T | PromiseLike<T>) => void
  /** Rejection is captured once so late failures can be observed after a timeout. */
  reject!: (reason: unknown) => void

  /** Allocate only a Promise and its two native settlement capabilities. */
  constructor() {
    this.promise = new Promise<T>((resolve, reject) => this.capture(resolve, reject))
  }

  /** Retain native settlement functions without wrapping their outcomes. */
  capture(resolve: (value: T | PromiseLike<T>) => void, reject: (reason: unknown) => void): void {
    this.resolve = resolve
    this.reject = reject
  }
}

/** Advance the asynchronous entry pipeline without changing a clock or deadline. */
export async function microtasks(): Promise<void> {
  // Thirty-two turns are a fixed fixture bound, independent of the log or plugin inventory.
  for (let index = 0; index < 32; index++) await Promise.resolve()
}

/** Wait for one host turn when Node's unhandled-rejection detector is part of an assertion. */
export function nextTurn(delay = 0): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, delay))
}

/** Select messages without adding assertions or reading private host state. */
export function messages(entries: readonly ILogEntry[]): string[] {
  return entries.map(entryMessage)
}

/** Read the business message carried by one native entry. */
function entryMessage(entry: ILogEntry): string {
  return entry.message
}
