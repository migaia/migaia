import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { createEndpoint, RpcConfigurationError, RpcTimeoutError } from '../../src/core/index.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createFullEndpoint } from '../../src/core/full.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createClientFirstPartyRoots } from '../../src/core/internal/client-first-party-roots.js'
import { abort } from '../../src/core/middleware/abort.js'
import { connect } from '../../src/core/middleware/connect.js'
import { hooks } from '../../src/core/middleware/hooks.js'
import { ping } from '../../src/core/middleware/ping.js'
import { timeout } from '../../src/core/middleware/timeout.js'
import type { IRpcHookEvent, IRpcPlugin, IRpcServerMetadata } from '../../src/core/typing.js'
import type { IRpcTransport } from '../../src/core/transport.js'

/** Hook events delivered through the Host `core.hooks` path when no hooks middleware exists. */
const hostHookEvents = vi.hoisted(() => [] as unknown[])

vi.mock('../../src/core/internal/web-rpc-plugin-host.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/core/internal/web-rpc-plugin-host.js')
  >('../../src/core/internal/web-rpc-plugin-host.js')
  return {
    ...actual,
    createWebRpcPluginHost: (...args: Parameters<typeof actual.createWebRpcPluginHost>) => {
      /** Original Host hook sink, wrapped so the test observes every event it receives. */
      const sink = args[3]
      args[3] = (event) => {
        hostHookEvents.push(event)
        sink(event)
      }
      return actual.createWebRpcPluginHost(...args)
    }
  }
})

/** Discovery attachments constructed by endpoints, exposing the stale-aware server list. */
const discoveryAttachments = vi.hoisted(() => [] as unknown[])

vi.mock('../../src/core/internal/discovery-attachment.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/core/internal/discovery-attachment.js')
  >('../../src/core/internal/discovery-attachment.js')
  /** Records every attachment so the test can read its stale-aware receiver view. */
  class RecordedDiscoveryAttachment<
    TTargetId extends string
  > extends actual.RpcDiscoveryAttachment<TTargetId> {
    constructor(...args: ConstructorParameters<typeof actual.RpcDiscoveryAttachment<TTargetId>>) {
      super(...args)
      discoveryAttachments.push(this)
    }
  }
  return { ...actual, RpcDiscoveryAttachment: RecordedDiscoveryAttachment }
})

/** Base epoch value of the injected wall clocks; far away from any manual scheduler value. */
const WALL_BASE = 1_700_000_000_000

/** Claims for test-only plugins that publish nothing. */
const emptyClaims = Object.freeze({
  routes: Object.freeze([]),
  provides: Object.freeze([]),
  consumes: Object.freeze([]),
  publicKeys: Object.freeze([]),
  exposedKeys: Object.freeze([]),
  activator: false
})

/** Sequence used to keep endpoint identifiers unique across tests. */
let idSequence = 0

/** A wall clock whose readings are recorded and whose next value can be replaced. */
function recordingWallClock(next?: () => number) {
  /** Every value returned by `timestamp()`. */
  const readings: number[] = []
  /** Mutable source of the next reading; defaults to an increasing epoch sequence. */
  let source = next ?? (() => WALL_BASE + readings.length)
  return {
    readings,
    setSource(value: () => number) {
      source = value
    },
    wallClock: {
      timestamp: () => {
        const value = source()
        readings.push(value)
        return value
      }
    }
  }
}

/** Lets queued delivery and provider continuations settle without advancing scheduler time. */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

/** A transport that never delivers, leaving endpoint admission observable. */
function silentTransport(): IRpcTransport {
  return {
    platform: 'Memory',
    ownership: 'borrowed',
    topology: 'exclusive',
    send() {},
    subscribe() {
      return () => undefined
    }
  }
}

/** Creates a middleware whose install stays pending until the test rejects it late. */
function pendingInstall(started: () => void, pending: Promise<never>): IRpcPlugin {
  return {
    name: `clock-pending-${idSequence++}`,
    metadata: { claims: emptyClaims },
    install: () => {
      started()
      return pending
    }
  }
}

