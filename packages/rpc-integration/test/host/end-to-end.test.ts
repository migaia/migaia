import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createRpcHost, type IRpcHost, type IRpcNamespace } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'
import { pool } from '@migaia/rpc-plugin-pool'
import { devtoolsPlugin, type IDevtoolsPlugin } from '@migaia/rpc-plugin-devtools'
import { childService, type IChildApi, type IParentApi } from './fixtures/service.ts'

/** All examples expose the same actual reverse scalar and generator capabilities on their host. */
const parentService: IParentApi = {
  parentRequest: (value) => value + 100,
  parentValues: async function* (value) {
    yield value + 10
    yield value + 11
  }
}

/** Native launchers consume a real source URL, independently from Vitest's module transform. */
const processEntry = new URL('./fixtures/process-child.ts', import.meta.url)
/** The Node Worker receives its own real module and opens its own explicit parent source. */
const threadEntry = new URL('./fixtures/thread-child.ts', import.meta.url)

/** Stream collection consumes the exact public iterator and its normal terminal result. */
async function values(stream: AsyncIterable<number>): Promise<number[]> {
  const result: number[] = []
  for await (const value of stream) result.push(value)
  return result
}

/** The same public feature instance observes every host in one example through original probes. */
function observer(): IDevtoolsPlugin {
  return devtoolsPlugin({ stages: ['message', 'envelope', 'carrier', 'peer'], maxEvents: 4096 })
}

/** Scalar and generator callbacks originate new work in the opposite direction on the real carrier. */
async function business(host: IRpcNamespace<IChildApi>): Promise<void> {
  expect(await host.request('childRequest', 21)).toBe(42)
  expect(await host.request('reverseRequest', 21)).toBe(121)
  expect(await values(host.stream('childValues', 2) as AsyncIterableIterator<number>)).toEqual([
    2, 3
  ])
  expect(await values(host.stream('reverseValues', 2) as AsyncIterableIterator<number>)).toEqual([
    12, 13
  ])
}

/** Existing record identities link each real interaction to its settlement and reversed wire route. */
function correlated(value: IDevtoolsPlugin, host: IRpcHost<IChildApi>): void {
  /** Rows come from the installed feature's actual collector, filtered by the native host identity. */
  const events = value.collector.query({ endpointIds: [host.self.instanceId], limit: 1000 }).events
  for (const [method, direction, kind] of [
    ['childRequest', 'outbound', 'request'],
    ['parentRequest', 'inbound', 'request'],
    ['childValues', 'outbound', 'streamOpen'],
    ['parentValues', 'inbound', 'streamOpen']
  ] as const) {
    /** The beginning preserves the caller's original identity and direction at the canonical owner. */
    const start = events.find(
      (event) =>
        event.stage === 'message' &&
        event.method === method &&
        event.direction === direction &&
        event.kind === kind &&
        event.outcome ===
          (kind === 'request'
            ? direction === 'outbound'
              ? 'created'
              : 'admitted'
            : direction === 'outbound'
              ? 'sent'
              : 'received')
    )
    expect(start, `${host.self.name}:${method}`).toBeDefined()
    expect(start!.messageId).toEqual(expect.any(String))
    expect(start!.senderId).toEqual(expect.any(String))
    expect(start!.targetId).toEqual(expect.any(String))
    expect(direction === 'outbound' ? start!.senderId : start!.targetId).toBe(host.self.instanceId)
    /** The public contract correlates with messageId plus senderId, without an invented task field. */
    const identity = JSON.stringify([start!.messageId, start!.senderId])
    /** Scalars settle logically; streams terminate through their original reversed close frame. */
    const terminal = events.find(
      (event) =>
        event.stage === 'message' &&
        (kind === 'request'
          ? event.outcome === 'settled' &&
            event.direction === direction &&
            JSON.stringify([event.messageId, event.senderId]) === identity &&
            event.targetId === start!.targetId
          : event.kind === 'streamClose' &&
            event.outcome === (direction === 'outbound' ? 'received' : 'sent') &&
            event.direction === (direction === 'outbound' ? 'inbound' : 'outbound') &&
            JSON.stringify([event.messageId, event.targetId]) === identity &&
            event.senderId === start!.targetId)
    )
    expect(terminal, `${host.self.name}:${method}:settlement`).toBeDefined()
    /** A response retains the original message id and reverses the actual sender/destination. */
    expect(
      events.some(
        (event) =>
          event.stage === 'message' &&
          event.outcome === (direction === 'outbound' ? 'received' : 'sent') &&
          event.messageId === start!.messageId &&
          event.direction === (direction === 'outbound' ? 'inbound' : 'outbound') &&
          event.senderId === start!.targetId &&
          event.targetId === start!.senderId &&
          event.kind === (kind === 'request' ? 'response' : 'streamChunk')
      ),
      `${host.self.name}:${method}:response-route`
    ).toBe(true)
  }
  for (const direction of ['outbound', 'inbound'])
    expect(
      events.some(
        (event) =>
          event.stage === 'carrier' && event.direction === direction && Boolean(event.carrier)
      ),
      `${host.self.name}:${direction}:physical-carrier`
    ).toBe(true)
}

