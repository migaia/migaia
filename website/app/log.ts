/** Reporting surface the website needs from its logger; arguments keep their original identity. */
type IWebsiteLog = { error(...args: unknown[]): void }

/**
 * Creates the page's single console-only logger. `@migaia/logger` is a plugin host with its own
 * pipeline, so it is loaded only when the first error is reported and never weighs on the first
 * screen. Errors reported while it loads are queued in order and replayed once it is ready.
 */
function createWebsiteLog(): IWebsiteLog {
  /** Calls received before the logger finished loading, delivered in their original order. */
  let pending: unknown[][] = []
  /** The loaded logger, or the console fallback when loading or construction failed. */
  let ready: IWebsiteLog | undefined
  /** Single in-flight load shared by every early call. */
  let loading: Promise<void> | undefined

  /** Loads and constructs the logger once; any failure degrades to the host console. */
  const load = () =>
    (loading ??= import('./log-runtime.js')
      .then(
        ({ createConsoleLogger }) => createConsoleLogger(),
        (error: unknown) => {
          console.error(error)
          return undefined
        }
      )
      .then((logger) => {
        ready = logger ?? { error: (...args) => console.error(...args) }
        /** Calls queued before readiness, replayed exactly once. */
        const queued = pending
        pending = []
        for (const args of queued) ready.error(...args)
      }))

  return {
    error(...args) {
      if (ready) return ready.error(...args)
      pending.push(args)
      void load()
    }
  }
}

/** Page-lifetime reporting owner shared by browser enhancements and recovery rendering. */
export const log = createWebsiteLog()
