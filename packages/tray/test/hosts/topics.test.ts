import { describe, expect, it, vi } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { fixture, until, marker, lines, chainHas, assembled } from './helper.js'

describe('Tray business topics', () => {
  it('validates topic and portable payload before delivery', async () => {
    /** Public topic admission belongs to Tray rather than EventSubscriber's local key grammar. */
    const api = await fixture()
    /** No instances are necessary to establish the parent entry contract. */
    const tray = api.createTray({ hosts: api.hosts })
    try {
      expect(() => tray.publish('', 1)).toThrowError(
        expect.objectContaining({ code: 'TRAY_TOPIC_INVALID' })
      )
      expect(() => tray.subscribe('', () => undefined)).toThrowError(
        expect.objectContaining({ code: 'TRAY_TOPIC_INVALID' })
      )
      expect(() => tray.publish('business', () => undefined)).toThrowError(
        expect.objectContaining({ code: 'TRAY_VALUE_NOT_PORTABLE' })
      )
      /** Child admission uses the same actual owner exported to its per-init Tray Feature. */
      const ownerUrl = new URL('../../dist/hosts/child/topics.js', import.meta.url).href
      /** Invalid topics and payloads must reject before a relay operation is attempted. */
      const request = vi.fn()
      /** Only the existing consumed RPC request is observed; no native lifecycle is fabricated. */
      const topics = (await import(ownerUrl)).createChildTopics(
        () => ({ request }),
        () => undefined
      )
      await expect(topics.publish('', 1)).rejects.toMatchObject({ code: 'TRAY_TOPIC_INVALID' })
      await expect(topics.subscribe('', () => undefined)).rejects.toMatchObject({
        code: 'TRAY_TOPIC_INVALID'
      })
      await expect(topics.publish('business', () => undefined)).rejects.toMatchObject({
        code: 'TRAY_VALUE_NOT_PORTABLE'
      })
      expect(request).not.toHaveBeenCalled()
      topics.close()
    } finally {
      await tray.dispose()
    }
  })

  it('authenticates process publisher and fans out once across all runtimes', async () => {
    /** Fixture declarations reach genuine coroutine, Worker and child-process dispatchers. */
    const api = await fixture()
    /** Parent listener records the same business event as every child subscriber. */
    const parent: any[] = []
    /** Each instance owns its own local subscription count. */
    const tray = api.createTray({ hosts: api.hosts })
    try {
      tray.subscribe('business', (payload: unknown, meta: any) => {
        parent.push({ payload, meta, frozen: Object.isFrozen(meta) })
      })
      /** Every native family installs one local listener during genuine init. */
      const remotes = []
      for (const [index, host] of api.hosts.entries())
        remotes.push(
          await tray.spawn(host.name, { id: `p${index}`, config: { topic: 'business' } })
        )
      /** Forged application data never becomes the authenticated sender metadata. */
      const payload = { id: 'x' }
      await remotes[2].request('node.svc.topicPublish', { topic: 'business', payload })
      /** Sender metadata comes from the parent's accepted process generation. */
      const from = { id: 'p2', host: 'node-pr', generation: tray.list()[2].generation }
      expect(parent).toEqual([{ payload, meta: { from }, frozen: true }])
      for (const remote of remotes) {
        await until(
          () => remote.request('node.svc.topicMessages'),
          (values: any) => values.length === 1
        )
        expect(await remote.request('node.svc.topicMessages')).toEqual([
          { payload, meta: { from }, frozen: true }
        ])
      }
      tray.publish('business', 2)
      for (const remote of remotes) {
        await until(
          () => remote.request('node.svc.topicMessages'),
          (values: any) => values.length === 2
        )
        expect((await remote.request('node.svc.topicMessages'))[1]).toEqual({
          payload: 2,
          meta: { from: { parent: true } },
          frozen: true
        })
      }
    } finally {
      await tray.dispose()
    }
  }, 30000)

  it('keeps business topics separate and contains parent listener failures', async () => {
    /** Lifecycle and business topic publications use different canonical hub owners. */
    const api = await fixture()
    /** Original user errors remain reachable at the parent reporter. */
    const reports: unknown[] = []
    /** Observations record all callbacks without introducing an event transport. */
    const values: any[] = []
    /** Genuine parent facade exercises public subscribe/publish entry points. */
    const tray = api.createTray({
      hosts: api.hosts,
      report: (error: unknown) => reports.push(error)
    })
    /** Fixture-owned coded errors keep report assertions independent from wrapper text. */
    const textUrl = new URL('./fixtures/fixture-text.mjs', import.meta.url).href
    /** Existing diagnostic contract supplies distinct synchronous and asynchronous causes. */
    const { fixtureError, FixtureText } = await import(textUrl)
    /** Sync failure must never prevent a later listener from receiving the same publication. */
    const failure = fixtureError(FixtureText.businessCode, FixtureText.businessMessage)
    try {
      tray.on('spawned', () => values.push('lifecycle'))
      tray.subscribe('spawned', () => {
        throw failure
      })
      tray.subscribe('spawned', () => Promise.reject(failure))
      tray.subscribe('spawned', (payload: unknown, meta: unknown) => values.push({ payload, meta }))
      expect(() => tray.publish('spawned', 1)).not.toThrow()
      expect(values).toEqual([{ payload: 1, meta: { from: { parent: true } } }])
      expect(reports).toContain(failure)
      await until(
        () => reports.filter((error) => error === failure).length,
        (count) => count === 2
      )
    } finally {
      await tray.dispose()
    }
  })

  it('first concurrent child listeners share registration and last off is idempotent', async () => {
    /** Internal child owner uses the same outlet request boundary as genuine native fixtures. */
    const ownerUrl = new URL('../../dist/hosts/child/topics.js', import.meta.url).href
    /**
     * Direct owner construction permits the required held relay response without another public
     * seam.
     */
    const { createChildTopics } = await import(ownerUrl)
    /** This one stub represents the parent relay request already consumed by the owner. */
    const request = vi.fn().mockResolvedValue(undefined)
    /** Held first admission proves concurrent listeners use one relay operation. */
    let admit!: () => void
    request.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          admit = resolve
        })
    )
    /** Local delivery observations use real EventSubscriber fan-out. */
    const received: number[] = []
    /** Reports must remain empty for ordinary registration and release transitions. */
    const reports: unknown[] = []
    /** Only the existing consumed request method is stubbed. */
    const topics = createChildTopics(
      () => ({ request }),
      (error: unknown) => reports.push(error)
    )
    /** Both subscribe calls execute before the shared first response settles. */
    const first = topics.subscribe('shared', () => {
      received.push(1)
    })
    /** Second local callback does not create a second parent membership. */
    const second = topics.subscribe('shared', () => {
      received.push(2)
    })
    expect(request).toHaveBeenCalledTimes(1)
    admit()
    /** Off receipts stay tied to their individual local registrations. */
    const [offFirst, offSecond] = await Promise.all([first, second])
    topics.deliver({ topic: 'shared', payload: 1, meta: { from: { parent: true } } })
    expect(received).toEqual([1, 2])
    await offFirst()
    topics.deliver({ topic: 'shared', payload: 2, meta: { from: { parent: true } } })
    expect(received).toEqual([1, 2, 2])
    await Promise.all([offSecond(), offSecond()])
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.map((call) => call[1])).toEqual([
      'trayRelay.subscribe',
      'trayRelay.unsubscribe'
    ])
    topics.deliver({ topic: 'shared', payload: 3, meta: { from: { parent: true } } })
    expect(received).toEqual([1, 2, 2])
    expect(reports).toEqual([])
    topics.close()
  })

  it('failed relay subscribe rolls back listeners and retains the original failure', async () => {
    /** The required relay rejection is injected at the existing consumed outlet boundary. */
    const ownerUrl = new URL('../../dist/hosts/child/topics.js', import.meta.url).href
    /** Fixture errors retain native identity for the failed-subscribe contract. */
    const textUrl = new URL('./fixtures/fixture-text.mjs', import.meta.url).href
    /** Actual child topic owner and existing fixture diagnostic constructor are used directly. */
    const { createChildTopics } = await import(ownerUrl)
    /** Diagnostic code separates this relay failure from listener errors. */
    const { fixtureError, FixtureText } = await import(textUrl)
    /** Subscribe rejects this exact original object. */
    const failure = fixtureError(FixtureText.businessCode, FixtureText.businessMessage)
    /** Later admission succeeds, proving the failed first membership was removed. */
    const request = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    /** Rolled-back local callbacks must not observe delivery. */
    const listener = vi.fn()
    /** No report path is expected for a public subscribe rejection. */
    const topics = createChildTopics(
      () => ({ request }),
      () => undefined
    )
    await expect(topics.subscribe('failed', listener)).rejects.toBe(failure)
    topics.deliver({ topic: 'failed', meta: { from: { parent: true } } })
    expect(listener).not.toHaveBeenCalled()
    /** A fresh local subscription must issue a fresh relay request. */
    const off = await topics.subscribe('failed', listener)
    topics.deliver({ topic: 'failed', meta: { from: { parent: true } } })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(2)
    await off()
    topics.close()
  })

  it('thread last off, active restart, crash restart and process removal isolate memberships', async () => {
    /** Existing thread child entry serves the same host name with this parent supervision policy. */
    const api = await fixture()
    /** Native crash replacement is configured through the canonical supervisor option. */
    const thread = api.defineTrayHost({
      ...api.nodeTh,
      supervisor: { restart: { mode: 'on-failure', maxRestarts: 2 } }
    })
    /** Parent and each native subscriber use one shared business topic. */
    const reports: unknown[] = []
    /**
     * Existing private registry factory exposes the genuine accepted sender identity for this
     * oracle.
     */
    const registryUrl = new URL('../../dist/hosts/parent/registry.js', import.meta.url).href
    /** Existing topic factory retains its real generation membership owner. */
    const topicsUrl = new URL('../../dist/hosts/parent/topics.js', import.meta.url).href
    /** Spies observe canonical factory results without manufacturing lifecycle or sender state. */
    const registrySpy = vi.spyOn(await import(registryUrl), 'createRegistry')
    /** Stale relay operations are driven directly at the consumed owner after a real restart. */
    const topicsSpy = vi.spyOn(await import(topicsUrl), 'createParentTopics')
    /** Registry and raw native exits own generation removal during both restart forms. */
    const tray = api.createTray({
      hosts: [api.nodeCo, thread, api.nodePr],
      report: (error: unknown) => reports.push(error)
    })
    try {
      /** Coroutine remains subscribed throughout the management operations. */
      const coroutine = await tray.spawn('node-co', { id: 'co', config: { topic: 'shared' } })
      /** Thread init re-registers its business listener for every native generation. */
      const remote = await tray.spawn('node-th', { id: 'th', config: { topic: 'shared' } })
      /** Process removal must release its membership before later publications. */
      await tray.spawn('node-pr', { id: 'pr', config: { topic: 'shared' } })
      await remote.request('node.svc.topicSubscribe', { topic: 'shared', key: 'second' })
      tray.publish('shared', 1)
      await until(
        () => remote.request('node.svc.topicMessages'),
        (values: any) => values.length === 2
      )
      await remote.request('node.svc.topicOff', 'shared')
      tray.publish('shared', 2)
      await until(
        () => remote.request('node.svc.topicMessages'),
        (values: any) => values.length === 3
      )
      await remote.request('node.svc.topicOff', 'second')
      tray.publish('shared', 3)
      await delay(50)
      expect(await remote.request('node.svc.topicMessages')).toHaveLength(3)
      /** Old sender id comes from the real accepted native identity, before active restart. */
      const registry = registrySpy.mock.results.at(-1)!.value
      /** Topic relay owner is the same object installed in the actual parent relay plugin. */
      const topics = topicsSpy.mock.results.at(-1)!.value
      /** A late old-generation wire operation cannot remove the next generation's registration. */
      const oldSender = registry.get('th').instanceId
      await tray.restart('th')
      expect(() => topics.unregister('shared', { senderId: oldSender })).toThrowError(
        expect.objectContaining({ code: 'TRAY_INSTANCE_UNKNOWN' })
      )
      expect(() => topics.register('shared', { senderId: oldSender })).toThrowError(
        expect.objectContaining({ code: 'TRAY_INSTANCE_UNKNOWN' })
      )
      tray.publish('shared', 4)
      await until(
        () => remote.request('node.svc.topicMessages'),
        (values: any) => values.length === 1
      )
      expect(await remote.request('node.svc.topicMessages')).toHaveLength(1)
      /** First failing native exit triggers genuine RPC supervision rather than a test state edit. */
      const previous = tray.list().find((item: any) => item.id === 'th').generation
      await remote.request('node.svc.exitCrash').catch(() => undefined)
      await until(
        () => tray.list().find((item: any) => item.id === 'th'),
        (value: any) => value.state === 'ready' && value.generation > previous
      )
      tray.publish('shared', 5)
      await until(
        () => remote.request('node.svc.topicMessages'),
        (values: any) => values.length === 1
      )
      expect(await remote.request('node.svc.topicMessages')).toHaveLength(1)
      await tray.remove('pr')
      /** Clear only known crash diagnostics before proving removed delivery is silent. */
      reports.length = 0
      tray.publish('shared', 6)
      await until(
        () => coroutine.request('node.svc.topicMessages'),
        (values: any) => values.length === 6
      )
      await until(
        () => remote.request('node.svc.topicMessages'),
        (values: any) => values.length === 2
      )
      expect(reports).toEqual([])
    } finally {
      await tray.dispose()
      registrySpy.mockRestore()
      topicsSpy.mockRestore()
    }
  }, 30000)

  it('contains delivery send rejection on parent and handler failure on genuine child', async () => {
    /** Existing outlet selector permits transport failure injection without a new seam. */
    const runtimeUrl = new URL('../../dist/hosts/runtime.js', import.meta.url).href
    /** Existing child topic factory supplies the deliver handler used by the genuine dispatcher. */
    const childUrl = new URL('../../dist/hosts/child/topics.js', import.meta.url).href
    /** Fixture diagnostic contract creates classified original send and handler failures. */
    const textUrl = new URL('./fixtures/fixture-text.mjs', import.meta.url).href
    /** Original selectors and owner constructors remain the normal production path. */
    const runtime = await import(runtimeUrl)
    /** Coroutine construction executes this exact module in its genuine child Host. */
    const child = await import(childUrl)
    /** Shared fixture constructor preserves native source, code, cause and stack. */
    const { fixtureError, FixtureText } = await import(textUrl)
    /** Parent reports the original rejected notify-send Promise. */
    const sendFailure = fixtureError(FixtureText.businessCode, FixtureText.businessMessage)
    /** A separate code proves the second report came from the child's handler failure. */
    const handlerFailure = fixtureError(FixtureText.causeCode, FixtureText.causeMessage)
    /** Fault selection is bounded to this one delivery scenario. */
    let rejectSend = false
    /** Only the accepted parent assembly receives the rejected outgoing send. */
    let parent: any
    /** Original family selection delegates all normal management and call behavior. */
    const originalOutlet = runtime.outletOf
    /** Existing selector is wrapped only for the requested delivery fault. */
    const outletSpy = vi
      .spyOn(runtime, 'outletOf')
      .mockImplementation((host: any, definition: any) => {
        /** Genuine outlet owns every native resource and RPC receipt. */
        const outlet = originalOutlet(host, definition)
        if (host !== parent) return outlet
        return {
          ...outlet,
          notify: (...args: any[]) =>
            rejectSend && args[1] === 'trayChild.deliver'
              ? Promise.reject(sendFailure)
              : outlet.notify(...args)
        }
      })
    /** Only the direct child handler is faulted; notify still traverses the actual RPC endpoint. */
    let rejectHandler = false
    /** Original local topic hub remains in use for ordinary delivery. */
    const originalTopics = child.createChildTopics
    /** Existing construction seam changes only the handler fault selected by this test. */
    const childSpy = vi.spyOn(child, 'createChildTopics').mockImplementation((...args: any[]) => {
      /** Actual EventSubscriber and first/last membership owner are retained. */
      const topics = originalTopics(...args)
      return {
        ...topics,
        deliver: (input: any) => {
          if (rejectHandler) throw handlerFailure
          topics.deliver(input)
        }
      }
    })
    /** The native coroutine's original reporter is shared with the parent by the runtime adapter. */
    const reports: unknown[] = []
    /** Parent listener proves one failed child never fails another subscriber. */
    const parentValues: unknown[] = []
    /** Branded fixture definition reaches the real native coroutine task and dispatcher. */
    const api = await fixture()
    /** Private assembly exposes only the existing parent Host used by the outlet selector. */
    const { tray, host } = await assembled({
      hosts: [api.nodeCo],
      report: (error: unknown) => reports.push(error)
    })
    parent = host
    try {
      /** Init installs a genuine child subscription before faults are enabled. */
      const remote = await tray.spawn('node-co', { id: 'child', config: { topic: 'faults' } })
      tray.subscribe('faults', (value: unknown) => {
        parentValues.push(value)
      })
      rejectSend = true
      expect(() => tray.publish('faults', 1)).not.toThrow()
      await until(() => reports.includes(sendFailure), Boolean)
      rejectSend = false
      rejectHandler = true
      expect(() => tray.publish('faults', 2)).not.toThrow()
      await until(() => reports.some((error) => chainHas(error, 'SVC_CAUSE')), Boolean)
      expect(parentValues).toEqual([1, 2])
      rejectHandler = false
      tray.publish('faults', 3)
      await until(
        () => remote.request('node.svc.topicMessages'),
        (values: any) => values.length === 1
      )
      expect((await remote.request('node.svc.topicMessages'))[0].payload).toBe(3)
    } finally {
      rejectSend = false
      rejectHandler = false
      await tray.dispose()
      outletSpy.mockRestore()
      childSpy.mockRestore()
    }
  }, 30000)

  it('init subscriptions miss starting publications and child user failures stay contained', async () => {
    /** Marker comes from genuine plugin install after its first subscription has been accepted. */
    const api = await fixture()
    /** Child target report marker is separate from parent send-failure reporting. */
    const reportMarker = marker('topic-child-report')
    /** Init marker identifies the bounded starting window without assuming a startup duration. */
    const initMarker = marker('topic-init')
    /** Thread realm reports user callback errors through its original RPC reporter. */
    const tray = api.createTray({ hosts: api.hosts })
    try {
      /** Delayed plugin install leaves the authenticated topic membership in starting. */
      const pending = tray.spawn('node-th', {
        id: 'starting',
        config: { topic: 'init', initMarker, initDelayMs: 200, reportMarker }
      })
      await until(
        () => lines(initMarker),
        (values) => values.length === 1
      )
      tray.publish('init', 'missed')
      /** Ready is the only delivery boundary; buffered replay is not added. */
      const remote = await pending
      tray.publish('init', 'received')
      await until(
        () => remote.request('node.svc.topicMessages'),
        (values: any) => values.length === 1
      )
      expect((await remote.request('node.svc.topicMessages'))[0].payload).toBe('received')
      await remote.request('node.svc.topicSubscribe', {
        topic: 'failures',
        key: 'sync',
        throwSync: true
      })
      await remote.request('node.svc.topicSubscribe', {
        topic: 'failures',
        key: 'async',
        rejectAsync: true
      })
      await remote.request('node.svc.topicSubscribe', { topic: 'failures', key: 'good' })
      expect(() => tray.publish('failures', 1)).not.toThrow()
      await until(
        () => remote.request('node.svc.topicMessages'),
        (values: any) => values.length === 4
      )
      await until(
        () => lines(reportMarker),
        (values) =>
          values.some((line) => line.includes('SVC_FAILED')) &&
          values.some((line) => line.includes('SVC_CAUSE'))
      )
    } finally {
      await tray.dispose()
    }
  }, 30000)
})
