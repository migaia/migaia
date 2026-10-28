import { describe, expect, it } from 'vitest'
import { fixture, livePorts, liveThreads, processAlive, until } from './helper.ts'

describe('Tray Hosts root integration', () => {
  it('[A-total] manages shared agent, Worker and process hosts with relayed request and ordered stream', async () => {
    /** One shared module supplies all three branded runtime declarations. */
    const api = await fixture()
    /** Baselines exclude resources already owned by the Vitest host process. */
    const beforeThreads = await liveThreads()
    /** Coroutine task resources must be released before dispose resolves. */
    const beforePorts = livePorts()
    /** Root registry owns four genuine units. */
    const tray = api.createTray({ hosts: [api.agent, api.worker, api.wiki] })
    /** Native process identity must disappear after explicit removal. */
    let wikiPid = 0
    try {
      /** Each agent uses the default omitted coroutine runtime. */
      const alice = await tray.spawn('agent', { id: 'agent-alice', config: { label: 'alice' } })
      /** A separate admission owns Bob's stream and later restart. */
      const bob = await tray.spawn('agent', { id: 'agent-bob', config: { label: 'bob' } })
      /** This remote represents a real Node Worker caller. */
      const worker = await tray.spawn('worker', { id: 'worker-1' })
      /** This remote represents a real Node child process target. */
      const wiki = await tray.spawn('wiki', { id: 'wiki-main' })
      wikiPid = (await wiki.request('node.svc.hello')).pid
      expect(
        await alice.request('node.svc.ask', { host: 'wiki', id: 'wiki-main', value: 'search' })
      ).toEqual({ id: 'wiki-main', value: 'search' })
      expect(
        await worker.request('node.svc.collect', { host: 'agent', id: 'agent-bob', total: 3 })
      ).toEqual([1, 2, 3])
      /** Management resolves only after the new generation's init becomes callable. */
      const before = await tray.get('agent-bob')
      /** Returned generation belongs to this restart's queue entry. */
      const restarted = await tray.restart('agent-bob')
      expect(restarted).toMatchObject({ state: 'ready' })
      expect(restarted.generation).toBeGreaterThan(before.generation)
      expect(await bob.request('node.svc.hello')).toMatchObject({
        generation: restarted.generation,
        initCount: 1
      })
      expect(tray.list({ host: 'agent' })).toHaveLength(2)
      expect(
        tray.list({ host: 'agent' }).every((instance: any) => instance.state === 'ready')
      ).toBe(true)
      await tray.remove('wiki-main')
      await expect(tray.get('wiki-main')).rejects.toMatchObject({
        source: 'tray',
        code: 'TRAY_INSTANCE_UNKNOWN'
      })
      await until(
        () => processAlive(wikiPid),
        (alive) => !alive
      )
    } finally {
      await tray.dispose()
    }
    expect(() => tray.list()).toThrowError(expect.objectContaining({ code: 'TRAY_DISPOSED' }))
    expect(processAlive(wikiPid)).toBe(false)
    expect(await liveThreads()).toEqual(beforeThreads)
    await until(livePorts, (count) => count <= beforePorts)
  }, 30000)
})