/** A host releases only its own subscription; the same collector wakes from the surviving host. */
async function survives(
  value: IDevtoolsPlugin,
  first: IRpcHost<IChildApi>,
  second: IRpcHost<IChildApi>,
  namespace: string
): Promise<void> {
  await first.close()
  /** A sequence cursor distinguishes new surviving-host observations from earlier history. */
  const afterSeq = value.collector.query().nextSeq
  /** First next subscribes before the real business operation; no polling clock is introduced. */
  const watch = value.collector.watch({
    endpointIds: [second.self.instanceId],
    stages: ['message']
  })
  try {
    /** The pending iterator is fulfilled only by the existing collector subscription. */
    const next = watch.next()
    expect(await second[namespace]!.request('childRequest', 25)).toBe(50)
    /** The emitted batch belongs to the surviving host endpoint rather than a synthetic probe. */
    const batch = await next
    expect(batch.done).toBe(false)
    if (batch.done) expect.fail('surviving collector watch ended')
    expect(batch.value.events.some((event) => event.endpointId === second.self.instanceId)).toBe(
      true
    )
    expect(
      value.collector
        .query({ afterSeq, endpointIds: [second.self.instanceId], stages: ['message'] })
        .events.some((event) => event.method === 'childRequest' && Boolean(event.messageId))
    ).toBe(true)
  } finally {
    await watch.return(undefined)
  }
}

it('observes bidirectional parent and child process requests and streams through public plugins', async () => {
  /** One feature object retains the same caller-owned collector across the independent hosts. */
  const value = observer()
  /** Only successfully opened public hosts enter the original cleanup set. */
  const hosts: IRpcHost<IChildApi>[] = []
  try {
    for (const name of ['process-a', 'process-b'])
      hosts.push(
        await createRpcHost<IChildApi>({
          self: { name, instanceId: name },
          plugins: [processPlugin({ spawn: processEntry }), value],
          provide: parentService
        })
      )
    for (const host of hosts) {
      await business(host.process!)
      correlated(value, host)
    }
    await survives(value, hosts[0]!, hosts[1]!, 'process')
  } finally {
    await Promise.all(hosts.map((host) => host.close()))
    value.close()
  }
}, 30000)

