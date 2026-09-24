import { containAsyncRejection } from '@migaia/lifecycle'
import type { IPluginHostDiagnostic, IPluginHostErrorCode } from './typing.js'

/** Runtime-provided last-resort error sink (`reportError` in browsers, Deno and Bun), if present. */
type IGlobalErrorSink = Readonly<{ reportError?: (error: unknown) => void }>

/**
 * Host-configured terminal sinks (`onDiagnosticFailure`), keyed by the exact diagnostic function a
 * Host hands to its runtimes. Keying by function lets every runtime keep its plain diagnostic port
 * while failures of that port still reach the owning Host's sink.
 */
const terminalSinks = new WeakMap<Function, (failure: unknown) => void>()

/** Associates one Host diagnostic function with that Host's `onDiagnosticFailure` sink. */
export const bindTerminalSink = (diagnostic: Function, sink: (failure: unknown) => void): void => {
  terminalSinks.set(diagnostic, sink)
}

/** Delivers to the runtime's global `reportError` when one exists (browsers, Deno, Bun). */
const reportToRuntime = (failure: unknown): void => {
  try {
    const sink = (globalThis as IGlobalErrorSink).reportError
    if (typeof sink === 'function') sink(failure)
  } catch {
    // The runtime sink is the terminal observer; nothing further exists to receive its failure.
  }
}

/**
 * Forwards a failure of the Host diagnostic outlet itself. The outlet is the last Host-owned
 * observer, so its failure goes to the Host's `onDiagnosticFailure` sink bound to `diagnostic`, or
 * — when none is bound or that sink throws too — to the runtime's global `reportError`. It never
 * throws: callers are cleanup and recovery paths whose primary result must not be replaced.
 */
export const reportTerminalFailure = (failure: unknown, diagnostic?: Function): void => {
  const sink = diagnostic ? terminalSinks.get(diagnostic) : undefined
  if (!sink) {
    reportToRuntime(failure)
    return
  }
  try {
    sink(failure)
  } catch (sinkFailure) {
    reportToRuntime(sinkFailure)
  }
}

/**
 * Delivers one message (and, when given, the exact contained error object) to a Host diagnostic
 * outlet. Synchronous throws and async rejections of the outlet are forwarded to the Host's
 * terminal sink via `reportTerminalFailure`, never swallowed and never propagated into the
 * reporting caller.
 */
export const reportDiagnostic = (
  diagnostic: IPluginHostDiagnostic | ((message: string, code?: IPluginHostErrorCode) => unknown),
  message: string,
  code?: IPluginHostErrorCode,
  error?: unknown
): void => {
  try {
    const outcome =
      error === undefined
        ? diagnostic(message, code)
        : (diagnostic as IPluginHostDiagnostic)(message, code, error)
    containAsyncRejection(outcome, (failure) => reportTerminalFailure(failure, diagnostic))
  } catch (failure) {
    reportTerminalFailure(failure, diagnostic)
  }
}
