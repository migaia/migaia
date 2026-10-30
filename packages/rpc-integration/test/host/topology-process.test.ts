import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/**
 * Mixed-carrier forwarding through one process: origin a calls through forwarding process b into
 * b's thread c, child process d, thread pool and coroutine co, using only public entries.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RpcProbeDirection, RpcProbeOutcome } from '@migaia/rpc-contract/interfaces'
import type { IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { TopologyLeaf } from './fixtures/topology-leaf.ts'

import { RPC_POOL_PEER_ID } from '@migaia/rpc-plugin-pool'
import { processPlugin } from '@migaia/rpc-plugin-process'
import {
  LeafFailure,
  HopAuthCounter,
  HopAuthText,
  HopSecret,
  Topology,
  binaryPattern,
  type ITopologyLeafSnapshot,
  type ITopologyOptions,
  type ITopologyProbeEvent
} from './fixtures/topology-vocabulary.ts'

/** Inspect snapshot returned by forwarding host b. */
type IBSnapshot = Readonly<{
  selfId: string
  selfName: string
  pid: number
  forward: readonly ITopologyProbeEvent[]
  auth: Readonly<{ signed: number; verified: number }>
  c: ITopologyLeafSnapshot
  d?: ITopologyLeafSnapshot
  co: ITopologyLeafSnapshot
}>

/** Peer-closed listener surface the process transport adds to its namespace. */
type IPeerClosing = Readonly<{ onPeerClosed(listener: (event: unknown) => void): unknown }>

/** Business call options shared by every traced call. */
const traced = { trace: Topology.trace } as const

/**
 * Open origin a with one spawned forwarding process b and wait until b's children are ready.
 *
 * @param options Application options forwarded to b's recipe.
 * @returns The origin host; the caller closes it.
 */
async function openOrigin(options: ITopologyOptions = {}): Promise<IRpcHost> {
  /** Origin host whose process namespace holds b. */
  const host = await createRpcHost({
    self: { name: 'a', instanceId: 'topology-a' },
    plugins: [
      processPlugin({
        name: Topology.b,
        spawn: {
          entry: new URL('./fixtures/topology-b.ts', import.meta.url),
          args: [JSON.stringify(options)]
        }
      })
    ],
    report: () => undefined
  })
  try {
    await host.process.send(Topology.b, Topology.ready)
    return host
  } catch (error) {
    await host.close()
    throw error
  }
}

/** Read b's forward rows and its leaves' counters. */
function inspectB(host: IRpcHost): Promise<IBSnapshot> {
  return host.process.send(Topology.b, Topology.inspect) as Promise<IBSnapshot>
}

/** Forward one traced call to `leaf.method` through b. */
function viaB(
  host: IRpcHost,
  leaf: string,
  method: string,
  payload?: IRpcPortableValue,
  options: Record<string, unknown> = {}
): Promise<unknown> {
  return host.process.send(Topology.b, `${leaf}.${method}`, payload, { ...traced, ...options })
}

/** Collect the error a rejected call settles with. */
async function rejection(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending
  } catch (error) {
    return error
  }
  throw new Error('expected rejection')
}

/** Walk `cause` links and return every node, bounded by the chain length. */
function causeChain(error: unknown): unknown[] {
  /** Nodes reached so far, starting at the top-level error. */
  const chain: unknown[] = []
  /** Current node in the walk. */
  let node: unknown = error
  while (node !== undefined && node !== null && chain.length < 32) {
    chain.push(node)
    node = (node as { cause?: unknown }).cause
  }
  return chain
}

/** Assert the leaf failure came back with its code, source and root cause, plus the route. */
function expectLeafFailure(error: unknown): void {
  /** Every node reachable through `cause`. */
  const chain = causeChain(error)
  expect(chain).toContainEqual(
    expect.objectContaining({ source: LeafFailure.source, code: LeafFailure.code })
  )
  expect(chain).toContainEqual(expect.objectContaining({ message: LeafFailure.rootMessage }))
  expect(error).toMatchObject({ route: expect.any(Array) })
}

