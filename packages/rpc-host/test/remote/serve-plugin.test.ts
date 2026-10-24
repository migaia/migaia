import { describe, expect, it, vi } from 'vitest'
import type { IRpcContext } from '../../dist/core/typing.js'
import { ProviderExecutor } from '../../dist/core/internal/provider-executor.js'
import { RpcRemoteLayerErrorCode } from '../../dist/remote/error-code.js'
import { createRemoteLayerError } from '../../dist/remote/error.js'
import { connectedHosts } from '../host/fixture.js'

/** Actual provider operations expose the original scalar and stream payload contracts. */
type IContextMethods = {
  p: {
    f: {
      request(value: unknown): Promise<unknown>
      generator(value: unknown): AsyncIterableIterator<unknown>
    }
  }
}

/** Application providers retain the exact contexts emitted by the actual canonical executor. */
class ProviderContextFixture {
  /** Request admission has its own original Core context. */
  #requestContext: IRpcContext | undefined
  /** Stream-open admission must retain a different original Core context. */
  #streamContext: IRpcContext | undefined
  /** The request hook observes the same context subsequently received by its provider. */
  #requestHookContext: IRpcContext | undefined
  /** The stream hook observes the same context subsequently received by its generator. */
  #streamHookContext: IRpcContext | undefined
  /** Hook execution counts cannot be inferred from client completion. */
  #hookCalls = 0
  /** A rejected hook must prevent the provider's application side effect. */
  #requestCalls = 0
  /** The local original failure remains reachable while controlled wire failures omit its cause. */
  readonly hookCause = new Error('hook root cause')
  /** The existing remote error constructor owns the public controlled failure projection. */
  readonly hookError = createRemoteLayerError(RpcRemoteLayerErrorCode.closed, this.hookCause)

  /** Bind actual application providers; the advanced declaration retains the generator call mode. */
  readonly provide = {
    p: {
      f: {
        request: (value: unknown, context: IRpcContext) => this.#request(value, context),
        generator: (value: unknown, context: IRpcContext) => this.#generator(value, context)
      }
    }
  }
  /** The unchanged declared method tree names actual providers, never a remote Plugin facade. */
  readonly contract = {
    schemaVersion: 1 as const,
    plugin: 'p',
    features: {
      f: {
        methods: {
          request: { mode: 'request' as const, idempotent: false },
          generator: { mode: 'generator' as const, idempotent: false }
        }
      }
    }
  }

  /** Return only passive observations; lifecycle and invocation remain with the actual providers. */
  get observed() {
    return {
      requestContext: this.#requestContext,
      streamContext: this.#streamContext,
      requestHookContext: this.#requestHookContext,
      streamHookContext: this.#streamHookContext,
      hookCalls: this.#hookCalls,
      requestCalls: this.#requestCalls
    }
  }

  /** The same local hook precedes either real application provider exactly once per invocation. */
  #hook(context: IRpcContext): void {
    this.#hookCalls += 1
    if (Array.isArray(context.data) && context.data[0] === 'stream')
      this.#streamHookContext = context
    else if (Array.isArray(context.data) && context.data[0] === 'ordinary')
      this.#requestHookContext = context
    if (Array.isArray(context.data) && context.data[0] === 'reject') throw this.hookError
  }

  /** Preserve original request side effects only after the hook has accepted this exact context. */
  #request(value: unknown, context: IRpcContext): unknown {
    this.#hook(context)
    this.#requestCalls += 1
    this.#requestContext = context
    return (value as unknown[])[0]
  }

  /** Generator execution retains the original stream-open context through yield and completion. */
  *#generator(value: unknown, context: IRpcContext): Generator<unknown> {
    this.#hook(context)
    this.#streamContext = context
    yield (value as unknown[])[0]
    return 'done'
  }
}

/** Context, hook failure identity and wire privacy remain on the real public Host provider path. */
describe('runtime provider contexts', () => {
  it('passes the stream-open context unchanged and invokes its hook once', async () => {
    /** Observe the original Core context directly, rather than inserting another service wrapper. */
    const contextCreation = vi.spyOn(ProviderExecutor.prototype, 'createContext')
    /** The application fixture owns only provider observations and its original local hook error. */
    const fixture = new ProviderContextFixture()
    /** Both endpoints use the actual public Host entry and the existing genuine memory source. */
    const pair = await connectedHosts<unknown, Record<string, IContextMethods>>({
      a: { self: { name: 'client', instanceId: 'client' }, report: () => undefined },
      b: {
        self: { name: 'server', instanceId: 'server' },
        provide: fixture.provide,
        contract: fixture.contract,
        report: () => undefined
      }
    })
    /** The accepted peer projection is the actual direct target, with no test forwarding facade. */
    const remote = pair.a.peers[pair.b.self.instanceId]!.p.f
    try {
      expect(await remote.request(['ordinary'])).toBe('ordinary')
      const iterator = remote.generator(['stream'])
      expect(await iterator.next()).toEqual({ done: false, value: 'stream' })
      expect(await iterator.next()).toEqual({ done: true, value: 'done' })
      const observed = fixture.observed
      /** The original executor creates each admitted request/stream context exactly once. */
      const streamProviderContext = contextCreation.mock.results
        .map((result) => result.value as IRpcContext)
        .find((context) => Array.isArray(context.data) && context.data[0] === 'stream')
      expect(observed.hookCalls).toBe(2)
      expect(observed.requestContext?.data).toEqual(['ordinary'])
      expect(observed.streamContext?.data).toEqual(['stream'])
      expect(observed.streamContext).not.toBe(observed.requestContext)
      expect(observed.streamHookContext).toBe(observed.streamContext)
      expect(observed.streamHookContext).toBe(streamProviderContext)
      expect(observed.requestHookContext).toBe(observed.requestContext)
      expect(typeof observed.streamContext?.dispatchTo).toBe('function')
      /**
       * The requester sees only the controlled public code/message, retaining the local exact
       * cause.
       */
      const rejected = await remote.request(['reject']).catch((error: unknown) => error)
      expect(rejected).toMatchObject({ code: 'REMOTE_CLOSED', message: fixture.hookError.message })
      expect((rejected as Error).cause).toBeUndefined()
      expect(fixture.hookError.cause).toBe(fixture.hookCause)
      expect(fixture.observed.requestCalls).toBe(1)
      expect(await remote.request(['after-hook-error'])).toBe('after-hook-error')
    } finally {
      await pair.a.close()
      await pair.b.close()
      contextCreation.mockRestore()
    }
  })
})