it('observes an unrelated socket service and two independent public client hosts', async () => {
  /** One feature object retains the same caller-owned collector across the independent hosts. */
  const value = observer()
  /** This example alone owns the temporary address directory and removes it after native exit. */
  const directory = await mkdtemp(join(tmpdir(), 'rpc-public-examples-'))
  /** An explicit private socket path supports independent processes without rendezvous globals. */
  const address =
    process.platform === 'win32'
      ? String.raw`\\.\pipe\rpc-${randomUUID()}`
      : join(directory, 'service.sock')
  /** An ephemeral local-only credential authenticates the two genuine independent clients. */
  const token = randomUUID()
  /** The unrelated Node process opens listen through its own public process plugin. */
  const server = spawn(
    process.execPath,
    [fileURLToPath(new URL('./fixtures/socket-server.ts', import.meta.url)), address, token],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  /** Exit observation is attached before termination so cleanup waits for actual native exit. */
  const exited = once(server, 'exit')
  /** Only successfully opened public hosts enter the original cleanup set. */
  const hosts: IRpcHost<IChildApi>[] = []
  /** Startup failure retains the real child diagnostic text without exposing the credential. */
  let stderr = ''
  server.stderr.setEncoding('utf8').on('data', (part: string) => {
    stderr += part
  })
  try {
    await new Promise<void>((resolve, reject) => {
      /** Setup readiness is a native stdout line, independent of all subsequent RPC traffic. */
      let output = ''
      server.stdout.setEncoding('utf8').on('data', (part: string) => {
        output += part
        if (output.includes('ready\n')) resolve()
      })
      server.once('error', reject)
      void exited.then(
        ([code]) => reject(new Error(`socket service exited ${code}: ${stderr}`)),
        reject
      )
    })
    for (const name of ['socket-a', 'socket-b'])
      hosts.push(
        await createRpcHost<IChildApi>({
          self: { name, instanceId: name },
          plugins: [processPlugin({ connect: { target: address }, token }), value],
          provide: parentService
        })
      )
    for (const host of hosts) {
      await business(host.process!)
      correlated(value, host)
    }
    await survives(value, hosts[0]!, hosts[1]!, 'process')
  } finally {
    await Promise.all(hosts.map((host) => host.close()))
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM')
    await exited
    await rm(directory, { recursive: true, force: true })
    value.close()
  }
}, 30000)

it('observes genuine Node Worker requests and streams through the public thread plugin', async () => {
  /** One feature object retains the same caller-owned collector across the independent hosts. */
  const value = observer()
  /** Only successfully opened public hosts enter the original cleanup set. */
  const hosts: IRpcHost<IChildApi>[] = []
  try {
    for (const name of ['thread-a', 'thread-b'])
      hosts.push(
        await createRpcHost<IChildApi>({
          self: { name, instanceId: name },
          plugins: [threadPlugin({ spawn: threadEntry }), value],
          provide: parentService
        })
      )
    for (const host of hosts) {
      await business(host.thread!)
      correlated(value, host)
    }
    await survives(value, hosts[0]!, hosts[1]!, 'thread')
  } finally {
    await Promise.all(hosts.map((host) => host.close()))
    value.close()
  }
}, 30000)

it('observes public dedicated Worker plugins over two actual borrowed MessageChannels', async () => {
  /** One feature object retains the same caller-owned collector across the independent hosts. */
  const value = observer()
  /** Real native ports provide structured clone delivery and remain caller-owned after host close. */
  const pairs = [new MessageChannel(), new MessageChannel()]
  /** Only successfully opened public hosts enter the original cleanup set. */
  const hosts: IRpcHost<IChildApi>[] = []
  /** Opposite public hosts consume the native ports without any private source constructor. */
  const children: IRpcHost<IParentApi>[] = []
  try {
    for (const [index, pair] of pairs.entries()) {
      pair.port1.start()
      pair.port2.start()
      const name = `browser-${index}`
      /** The child retains its own genuine provider and remote callable directory. */
      const child: Promise<IRpcHost<IParentApi>> = createRpcHost<IParentApi>({
        plugins: [dedicatedWorkerPlugin({ worker: pair.port2 })],
        provide: childService(() => child, 'worker')
      })
      /** Both endpoints prepare concurrently through the same public browser carrier plugin. */
      const parent = createRpcHost<IChildApi>({
        self: { name, instanceId: name },
        plugins: [dedicatedWorkerPlugin({ worker: pair.port1 }), value],
        provide: parentService
      })
      const [openedParent, openedChild] = await Promise.all([parent, child])
      hosts.push(openedParent)
      children.push(openedChild)
    }
    for (const host of hosts) {
      await business(host.worker!)
      correlated(value, host)
    }
    await survives(value, hosts[0]!, hosts[1]!, 'worker')
  } finally {
    await Promise.all([...hosts, ...children].map((host) => host.close()))
    for (const pair of pairs) {
      pair.port1.close()
      pair.port2.close()
    }
    value.close()
  }
}, 30000)

it('observes explicit coroutine task handles and keeps the other host collector active', async () => {
  /** One feature object retains the same caller-owned collector across the independent hosts. */
  const value = observer()
  /** Only successfully opened public hosts enter the original cleanup set. */
  const hosts: IRpcHost<IChildApi>[] = []
  /** The original cooperative supervisor supplies the opaque connect handle and cancellation. */
  const task: ICoroutineUserTask = async ({ connect, signal }) => {
    /** The exact supervisor-provided handle opens a child public host within this actual task. */
    const opening: Promise<IRpcHost<IParentApi>> = createRpcHost<IParentApi>({
      plugins: [coroutinePlugin({ connectToParent: connect })],
      provide: childService(() => opening, 'coroutine')
    })
    /** The task keeps its child host alive until the original cooperative abort is delivered. */
    const child = await opening
    try {
      if (!signal.aborted)
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        )
    } finally {
      await child.close()
    }
  }
  try {
    for (const name of ['coroutine-a', 'coroutine-b'])
      hosts.push(
        await createRpcHost<IChildApi>({
          self: { name, instanceId: name },
          plugins: [coroutinePlugin({ spawn: task }), value],
          provide: parentService
        })
      )
    for (const host of hosts) {
      await business(host.coroutine!)
      correlated(value, host)
    }
    await survives(value, hosts[0]!, hosts[1]!, 'coroutine')
  } finally {
    await Promise.all(hosts.map((host) => host.close()))
    value.close()
  }
}, 30000)

it('observes scalar process pool work while each public host retains one logical pool target', async () => {
  /** One feature object retains the same caller-owned collector across the independent hosts. */
  const value = observer()
  /** Only successfully opened public hosts enter the original cleanup set. */
  const hosts: IRpcHost<IChildApi>[] = []
  try {
    for (const name of ['pool-a', 'pool-b'])
      hosts.push(
        await createRpcHost<IChildApi>({
          self: { name, instanceId: name },
          plugins: [
            processPlugin({ spawn: processEntry, features: { workers: pool({ size: 2 }) } }),
            value
          ],
          provide: parentService
        })
      )
    for (const host of hosts) {
      expect(Object.keys(host.process!.peers)).toEqual(['pool'])
      await business(host.process!)
      correlated(value, host)
      expect(await host.process!.send('pool', 'childRequest', 21)).toBe(42)
    }
    await survives(value, hosts[0]!, hosts[1]!, 'process')
  } finally {
    await Promise.all(hosts.map((host) => host.close()))
    value.close()
  }
}, 30000)