describe('forwarding through process b to its thread, pool and coroutine', () => {
  /** Origin host shared by the business assertions in this block. */
  let host: IRpcHost

  beforeAll(async () => {
    host = await openOrigin()
  })
  afterAll(async () => {
    await host?.close()
  })

  it('executes once on thread c and observes the forward hop on b and on c', async () => {
    expect(await viaB(host, Topology.c, Topology.echo, 1)).toMatchObject({ value: 1, seq: 1 })
    /** Counters and observations after the business call. */
    const b = await inspectB(host)
    expect(b.c.echoCalls).toBe(1)
    expect(b.forward.map((event) => [event.outcome, event.hop])).toEqual([
      [RpcProbeOutcome.received, 1],
      [RpcProbeOutcome.sent, 1]
    ])
    expect(b.forward[1]!.route).toHaveLength(2)
    /** The leaf sees the hop and the route appended by b. */
    const inbound = b.c.messages.find((event) => event.direction === RpcProbeDirection.inbound)
    expect(inbound).toMatchObject({ hop: 1, route: b.forward[1]!.route })
  })

  it('restores the leaf failure from thread c with code, source, cause and route', async () => {
    expectLeafFailure(await rejection(viaB(host, Topology.c, Topology.fail)))
    expect((await inspectB(host)).c.failCalls).toBe(1)
  })

  it('runs 20 concurrent calls once each on b pool members, seen by a as one peer', async () => {
    /** Results of 20 concurrent forwarded calls into the pool. */
    const results = (await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        viaB(host, RPC_POOL_PEER_ID, Topology.echo, index)
      )
    )) as { value: number; leaf: string; seq: number }[]
    expect(results.map((result) => result.value)).toEqual(Array.from({ length: 20 }, (_u, i) => i))
    /** Highest sequence each member reached; a repeat or hidden execution breaks the sum. */
    const highest = new Map<string, number>()
    /** Distinct (member, sequence) executions. */
    const executions = new Set<string>()
    for (const result of results) {
      executions.add(`${result.leaf}:${result.seq}`)
      highest.set(result.leaf, Math.max(highest.get(result.leaf) ?? 0, result.seq))
    }
    expect(executions.size).toBe(20)
    expect([...highest.values()].reduce((sum, value) => sum + value, 0)).toBe(20)
  })

  it('executes once on coroutine co and restores its failure', async () => {
    expect(await viaB(host, Topology.coroutine, Topology.echo, 7)).toMatchObject({
      value: 7,
      seq: 1
    })
    expectLeafFailure(await rejection(viaB(host, Topology.coroutine, Topology.fail)))
    /** Coroutine counters after one echo and one failure. */
    const b = await inspectB(host)
    expect([b.co.echoCalls, b.co.failCalls]).toEqual([1, 1])
  })

  it('cancels a forwarded stream mid-way and the leaf generator finalizes', async () => {
    /** Lazy stream forwarded through b to c's unbounded generator. */
    const stream = host.process
      .streamTo(Topology.b, `${Topology.c}.${Topology.ticks}`, undefined, traced)
      [Symbol.asyncIterator]()
    /** First three values pulled through both hops. */
    const values: unknown[] = []
    for (let index = 0; index < 3; index++) values.push((await stream.next()).value)
    expect(values).toEqual([0, 1, 2])
    await stream.return?.()
    await expect
      .poll(async () => (await inspectB(host)).c.streamsFinalized, { timeout: 5000 })
      .toBe(1)
    expect((await inspectB(host)).c.streamsOpened).toBe(1)
  })

  it('restores a mid-stream leaf failure through the forwarding hop', async () => {
    /** Lazy stream through b to a generator that fails after two values. */
    const stream = host.process
      .streamTo(Topology.b, `${Topology.c}.${Topology.ticksFail}`, undefined, traced)
      [Symbol.asyncIterator]()
    expect((await stream.next()).value).toBe(0)
    expect((await stream.next()).value).toBe(1)
    expectLeafFailure(await rejection(stream.next()))
  })

  it('runs a forwarded group once per step and refuses a group with an unknown step', async () => {
    /** Echo executions before the groups. */
    const before = (await inspectB(host)).c.echoCalls
    /** Two steps forwarded through b to c as one group. */
    const outcomes = (await host.process.group(
      [
        { method: `${Topology.c}.${Topology.echo}`, payload: 'g1' },
        { method: `${Topology.c}.${Topology.echo}`, payload: 'g2' }
      ],
      traced
    )) as readonly { state: string; result?: { value: unknown } }[]
    expect(outcomes.map((outcome) => outcome.result?.value)).toEqual(['g1', 'g2'])
    expect((await inspectB(host)).c.echoCalls).toBe(before + 2)
    /** A group whose second step names a method c does not provide. */
    await rejection(
      host.process.group(
        [
          { method: `${Topology.c}.${Topology.echo}`, payload: 'g3' },
          { method: `${Topology.c}.missing`, payload: 'g4' }
        ],
        traced
      )
    )
    expect((await inspectB(host)).c.echoCalls).toBe(before + 2)
  })

  it('propagates abort with its reason to the leaf signal', async () => {
    /** Caller-owned cancellation for the in-flight wait. */
    const controller = new AbortController()
    /** Forwarded wait that only settles on abort. */
    const pending = viaB(host, Topology.c, Topology.wait, undefined, {
      signal: controller.signal
    })
    await expect.poll(async () => (await inspectB(host)).c.waitCalls, { timeout: 5000 }).toBe(1)
    controller.abort(new Error('caller stopped'))
    await rejection(pending)
    await expect
      .poll(async () => (await inspectB(host)).c.aborts, { timeout: 5000 })
      .toEqual(['caller stopped'])
  })

  it('carries the remaining deadline to the leaf without growing it', async () => {
    /** Remaining time the leaf observed for a 5 s caller budget. */
    const seen = (await viaB(host, Topology.c, Topology.remaining, undefined, {
      timeout: { ms: 5000 }
    })) as { timeoutMs: number | null }
    expect(seen.timeoutMs).toEqual(expect.any(Number))
    expect(seen.timeoutMs).toBeGreaterThan(0)
    expect(seen.timeoutMs).toBeLessThanOrEqual(5000)
  })

  it('delivers 1 MiB of binary byte-for-byte through both hops', async () => {
    expect(await viaB(host, Topology.c, Topology.bytes, binaryPattern(1 << 20))).toEqual({
      length: 1 << 20,
      mismatches: 0
    })
  })

  it('rejects a forwarding loop between b and c without reaching the leaf', async () => {
    /**
     * Only this origin requests the explicit public providers; ordinary topology cases stay
     * unchanged.
     */
    const looping = await openOrigin({ loop: true })
    try {
      /** The loop must refuse before any actual echo business can execute. */
      const before = (await inspectB(looping)).c.echoCalls
      /** A calls through b to c.loop, whose explicitly held target revisits b.loop. */
      const error = await rejection(viaB(looping, Topology.c, Topology.loop, 0))
      expect(causeChain(error)).toContainEqual(expect.objectContaining({ code: 'FORWARD_LOOP' }))
      expect((await inspectB(looping)).c.echoCalls).toBe(before)
      /** Split horizon keeps the old reflected route out of b's advertised public directory. */
      const reflected = `${Topology.c}.${Topology.b}.${Topology.c}.${Topology.echo}`
      expect(looping.process.peers[Topology.b]).not.toHaveProperty(reflected)
      /** Unknown reflected paths are refused by the origin, without reaching b's forward stage. */
      const observed = (await inspectB(looping)).forward.length
      const unknown = await rejection(looping.process.send(Topology.b, reflected, 0, traced))
      expect(causeChain(unknown)).toContainEqual(
        expect.objectContaining({ code: 'PROVIDER_NOT_FOUND' })
      )
      expect((await inspectB(looping)).forward).toHaveLength(observed)
    } finally {
      await looping.close()
    }
  })
})

