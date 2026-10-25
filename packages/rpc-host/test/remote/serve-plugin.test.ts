import { expect, it } from 'vitest'
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import { createRemoteLayerError } from '../../dist/host/remote-error-owner.js'
import { coreMemoryServer } from '../host/core-fixture.js'

/** The actual remote method tree preserves scalar and stream call modes for held capabilities. */
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
it('passes the stream-open context unchanged and invokes its hook once', async () => {
  /** The application fixture owns only provider observations and its original local hook error. */
  const fixture = new ProviderContextFixture()
  /** Actual server identity and declarations belong to this installed native listener. */
  const listener = coreMemoryServer('server', 'server')
  /** Provider construction is complete before the independent client starts its one handshake. */
  const server = await createRpcHost({
    ...listener.options,
    provide: fixture.provide,
    contract: fixture.contract
  })
  /** The client's distinct native listener carries the original remote method declaration. */
  const clientListener = coreMemoryServer('client', 'client')
  /** The client remains the original caller, using the actual public namespace projection. */
  const client = await createRpcHost<Record<string, IContextMethods>>(clientListener.options)
  await listener.link(clientListener)
  /** Held methods retain the real accepted Session identity and their scalar/stream modes. */
  const remote = client.memory.peers.server!.p.f
  try {
    expect(await remote.request(['ordinary'])).toBe('ordinary')
    /** The same held generator must return its real lazy stream owner directly. */
    const iterator = remote.generator(['stream'])
    expect(await iterator.next()).toEqual({ done: false, value: 'stream' })
    expect(await iterator.next()).toEqual({ done: true, value: 'done' })
    /** Passive application observations retain the actual provider context instances. */
    const observed = fixture.observed
    expect(observed.hookCalls).toBe(2)
    expect(observed.requestContext?.data).toEqual(['ordinary'])
    expect(observed.streamContext?.data).toEqual(['stream'])
    expect(observed.streamContext).not.toBe(observed.requestContext)
    expect(observed.streamHookContext).toBe(observed.streamContext)
    expect(observed.requestHookContext).toBe(observed.requestContext)
    expect(typeof observed.streamContext?.dispatchTo).toBe('function')
    /** The requester sees only the controlled public code/message, retaining the local exact cause. */
    const rejected = await remote.request(['reject']).catch((error: unknown) => error)
    expect(rejected).toMatchObject({ code: 'REMOTE_CLOSED', message: fixture.hookError.message })
    expect((rejected as Error).cause).toBeUndefined()
    expect(fixture.hookError.cause).toBe(fixture.hookCause)
    expect(fixture.observed.requestCalls).toBe(1)
    expect(await remote.request(['after-hook-error'])).toBe('after-hook-error')
  } finally {
    await client.close()
    await server.close()
  }
})
