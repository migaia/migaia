import { describe, expect, it } from 'vitest'
import {
  createStorageHost,
  type IStorageBackendType,
  type IStorageFeatureDefiner
} from '../../src/index.ts'
import { defineStorageFeature } from '../../src/sdk.ts'
import { memoryBackendPlugin } from '../../src/plugins/memory.ts'
import type { IStorageBase } from '@migaia/storage-contract'

/** Features here read nothing from the backend, so the plain storage base type suffices. */
type IAnyBackend = IStorageBackendType<IStorageBase, undefined>
/** Storage Feature definer used by every failing Feature below. */
const defineFeature: IStorageFeatureDefiner<IAnyBackend> = defineStorageFeature

/** Install one memory backend whose single Feature factory throws `thrown`; return the rejection. */
async function installFailing(name: string, thrown: unknown): Promise<unknown> {
  /** A Feature whose factory fails during installation. */
  const broken = defineFeature(() => {
    throw thrown
  })
  try {
    await createStorageHost({
      plugins: [memoryBackendPlugin({ name, features: { broken } as never })] as const
    })
  } catch (error) {
    return error
  }
  throw new Error('installation unexpectedly succeeded')
}

describe('storage Feature failure attribution', () => {
  it('names the plugin and the root key of a Feature whose factory throws', async () => {
    await expect(installFailing('attributed', new Error('feature broke'))).resolves.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED',
      plugin: 'attributed',
      feature: 'broken'
    })
  })

  it('leaves attribution empty when a Feature factory throws a primitive', async () => {
    /** A thrown string cannot be recorded, so the install error carries no plugin name. */
    const failure = (await installFailing('primitive', 'not an error object')) as {
      code: string
      plugin?: string
    }
    expect(failure.code).toBe('BACKEND_INSTALL_FAILED')
    expect(failure.plugin).toBeUndefined()
  })

  it('keeps the first attribution when one error object is thrown by two plugins', async () => {
    /** The same object thrown by two separate installations. */
    const shared = new Error('shared failure')
    await installFailing('first-owner', shared)
    await expect(installFailing('second-owner', shared)).resolves.toMatchObject({
      plugin: 'first-owner'
    })
  })
})

describe('memory backend option admission', () => {
  it('rejects non-object options and malformed owners before any allocation', () => {
    /** Option failures surface as INVALID_CONFIG with the original TypeError as cause. */
    const invalid = expect.objectContaining({
      code: 'INVALID_CONFIG',
      cause: expect.any(TypeError)
    })
    expect(() => memoryBackendPlugin(null as never)).toThrowError(invalid)
    expect(() => memoryBackendPlugin({ owner: 5 as never })).toThrowError(invalid)
    expect(() => memoryBackendPlugin({ owner: { label: 3 } as never })).toThrowError(invalid)
  })
})
