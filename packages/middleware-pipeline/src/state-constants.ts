/**
 * Defines four stable execution modes for public runners and types. These values do not represent
 * host lifecycle states.
 */
export const MiddlewarePipelineMode = {
  /** Linear synchronous stages: next only submits a value; downstream runs after the stage returns. */
  sync: 'sync',
  /** Awaitable onion stages: the first next starts downstream and returns its promise. */
  async: 'async',
  /** Synchronous generators: drain each stage and reduce its final return before continuing. */
  generator: 'generator',
  /** Await each generator iteration and terminal callback; run returns a promise. */
  asyncGenerator: 'async-generator'
} as const

/** Required construction mode values; there is no implicit default mode. */
export type IMiddlewarePipelineMode =
  (typeof MiddlewarePipelineMode)[keyof typeof MiddlewarePipelineMode]

/** Selects whether an active stage may submit one or several downstream values. */
export const MiddlewarePipelineNext = {
  /** Keeps the existing duplicate-call protocol and selects one downstream value. */
  single: 'single',
  /** Gives every submitted value its own traversal of the remaining stages. */
  multiple: 'multiple'
} as const

/** Construction policy shared by runners and their canonical lifting adapters. */
export type MiddlewarePipelineNext = keyof typeof MiddlewarePipelineNext

/**
 * Defines stable `next()` violations emitted by every runner. Hosts convert these values into
 * diagnostics or domain errors.
 */
export const MiddlewarePipelineViolation = {
  /** Next was called after its stage finished; it cannot restart downstream. */
  late: 'late',
  /**
   * Next was called again while its stage was still active; the first accepted value remains
   * selected.
   */
  duplicate: 'duplicate'
} as const

/**
 * Names reported for rejected next calls; violations are diagnostics rather than thrown error
 * codes.
 */
export type IMiddlewarePipelineViolation =
  (typeof MiddlewarePipelineViolation)[keyof typeof MiddlewarePipelineViolation]

/**
 * Optional host reporter for late/duplicate next. The default does nothing; a thrown reporter
 * failure is identified and propagated from the call that reached it, including a captured late
 * next.
 */
export type IMiddlewarePipelineViolationHandler = (kind: IMiddlewarePipelineViolation) => void

/**
 * Returns undefined as an explicit downstream payload from a generator stage. An ordinary or
 * implicit undefined return halts instead. The pipeline payload type must include undefined.
 */
export const GENERATOR_UNDEFINED = Symbol('middleware-pipeline.generator-undefined')

/** Return from a generator stage to stop the run without executing later stages or done. */
export const GENERATOR_HALT = Symbol('middleware-pipeline.generator-halt')

/**
 * Return from a generator stage to continue with its last yielded value. With no yields, the input
 * value continues unchanged. Intermediate yields are not sent to downstream stages individually.
 */
export const GENERATOR_CONTINUE = Symbol('middleware-pipeline.generator-continue')

/**
 * Generator control symbol set. Supply custom identities when integrating an existing generator
 * protocol; all three must be distinct symbols. The factory reads each once and freezes its copy.
 */
export type IGeneratorMiddlewareSignals = {
  /** Explicitly forwards an undefined payload rather than halting on an ordinary undefined return. */
  readonly undefined: symbol
  /** Stops the run, including done, after this stage finishes. */
  readonly halt: symbol
  /** Forwards the last yield, or this stage's input if it yielded nothing. */
  readonly continue: symbol
}

/** Frozen default controls used when signals is omitted; lifted sync stages share the selected set. */
export const MiddlewarePipelineGeneratorSignals = Object.freeze({
  /** Default explicit-undefined control, identical to GENERATOR_UNDEFINED. */
  undefined: GENERATOR_UNDEFINED,
  /** Default halt control, identical to GENERATOR_HALT. */
  halt: GENERATOR_HALT,
  /** Default last-yield continuation control, identical to GENERATOR_CONTINUE. */
  continue: GENERATOR_CONTINUE
} as const) satisfies IGeneratorMiddlewareSignals
