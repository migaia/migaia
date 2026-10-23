import {
  defineProbe,
  RpcProbeKind,
  RpcProbeKindName,
  RpcProbeOutcome,
  RpcProbeOutcomeName,
  RpcProbeStage,
  RpcProbeStageName,
  type IRpcProbe,
  type IRpcProbeEventView
} from '@migaia/rpc-host/probe'
import { reportFailure } from '../collector/report.js'
import { classifyRpcFailure } from '../collector/failure.js'
import { RpcDevtoolsErrorCode } from '../error-code.js'
import { identifyDevtoolsError } from '../errors.js'
import { RpcLogCategory, RpcLogErrorText, RpcLogLevel, RpcLogMessage } from './text.js'
import type { IRpcLogProbeOptions, IRpcLogSink } from './types.js'

/** A selected sink retains the logger receiver through a construction-time arrow closure. */
type ILogMethod = (message: string, fields: object) => unknown

/**
 * Fields form the logger representation boundary; error and captured content remain original
 * references.
 */
type ILogFields = {
  method: string | undefined
  messageId: string | undefined
  senderId: string | undefined
  targetId: string | undefined
  trace: string | undefined
  durationMs: number
  outcome: string | undefined
  kind: string | undefined
  rejection: string | undefined
  lifecycle: string | undefined
  peerId: string | undefined
  error: unknown
  content?: unknown
}

/** Rejects construction inputs with native TypeError and the registered devtools identity. */
function invalid(message: string, cause?: unknown): never {
  throw identifyDevtoolsError(
    new TypeError(message, cause === undefined ? undefined : { cause }),
    RpcDevtoolsErrorCode.invalidOption
  )
}

/** Compiles option-level overrides once; missing entries preserve the first-party defaults. */
function compileLevels(options: IRpcLogProbeOptions): number[] {
  /** The six slots correspond exactly to RpcLogCategory indexes. */
  const levels: number[] = [
    RpcLogLevel.error,
    RpcLogLevel.warn,
    RpcLogLevel.warn,
    RpcLogLevel.warn,
    RpcLogLevel.warn,
    RpcLogLevel.info
  ]
  if (options.levels === undefined) return levels
  if (
    typeof options.levels !== 'object' ||
    options.levels === null ||
    Array.isArray(options.levels)
  )
    invalid(RpcLogErrorText.levelsInvalid)
  for (const category of Object.keys(options.levels)) {
    if (!Object.hasOwn(RpcLogCategory, category)) invalid(RpcLogErrorText.levelsInvalid)
    /** The cold policy table admits only one of the five documented level names. */
    const level = options.levels[category as RpcLogCategory]
    if (typeof level !== 'string' || !Object.hasOwn(RpcLogLevel, level))
      invalid(RpcLogErrorText.levelsInvalid)
    levels[RpcLogCategory[category as RpcLogCategory]] = RpcLogLevel[level]
  }
  return levels
}

/** The shared failure owner's dense ordinals map once to this logger's six-category policy. */
const failureCategories = [
  RpcLogCategory.failed,
  RpcLogCategory.timeout,
  RpcLogCategory.aborted
] as const

/**
 * Builds one standalone probe. Successful/unsubscribed events stop before message or fields
 * construction. Every qualifying event makes exactly one synchronous logger call; buffering and I/O
 * remain owned by the logger. Sink failures are reported and never reach the business caller.
 */
