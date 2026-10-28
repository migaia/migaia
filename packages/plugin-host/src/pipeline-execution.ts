/** Owns fixed pipeline execution ports and terminal-result capture, not runner or lease algorithms. */
import ERROR_TEXT, { tagPluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'

/** Keeps stage/downstream failure identity and ordering under the existing pipeline code. */
export function combinePipelineFailures(
  stageError: unknown,
  downstreamError: unknown
): AggregateError {
  return tagPluginHostError(
    new AggregateError(
      [stageError, downstreamError],
      ERROR_TEXT.PIPELINE_STAGE_AND_DOWNSTREAM_FAILED
    ),
    PluginHostErrorCode.pipelineFailed
  )
}

/** Last terminal invocation owns its eventual result, even if earlier invocations settle later. */
export class PluginPipelineAsyncTerminal<TValue, TResult> {
  /** Original terminal callback; this owner never translates its failure. */
  readonly #done: (value: TValue) => TResult
  /** Per-invocation cells keep late completion from overwriting the last invocation. */
  #result: { value?: Awaited<TResult> } | undefined

  /** Captures the terminal callback without invoking it. */
  constructor(done: (value: TValue) => TResult) {
    this.#done = done
  }

  /** Invokes once and projects only fulfillment; the runner retains original rejection identity. */
  accept(value: TValue): Promise<Awaited<TResult>> {
    /** This invocation's cell remains independent from any later terminal call. */
    const terminal: { value?: Awaited<TResult> } = {}
    this.#result = terminal
    /** Keep the terminal callback unbound, as in the original direct function invocation. */
    const done = this.#done
    return Promise.resolve(done(value)).then((output) => {
      terminal.value = output
      return output
    })
  }

  /** Undefined also represents a normal short-circuit with no terminal invocation. */
  get result(): Awaited<TResult> | undefined {
    return this.#result?.value
  }
}