describe('auth installed on one hop only', () => {
  it('signs and verifies only the b–c hop; other hops stay unaffected', async () => {
    /** B and c share the hop secret. */
    const host = await openOrigin({ hopAuth: 'match' })
    try {
      expect(await viaB(host, Topology.c, Topology.echo, 3)).toMatchObject({ value: 3 })
      expect(await viaB(host, Topology.coroutine, Topology.echo, 4)).toMatchObject({ value: 4 })
      /** Transform counts on both sides of the b–c hop. */
      const b = await inspectB(host)
      expect(b.auth.signed).toBeGreaterThan(0)
      expect(b.auth.verified).toBeGreaterThan(0)
      expect(b.c.auth.signed).toBeGreaterThan(0)
      expect(b.c.auth.verified).toBeGreaterThan(0)
      /** The coroutine hop has no auth installed. */
      expect(b.co.auth).toEqual({ signed: 0, verified: 0 })
    } finally {
      await host.close()
    }
  })

  it('a wrong secret on c refuses only the b–c hop', async () => {
    /** B first commits parent, pool and coroutine; c remains a cold definition until public use. */
    const host = await openOrigin({ hopAuth: 'mismatch' })
    try {
      /** Actual remote identity proves this same native process survives the rejected install. */
      const before = await inspectB(host)
      expect(before.pid).not.toBe(process.pid)
      /** Only c's later native installation presents the deliberately mismatched credentials. */
      const error = await rejection(host.process.send(Topology.b, Topology.installThread))
      expect(causeChain(error)).toContainEqual(
        expect.objectContaining({ code: 'AUTHENTICATION_FAILED' })
      )
      await rejection(viaB(host, Topology.c, Topology.echo, 5))
      expect(await viaB(host, Topology.coroutine, Topology.echo, 6)).toMatchObject({ value: 6 })
      expect(await viaB(host, RPC_POOL_PEER_ID, Topology.echo, 7)).toMatchObject({ value: 7 })
      /** A reachable public provider in the original process remains available after both calls. */
      const after = await inspectB(host)
      expect(after.pid).toBe(before.pid)
      expect(after.selfId).toBe(before.selfId)
      expect(causeChain(error)).toContainEqual(
        expect.objectContaining({ message: HopAuthText.credentialRefused })
      )
    } finally {
      await host.close()
    }
  })
})