export function createRpcLogProbe(
  logger: IRpcLogSink,
  options: IRpcLogProbeOptions = {}
): IRpcProbe {
  if (
    typeof logger !== 'object' ||
    logger === null ||
    typeof logger.debug !== 'function' ||
    typeof logger.info !== 'function' ||
    typeof logger.warn !== 'function' ||
    typeof logger.error !== 'function'
  )
    invalid(RpcLogErrorText.loggerInvalid)
  if (typeof options !== 'object' || options === null) invalid(RpcLogErrorText.optionsInvalid)
  if (
    options.slowMs !== undefined &&
    (typeof options.slowMs !== 'number' || !Number.isFinite(options.slowMs) || options.slowMs < 0)
  )
    invalid(RpcLogErrorText.slowInvalid)
  if (
    (options.message !== undefined && typeof options.message !== 'function') ||
    (options.content !== undefined && typeof options.content !== 'boolean')
  )
    invalid(RpcLogErrorText.optionsInvalid)
  /** Stage defaults reuse canonical names and subscribe to no encoded/frame/carrier paths. */
  const stages = options.stages ?? [
    RpcProbeStageName[RpcProbeStage.message],
    RpcProbeStageName[RpcProbeStage.peer]
  ]
  if (!Array.isArray(stages)) invalid(RpcLogErrorText.stagesInvalid)
  for (let i = 0; i < stages.length; i++) {
    if (
      stages[i] !== RpcProbeStageName[RpcProbeStage.message] &&
      stages[i] !== RpcProbeStageName[RpcProbeStage.peer]
    )
      invalid(RpcLogErrorText.stagesInvalid)
  }
  /** Policy dispatch is precomputed; emit never searches option keys or logger methods. */
  const levels = compileLevels(options)
  /** These construction-time closures preserve structural method receivers without bind/call. */
  const sinks: readonly ILogMethod[] = [
    (message, fields) => logger.debug(message, fields),
    (message, fields) => logger.info(message, fields),
    (message, fields) => logger.warn(message, fields),
    (message, fields) => logger.error(message, fields)
  ]
  /** Capture immutable options before caller mutations can retarget later diagnostic events. */
  const slowMs = options.slowMs
  /** Formatting runs only after the numeric qualification and off-level branches. */
  const message = options.message
  /** Captured content is opted in per subscribed stage through defineProbe. */
  const content = options.content === true || options.capture !== undefined
  /** The supplied reporter is fixed at construction like the other probe callbacks. */
  const onError = options.onError
  /** All sync and async logger failures share the parent collector's diagnostic boundary. */
  const onFailure = (error: unknown): void => reportFailure(error, onError)
  /** Filled by defineProbe before any observer can invoke emit. */
  let probe: IRpcProbe
  /** Selects by integers first; successful events return without reading object-boundary fields. */
  const emit = (view: IRpcProbeEventView): void => {
    try {
      if ((probe.stageMask & (1 << view.stage)) === 0) return
      /** Unqualified events and disabled categories never allocate a log fields object. */
      let category: number
      if (view.stage === RpcProbeStage.peer && view.kind === RpcProbeKind.lifecycle)
        category = RpcLogCategory.lifecycle
      else if (view.outcome === RpcProbeOutcome.failed)
        category = failureCategories[classifyRpcFailure(view.error)]!
      else if (view.outcome === RpcProbeOutcome.rejected) category = RpcLogCategory.rejected
      else if (
        view.outcome === RpcProbeOutcome.settled &&
        slowMs !== undefined &&
        view.durationMs >= slowMs
      )
        category = RpcLogCategory.slow
      else return
      /** The compiled negative sink index implements the documented off policy. */
      const level = levels[category]!
      if (level === RpcLogLevel.off) return
      // One synchronous logger-boundary object extracts scalars from the reusable view.
      /** Only logger-visible qualified events create this object; nested values retain ownership. */
      const fields: ILogFields = {
        method: view.method,
        messageId: view.messageId,
        senderId: view.senderId,
        targetId: view.targetId,
        trace: view.trace,
        durationMs: view.durationMs,
        outcome: RpcProbeOutcomeName[view.outcome],
        kind: RpcProbeKindName[view.kind],
        rejection: view.rejection,
        lifecycle: view.lifecycle,
        peerId: view.peerId,
        error: view.error
      }
      // The canonical emitter supplies content only after the configured redactor runs.
      if (content && (probe.captureMask & (1 << view.stage)) !== 0) fields.content = view.content
      /** Logger invocation stays synchronous; no Promise is introduced for a synchronous sink. */
      const result = sinks[level]!(
        message === undefined ? RpcLogMessage[category]! : message(view),
        fields
      )
      if ((typeof result === 'object' && result !== null) || typeof result === 'function') {
        /** Native Promise and foreign thenable failures require their existing rejection seam. */
        const thenable = result as {
          then?: (fulfilled: undefined, rejected: (error: unknown) => void) => unknown
        }
        if (typeof thenable.then === 'function') thenable.then(undefined, onFailure)
      }
    } catch (error) {
      onFailure(error)
    }
  }
  try {
    probe = defineProbe({
      stages,
      capture: options.capture ?? (content ? stages : undefined),
      redact: options.redact,
      methods: options.methods,
      sample: options.sample,
      onError,
      emit
    })
  } catch (cause) {
    // Core remains the canonical option validator; the logger API exposes its own registered code.
    invalid(RpcLogErrorText.optionsInvalid, cause)
  }
  return probe
}
