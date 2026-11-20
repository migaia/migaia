import { describe, expect, it } from 'vitest'
import {
  checkDelivery,
  type ICapabilityManifest,
  type IPartSnapshot,
  type IRemoteModuleRef
} from '../src/index.ts'

/** Client manifest that lacks `x@1` and `y@1`. */
const manifest: ICapabilityManifest = {
  format: 1,
  build: 'b1',
  definitions: ['button@1'],
  renderers: ['react']
}

/** Snapshot referencing `definitions` with the given remote modules. */
function snapshotOf(definitions: string[], modules: IRemoteModuleRef[] = []): IPartSnapshot {
  return {
    lock: { format: 1, project: 'p', tag: 'v1', blueprints: [], definitions, modules },
    blueprints: [],
    descriptors: []
  }
}

/** Remote module exporting `x@1`. */
const module: IRemoteModuleRef = {
  name: 'enhancers/x.ts',
  id: 'sha256-a',
  url: 'm/a.js',
  integrity: 'sha384-a',
  exports: [{ id: 'x@1', kind: 'enhancer' }]
}

describe('checkDelivery', () => {
  it('reports a definition neither the manifest nor a module provides', () => {
    expect(checkDelivery(snapshotOf(['button@1', 'x@1']), manifest)).toEqual({
      ok: false,
      missing: ['x@1'],
      missingStores: []
    })
  })

  it('counts definitions exported by remote modules as available', () => {
    expect(checkDelivery(snapshotOf(['button@1', 'x@1'], [module]), manifest)).toEqual({ ok: true })
  })

  it('reports every missing definition, not only the first', () => {
    expect(checkDelivery(snapshotOf(['y@1', 'x@1']), manifest)).toEqual({
      ok: false,
      missing: ['y@1', 'x@1'],
      missingStores: []
    })
  })
})
