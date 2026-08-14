/**
 * Coordinates cancellable request generations without imposing a resource state machine on its
 * callers.
 */
export type IGenerationRequest = {
  readonly generation: number;
  readonly token: GenerationToken;
  readonly signal: AbortSignal;
};

export class GenerationController {
  #generation = 0;
  #requests = new RequestControllerImpl();

  begin(): IGenerationRequest {
    const request = this.#requests.begin();
    return {
      generation: ++this.#generation,
      token: request.token,
      signal: request.signal
    };
  }

  supersede(): void {
    this.#generation++;
    this.#requests.supersede();
  }

  isCurrentToken(token: GenerationToken): boolean {
    return this.#requests.isCurrent(token);
  }

  get generation(): number {
    return this.#generation;
  }

  dispose(): void {
    this.#requests.dispose();
    this.#generation++;
  }
}
import { RequestControllerImpl, type GenerationToken } from './lifecycle-primitives';
