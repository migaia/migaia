import type { StoreRegistry } from '../src/index.js'
// @ts-expect-error Cleanup classification is private to the owning adapter.
import { identifyRegistryDisposalFailure } from '../src/index.js'

void identifyRegistryDisposalFailure

/** Compile-only migration assertions: obsolete compatibility members stay unavailable. */
export function assertRetiredRegistrySurface(registry: StoreRegistry): void {
  // @ts-expect-error SR-C01 removed the no-op render-preparation method.
  registry.prepareForRender()
  // @ts-expect-error SR-C01 removed the ignored deferred-release parameter.
  registry.retain(true, false)
}
