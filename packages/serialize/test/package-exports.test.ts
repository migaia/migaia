import { describe, expect, it } from 'vitest'
import {
  SerializeChunkKind,
  chunkToBytes,
  chunkToText,
  createSerializeRegistry,
  jsonPlugin,
  type ISerializeCleanupError as IRootSerializeCleanupError,
  type ISerializeRegistryOptions as IRootSerializeRegistryOptions,
  type ISerializeScheduler as IRootSerializeScheduler,
  type ISerializeTimeoutDiagnostic as IRootSerializeTimeoutDiagnostic,
  type ITextDecoder as IRootTextDecoder,
  type ITextEncoder as IRootTextEncoder
} from '@migaia/serialize'
import {
  collectStream,
  decodeStream,
  encodeStream,
  SERIALIZE_SOURCE,
  SerializeErrorCode,
  sliceByFrameBudget,
  type IEncodeStreamOptions,
  type IFrameBudgetOptions,
  type ISerializeChunk,
  type ISerializeScheduler,
  type ITextDecoder,
  type ITextEncoder
} from '@migaia/serialize/core'
import { jsonPlugin as jsonPluginFromSubpath } from '@migaia/serialize/plugins'
import {
  chunkToBytes as registryChunkToBytes,
  chunkToText as registryChunkToText,
  createSerializeRegistry as createRegistryFromSubpath,
  type ISerializeCleanupError,
  type ISerializeRegistryOptions,
  type ISerializeTimeoutDiagnostic
} from '@migaia/serialize/registry'

type ICompileEncoder = ITextEncoder
type ICompileDecoder = ITextDecoder
type ICompileScheduler = ISerializeScheduler
type ICompileRootEncoder = IRootTextEncoder
type ICompileRootDecoder = IRootTextDecoder
type ICompileRootScheduler = IRootSerializeScheduler
type ICompileRegistryOptions = ISerializeRegistryOptions
type ICompileCleanupError = ISerializeCleanupError
type ICompileTimeoutDiagnostic = ISerializeTimeoutDiagnostic
type ICompileRootRegistryOptions = IRootSerializeRegistryOptions
type ICompileRootCleanupError = IRootSerializeCleanupError
type ICompileRootTimeoutDiagnostic = IRootSerializeTimeoutDiagnostic
type ICompileFrameOptions = IFrameBudgetOptions
type ICompileEncodeOptions = IEncodeStreamOptions

describe('package exports', () => {
  it('resolves runtime and named declaration exports through package subpaths', async () => {
    const encoder: ICompileEncoder & ICompileRootEncoder = {
      encode: (value: string) => Uint8Array.from(Array.from(value, (char) => char.charCodeAt(0)))
    }
    const decoder: ICompileDecoder & ICompileRootDecoder = {
      decode: (value: Uint8Array) => String.fromCharCode(...value)
    }
    const scheduler: ICompileScheduler & ICompileRootScheduler = {
      now: () => 0,
      schedule: (callback: () => void) => {
        callback()
        return { cancel: () => undefined }
      }
    }
    const options: ICompileRegistryOptions & ICompileRootRegistryOptions = {
      encoder,
      decoder,
      scheduler
    }
    const cleanupError = null as unknown as ICompileCleanupError & ICompileRootCleanupError
    const timeoutDiagnostic = null as unknown as ICompileTimeoutDiagnostic &
      ICompileRootTimeoutDiagnostic
    const frameOptions: ICompileFrameOptions = { scheduler }
    const encodeOptions: ICompileEncodeOptions = frameOptions
    const registry = createSerializeRegistry([jsonPlugin()], options)
    const registryFromSubpath = createRegistryFromSubpath([jsonPluginFromSubpath()], options)
    const chunk: ISerializeChunk = [SerializeChunkKind.text, 'value']

    expect(chunkToText(chunk, decoder)).toBe('value')
    expect(chunkToBytes(chunk, encoder)).toEqual(new Uint8Array([118, 97, 108, 117, 101]))
    expect(registryFromSubpath.primaryType).toBe('json')
    expect(typeof sliceByFrameBudget).toBe('function')
    expect(typeof encodeStream).toBe('function')
    expect(typeof decodeStream).toBe('function')
    expect(typeof collectStream).toBe('function')
    expect(SERIALIZE_SOURCE).toBe('@migaia/serialize')
    expect(SerializeErrorCode.invalidOption).toBe('INVALID_OPTION')
    expect(typeof registryChunkToText).toBe('function')
    expect(typeof registryChunkToBytes).toBe('function')
    expect(options.scheduler).toBe(scheduler)
    expect(cleanupError).toBeNull()
    expect(timeoutDiagnostic).toBeNull()
    expect(encodeOptions.scheduler).toBe(scheduler)
    await registry.dispose()
  })
})
