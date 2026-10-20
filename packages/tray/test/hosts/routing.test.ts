import { describe, expect, it } from 'vitest'
import { defineProbe } from '@migaia/rpc-core/probe'
import { setTimeout as delay } from 'node:timers/promises'
import { fixture, until } from './helper.js'

describe('mesh routing and admission accounting', () => {
  it('interleaves both built-in forms with one cursor and counts pending requests', async () => {
    /** Genuine thread targets own their business calls and cancellation receipts. */
    const api = await fixture()
    /** Reporter retains contained native notices without printing redundant diagnostics. */
    const reports: unknown[] = []
    /** Declaring an always-available built-in must retain one own namespace member. */
    const childDefinition = api.defineTrayHost({ ...api.nodeCo, routing: [api.roundRobin] })
    /** Three ready candidates preserve their spawn order. */
    const tray = api.createTray({
      hosts: [api.nodeTh, childDefinition],
      report: (error: unknown) => reports.push(error)
    })
    try {
      for (const id of ['a', 'b', 'c']) await tray.spawn('node-th', { id })
      /** A genuine child control leg must return selection failures before target notification. */
      const caller = await tray.spawn('node-co', { id: 'no-candidate-caller' })
      /** Two namespace forms must share one policy sequence. */
      const ids: string[] = []
      for (let index = 0; index < 6; index++) {
        const remote =
          index % 2 ? tray.routing('roundRobin', api.nodeTh) : tray.routing.roundRobin(api.nodeTh)
        ids.push((await remote.request('node.svc.hello')).id)
        expect(remote.host).toBe('node-th')
        expect('id' in remote).toBe(false)
      }
      expect(ids).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
      expect(Object.isFrozen(tray.routing)).toBe(true)
      expect(tray.routing.length).toBe(2)
      expect(tray.routing.roundRobin.length).toBe(1)
      /** The pending call proves the public snapshot uses the one counted send owner. */
      const held = tray.instance(api.nodeTh, 'a').request('node.svc.sleep', 600)
      await until(
        () => tray.list().find((record: any) => record.id === 'a')?.inFlight,
        (value) => value === 1
      )
      /** Keep the first selected target busy so the next pick proves the stable tie break. */
      const onB = tray.routing.leastInFlight(api.nodeTh).request('node.svc.sleep', 200)
      await until(
        () => tray.list().find((record: any) => record.id === 'b')?.inFlight,
        (value) => value === 1
      )
      const onC = tray.routing.leastInFlight(api.nodeTh).request('node.svc.hello')
      expect((await onC).id).toBe('c')
      await Promise.all([held, onB])
      expect(tray.list().every((record: any) => record.inFlight === 0)).toBe(true)
      await tray.stop('a')
      await tray.stop('b')
      await tray.stop('c')
      await expect(
        tray.routing.roundRobin(api.nodeTh).request('node.svc.hello')
      ).rejects.toMatchObject({ code: 'TRAY_HOST_UNAVAILABLE' })
      await expect(
        caller.request('node.svc.routeNotify', { host: 'node-th', policy: 'roundRobin' })
      ).rejects.toMatchObject({ code: 'TRAY_HOST_UNAVAILABLE' })
      expect(tray.balanced).toBeUndefined()
    } finally {
      await tray.dispose()
    }
  }, 30000)
  it('registers custom policies from DSL and options, routes every kind and authenticates child declaration', async () => {
    /** Shared branded policies are imported by genuine native entries. */
    const api = await fixture()
    /** This realm owns the parent policy callback; each native child keeps its own counter. */
    const initialPicks = api.routingPickCount()
    const relayEvents: string[] = []
    const probe = defineProbe({
      stages: ['message'],
      emit: (event) => {
        if (event.method === 'trayRelay.routed') relayEvents.push(event.method)
      }
    })
    const tray = api.createTray({ hosts: api.hosts, probe, report: () => {} })
    try {
      const target = await tray.spawn('node-th', { id: 'b' })
      const declared = await tray.spawn('node-th', { id: 'declared' })
      const plain = await tray.spawn('node-co', { id: 'plain' })
      expect(Object.getOwnPropertyDescriptor(tray.routing, 'toB')).toMatchObject({
        writable: false,
        configurable: false
      })
      expect((await tray.routing.toB(api.nodeTh).request('node.svc.hello')).id).toBe('b')
      await tray.routing('toB', api.nodeTh).notify('node.svc.noted')
      await until(
        () => target.request('node.svc.notedCount'),
        (count) => count === 1
      )
      const items: unknown[] = []
      for await (const item of tray.routing.toB(api.nodeTh).stream('node.svc.count', 3))
        items.push(item)
      expect(items).toEqual([1, 2, 3])
      for (const member of [true, false])
        expect(
          (await declared.request('node.svc.route', { host: 'node-th', policy: 'toB', member })).id
        ).toBe('b')
      expect(await declared.request('node.svc.routingInfo')).toMatchObject({
        picks: 0,
        balanced: false
      })
      expect(api.routingPickCount()).toBeGreaterThan(initialPicks)
      const beforeUnknown = relayEvents.length
      await expect(
        plain.request('node.svc.route', { host: 'node-th', policy: 'toB' })
      ).rejects.toMatchObject({ code: 'TRAY_ROUTING_UNKNOWN' })
      expect(relayEvents.length).toBe(beforeUnknown)
      const routes: string[] = []
      for (let index = 0; index < 3; index++)
        routes.push(
          (
            await plain.request('node.svc.route', {
              host: 'node-th',
              policy: 'roundRobin',
              member: index % 2 === 0
            })
          ).id
        )
      expect(routes).toEqual(['b', 'declared', 'b'])
      const held = plain
        .request('node.svc.route', {
          host: 'node-th',
          policy: 'toB',
          path: 'node.svc.sleep',
          payload: 200
        })
        .catch((error: unknown) => error)
      // The undeclared policy above must reject before a target send.
      await expect(held).resolves.toMatchObject({ code: 'TRAY_ROUTING_UNKNOWN' })
      const pending = declared.notify('node.svc.route', {
        host: 'node-th',
        policy: 'toB',
        path: 'node.svc.sleep',
        payload: 200
      })
      await until(
        () => tray.list().find((record: any) => record.id === 'b')?.inFlight,
        (value) => value === 1
      )
      await pending
      // The parent notify has settled; the inbound relay adds no count to its calling instance.
      expect(tray.list().find((record: any) => record.id === 'declared')?.inFlight).toBe(0)
      await until(
        () => tray.list().find((record: any) => record.id === 'b')?.inFlight,
        (value) => value === 0
      )
      expect(tray.list().every((record: any) => record.inFlight === 0)).toBe(true)
    } finally {
      await tray.dispose()
    }
    const direct = api.defineRoutingPolicy('optionOnly', () => 'b')
    const parent = api.createTray({ hosts: [api.nodeCo], routing: [direct], report: () => {} })
    try {
      await parent.spawn('node-co', { id: 'b' })
      expect((await parent.routing.optionOnly(api.nodeCo).request('node.svc.hello')).id).toBe('b')
    } finally {
      await parent.dispose()
    }
  }, 30000)

  it('preserves policy error identity, rejects invalid registration and never retries unavailable or unknown targets', async () => {
    const api = await fixture()
    const original = Object.assign(new Error('fixture routing failure'), {
      source: '@fixture/tray',
      code: 'PICK_FAILED'
    })
    const invalid = api.defineRoutingPolicy('invalidPick', () => 'absent')
    const failing = api.defineRoutingPolicy('failingPick', () => {
      throw original
    })
    for (const name of ['call', 'roundRobin', 'A-b'])
      expect(() => api.defineRoutingPolicy(name, () => 'b')).toThrowError(
        expect.objectContaining({ code: 'TRAY_ROUTING_INVALID' })
      )
    expect(() =>
      api.createTray({ hosts: [api.nodeTh], routing: [api.defineRoutingPolicy('toB', () => 'b')] })
    ).toThrowError(expect.objectContaining({ code: 'TRAY_ROUTING_INVALID' }))
    expect(() => api.createTray({ hosts: [api.nodeCo], routing: [{ name: 'fake' }] })).toThrowError(
      expect.objectContaining({ code: 'TRAY_ROUTING_INVALID' })
    )
    const definition = api.defineTrayHost({ ...api.nodeCo, routing: [invalid, failing] })
    const tray = api.createTray({
      hosts: [definition],
      routing: [invalid, failing],
      report: () => {}
    })
    try {
      const target = await tray.spawn('node-co', { id: 'b' })
      await expect(
        tray.routing.invalidPick(definition).request('node.svc.hello')
      ).rejects.toMatchObject({ code: 'TRAY_ROUTING_INVALID' })
      const failed = await tray.routing
        .failingPick(definition)
        .request('node.svc.hello')
        .catch((error: unknown) => error)
      expect(failed).toMatchObject({ code: 'TRAY_ROUTING_INVALID', cause: original })
      expect(failed.cause).toBe(original)
      await expect(
        target.request('node.svc.route', { host: 'node-co', policy: 'failingPick' })
      ).rejects.toMatchObject({
        code: 'TRAY_ROUTING_INVALID',
        cause: { source: '@fixture/tray', code: 'PICK_FAILED' }
      })
      await expect(
        target.request('node.svc.routeNotify', { host: 'node-co', policy: 'invalidPick' })
      ).rejects.toMatchObject({ code: 'TRAY_ROUTING_INVALID' })
      await expect(
        target.request('node.svc.routeNotify', { host: 'node-pr', policy: 'roundRobin' })
      ).rejects.toMatchObject({ code: 'TRAY_HOST_UNKNOWN' })
      expect(() => tray.routing('nope', definition)).toThrowError(
        expect.objectContaining({ code: 'TRAY_ROUTING_UNKNOWN' })
      )
      expect(() => tray.routing.roundRobin({ ...definition })).toThrowError(
        expect.objectContaining({ code: 'TRAY_HOST_INVALID' })
      )
      expect(() => tray.routing.roundRobin(api.nodePr)).toThrowError(
        expect.objectContaining({ code: 'TRAY_HOST_UNKNOWN' })
      )
      await expect(
        target.request('node.svc.route', { host: 'node-pr', policy: 'roundRobin' })
      ).rejects.toMatchObject({ code: 'TRAY_HOST_UNKNOWN' })
      await expect(
        tray.routing.roundRobin(definition).request('node.svc.fail')
      ).rejects.toMatchObject({
        source: '@fixture/tray',
        code: 'SVC_FAILED',
        cause: { code: 'SVC_CAUSE' }
      })
    } finally {
      await tray.dispose()
    }
    /** The existing relay owner also rejects a forged name after authenticated sender lookup. */
    const { defineHost } = await import('@migaia/plugin-host')
    const { createRelay } = await import('../../src/hosts/parent/relay.js')
    const { createRegistry } = await import('../../src/hosts/parent/registry.js')
    const { createRoutingRegistry } = await import('../../src/hosts/routing.js')
    const { createParentTopics } = await import('../../src/hosts/parent/topics.js')
    let targetSends = 0
    const registry = createRegistry(
      () => {},
      () => {
        targetSends += 1
        return {
          request: async () => undefined,
          notify: async () => {},
          stream: async function* () {}
        }
      }
    )
    const sender = registry.admit(api.nodeCo, 'sender', undefined)
    registry.identify(sender, 1, 'authenticated-sender')
    const policies = createRoutingRegistry([api.nodeCo], [], registry)
    const topics = createParentTopics(
      registry,
      async () => {},
      () => {}
    )
    const host = defineHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    try {
      const [handle] = await host.use(
        createRelay(
          registry,
          () => ({
            request: async () => undefined,
            notify: async () => {},
            stream: async function* () {}
          }),
          policies,
          new Map([['node-co', api.nodeCo]]),
          topics,
          () => {}
        )
      )
      await expect(
        Promise.resolve().then(() =>
          (handle.getFeature('relay') as any).routed(
            { host: 'node-co', policy: 'forged', kind: 'request', path: 'node.svc.hello' },
            { senderId: 'authenticated-sender' }
          )
        )
      ).rejects.toMatchObject({ code: 'TRAY_ROUTING_UNKNOWN' })
      expect(targetSends).toBe(0)
    } finally {
      topics.close()
      await host.dispose()
    }
  }, 30000)

  it('routes immediate process calls after restart and forwards caller cancellation and remaining deadlines', async () => {
    const api = await fixture()
    const reports: unknown[] = []
    const envelopes: any[] = []
    const probe = defineProbe({
      stages: ['envelope'],
      capture: ['envelope'],
      emit: (event) => {
        /** Native call envelopes and V1 requests carry the same portable application data. */
        const content = event.content as any
        if (event.method === 'trayRelay.routed' && content?.kind === 'runtime-call')
          envelopes.push(content.payload)
        else if (event.method === 'trayRelay.routed' && content?.kind === 'request')
          envelopes.push(content.data.payload)
      }
    })
    const tray = api.createTray({
      hosts: api.hosts,
      probe,
      report: (error: unknown) => reports.push(error)
    })
    try {
      const processA = await tray.spawn('node-pr', { id: 'pa' })
      await tray.spawn('node-pr', { id: 'pb' })
      const caller = await tray.spawn('node-co', { id: 'caller' })
      await tray.restart('pa')
      for (let index = 0; index < 4; index++)
        expect((await tray.routing.roundRobin(api.nodePr).request('node.svc.hello')).id).toBe(
          index % 2 ? 'pb' : 'pa'
        )
      for (const relayed of [false, true]) {
        const controller = new AbortController()
        const request = relayed
          ? caller.request(
              'node.svc.route',
              { host: 'node-pr', policy: 'roundRobin', path: 'node.svc.sleep', payload: 10000 },
              { signal: controller.signal }
            )
          : tray.routing
              .roundRobin(api.nodePr)
              .request('node.svc.sleep', 10000, { signal: controller.signal })
        const failure = request.catch((error: unknown) => error)
        await until(
          () =>
            tray
              .list()
              .filter((record: any) => record.host === 'node-pr')
              .reduce((sum: number, record: any) => sum + record.inFlight, 0),
          (count) => count === 1
        )
        await delay(50)
        controller.abort()
        expect(await failure).toMatchObject({ code: 'CANCELLED' })
        const timed = relayed
          ? caller.request(
              'node.svc.route',
              { host: 'node-pr', policy: 'roundRobin', path: 'node.svc.sleep', payload: 10000 },
              { timeoutMs: 20 }
            )
          : tray.routing.roundRobin(api.nodePr).request('node.svc.sleep', 10000, { timeoutMs: 20 })
        await expect(timed).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      }
      expect(envelopes.length).toBeGreaterThan(0)
      for (const data of envelopes) {
        expect(data).toHaveProperty('policy', 'roundRobin')
        expect(data).not.toHaveProperty('signal')
        expect(data).not.toHaveProperty('timeoutMs')
      }
      await until(
        async () =>
          (await processA.request('node.svc.aborted')) +
          (await tray.instance(api.nodePr, 'pb').request('node.svc.aborted')),
        (count) => count === 4
      )
    } finally {
      await tray.dispose()
    }
  }, 30000)

  it('releases admission counts for every completion and never decrements a new same-id admission', async () => {
    /** This existing owner accepts a transport callback, so no public test seam is introduced. */
    const { createRegistry } = await import('../../src/hosts/parent/registry.js')
    const { TrayCallKind } = await import('../../src/hosts/constants.js')
    const api = await fixture()
    let settle: (value?: unknown) => void = () => {}
    let fail: (error: unknown) => void = () => {}
    const send = {
      request: () =>
        new Promise((resolve, reject) => {
          settle = resolve
          fail = reject
        }),
      notify: () =>
        new Promise<void>((resolve) => {
          settle = () => resolve()
        }),
      stream: () =>
        (async function* () {
          yield 1
          throw new Error('fixture stream failure')
        })()
    }
    const registry = createRegistry(
      () => {},
      () => send
    )
    const record = registry.admit(api.nodeCo, 'b', undefined)
    const pending = registry.sendCounted(record, TrayCallKind.request, { path: 'node.svc.hello' })
    expect(record.inFlight).toBe(1)
    registry.revoke(record)
    const newer = registry.admit(api.nodeCo, 'b', undefined)
    expect(newer.inFlight).toBe(0)
    settle('done')
    await pending
    expect(record.inFlight).toBe(0)
    expect(newer.inFlight).toBe(0)
    const failed = registry
      .sendCounted(newer, TrayCallKind.request, { path: 'node.svc.hello' })
      .catch((error: unknown) => error)
    fail(new Error('fixture request failure'))
    await failed
    expect(newer.inFlight).toBe(0)
    const notify = registry.sendCounted(newer, TrayCallKind.notify, { path: 'node.svc.noted' })
    expect(newer.inFlight).toBe(1)
    settle()
    await notify
    expect(newer.inFlight).toBe(0)
    const stream = registry.sendCounted(newer, TrayCallKind.stream, { path: 'node.svc.count' })
    expect(await stream.next()).toMatchObject({ done: false, value: 1 })
    expect(newer.inFlight).toBe(1)
    await stream.return?.()
    expect(newer.inFlight).toBe(0)
    const throwing = registry.sendCounted(newer, TrayCallKind.stream, { path: 'node.svc.count' })
    await throwing.next()
    await expect(throwing.next()).rejects.toThrow('fixture stream failure')
    expect(newer.inFlight).toBe(0)
    const injected = registry.sendCounted(newer, TrayCallKind.stream, { path: 'node.svc.count' })
    await injected.next()
    await expect(injected.throw?.(new Error('fixture consumer throw'))).rejects.toThrow()
    expect(newer.inFlight).toBe(0)
    const broken = createRegistry(
      () => {},
      () => ({
        ...send,
        stream: () => {
          throw new Error('fixture first send failure')
        }
      })
    )
    const other = broken.admit(api.nodeCo, 'other', undefined)
    await expect(
      broken.sendCounted(other, TrayCallKind.stream, { path: 'node.svc.count' }).next()
    ).rejects.toThrow('fixture first send failure')
    expect(other.inFlight).toBe(0)
  })
})
