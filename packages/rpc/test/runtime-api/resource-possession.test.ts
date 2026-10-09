import { describe, expect, it } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { messageFramerV1 } from '../../src/contract/framing/index.js'
import { createRuntimeApiEndpoint } from '../../src/core/internal/runtime-api-endpoint.js'
import {
  createProviderAdmissionScope,
  prepareProviderAdmissionScope
} from '../../src/core/internal/provider-admission.js'
import { connect } from '../../src/core/middleware/connect.js'
import { abort } from '../../src/core/middleware/abort.js'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import type { IRpcFactoryConfig } from '../../src/core/typing.js'
import type { IRpcPortableValue } from '../../src/contract/types.js'

/** New resource operations run through the existing composition and real memory carrier. */
function pair(capabilities: readonly string[] = []) {
  /** Each endpoint holds only its own carrier and the other endpoint's safe routing identity. */
  const transports = createMemoryTransportPair()
  /** Construction immediately returns resources; readiness remains the original composition work. */
  const endpoints = transports.map((transport, index) =>
    createRuntimeApiEndpoint(
      {
        id: `resource-${index}`,
        transport,
        targetIds: [`resource-${1 - index}`],
        codec: identityCodecV1 as IRpcFactoryConfig['codec'],
        framer: messageFramerV1,
        middlewares: [connect({ transport }), abort()],
        ...(index === 1 ? { provider: { echo: (context) => context.success(context.data) } } : {})
      },
      {
        transport,
        peerId: `resource-${1 - index}`,
        agreement: { capabilities }
      }
    )
  )
  return {
    endpoints,
    async close() {
      await Promise.all(endpoints.map((endpoint) => endpoint.dispose()))
      transports[0].close?.()
    }
  }
}

describe('C12 resource possession', () => {
  it('[A44/BC13] returns sync resource and snapshots a cold request before ready', async () => {
    /** Mutation after invocation must not change the captured new resource request. */
    const fixture = pair()
    /** Caller retains the original object; Core captures its supported portable data once. */
    const payload = { value: 42 }
    try {
      expect(typeof fixture.endpoints[0]!.request, 'A44_ENDPOINT_SYNC_RESOURCE').toBe('function')
      expect(fixture.endpoints[0]!.ready).toBeInstanceOf(Promise)
      expect(Object.isFrozen(fixture.endpoints[0])).toBe(true)
      /** Readonly readiness is one stable installation result. */
      const readiness = fixture.endpoints[0]!.ready
      const operation = fixture.endpoints[0]!.request('echo', payload)
      payload.value = 99
      expect(await operation).toEqual({ value: 42 })
      expect(fixture.endpoints[0]!.ready).toBe(readiness)
      await Promise.all(fixture.endpoints.map((endpoint) => endpoint.ready))
      expect(await fixture.endpoints[0]!.send('resource-1', 'echo', 43)).toBe(43)
      /** Repeated dispose receives the canonical installed endpoint's exact same Promise. */
      const closing = fixture.endpoints[0]!.dispose()
      expect(fixture.endpoints[0]!.dispose()).toBe(closing)
      await closing
    } finally {
      await fixture.close()
    }
  })

  it('[A44/BC13] cold stream controls share one original lazy consumer', async () => {
    /** The actual installed agreement supplies streaming rather than caller option claims. */
    const fixture = pair([RpcCapability.runtimeApi, RpcCapability.stream])
    /** Provider construction remains observable independently of local consumer construction. */
    let constructed = 0
    /** Complete provider values and cleanup prove the real original stream owner is used. */
    let cleaned = 0
    /** Cold opening snapshots this payload before asynchronous endpoint installation. */
    const payload = { value: 42 }
    const consumer = fixture.endpoints[0]!.stream.open('resource-1', 'numbers', payload)
    payload.value = 99
    try {
      await fixture.endpoints[1]!.ready
      fixture.endpoints[1]!.stream.provide('numbers', async function* (value) {
        constructed += 1
        try {
          yield (value as { value: number }).value
          yield 43
          return 44
        } finally {
          cleaned += 1
        }
      })
      expect(constructed).toBe(0)
      expect(await consumer.next()).toEqual({ done: false, value: 42 })
      expect(await consumer.next()).toEqual({ done: false, value: 43 })
      expect(await consumer.next()).toEqual({ done: true, value: 44 })
      expect(constructed).toBe(1)
      expect(cleaned).toBe(1)
    } finally {
      await fixture.close()
    }
  })

  it('[A44/BC13] held binding preserves operation Promise and lazy stream identity', async () => {
    /** Readiness belongs to the supplied binding; this resource owns no replacement readiness gate. */
    const readiness = Promise.resolve()
    /** Each original operation returns its own exact settled Promise. */
    const result = Promise.resolve<IRpcPortableValue>(45)
    /** No stream producer can run until the original iterator receives its first next. */
    let pulls = 0
    /** This iterator is the held resource, without a second consumer or prepared callback. */
    const consumer = (async function* () {
      pulls += 1
      yield 46
    })()
    /** A fake descriptive claim has no route to any operation beyond this supplied object. */
    const binding = {
      ready: readiness,
      request: () => result,
      notify: () => Promise.resolve(),
      stream: { open: () => consumer },
      dispose: () => Promise.resolve(),
      ownsExecution: true,
      family: 'process'
    }
    /** The constructor delegates complete held operations; no capture or retry plumbing is exposed. */
    const endpoint = createRuntimeApiEndpoint({ binding })
    expect(endpoint.ready).toBe(readiness)
    expect(endpoint.request('echo', 1)).toBe(result)
    expect(endpoint.stream.open('numbers', 2)).toBe(consumer)
    expect(pulls).toBe(0)
    expect(await consumer.next()).toEqual({ done: false, value: 46 })
    expect(pulls).toBe(1)
    await consumer.return(undefined)
    /** Disposal aliases the first original operation without repeating its callback. */
    const closing = endpoint.dispose()
    expect(endpoint.dispose()).toBe(closing)
    await closing
  })

  it('[A44/BC12] cold constraints validate without saving limits or leaking prepare authority', () => {
    /** This handle has no prepared quota until the first actual Core construction attaches. */
    const scope = createProviderAdmissionScope()
    expect(Reflect.ownKeys(scope).sort()).toEqual(['clear', 'constrain'])
    expect(() => scope.constrain(0, 1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    scope.constrain(1, 1)
    scope.clear()
    /** First attachment supplies its own actual endpoint limits and framing capacity. */
    const admission = prepareProviderAdmissionScope(scope, 3, 3, 8)
    expect(admission.acquire('a', 'first')).toBe(true)
    expect(admission.acquire('b', 'second')).toBe(true)
    expect(admission.acquire('c', 'third')).toBe(true)
    admission.release('c')
    scope.constrain(2, 2)
    expect(admission.acquire('d', 'fourth')).toBe(false)
    /** Copied callbacks keep their original operations, but cannot copy the private preparation. */
    const copied = { ...scope }
    expect(() => prepareProviderAdmissionScope(copied, 3, 3, 8)).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_UNSUPPORTED' })
    )
    copied.clear()
    expect(admission.size).toBe(0)
  })
})
