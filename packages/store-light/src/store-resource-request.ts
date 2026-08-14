import { GenerationController } from '@migaia/reactive/runtime/generation-controller';
import type { GenerationToken } from '@migaia/reactive/runtime/lifecycle-primitives';

export type StoreResourceLoadContext = {
  signal: AbortSignal;
  generation: number;
  token: GenerationToken;
};

/**
 * @deprecated Use `GenerationController` directly. Kept as a compatibility
 * facade for advanced integrations that imported the old coordinator.
 */
export class ResourceRequestCoordinator extends GenerationController {
  get currentGeneration(): number {
    return this.generation;
  }

  begin(): StoreResourceLoadContext {
    const request = super.begin();
    return {
      signal: request.signal,
      generation: request.generation,
      token: request.token
    };
  }
}