it('host-level auth applies to a late thread while the authenticated coroutine remains callable', async () => {
  /** Both real transports must borrow this single host-level auth installation. */
  const counter = new HopAuthCounter()
  /** The task reuses the original topology business providers and its own real auth counter. */
  const leaf = new TopologyLeaf()
  /** The original coroutine task port owns this independent public leaf Host until cancellation. */
  const task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {
    const child = await createRpcHost({
      plugins: [
        rpcFeaturesPlugin({ features: { auth: authFeature(leaf.auth.options(HopSecret.shared)) } }),
        coroutinePlugin({ connectToParent: connect })
      ],
      provide: leaf.providers()
    })
    leaf.bind(child.self.instanceId)
    heartbeat()
    try {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
    } finally {
      await child.close()
    }
  }
  /** Initial construction includes a real authenticated baseline and no thread namespace. */
  const host = await createRpcHost({
    self: { name: Topology.b, instanceId: 'topology-late-auth-b' },
    plugins: [
      rpcFeaturesPlugin({ features: { auth: authFeature(counter.options(HopSecret.shared)) } }),
      coroutinePlugin({ namespace: 'baseline', name: Topology.coroutine, spawn: task })
    ],
    report: () => undefined
  })
  try {
    await host.baseline.send(Topology.coroutine, Topology.ready)
    await expect(
      host.baseline.send(Topology.coroutine, Topology.echo, 'before-late')
    ).resolves.toMatchObject({ value: 'before-late' })
    /**
     * Existing c authenticates its parent with the same real hop secret; no local b-side override
     * exists.
     */
    const extended = await host.use(
      threadPlugin({
        name: Topology.c,
        spawn: {
          entry: new URL('./fixtures/topology-leaf-thread.ts', import.meta.url),
          data: { hopAuth: 'match' }
        }
      })
    )
    expect(extended).toBe(host)
    await extended.thread.send(Topology.c, Topology.ready)
    /** Awaited readiness leaves only this real thread business call between the two counter reads. */
    const before = counter.snapshot()
    await expect(
      extended.thread.send(Topology.c, Topology.echo, 'late-thread')
    ).resolves.toMatchObject({ value: 'late-thread' })
    const after = counter.snapshot()
    expect(after.signed).toBeGreaterThan(before.signed)
    expect(after.verified).toBeGreaterThan(before.verified)
    await expect(
      extended.baseline.send(Topology.coroutine, Topology.echo, 'after-late')
    ).resolves.toMatchObject({ value: 'after-late' })
  } finally {
    await host.close()
  }
})

