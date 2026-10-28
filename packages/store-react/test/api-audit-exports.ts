import type { StoreRegistry } from '../src/index.ts'
// @ts-expect-error Cleanup classification is private to the owning adapter.
import { identifyRegistryDisposalFailure } from '../src/index.ts'

void identifyRegistryDisposalFailure

/** Compile-only migration assertions: obsolete compatibility members stay unavailable. */
export function assertRetiredRegistrySurface(registry: StoreRegistry): void {
  // @ts-expect-error removed the no-op render-preparation method.
  registry.prepareForRender()
  // @ts-expect-error removed the ignored deferred-release parameter.
  registry.retain(true, false)
}
