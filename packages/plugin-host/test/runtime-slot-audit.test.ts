import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { PluginHost, defineHost, definePlugin, getPluginRuntimeIntegration } from '../src/index.js'

/** One real integration contribution exposes a scalar through the original slot lookup. */
function connection(name: string, key: string, family: object, answer: number) {
  return definePlugin({
    name,
    install(core) {
      const slot = getPluginRuntimeIntegration(core).acquireSharedSlot(key, family, (owner) => ({
        read: () => (owner.find(name) as { answer: number } | undefined)?.answer
      }))
      slot.contribute({ answer }, name)
      return {}
    }
  })
}

it('[C4-fix:L1] a shared then key rejects before constructing its facade', async () => {
  /** The genuine frozen Host supplies its original install core and publication Proxy. */
  const host = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Only successful physical facade construction can increment this independent discriminator. */
  let created = 0
  try {
    const [baseline] = await host.use(
      definePlugin({ name: 'baseline', install: () => ({ read: () => 42 }) })
    )
    assert.equal(baseline.extensions.read(), 42)
    const failure = await host
      .use(
        definePlugin({
          name: 'unsafe',
          install(core) {
            getPluginRuntimeIntegration(core).acquireSharedSlot('then', {}, () => {
              created += 1
              return {}
            })
            return {}
          }
        })
      )
      .then(
        () => undefined,
        (error: unknown) => error
      )
    assert.equal(created, 0, '[C4-fix:L1] reserved then cannot construct a shared facade')
    assert.equal((failure as { cause?: { code?: string } }).cause?.code, 'EXTENSION_RESERVED')
    assert.equal(Reflect.get(host, 'then'), undefined)
  } finally {
    await host.dispose()
  }
})

it('[C4-fix:L2] a class slot is immutable while its canonical owner retires and republishes', async () => {
  /** The original class owns the property descriptor as well as the same receipt registry. */
  const host = new PluginHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** Exact family identity remains fixed across final withdrawal and later installation. */
  const family = {}
  try {
    await host.use(connection('first', 'runtimeAudit', family, 42))
    const first = Reflect.get(host, 'runtimeAudit') as { read(): number | undefined }
    assert.equal(first.read(), 42)
    const descriptor = Object.getOwnPropertyDescriptor(host, 'runtimeAudit')!
    assert.equal(
      descriptor.configurable,
      false,
      '[C4-fix:L2] a holder cannot replace the owner descriptor'
    )
    assert.equal(descriptor.set, undefined)
    assert.equal(Reflect.deleteProperty(host, 'runtimeAudit'), false)
    assert.equal(Reflect.defineProperty(host, 'runtimeAudit', { value: {} }), false)
    await host.unUse('first')
    assert.equal(Reflect.get(host, 'runtimeAudit'), undefined)
    assert.equal(first.read(), undefined)
    await host.use(connection('second', 'runtimeAudit', family, 84))
    assert.equal((Reflect.get(host, 'runtimeAudit') as { read(): number }).read(), 84)
    assert.equal(Object.getOwnPropertyDescriptor(host, 'runtimeAudit')!.get, descriptor.get)
    assert.equal(
      first.read(),
      undefined,
      '[C4-fix:L2] immutable publication cannot revive an old slot'
    )
  } finally {
    await host.dispose()
  }
})

it('[C4-fix:M2] single-receipt find reads the canonical bucket without a Set iterator', async () => {
  /** This genuine Host publishes one actual original integration receipt. */
  const host = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  try {
    await host.use(connection('single', 'runtimeAudit', {}, 42))
    const facade = Reflect.get(host, 'runtimeAudit') as { read(): number }
    assert.equal(facade.read(), 42)
    const values = vi.spyOn(Set.prototype, 'values')
    try {
      assert.equal(facade.read(), 42)
      assert.equal(values.mock.calls.length, 0, '[C4-fix:M2] hot find creates no Set iterator')
    } finally {
      values.mockRestore()
    }
  } finally {
    await host.dispose()
  }
})
