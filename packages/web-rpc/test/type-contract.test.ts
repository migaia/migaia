import { describe, expectTypeOf, it } from 'vitest'
import { createEndpoint } from '../src/index'
import { createComposedEndpoint } from '../src/core'
import { chunk } from '../src/features/chunk'
import { connect } from '../src/middleware/connect'
import { ping } from '../src/middleware/ping'
import type { IMemoryTransport } from '../src/adapters/memory.js'
import type { IWebRpcPingOptions } from '../src/typing'

type IAutomaticMiddlewareList = readonly [ReturnType<typeof connect>]
type IManualMiddlewareList = readonly [
  ReturnType<typeof connect<'manual'>>,
  ReturnType<typeof ping>
]
type IAutomaticEndpoint = Awaited<
  ReturnType<typeof createEndpoint<'automatic-target', IAutomaticMiddlewareList>>
>
type IManualEndpoint = Awaited<
  ReturnType<typeof createEndpoint<'manual-target', IManualMiddlewareList>>
>

async function assertInferredFactoryContract(): Promise<void> {
  const automatic = await createEndpoint({
    id: 'automatic-target',
    middlewares: [connect({ transport: undefined as never })]
  })
  // @ts-expect-error automatic discovery does not expose manual query controls
  void automatic.connect.query
  const manual = await createEndpoint({
    id: 'manual-target',
    middlewares: [connect({ transport: undefined as never, discoveryMode: 'manual' }), ping()]
  })
  void manual.connect.query
  void manual.ping
}
void assertInferredFactoryContract

async function assertSelectedRootProjection(): Promise<void> {
  const chunkOnly = await createComposedEndpoint(
    { id: 'chunk-only', transport: undefined as never, middlewares: [] },
    [chunk()] as const
  )
  // @ts-expect-error chunk root has no implicit outbound capability
  void chunkOnly.send

  const discoveryOnly = await createComposedEndpoint(
    { id: 'discovery-only', transport: undefined as never, middlewares: [] },
    [(await import('../src/features/discovery.js')).discovery()] as const
  )
  // @ts-expect-error discovery roots do not inherit outbound methods from dependencies
  void discoveryOnly.send
}
void assertSelectedRootProjection

describe('factory type contract', () => {
  it('discriminates discovery mode and ping capability', () => {
    expectTypeOf<
      'query' extends keyof IAutomaticEndpoint['connect'] ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'query' extends keyof IManualEndpoint['connect'] ? true : false
    >().toEqualTypeOf<true>()
    expectTypeOf<'ping' extends keyof IAutomaticEndpoint ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<'ping' extends keyof IManualEndpoint ? true : false>().toEqualTypeOf<true>()
    expectTypeOf<IManualEndpoint['ping']>().toEqualTypeOf<
      (targetId: string, receiverId?: string, options?: IWebRpcPingOptions) => Promise<boolean>
    >()
  })

  it('keeps the public memory close specialization synchronous', () => {
    expectTypeOf<ReturnType<IMemoryTransport['close']>>().toEqualTypeOf<void>()
  })
})
