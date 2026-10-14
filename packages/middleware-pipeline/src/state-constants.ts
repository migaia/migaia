/**
 * Defines four stable execution modes for public runners and types. These values do not represent
 * host lifecycle states.
 */
export const MiddlewarePipelineMode = {
  sync: 'sync',
  async: 'async',
  generator: 'generator',
  asyncGenerator: 'async-generator'
} as const

export type IMiddlewarePipelineMode =
  (typeof MiddlewarePipelineMode)[keyof typeof MiddlewarePipelineMode]

/**
 * Defines stable `next()` violations emitted by every runner. Hosts convert these values into
 * diagnostics or domain errors.
 */
export const MiddlewarePipelineViolation = { late: 'late', duplicate: 'duplicate' } as const

export type IMiddlewarePipelineViolation =
  (typeof MiddlewarePipelineViolation)[keyof typeof MiddlewarePipelineViolation]

export type IMiddlewarePipelineViolationHandler = (kind: IMiddlewarePipelineViolation) => void

/**
 * Provides the public generator control signal for an undefined result. Compatibility layers and
 * consumers return it.
 */
export const GENERATOR_UNDEFINED = Symbol('middleware-pipeline.generator-undefined')

/** Provides the public generator control signal that a stage returns to halt the entire pipeline. */
export const GENERATOR_HALT = Symbol('middleware-pipeline.generator-halt')

/**
 * Provides the public generator control signal that a stage returns to continue with its last
 * yielded value.
 */
export const GENERATOR_CONTINUE = Symbol('middleware-pipeline.generator-continue')

/** Runtime sentinel identities used by a generator runner; compatibility hosts may inject theirs. */
export type IGeneratorMiddlewareSignals = {
  readonly undefined: symbol
  readonly halt: symbol
  readonly continue: symbol
}

/** Default sentinel set paired with this package's public generator constants. */
export const MiddlewarePipelineGeneratorSignals: IGeneratorMiddlewareSignals = {
  undefined: GENERATOR_UNDEFINED,
  halt: GENERATOR_HALT,
  continue: GENERATOR_CONTINUE
}
