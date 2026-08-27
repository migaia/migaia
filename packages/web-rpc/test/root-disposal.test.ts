import { describe, expect, it } from 'vitest'
import {
  PluginHostDisposalNodeKind,
  PluginHostErrorCode,
  PluginHost,
  readPluginHostDisposalProvenance
} from '@migaia/plugin-host'
import type { IPluginHostCore } from '@migaia/plugin-host'
import { createEndpoint, WebRpcLifecycleError, type IWebRpcTransport } from '../src/index.js'
import { translateEndpointDisposalError } from '../src/internal/disposal-translation.js'
import { connect } from '../src/middleware/connect.js'

class DisposalHost extends PluginHost<Record<string, never>, unknown> {
  /** Supplies an explicit unbounded test policy. */
  constructor(options: any = {}) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }
}

const disposeHostWithRawErrors = async (errors: readonly unknown[]) => {
  const host = new DisposalHost()
  await host.use({
    name: 'canonical-producer-matrix',
    install: (core: IPluginHostCore<unknown>) => {
      for (const error of [...errors].reverse())
        core.onDispose(() => {
          throw error
        })
      return {}
    }
  } as never)
  const first = host.dispose()
  expect(host.dispose()).toBe(first)
  return { failure: await first, promise: first }
}

describe('composed endpoint root disposal boundary', () => {
  it('translates the canonical PluginHost producer without wrapper-shape inference', async () => {
    const raw = new Error('canonical raw disposer')
    const host = new DisposalHost()
    await host.use({
      name: 'canonical-producer',
      install: (core: IPluginHostCore<unknown>) => {
        core.onDispose(() => {
          throw raw
        })
        return {}
      }
    } as never)

    const hostResult = await host.dispose()
    expect(hostResult).toMatchObject({ logicalTerminal: true, cleanupComplete: true })
    expect(PluginHostErrorCode.hostDisposeFailed).toBe('HOST_DISPOSE_FAILED')
    const hostChild = hostResult.cleanupErrors[0]
    expect(readPluginHostDisposalProvenance(hostChild)).toEqual({
      kind: PluginHostDisposalNodeKind.disposerWrapper,
      phase: 'resource disposer'
    })
    expect(Object.isFrozen(PluginHostDisposalNodeKind)).toBe(true)
    expect(() => {
      ;(PluginHostDisposalNodeKind as Record<string, string>).hostError = 'tampered'
    }).toThrow()
    expect(() =>
      Object.defineProperty(PluginHostDisposalNodeKind, 'aggregate', { value: 'tampered' })
    ).toThrow()
    expect(Reflect.deleteProperty(PluginHostDisposalNodeKind, 'disposerWrapper')).toBe(false)
    expect({ ...PluginHostDisposalNodeKind }).toEqual({
      hostError: 'host-error',
      aggregate: 'aggregate',
      disposerWrapper: 'disposer-wrapper'
    })
    expect(() => Object.setPrototypeOf(PluginHostDisposalNodeKind, null)).toThrow()
    const translated = translateEndpointDisposalError(new AggregateError(hostResult.cleanupErrors))
    expect(translated.cause).toBe(raw)
    expect(translated.cleanupErrors).toEqual([{ resource: 'resource disposer', error: raw }])
  })

  it('preserves caused raw disposer identities from the canonical Host producer', async () => {
    const firstInner = new Error('first inner cause')
    const secondInner = new Error('second inner cause')
    const firstRaw = new Error('first raw disposer', { cause: new AggregateError([firstInner]) })
    const secondRaw = new Error('second raw disposer', { cause: secondInner })
    const customRaw = new TypeError('custom raw disposer', { cause: new Error('custom cause') })
    const structuralRaw = {
      name: 'Error',
      message: 'cross-realm-like raw value',
      cause: firstInner
    }
    const { failure: hostResult } = await disposeHostWithRawErrors([
      firstRaw,
      secondRaw,
      customRaw,
      structuralRaw
    ])

    const translated = translateEndpointDisposalError(
      new AggregateError(hostResult.cleanupErrors),
      [
        { resource: 'first root', error: firstRaw },
        { resource: 'second root', error: secondRaw },
        { resource: 'custom root', error: customRaw },
        { resource: 'structural root', error: structuralRaw }
      ]
    )

    expect(translated.cause).toBe(firstRaw)
    expect(translated.cleanupErrors).toEqual([
      { resource: 'first root', error: firstRaw },
      { resource: 'second root', error: secondRaw },
      { resource: 'custom root', error: customRaw },
      { resource: 'structural root', error: structuralRaw }
    ])
    expect((firstRaw as { readonly cause?: unknown }).cause).toBeInstanceOf(AggregateError)
    expect((firstRaw as { readonly cause: AggregateError }).cause.errors[0]).toBe(firstInner)
    expect((secondRaw as { readonly cause?: unknown }).cause).toBe(secondInner)
    expect((customRaw as { readonly cause?: unknown }).cause).toBeInstanceOf(Error)
    expect((structuralRaw as { readonly cause?: unknown }).cause).toBe(firstInner)
  })

  it('deduplicates repeated raw leaves while preserving labeled root order', () => {
    const firstRaw = new Error('first raw disposer', { cause: new Error('first cause') })
    const secondRaw = new Error('second raw disposer', { cause: new Error('second cause') })
    const translated = translateEndpointDisposalError(
      new AggregateError([firstRaw, secondRaw, firstRaw]),
      [
        { resource: 'labeled first', error: firstRaw },
        { resource: 'labeled second', error: secondRaw }
      ]
    )

    expect(translated.cause).toBe(firstRaw)
    expect(translated.cleanupErrors).toEqual([
      { resource: 'labeled first', error: firstRaw },
      { resource: 'labeled second', error: secondRaw }
    ])
  })

  it('translates host cleanup while preserving raw cause, child identity, and Promise identity', async () => {
    const endpointPrimary = new Error('unsubscribe failed')
    const primaryStack = endpointPrimary.stack
    const transport: IWebRpcTransport = {
      platform: 'Memory',
      ownership: 'borrowed',
      send() {},
      subscribe() {
        return () => {
          throw endpointPrimary
        }
      }
    }
    const endpoint = await createEndpoint({
      id: 'root-disposal',
      transport,
      middlewares: [connect({ transport })]
    })

    const first = endpoint.dispose()
    const second = endpoint.dispose()
    expect(second).toBe(first)

    const failure = await first.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(WebRpcLifecycleError)
    expect(failure).toMatchObject({
      source: '@migaia/web-rpc',
      code: 'ENDPOINT_DISPOSED',
      message: 'Endpoint disposal completed with cleanup errors',
      cause: endpointPrimary,
      cleanupErrors: [{ resource: 'transport subscription', error: endpointPrimary }]
    })
    expect((failure as { readonly cause?: unknown }).cause).toBe(endpointPrimary)
    expect((failure as { readonly cleanupErrors?: readonly unknown[] }).cleanupErrors?.[0]).toEqual(
      {
        resource: 'transport subscription',
        error: endpointPrimary
      }
    )
    expect(endpointPrimary.message).toBe('unsubscribe failed')
    expect(endpointPrimary.stack).toBe(primaryStack)
    expect(endpoint.dispose()).toBe(first)
  })

  it('preserves reverse order and exact identities for two independent root failures', async () => {
    const firstCleanup = new Error('transport unsubscribe failed')
    const secondCleanup = new Error('transport error unsubscribe failed')
    const firstStack = firstCleanup.stack
    const secondStack = secondCleanup.stack
    const transport: IWebRpcTransport = {
      platform: 'Memory',
      ownership: 'borrowed',
      send() {},
      subscribe() {
        return () => {
          throw firstCleanup
        }
      },
      onTransportError() {
        return () => {
          throw secondCleanup
        }
      },
      onListenerError() {
        return () => undefined
      }
    }
    const endpoint = await createEndpoint({
      id: 'root-disposal-order',
      transport,
      middlewares: [connect({ transport })]
    })

    const first = endpoint.dispose()
    const second = endpoint.dispose()
    expect(second).toBe(first)
    const failure = await first.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(WebRpcLifecycleError)
    expect(failure).toMatchObject({
      source: '@migaia/web-rpc',
      code: 'ENDPOINT_DISPOSED',
      cause: secondCleanup,
      cleanupErrors: [
        { resource: 'transport error subscription', error: secondCleanup },
        { resource: 'transport subscription', error: firstCleanup }
      ]
    })
    expect((failure as { readonly cleanupErrors?: readonly unknown[] }).cleanupErrors).toEqual([
      { resource: 'transport error subscription', error: secondCleanup },
      { resource: 'transport subscription', error: firstCleanup }
    ])
    expect(firstCleanup.stack).toBe(firstStack)
    expect(secondCleanup.stack).toBe(secondStack)
    expect(firstCleanup.message).toBe('transport unsubscribe failed')
    expect(secondCleanup.message).toBe('transport error unsubscribe failed')
    expect(endpoint.dispose()).toBe(first)
  })

  it('returns an already-existing nested lifecycle error by exact identity', async () => {
    const nestedPrimary = new Error('nested cleanup failed')
    const nestedLifecycleError = new WebRpcLifecycleError(
      'Endpoint disposal completed with cleanup errors',
      nestedPrimary,
      [{ resource: 'nested root', error: nestedPrimary }]
    )
    const transport: IWebRpcTransport = {
      platform: 'Memory',
      ownership: 'borrowed',
      send() {},
      subscribe() {
        return () => {
          throw nestedLifecycleError
        }
      }
    }
    const endpoint = await createEndpoint({
      id: 'root-disposal-nested',
      transport,
      middlewares: [connect({ transport })]
    })

    const first = endpoint.dispose()
    const second = endpoint.dispose()
    expect(second).toBe(first)
    const failure = await first.catch((error: unknown) => error)
    expect(failure).toBe(nestedLifecycleError)
    expect(endpoint.dispose()).toBe(first)
  })
})
