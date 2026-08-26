import {
  createGenerationController,
  type IAbortSignal,
  type IGenerationController,
  type IGenerationToken
} from '@migaia/lifecycle'

export type IStoreResourceLoadContext = {
  signal: IAbortSignal
  generation: number
  token: IGenerationToken
}

/**
 * @deprecated Use `createGenerationController()` directly. Kept as a compatibility facade for
 * advanced integrations that imported the old coordinator.
 */
export class ResourceRequestCoordinator {
  #controller: IGenerationController = createGenerationController()

  get generation(): number {
    return this.#controller.generation
  }

  get currentGeneration(): number {
    return this.#controller.generation
  }

  get disposed(): boolean {
    return this.#controller.disposed
  }

  begin(): IStoreResourceLoadContext {
    const request = this.#controller.begin()
    return {
      signal: request.signal,
      generation: request.generation,
      token: request.token
    }
  }

  isCurrentToken(token: IGenerationToken): boolean {
    return this.#controller.isCurrent(token)
  }

  supersede(reason?: unknown): void {
    this.#controller.supersede(reason)
  }

  dispose(reason?: unknown): void {
    this.#controller.dispose(reason)
  }
}
