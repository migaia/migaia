/** Owns generation-controller fault injection while forwarding the real lifecycle contract. */
import type { IGenerationController, IGenerationRequest, IGenerationToken } from '@migaia/lifecycle'

/** Hoisted test state selects the controller whose actual disposal should report a failure. */
type IGenerationFailureState = { throwOnController: number; cleanupError: unknown }

/** Fault factory numbers real controllers without defining nested component factories. */
export class GenerationFailureFactory {
  /** Real lifecycle module remains responsible for generation behavior. */
  readonly #actual: Pick<typeof import('@migaia/lifecycle'), 'createGenerationController'>
  /** Hoisted test selection remains mutable across test setup. */
  readonly #state: IGenerationFailureState
  /** Each controller receives the same construction ordinal as the original mock. */
  #nextOrdinal = 0
  /** Capture the actual implementation and the existing fault selection. */
  constructor(
    actual: Pick<typeof import('@migaia/lifecycle'), 'createGenerationController'>,
    state: IGenerationFailureState
  ) {
    this.#actual = actual
    this.#state = state
  }
  /** Create a real controller and add only the selected terminal cleanup failure. */
  readonly createGenerationController = (): IGenerationController =>
    new FailingGenerationController(
      this.#actual.createGenerationController(),
      this.#nextOrdinal++,
      this.#state
    )
}

/** Wraps one real controller to inject an error after its genuine disposal completes. */
class FailingGenerationController implements IGenerationController {
  /** Real controller owns every token, generation and cancellation transition. */
  readonly #controller: IGenerationController
  /** Construction position selects the original test's failure target. */
  readonly #ordinal: number
  /** Mutable test state supplies the exact cleanup failure object. */
  readonly #state: IGenerationFailureState
  /** Capture the real controller and fault metadata without changing its state. */
  constructor(controller: IGenerationController, ordinal: number, state: IGenerationFailureState) {
    this.#controller = controller
    this.#ordinal = ordinal
    this.#state = state
  }
  /** Observe the real generation number. */
  get generation(): number {
    return this.#controller.generation
  }
  /** Observe the real terminal flag. */
  get disposed(): boolean {
    return this.#controller.disposed
  }
  /** Preserve the real generation admission result. */
  begin(options?: { readonly timeoutMs?: number }): IGenerationRequest {
    return this.#controller.begin(options)
  }
  /** Preserve exact token admission. */
  isCurrent(token: IGenerationToken): boolean {
    return this.#controller.isCurrent(token)
  }
  /** Preserve completion of the real current token. */
  complete(token: IGenerationToken): boolean {
    return this.#controller.complete(token)
  }
  /** Preserve real supersession before later cleanup. */
  supersede(reason?: unknown): void {
    this.#controller.supersede(reason)
  }
  /** Preserve stale-result release and its report policy. */
  adopt<T>(
    token: IGenerationToken,
    value: T,
    release: (released: T) => void | PromiseLike<void>,
    onReleaseError?: (error: unknown) => void
  ): boolean {
    return this.#controller.adopt(token, value, release, onReleaseError)
  }
  /** Inject the configured error only after the underlying controller has actually disposed. */
  dispose(reason?: unknown): void {
    this.#controller.dispose(reason)
    if (this.#ordinal === this.#state.throwOnController) throw this.#state.cleanupError
  }
}
