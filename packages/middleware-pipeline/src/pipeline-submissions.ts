import {
  MiddlewarePipelineNext,
  MiddlewarePipelineViolation,
  type IMiddlewarePipelineViolationHandler
} from './state-constants.ts'

export class PipelineSubmissions<TValue> {
  /** Public policy controls whether a second active submission is accepted. */
  readonly #policy: MiddlewarePipelineNext
  /** Canonical diagnostic sink retains late and single-duplicate semantics. */
  readonly #onViolation: IMiddlewarePipelineViolationHandler
  /** Inline first value avoids the multi-value collection on the usual path. */
  #first!: TValue
  /** Allocated only on the second accepted submission. */
  #values: TValue[] | undefined
  /** Number of accepted values includes an explicit undefined payload. */
  #count = 0
  /** Once closed, retained callbacks cannot start another traversal. */
  #closed = false

  /** Captures one stage's policy and diagnostic owner. */
  constructor(policy: MiddlewarePipelineNext, onViolation: IMiddlewarePipelineViolationHandler) {
    this.#policy = policy
    this.#onViolation = onViolation
  }
  /** Accepts a local value; downstream is deliberately not entered here. */
  readonly next = (value: TValue): void => {
    if (this.#closed) {
      this.#onViolation(MiddlewarePipelineViolation.late)
      return
    }
    if (this.#count > 0 && this.#policy === MiddlewarePipelineNext.single) {
      this.#onViolation(MiddlewarePipelineViolation.duplicate)
      return
    }
    if (this.#count === 0) this.#first = value
    else if (this.#values) this.#values.push(value)
    else this.#values = [this.#first, value]
    this.#count += 1
  }
  /** Prevents submissions once the originating stage has settled. */
  close(): void {
    this.#closed = true
  }
  /** Exposes the exact accepted count without scanning or allocating. */
  get count(): number {
    return this.#count
  }
  /** Reads one accepted submission in O(1). */
  at(index: number): TValue {
    return this.#values ? this.#values[index]! : this.#first
  }
}

/** One branch completion retains active-control provenance and original rejection identity. */
