import { describe, expect, it } from 'vitest'
import { PluginHostError } from '../src/error-text.ts'
import { PluginHostDisposalNodeKind, readPluginHostDisposalProvenance } from '../src/index.ts'
import * as pluginHostPublic from '../src/index.ts'
import type { IPluginHostCore } from '../src/plugin-core-types.ts'
import {
  createPipeline,
  GENERATOR_CONTINUE as middlewareContinue,
  GENERATOR_HALT as middlewareHalt,
  GENERATOR_UNDEFINED as middlewareUndefined,
  MiddlewarePipelineMode
} from '@migaia/middleware-pipeline'
import {
  GENERATOR_CONTINUE as hostContinue,
  GENERATOR_HALT as hostHalt,
  GENERATOR_UNDEFINED as hostUndefined
} from '@migaia/middleware-pipeline'
import { Host, plugin } from './plugin-host-fixtures.ts'

describe('PluginHost', () => {
  it('keeps the exported disposal discriminator immutable and exact', () => {
    const expectedKeys = ['hostError', 'aggregate', 'disposerWrapper']
    expect(Object.isFrozen(PluginHostDisposalNodeKind)).toBe(true)
    expect(Reflect.ownKeys(PluginHostDisposalNodeKind)).toEqual(expectedKeys)
    expect({ ...PluginHostDisposalNodeKind }).toEqual({
      hostError: 'host-error',
      aggregate: 'aggregate',
      disposerWrapper: 'disposer-wrapper'
    })
    for (const key of expectedKeys) {
      expect(Object.getOwnPropertyDescriptor(PluginHostDisposalNodeKind, key)).toEqual({
        configurable: false,
        enumerable: true,
        value: PluginHostDisposalNodeKind[key as keyof typeof PluginHostDisposalNodeKind],
        writable: false
      })
    }
    expect(() => {
      ;(PluginHostDisposalNodeKind as Record<string, string>).hostError = 'tampered'
    }).toThrow()
    expect(() =>
      Object.defineProperty(PluginHostDisposalNodeKind, 'hostError', { value: 'tampered' })
    ).toThrow()
    expect(Reflect.deleteProperty(PluginHostDisposalNodeKind, 'aggregate')).toBe(false)
    expect(PluginHostDisposalNodeKind.aggregate).toBe('aggregate')
    expect(() => Object.setPrototypeOf(PluginHostDisposalNodeKind, null)).toThrow()
    expect(Object.getPrototypeOf(PluginHostDisposalNodeKind)).toBe(Object.prototype)
  })

  it('fails closed when a duplicate module instance reads a genuine Host node', async () => {
    const producerModule = await import(
      new URL('../src/host-runtime.js?producer', import.meta.url).href
    )
    const foreignModule = await import(
      new URL('../src/host-runtime.js?foreign', import.meta.url).href
    )
    const DuplicateHost = class extends producerModule.PluginHost {
      constructor() {
        super({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
      }
    }
    const raw = new Error('duplicate-instance raw disposer')
    const host = new DuplicateHost()
    await host.use({
      name: 'duplicate-instance',
      install: (core: IPluginHostCore<unknown>) => {
        core.onDispose(() => {
          throw raw
        })
        return {}
      }
    } as never)
    const result = await host.dispose()
    expect(result.logicalTerminal).toBe(true)
    expect(result.cleanupComplete).toBe(true)
    expect(result.cleanupErrors.length).toBeGreaterThan(0)
    expect(producerModule.readPluginHostDisposalProvenance(result.cleanupErrors[0])?.kind).toBe(
      producerModule.PluginHostDisposalNodeKind.disposerWrapper
    )
    expect(foreignModule.readPluginHostDisposalProvenance(result.cleanupErrors[0])).toBeUndefined()
  })

  it('marks generated disposal nodes without mutating arbitrary disposer errors', async () => {
    const rawInner = new Error('raw inner cause')
    const raw = new Error('raw disposer failure', {
      cause: new AggregateError([rawInner])
    })
    const host = new Host()
    await host.use(
      plugin('provenance', (core) => {
        core.onDispose(() => {
          throw raw
        })
        return {}
      })
    )

    const first = host.dispose()
    const second = host.dispose()
    expect(second).toBe(first)
    const result = await first
    expect(result.logicalTerminal).toBe(true)
    expect(result.cleanupComplete).toBe(true)
    expect(result.cleanupErrors.length).toBeGreaterThan(0)
    const wrapper = result.cleanupErrors[0]
    expect(readPluginHostDisposalProvenance(wrapper)).toEqual({
      kind: PluginHostDisposalNodeKind.disposerWrapper,
      phase: 'resource disposer'
    })
    expect((wrapper as { readonly cause?: unknown }).cause).toBe(raw)
    expect((raw as { readonly cause?: unknown }).cause).toBeInstanceOf(AggregateError)
    /** Object view used to prove copying and proxying cannot copy WeakMap membership. */
    const wrapperObject = wrapper as object
    expect(
      readPluginHostDisposalProvenance({ kind: PluginHostDisposalNodeKind.hostError })
    ).toBeUndefined()
    expect(readPluginHostDisposalProvenance(Object.assign({}, wrapper))).toBeUndefined()
    expect(
      readPluginHostDisposalProvenance(
        Object.create(Object.getPrototypeOf(wrapper), Object.getOwnPropertyDescriptors(wrapper))
      )
    ).toBeUndefined()
    expect(readPluginHostDisposalProvenance(new Proxy(wrapperObject, {}))).toBeUndefined()
    expect(Reflect.ownKeys(wrapperObject).filter((key) => typeof key === 'symbol')).toEqual([])
    expect(pluginHostPublic).not.toHaveProperty('markPluginHostDisposalNode')
    expect(pluginHostPublic).not.toHaveProperty('pluginHostDisposalProvenanceKey')
  })

  it('preserves failed plugin and rollback error identities in install detail', async () => {
    const host = new Host()
    const primary = new Error('install-boom')
    const rollback = new Error('rollback-boom')
    let caught: unknown

    try {
      await host.use(
        plugin('first', (core) => {
          core.onDispose(() => {
            throw rollback
          })
          return {}
        }),
        plugin('failed', () => {
          throw primary
        })
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(PluginHostError)
    const failure = caught as PluginHostError
    expect(failure.cause).toBe(primary)
    expect(failure.detail?.failedName).toBe('failed')
    const rollbackErrors = failure.detail?.rollbackErrors
    expect(rollbackErrors).toHaveLength(1)
    expect((rollbackErrors as readonly unknown[])[0]).toBe(rollback)
  })

  it('preserves host error ownership while forwarding explicit signal', async () => {
    let aborted = false
    const signal = {
      get aborted() {
        return aborted
      },
      addEventListener() {},
      removeEventListener() {}
    }
    await expect(
      createPipeline<number>({ mode: MiddlewarePipelineMode.async, signal }).run(
        [
          async (_value, _next, context) => {
            aborted = true
            expect(context?.signal).toBe(signal)
          }
        ],
        1,
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('uses canonical signals internally without exposing pipeline or invocation aliases', () => {
    expect(hostContinue).toBe(middlewareContinue)
    expect(hostHalt).toBe(middlewareHalt)
    expect(hostUndefined).toBe(middlewareUndefined)
    for (const name of [
      'MiddlewarePipelineMode',
      'MiddlewarePipelineViolation',
      'GENERATOR_CONTINUE',
      'GENERATOR_HALT',
      'GENERATOR_UNDEFINED',
      'disposeKey',
      'invokeCaptured'
    ])
      expect(pluginHostPublic).not.toHaveProperty(name)
    expect(pluginHostPublic).not.toHaveProperty('PluginHostPipelineMode')
    expect(pluginHostPublic).not.toHaveProperty('adaptSyncStageToAsync')
  })
})