/** Starts a construction that is cancelled, then reports one late install failure. */
async function lateConstructionFailure(options: {
  readonly scheduler: IScheduler
  readonly wallClock: { timestamp(): number }
  readonly listeners?: IRpcHookEvent[]
}): Promise<Error> {
  const controller = new AbortController()
  /** Resolves once the pending middleware started installing. */
  let resolveStarted!: () => void
  /** Rejects the pending install after construction settled. */
  let rejectLate!: (error: unknown) => void
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve
  })
  const pending = new Promise<never>((_resolve, reject) => {
    rejectLate = reject
  })
  const lateError = new Error('late construction failure')
  const [transport] = createMemoryTransportPair()
  const listeners = options.listeners
  const construction = createComposedEndpoint(
    {
      id: `clock-construction-${idSequence++}`,
      transport,
      scheduler: options.scheduler,
      wallClock: options.wallClock,
      middlewares: [
        ...(listeners === undefined
          ? []
          : [hooks({ listeners: [(event: IRpcHookEvent) => void listeners.push(event)] })]),
        connect(),
        pendingInstall(resolveStarted, pending)
      ],
      construction: { signal: controller.signal }
    },
    createClientFirstPartyRoots()
  )
  await started
  controller.abort('construction cancelled')
  await expect(construction).rejects.toMatchObject({ code: 'CANCELLED' })
  rejectLate(lateError)
  return lateError
}

/** Polls a synchronous assertion within a bounded number of macrotask turns. */
async function eventually(assertion: () => void): Promise<void> {
  /** Last assertion failure, rethrown when polling gives up. */
  let lastError: unknown
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
  }
  throw lastError
}

