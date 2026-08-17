/** 三种稳定执行代数；由公开 runner/type 使用，不表示 host 生命周期状态。 */
export const MiddlewarePipelineMode = {
  sync: 'sync',
  async: 'async',
  generator: 'generator'
} as const;

export type IMiddlewarePipelineMode =
  (typeof MiddlewarePipelineMode)[keyof typeof MiddlewarePipelineMode];

/** `next()` 的稳定违约协议；由所有 runner 发出，并由 host 转成诊断或领域错误。 */
export const MiddlewarePipelineViolation = { late: 'late', duplicate: 'duplicate' } as const;

export type IMiddlewarePipelineViolation =
  (typeof MiddlewarePipelineViolation)[keyof typeof MiddlewarePipelineViolation];

export type IMiddlewarePipelineViolationHandler = (kind: IMiddlewarePipelineViolation) => void;

/** Generator runner 的公开 undefined 控制信号，由兼容层与消费者返回。 */
export const GENERATOR_UNDEFINED = Symbol('middleware-pipeline.generator-undefined');

/** Generator runner 的公开终止控制信号，由 stage 返回以停止整个 pipeline。 */
export const GENERATOR_HALT = Symbol('middleware-pipeline.generator-halt');

/** Generator runner 的公开继续控制信号，由 stage 返回以采用最后一次 yield。 */
export const GENERATOR_CONTINUE = Symbol('middleware-pipeline.generator-continue');

/** Runtime sentinel identities used by a generator runner; compatibility hosts may inject theirs. */
export type IGeneratorMiddlewareSignals = {
  readonly undefined: symbol;
  readonly halt: symbol;
  readonly continue: symbol;
};

/** Default sentinel set paired with this package's public generator constants. */
export const MiddlewarePipelineGeneratorSignals: IGeneratorMiddlewareSignals = {
  undefined: GENERATOR_UNDEFINED,
  halt: GENERATOR_HALT,
  continue: GENERATOR_CONTINUE
};
