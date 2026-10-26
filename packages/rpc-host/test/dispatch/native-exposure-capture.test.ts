/** Native Feature output reflection is captured once without changing the first selector failure. */
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { expect, it } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

it('captures one native output descriptor inventory for repeated exposure selectors', async () => {
  /** Only cold RPC exposure after native Feature publication is counted. */
  let captures = 0
  /** The real native Feature retains this original Proxy after its own freeze. */
  const output = new Proxy(
    { a: () => 1, b: () => 2 },
    {
      ownKeys: (target) => {
        captures += 1
        return Reflect.ownKeys(target)
      }
    }
  )
  /** The actual NativeHost owns both the Feature and its later RPC transport registration. */
  /** Lazy pipeline authority reads this case's own native host only at installation. */
  const rpc = rpcHostPipelines(
    () => host,
    (name) => host.pipeline(name),
    ['memory']
  )
  const host = defineHost({
    ...rpc,
    host: {
      identity: { name: 'native-capture' },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    }
  })
  /** Native installation publishes only its original declared Feature outputs. */
  const app = definePlugin({
    name: 'app',
    features: { view: defineFeature(() => output) },
    install: () => ({})
  })
  /** Exposure selectors enter the same genuine RPC native installation. */
  const server = coreMemoryServer(
    'native-capture',
    'native-capture',
    'memory',
    [],
    ['app.a', 'app.b', 'app.a']
  )
  /** Final cleanup retains only the independently owned actual connecting Host. */
  let client: Awaited<ReturnType<typeof server.connect>> | undefined
  try {
    /** The real Feature handle forces native publication before counting RPC reflection. */
    const [handle] = await host.use(app)
    handle.getFeature('view')
    captures = 0
    await host.use(server.transport)
    expect(captures).toBe(1)
    client = await server.connect('native-capture-client')
    expect(await client.host.memory.send('native-capture', 'app.a')).toBe(1)
    expect(await client.host.memory.send('native-capture', 'app.b')).toBe(2)
  } finally {
    await client?.host.close()
    await host.dispose()
  }
})

it('keeps the first selector invalid descriptor ahead of later native output reflection', async () => {
  /** Native publication remains legal; the later RPC descriptor reflection alone would fail. */
  let armed = false
  /** This later reflection error must remain unreached when the first selected accessor is invalid. */
  const later = new Error('later feature reflection')
  /** The first native Feature uses an accessor whose descriptor is unsupported for RPC exposure. */
  const first = Object.defineProperty({}, 'a', {
    enumerable: true,
    get() {
      throw new Error('accessor must not run')
    }
  })
  /** Only the later RPC reflection is armed; native publication has already completed. */
  const second = new Proxy(
    { b: () => 2 },
    {
      ownKeys(target) {
        if (armed) throw later
        return Reflect.ownKeys(target)
      }
    }
  )
  /** Failure and final cleanup belong to this same genuine NativeHost. */
  /** Lazy pipeline authority reads this case's own native host only at installation. */
  const rpc = rpcHostPipelines(
    () => host,
    (name) => host.pipeline(name),
    ['memory']
  )
  const host = defineHost({
    ...rpc,
    host: {
      identity: { name: 'native-selector-order' },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    }
  })
  /** Native installation publishes only its original declared Feature outputs. */
  const app = definePlugin({
    name: 'app',
    features: { first: defineFeature(() => first), second: defineFeature(() => second) },
    install: () => ({})
  })
  /** Exposure selectors enter the same genuine RPC native installation. */
  const server = coreMemoryServer(
    'native-selector-order',
    'native-selector-order',
    'memory',
    [],
    ['app.a', 'app.b']
  )
  try {
    /** The real Feature handle forces native publication before counting RPC reflection. */
    const [handle] = await host.use(app)
    handle.getFeature('first')
    handle.getFeature('second')
    armed = true
    /** Preserve the real installation failure without bypassing its native wrapper. */
    const failed = await host.use(server.transport).catch((error: unknown) => error)
    /** Native installation keeps the genuine first RPC configuration failure on its original cause. */
    expect(failed).toMatchObject({ cause: { source: 'rpc.endpoint', code: 'INVALID_CONFIG' } })
  } finally {
    await host.dispose()
  }
})