describe('A7 endpoint clocks: wall clock stamps diagnostics, scheduler owns deadlines', () => {
  it('stamps response and abort variation sentAt and hook event at from the wall clock', async () => {
    const scheduler = createManualScheduler()
    scheduler.advance(5)
    const clock = recordingWallClock()
    const [clientBase, serverBase] = createMemoryTransportPair()
    /** Response frames sent by the server. */
    const responses: unknown[] = []
    /** Variation frames sent by the client. */
    const variations: unknown[] = []
    /** Hook events emitted by the client. */
    const events: IRpcHookEvent[] = []
    const serverTransport: IRpcTransport = {
      ...serverBase,
      send(message, options) {
        if ((message as { kind?: unknown }).kind === 'response') responses.push(message)
        return serverBase.send(message, options)
      }
    }
    const clientTransport: IRpcTransport = {
      ...clientBase,
      send(message, options) {
        if ((message as { kind?: unknown }).kind === 'variation') variations.push(message)
        return clientBase.send(message, options)
      }
    }
    const server = await createEndpoint({
      id: 'clock-server',
      transport: serverTransport,
      scheduler,
      wallClock: clock.wallClock,
      provider: {
        fail: (context) => context.failed('expected failure', 'EXPECTED_FAILURE'),
        hang: () => new Promise<never>(() => undefined)
      },
      middlewares: [connect({ transport: serverTransport }), abort()]
    })
    const client = await createEndpoint({
      id: 'clock-client',
      transport: clientTransport,
      scheduler,
      wallClock: clock.wallClock,
      middlewares: [
        hooks({ listeners: [(event) => void events.push(event)] }),
        connect({ transport: clientTransport }),
        abort(),
        timeout()
      ]
    })
    try {
      await expect(client.send('clock-server', 'fail', null)).rejects.toBeDefined()
      /** Wire sentAt of the failure response. */
      const responseSentAt = (responses[0] as { data?: { route?: { sentAt?: number } } }).data
        ?.route?.sentAt
      expect(clock.readings).toContain(responseSentAt)
      expect(responseSentAt).not.toBe(scheduler.now())

      const hanging = client.send('clock-server', 'hang', null, { timeoutMs: 50 })
      const outcome = hanging.catch((error: unknown) => error)
      await flushMicrotasks()
      scheduler.advance(50)
      expect(await outcome).toBeInstanceOf(RpcTimeoutError)
      await flushMicrotasks()
      /** Abort variation frame produced by the client timeout. */
      const abortFrame = variations.find(
        (message) =>
          (message as { data?: { route?: { variation?: string } } }).data?.route?.variation ===
          'abort'
      ) as { data: { route: { sentAt: number } } } | undefined
      expect(abortFrame).toBeDefined()
      expect(clock.readings).toContain(abortFrame!.data.route.sentAt)
      expect(events.length).toBeGreaterThan(0)
      for (const event of events) {
        expect(clock.readings).toContain(event.at)
        expect(event.at).toBeGreaterThanOrEqual(WALL_BASE)
      }
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('stamps late construction failures from the wall clock on both reporting paths', async () => {
    const reporterClock = recordingWallClock()
    /** Events delivered through the hooks middleware construction reporter. */
    const reported: IRpcHookEvent[] = []
    const reporterError = await lateConstructionFailure({
      scheduler: createManualScheduler(),
      wallClock: reporterClock.wallClock,
      listeners: reported
    })
    await eventually(() => expect(reported).toHaveLength(1))
    expect(reported[0]).toMatchObject({ name: 'failure', error: reporterError })
    expect(reporterClock.readings).toContain(reported[0]!.at)
    expect(reported[0]!.at).toBeGreaterThanOrEqual(WALL_BASE)

    const hooksClock = recordingWallClock()
    hostHookEvents.length = 0
    const hooksError = await lateConstructionFailure({
      scheduler: createManualScheduler(),
      wallClock: hooksClock.wallClock
    })
    await eventually(() =>
      expect(
        hostHookEvents.filter((event) => (event as IRpcHookEvent).error === hooksError)
      ).toHaveLength(1)
    )
    /** Failure event delivered through the Host `core.hooks` path. */
    const hostEvent = hostHookEvents.find(
      (event) => (event as IRpcHookEvent).error === hooksError
    ) as IRpcHookEvent
    expect(hostEvent).toMatchObject({ name: 'failure' })
    expect(hooksClock.readings).toContain(hostEvent.at)
    expect(hostEvent.at).toBeGreaterThanOrEqual(WALL_BASE)
  })

  it('keeps timeouts and replay windows on the scheduler when the wall clock runs backwards', async () => {
    const scheduler = createManualScheduler()
    /** Decreasing wall clock: every reading is one millisecond earlier. */
    let wall = WALL_BASE
    const wallClock = { timestamp: () => wall-- }
    const [clientBase, serverBase] = createMemoryTransportPair()
    /** Request frames the client sent, for replay. */
    const requests: unknown[] = []
    const clientTransport: IRpcTransport = {
      ...clientBase,
      send(message, options) {
        if ((message as { kind?: unknown }).kind === 'request') requests.push(message)
        return clientBase.send(message, options)
      }
    }
    /** Provider invocations of the replayed method. */
    let calls = 0
    const server = await createEndpoint({
      id: 'clock-replay-server',
      transport: serverBase,
      scheduler,
      wallClock,
      provider: {
        count: (context) => {
          calls += 1
          return context.success(calls)
        },
        hang: () => new Promise<never>(() => undefined)
      },
      middlewares: [connect({ transport: serverBase })]
    })
    const client = await createEndpoint({
      id: 'clock-replay-client',
      transport: clientTransport,
      scheduler,
      wallClock,
      middlewares: [connect({ transport: clientTransport }), timeout()]
    })
    try {
      const pending = client.send('clock-replay-server', 'hang', null, { timeoutMs: 50 })
      const outcome = pending.catch((error: unknown) => error)
      await flushMicrotasks()
      scheduler.advance(49)
      await flushMicrotasks()
      /** Whether the timed request settled before its deadline. */
      let settled = false
      void outcome.then(() => {
        settled = true
      })
      await flushMicrotasks()
      expect(settled).toBe(false)
      scheduler.advance(1)
      expect(await outcome).toBeInstanceOf(RpcTimeoutError)

      await expect(client.send('clock-replay-server', 'count', null)).resolves.toBe(1)
      /** The accepted request frame, resent to probe the replay window. */
      const replayed = requests.at(-1)
      await clientBase.send(replayed)
      await flushMicrotasks()
      expect(calls).toBe(1)
      scheduler.advance(310_001)
      await clientBase.send(replayed)
      await flushMicrotasks()
      expect(calls).toBe(2)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('admits fractional monotonic schedulers and rejects malformed schedulers and wall clocks', async () => {
    const manual = createManualScheduler()
    const fractional = await createEndpoint({
      id: 'clock-fractional',
      transport: silentTransport(),
      scheduler: { now: () => 1.5, schedule: manual.schedule },
      middlewares: [connect()]
    })
    await fractional.dispose()

    const thrown = new Error('wall clock failed')
    const invalid: readonly [string, Record<string, unknown>][] = [
      ['NaN scheduler', { scheduler: { now: () => Number.NaN, schedule: manual.schedule } }],
      ['scheduler without schedule', { scheduler: { now: () => 1 } }],
      ['fractional wall clock', { wallClock: { timestamp: () => 1.5 } }],
      ['negative wall clock', { wallClock: { timestamp: () => -1 } }],
      [
        'throwing wall clock',
        {
          wallClock: {
            timestamp: () => {
              throw thrown
            }
          }
        }
      ]
    ]
    for (const [label, fields] of invalid) {
      const failure = await createEndpoint({
        id: `clock-invalid-${idSequence++}`,
        transport: silentTransport(),
        middlewares: [connect()],
        ...(fields as object)
      }).catch((error: unknown) => error)
      expect(failure, label).toBeInstanceOf(RpcConfigurationError)
      expect(failure, label).toMatchObject({ code: 'INVALID_CONFIG' })
      if (label === 'throwing wall clock') expect((failure as Error).cause).toBe(thrown)
    }
  })
})

/** Root of the rpc core sources inspected by the A8 static rules. */
const coreRoot = join(import.meta.dirname, '../../src/core')

/** Recursively lists executable core sources. */
function coreSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return coreSources(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

/** Parses one core source file. */
function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
}

/** Walks every node of a source file. */
function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

/** Whether an expression is a call whose callee is named `timestamp`. */
function isTimestampCall(node: ts.Expression): boolean {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  return (
    (ts.isIdentifier(callee) && callee.text === 'timestamp') ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 'timestamp')
  )
}

/** Initializers of every property assignment with the given name in one file. */
function propertyInitializers(path: string, name: string): ts.Expression[] {
  const found: ts.Expression[] = []
  walk(parse(path), (node) => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === name)
      found.push(node.initializer)
  })
  return found
}

/** Arithmetic and comparison operators a wall-clock reading must never feed directly. */
const arithmeticOrComparison = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken
])

describe('A8 rpc core timestamp sources', () => {
  it('produces every hook event at and wire sentAt from a timestamp() call', () => {
    const atCounts: readonly [string, number][] = [
      ['internal/outbound-attachment.ts', 3],
      ['middleware.ts', 2],
      ['internal/endpoint-capabilities-plugin.ts', 1],
      ['internal/plugin-inventory.ts', 2],
      ['internal/endpoint-bootstrap.ts', 2]
    ]
    for (const [file, count] of atCounts) {
      const initializers = propertyInitializers(join(coreRoot, file), 'at')
      expect(initializers, file).toHaveLength(count)
      for (const initializer of initializers) expect(isTimestampCall(initializer), file).toBe(true)
    }
    const sentAtCounts: readonly [string, number][] = [
      ['internal/discovery-attachment.ts', 5],
      ['internal/outbound-attachment.ts', 3],
      ['internal/control-attachment.ts', 1],
      ['internal/provider-executor.ts', 3]
    ]
    for (const [file, count] of sentAtCounts) {
      const initializers = propertyInitializers(join(coreRoot, file), 'sentAt')
      expect(initializers, file).toHaveLength(count)
      for (const initializer of initializers) expect(isTimestampCall(initializer), file).toBe(true)
    }
  })

  it('never feeds a timestamp() reading into arithmetic or comparison', () => {
    /** Offending locations as `file:line`. */
    const offenders: string[] = []
    for (const path of coreSources(coreRoot)) {
      const source = parse(path)
      walk(source, (node) => {
        if (!ts.isBinaryExpression(node) || !arithmeticOrComparison.has(node.operatorToken.kind))
          return
        for (const operand of [node.left, node.right])
          if (isTimestampCall(operand))
            offenders.push(
              `${relative(coreRoot, path)}:${source.getLineAndCharacterOfPosition(operand.getStart()).line + 1}`
            )
      })
    }
    expect(offenders).toEqual([])
  })

  it('keeps timestamp naming, systemWallClock and Date confined', () => {
    /** Files that reference `systemWallClock`. */
    const wallClockOwners = new Set<string>()
    /** Files that reference the global `Date`. */
    const dateOwners = new Set<string>()
    /** `timestamp` identifiers inside the variation coordinator. */
    let coordinatorTimestamp = 0
    for (const path of coreSources(coreRoot)) {
      const file = relative(coreRoot, path)
      walk(parse(path), (node) => {
        if (!ts.isIdentifier(node)) return
        if (node.text === 'systemWallClock') wallClockOwners.add(file)
        if (node.text === 'Date') dateOwners.add(file)
        if (file === 'internal/variation-coordinator.ts' && node.text === 'timestamp')
          coordinatorTimestamp += 1
      })
    }
    expect([...wallClockOwners]).toEqual(['internal/time-port.ts'])
    expect([...dateOwners]).toEqual([])
    expect(coordinatorTimestamp).toBe(0)
  })
})

describe('A12 server metadata times follow the endpoint scheduler', () => {
  it('records registeredAt and lastSeenAt in scheduler time and ages them on the scheduler', async () => {
    const scheduler = createManualScheduler()
    scheduler.advance(1_000)
    const clock = recordingWallClock(() => WALL_BASE)
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    discoveryAttachments.length = 0
    const client = await createFullEndpoint({
      id: 'clock-meta-client',
      transport: clientTransport,
      scheduler,
      wallClock: clock.wallClock,
      middlewares: [connect({ transport: clientTransport }), ping()] as const
    })
    /** The client's discovery attachment; the first one constructed. */
    const clientDiscovery = discoveryAttachments[0] as {
      getServerList(targetId?: string): readonly IRpcServerMetadata[]
    }
    const server = await createFullEndpoint({
      id: 'clock-meta-server',
      transport: serverTransport,
      scheduler,
      wallClock: clock.wallClock,
      middlewares: [connect({ transport: serverTransport }), ping()] as const
    })
    try {
      expect(clientDiscovery).toBeDefined()
      await expect(client.ping!('clock-meta-server', undefined, { timeoutMs: 100 })).resolves.toBe(
        true
      )
      const [entry] = client.connect.getServerList('clock-meta-server')
      expect(entry).toBeDefined()
      expect(entry!.registeredAt).toBe(scheduler.now())
      expect(entry!.lastSeenAt).toBe(scheduler.now())
      expect(entry!.registeredAt).toBeLessThan(WALL_BASE)
      expect(clientDiscovery.getServerList('clock-meta-server')[0]?.status).toBe('active')

      clock.setSource(() => WALL_BASE - 1_000_000)
      scheduler.advance(299_999)
      expect(clientDiscovery.getServerList('clock-meta-server')[0]?.status).toBe('active')
      scheduler.advance(1)
      expect(clientDiscovery.getServerList('clock-meta-server')[0]?.status).toBe('stale')
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