describe('middle hop failure while a call is in flight', () => {
  it('a graceful close of b settles the call with the close-frame reason', async () => {
    /** Origin with a fresh b that this case closes. */
    const host = await openOrigin()
    /** Peer-closed event a receives for b. */
    const closed = new Promise<unknown>((resolve) =>
      (host.process as unknown as IPeerClosing).onPeerClosed(resolve)
    )
    try {
      /** Wait that stays in flight on c until b closes. */
      const pending = viaB(host, Topology.c, Topology.wait)
      await expect.poll(async () => (await inspectB(host)).c.waitCalls, { timeout: 5000 }).toBe(1)
      await host.process.send(Topology.b, Topology.shutdown)
      /** Settlement of the in-flight call. */
      const error = await rejection(pending)
      expect(error).toMatchObject({ code: expect.any(String) })
      expect(await closed).toMatchObject({ closeFrame: true })
    } finally {
      await host.close()
    }
  })

  it('a killed b settles the call and reports that no close frame arrived', async () => {
    /** Origin with a fresh b that this case kills. */
    const host = await openOrigin()
    /** Peer-closed event a receives for b. */
    const closed = new Promise<unknown>((resolve) =>
      (host.process as unknown as IPeerClosing).onPeerClosed(resolve)
    )
    try {
      /** Wait that stays in flight on c until b dies. */
      const pending = viaB(host, Topology.c, Topology.wait)
      /** B's pid, read through its own provider. */
      const { pid } = await inspectB(host)
      process.kill(pid, 'SIGKILL')
      /** Settlement of the in-flight call. */
      const error = await rejection(pending)
      expect(error).toMatchObject({ code: expect.any(String) })
      expect(await closed).toMatchObject({
        closeFrame: false,
        reason: { code: 'PROCESS_CHANNEL_CLOSED', detail: { signal: 'SIGKILL' } }
      })
    } finally {
      await host.close()
    }
  })
})

describe('forwarding through process b to its child process d', () => {
  it('executes once on d, restores its failure, and reaches a new generation after restart', async () => {
    /** Origin whose b also spawns child process d. */
    const host = await openOrigin({ childProcess: true })
    try {
      expect(await viaB(host, Topology.d, Topology.echo, 2)).toMatchObject({ value: 2, seq: 1 })
      expectLeafFailure(await rejection(viaB(host, Topology.d, Topology.fail)))
      /** D's identity before the supervised restart. */
      const first = (await inspectB(host)).d!
      expect([first.echoCalls, first.failCalls]).toEqual([1, 1])
      await viaB(host, Topology.d, Topology.crash)
      /** Missing D during restart cannot count as observing a replacement process. */
      await expect
        .poll(async () => (await inspectB(host).catch(() => undefined))?.d?.pid ?? first.pid, {
          timeout: 10000
        })
        .not.toBe(first.pid)
      expect(await viaB(host, Topology.d, Topology.echo, 9)).toMatchObject({ value: 9, seq: 1 })
      expect((await inspectB(host)).d!.instanceId).not.toBe(first.instanceId)
    } finally {
      await host.close()
    }
  })
})

describe('forwarding through Node process b to a Python child process', () => {
  it('executes once on the Python leaf and restores its native error graph', async () => {
    /** Origin whose b also spawns the Python leaf. */
    const host = await openOrigin({ python: true })
    try {
      expect(await viaB(host, Topology.python, Topology.echo, 'ping')).toBe('ping')
      await host.process.notify(`${Topology.python}.p.f.oneWay`, ['once'], {
        ...traced,
        targetId: Topology.b
      })
      await expect
        .poll(() => viaB(host, Topology.python, 'peer.received', []), { timeout: 5000 })
        .toEqual({ count: 1, values: ['once'] })
      /** Native error graph from the Python leaf, restored on a. */
      const error = await rejection(viaB(host, Topology.python, 'peer.error', []))
      expect(error).toMatchObject({
        source: 'rpc.endpoint',
        code: 'INTERNAL',
        cause: { source: 'rpc.endpoint', code: 'INTERNAL', message: 'peer cause' }
      })
      expect(error).toMatchObject({ route: expect.any(Array) })
    } finally {
      await host.close()
    }
  })
})
