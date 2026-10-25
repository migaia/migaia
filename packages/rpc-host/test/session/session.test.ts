import {
  defineProbe,
  RpcProbeKind,
  RpcProbeOutcome,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import { createProbeEmitter } from '../../dist/plugins/probe/emitter.js'
import { MemoryCarrier } from '../fixtures/core-carrier.js'
import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { defineHost, definePlugin, type IPluginHostCore } from '@migaia/plugin-host'
import { RpcFlowPipelines, type IRpcFlowInstallation } from '@migaia/rpc-host/sdk'
import { TOKEN, leaks } from '../../../rpc-contract/test/fixtures/handshake-privacy.js'

import {
  RpcWireProfile,
  type IRpcDirectory,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode, RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { SessionTable } from '../../dist/session/table.js'
import { FlowRegistry } from '../../dist/flow/registry.js'
import type { IRpcSessionTableOptions } from '../../dist/session/types.js'

/** One bounded host fixture owns the actual SessionTable and its narrow work callbacks. */
class Host {
  /** Manual time proves control cleanup without wall-clock sleeps. */
  readonly scheduler = createManualScheduler()
  /** Actual work/lifecycle callbacks provide the observable host boundary. */
  readonly receive = vi.fn<IRpcSessionTableOptions['receive']>()
  /** Rejections keep every original diagnostic available to assertions. */
  readonly report = vi.fn<IRpcSessionTableOptions['report']>()
  /** One table covers every installed namespace; self remains global. */
  readonly table: SessionTable
  /** A real directory supplies method and generation authority. */
  directory: IRpcDirectory

  /** Construct the real fixed flow pipeline, with optional explicit test hooks. */
  constructor(
    id: string,
    name = id,
    installed: IRpcFlowInstallation<object> = {},
    options?: Pick<IRpcSessionTableOptions, 'scheduler' | 'handshakeTimeoutMs'>
  ) {
    this.directory = directory(id, name)
    /** Native construction declares the same seven payload/mode specifications as the real Host. */
    const native = defineHost({
      pipelines: RpcFlowPipelines,
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** Facts and stages are registered from the actual installing native core, never a fake core. */
    const flow = new FlowRegistry(this.report)
    native.useSync(
      definePlugin({
        name: 'session-flow',
        install(core: IPluginHostCore) {
          flow.register(core, { name: 'session-flow', setup: () => installed }, installed)
          return {}
        }
      })
    )
    flow.start()
    this.table = new SessionTable({
      flow,
      pipelines: () => native,
      self: () => this.directory.self,
      directory: () => this.directory,
      receive: this.receive,
      report: this.report,
      scheduler: options?.scheduler ?? this.scheduler,
      handshakeTimeoutMs: options?.handshakeTimeoutMs,
      timestamp: () => 0,
      nameProbeTimeoutMs: 20
    })
  }
}

/** Every fixture directory uses the actual schema3 admission path. */
function directory(id: string, name = id): IRpcDirectory {
  return {
    schemaVersion: 3,
    self: { name, instanceId: id, generation: { kind: 'session', value: 1, providerId: id } },
    methods: [{ name: 'api.echo', supportedModes: ['request'], modeSource: 'declared' }],
    nodeId: id.charCodeAt(0).toString(16).padStart(32, '0')
  }
}

/** Build one actual bidirectional physical connection without accepting a fabricated session view. */
function connect(left: Host, right: Host, namespace = 'process', holdAccept = false, key = '') {
  /** Endpoint ids are local physical identities, independent of peer display names. */
  const a = new MemoryCarrier(
    `${left.directory.self.instanceId}-${right.directory.self.instanceId}${key}`,
    ['native', 'json']
  )
  /** Opposite preference proves the smaller-id initiating offer owns codec priority. */
  const b = new MemoryCarrier(
    `${right.directory.self.instanceId}-${left.directory.self.instanceId}${key}`,
    ['json', 'native']
  )
  a.link(b)
  b.link(a)
  if (holdAccept) b.holdAccept()
  /** Both Session owners subscribe before asynchronous hello processing completes. */
  const first = left.table.attach(namespace, a)
  /** Every supported path exchanges real hello/accept through the public carrier contract. */
  const second = right.table.attach(namespace, b)
  return { a, b, first, second }
}

/** An ordinary business call includes the immutable generation tuple and direct hop route. */
function call(left: Host, right: Host): IRpcSemanticFrame {
  return {
    profile: RpcWireProfile,
    kind: 'call',
    id: 'call-1',
    route: {
      applicationVersion: 'app/1',
      senderId: left.directory.self.instanceId,
      receiverId: right.directory.self.instanceId,
      targetId: right.directory.self.instanceId,
      sentAt: 0
    },
    task: {
      mode: 'request',
      callerId: left.directory.self.instanceId,
      callerGeneration: left.directory.self.generation,
      targetGeneration: right.directory.self.generation,
      method: 'api.echo'
    },
    options: {},
    payload: { answer: 42 }
  }
}

describe('C2 Session and SessionTable owners', () => {
  it('publishes only after actual accept, negotiates one role and preserves codec/hook/write order', async () => {
    /** The hooks record actual stage placement without executing a second codec. */
    let a!: MemoryCarrier
    /** Inbound trace belongs to the physical restoring carrier. */
    let b!: MemoryCarrier
    /** Auth hooks see prepared metadata before native restoration. */
    const left = new Host('a', 'alpha', {
      stages: {
        envelopeOutbound: async (payload, next) => {
          a?.trace.push('envelope')
          await next(payload)
        },
        frameOutbound: async (payload, next) => {
          a.trace.push('frame')
          await next(payload)
        }
      }
    })
    /** Receiver instrumentation observes the inverse protected-metadata seam. */
    const right = new Host('b', 'beta', {
      stages: {
        envelopeInbound: async (payload, next) => {
          b?.trace.push('envelope')
          await next(payload)
        }
      }
    })
    /** Responder accept is held at the actual native handoff. */
    const pair = connect(left, right, 'process', true)
    a = pair.a
    b = pair.b
    await vi.waitFor(() => expect(b.trace.filter((x) => x.startsWith('encode:'))).toHaveLength(2))
    expect(left.table.get('process', 'beta')).toBeUndefined()
    expect(right.table.get('process', 'alpha')).toBeUndefined()
    expect(left.table.lookup('process', 'beta')).toBeUndefined()
    b.releaseAccept()
    /** Both sides independently publish the same selected codec. */
    const [l, r] = await Promise.all([pair.first.ready, pair.second.ready])
    expect(l.codec).toBe('native')
    expect(r.codec).toBe('native')
    expect(left.table.lookup('process', 'beta')).toEqual({ handle: pair.first, view: l })
    expect(left.table.lookup('process', 'b')?.handle).toBe(pair.first)
    expect(left.table.nodeId(a.id)).toBe('00000000000000000000000000000062')
    expect(b.written.filter((x) => x.kind === 'handshake' && x.step === 'accept')).toHaveLength(1)
    a.trace.length = 0
    b.trace.length = 0
    await left.table.send(a.id, call(left, right), { onWriteStart: () => a.trace.push('handoff') })
    await vi.waitFor(() => expect(right.receive).toHaveBeenCalledTimes(1))
    expect(a.trace).toEqual([
      'prepare:native',
      'envelope',
      'encode:native',
      'frame',
      'handoff',
      'write:call'
    ])
    expect(b.trace).toEqual(['decode:native', 'envelope', 'restore:native'])
    expect(left.table.getById(a.id)?.view).toBe(l)
    await Promise.all([left.table.close(), right.table.close()])
    expect(left.table.lookup('process', 'beta')).toBeUndefined()
    expect(left.table.lookup('process', 'b')).toBeUndefined()
  })

  it('uses host control ports, preserves remaining drain budget and clears timeout/cancel state', async () => {
    /** Real ping/pong and drain share the same accepted Session. */
    const left = new Host('a'),
      right = new Host('b')
    /** One physical connection is sufficient for lifecycle controls. */
    const pair = connect(left, right)
    await Promise.all([pair.first.ready, pair.second.ready])
    await left.table.ping(pair.first)
    expect(left.scheduler.pendingCount).toBe(0)
    await left.table.drain(pair.first, 17)
    await vi.waitFor(() => expect(right.receive).toHaveBeenCalledTimes(1))
    expect(right.receive.mock.calls[0]?.[2]).toMatchObject({
      kind: 'control',
      operation: 'drain',
      route: { remainingMs: 17 }
    })
    pair.a.silentPing = true
    /** The pending probe observes its original single monotonic deadline. */
    const timeout = left.table.ping(pair.first, { timeoutMs: 5 })
    /** Observe rejection before manually advancing its deadline. */
    const expired = expect(timeout).rejects.toMatchObject({
      name: 'TimeoutError',
      code: RpcCoreErrorCode.deadlineExceeded
    })
    left.scheduler.advance(5)
    await expired
    expect(left.scheduler.pendingCount).toBe(0)
    /** Aborting a no-timeout control retains the exact caller reason as cause. */
    const controller = new AbortController()
    /** A single object verifies cancellation provenance rather than message equivalence. */
    const reason = new Error('supervisor stopped')
    /** This genuine pending health exchange must leave no timer behind. */
    const cancelled = left.table.ping(pair.first, { timeoutMs: false, signal: controller.signal })
    controller.abort(reason)
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError', cause: reason })
    await Promise.all([left.table.close(), right.table.close()])
    expect(pair.a.unsubscribed).toBe(1)
    expect(pair.b.unsubscribed).toBe(1)
  })

  it('closes a held accepting write without deadlock or late publication and retains Promise identity', async () => {
    /** The native responder remains inside an unfinished write at retirement. */
    const left = new Host('a'),
      right = new Host('b')
    /** The close contract itself settles this real pending native operation. */
    const pair = connect(left, right, 'process', true)
    await vi.waitFor(() =>
      expect(pair.b.trace.filter((x) => x.startsWith('encode:')).length).toBe(2)
    )
    /** Preserve one original reason through both native EOF and handle readiness failure. */
    const reason = new Error('source stopped')
    /** Close returns the exact lifecycle Promise published before any IO. */
    const closing = pair.second.close(reason)
    expect(pair.second.close(reason)).toBe(closing)
    expect(closing).toBe(pair.second.closed)
    await closing
    await expect(pair.second.ready).rejects.toBe(reason)
    expect(right.table.getById(pair.b.id)).toBeUndefined()
    pair.b.releaseAccept()
    await Promise.all([left.table.close(), right.table.close()])
    expect(pair.b.written.some((x) => x.kind === 'handshake' && x.step === 'accept')).toBe(false)
    expect(pair.b.unsubscribed).toBe(1)
    expect(right.table.close()).toBe(right.table.close())
  })

  it('reserves an unpublished instance while its real accept write is pending', async () => {
    /** The responder owns the held accept, so its peer id is reserved before publication. */
    const local = new Host('z'),
      first = new Host('a', 'first'),
      next = new Host('a', 'next')
    /** Both connections use genuine native codec/handshake processing and distinct physical ids. */
    const original = connect(local, first)
    original.a.holdAccept()
    await vi.waitFor(() =>
      expect(original.a.trace.filter((x) => x.startsWith('encode:'))).toHaveLength(2)
    )
    expect(local.table.lookup('process', 'a')).toBeUndefined()
    /** A distinct display name cannot steal the pending original instance address. */
    const duplicate = connect(local, next, 'process', false, '-duplicate')
    await expect(duplicate.first.ready).rejects.toMatchObject({
      code: RpcCoreErrorCode.capabilityConflict
    })
    await Promise.all([duplicate.first.closed, duplicate.second.closed])
    original.a.releaseAccept()
    await Promise.all([original.first.ready, original.second.ready])
    expect(local.table.lookup('process', 'a')?.handle).toBe(original.first)
    expect(local.table.lookup('process', 'first')?.handle).toBe(original.first)
    expect(local.table.lookup('process', 'next')).toBeUndefined()
    await Promise.all([local.table.close(), first.table.close(), next.table.close()])
    expect(local.scheduler.pendingCount).toBe(0)
  })

  it('retains a healthy same-name peer after one ping and rejects the new candidate', async () => {
    /** Two different native instances compete for the same namespace display name. */
    const local = new Host('a'),
      old = new Host('b', 'worker'),
      newcomer = new Host('c', 'worker')
    /** The admitted first source is selected by both name and instance id. */
    const first = connect(local, old)
    await Promise.all([first.first.ready, first.second.ready])
    /** The second handshake must use real control liveness, not overwrite indexes. */
    const next = connect(local, newcomer)
    await expect(next.first.ready).rejects.toMatchObject({
      code: RpcCoreErrorCode.hostPeerNameDuplicate
    })
    expect(local.table.get('process', 'worker')?.carrierId).toBe(first.a.id)
    expect(
      first.a.written.filter((x) => x.kind === 'control' && x.operation === 'ping')
    ).toHaveLength(1)
    await Promise.all([local.table.close(), old.table.close(), newcomer.table.close()])
  })

  it('replaces only a failed same-name source and clears its health deadline', async () => {
    /** The old physical source is live but its actual health write no longer reaches the peer. */
    const local = new Host('a'),
      old = new Host('b', 'worker'),
      replacement = new Host('c', 'worker')
    /** First admission supplies the old session generation and directory. */
    const first = connect(local, old)
    await Promise.all([first.first.ready, first.second.ready])
    first.a.silentPing = true
    /** The genuine second hello enters same-name arbitration. */
    const next = connect(local, replacement)
    await vi.waitFor(() => expect(local.scheduler.pendingCount).toBe(2))
    local.scheduler.advance(20)
    await next.first.ready
    expect(local.table.get('process', 'worker')?.carrierId).toBe(next.a.id)
    expect(local.table.get('process', 'b')).toBeUndefined()
    expect(first.a.unsubscribed).toBe(1)
    expect(local.scheduler.pendingCount).toBe(0)
    await Promise.all([local.table.close(), old.table.close(), replacement.table.close()])
  })

  it('enforces trusted parent identity and rejects equal global identities with the canonical native error', async () => {
    /** Only actual native facts may constrain a bootstrap parent. */
    const local = new Host('a'),
      remote = new Host('b')
    /** This connection intentionally presents a different real peer than its parent fact. */
    const a = new MemoryCarrier('fact-a'),
      b = new MemoryCarrier('fact-b')
    a.link(b)
    b.link(a)
    /** Readiness is observed immediately so a rejected handshake owns its original failure. */
    const handle = local.table.attach('process', a, { expectedPeerId: 'parent' })
    /** The counterpart still exchanges a genuine pure-valid hello. */
    const other = remote.table.attach('process', b)
    await expect(handle.ready).rejects.toMatchObject({ code: RpcCoreErrorCode.protocolInvalid })
    await Promise.all([handle.closed, other.closed])
    expect(local.table.values('process')).toEqual([])
    /** Equal ids cannot select either simultaneous-hello role. */
    const one = new Host('same'),
      two = new Host('same')
    /** Carrier ids are distinct even when the proposed global ids are equal. */
    const pair = connect(one, two)
    await expect(pair.first.ready).rejects.toMatchObject({
      name: 'TypeError',
      code: RpcContractErrorCode.handshakeInvalid
    })
    await Promise.all([
      local.table.close(),
      remote.table.close(),
      one.table.close(),
      two.table.close()
    ])
  })

  it('cancels a retiring candidate probe without retiring its existing same-name source', async () => {
    /** Candidate cancellation is independent of whether the established source is healthy. */
    const local = new Host('a'),
      old = new Host('b', 'worker'),
      candidate = new Host('c', 'worker')
    /** The old real session remains selectable while candidate liveness is unresolved. */
    const first = connect(local, old)
    await Promise.all([first.first.ready, first.second.ready])
    first.a.silentPing = true
    /** This candidate waits on the existing Session's actual control exchange. */
    const next = connect(local, candidate)
    await vi.waitFor(() => expect(local.scheduler.pendingCount).toBe(2))
    /** Cancel the native candidate before the existing source's health deadline fires. */
    const reason = new Error('candidate source closed')
    await next.first.close(reason)
    await expect(next.first.ready).rejects.toBe(reason)
    await vi.waitFor(() => expect(local.scheduler.pendingCount).toBe(0))
    expect(local.table.get('process', 'worker')?.carrierId).toBe(first.a.id)
    expect(first.a.unsubscribed).toBe(0)
    first.a.silentPing = false
    await local.table.ping(first.first)
    await Promise.all([local.table.close(), old.table.close(), candidate.table.close()])
  })

  it('updates O(1) directory/name indexes and rejects ambiguous cross-namespace forwarding', async () => {
    /** The host has two actual namespaces sharing one global self identity. */
    const local = new Host('a'),
      remote = new Host('b', 'worker'),
      other = new Host('c', 'worker')
    /** Each accepted directory supplies its actual direct node id. */
    const first = connect(local, remote, 'process'),
      second = connect(local, other, 'thread')
    await Promise.all([
      first.first.ready,
      first.second.ready,
      second.first.ready,
      second.second.ready
    ])
    expect(local.table.resolveForward('process', 'worker')?.carrierId).toBe(first.a.id)
    expect(() => local.table.resolveForward('browser', 'worker')).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.targetUnknown })
    )
    /** A real directory frame replaces cold metadata through the same Session admission path. */
    const control = call(remote, local) as Exclude<IRpcSemanticFrame, { kind: 'handshake' }>
    await remote.table.send(first.b.id, {
      profile: RpcWireProfile,
      kind: 'directory',
      id: 'directory-1',
      route: control.route,
      directory: { ...directory('b', 'renamed'), nodeId: '11111111111111111111111111111111' }
    })
    await vi.waitFor(() => expect(local.table.get('process', 'renamed')).toBeDefined())
    expect(local.table.get('process', 'worker')).toBeUndefined()
    expect(local.table.resolveForward('browser', 'worker')?.carrierId).toBe(second.a.id)
    expect(local.table.nodeId(first.a.id)).toBe('11111111111111111111111111111111')
    await Promise.all([local.table.close(), remote.table.close(), other.table.close()])
    expect(local.table.values('process')).toEqual([])
  })
})

it('times out an actual silent handshake at10000ms, preserves abort identity and releases timers', async () => {
  /** No peer response reaches this original subscribed physical carrier. */
  const silent = new Host('silent')
  /** The actual native resource keeps its original receiver and idempotent physical cleanup. */
  const carrier = new MemoryCarrier('silent-startup')
  /** Count the original native close, without replacing the cleanup implementation. */
  const close = vi.spyOn(carrier, 'close')
  /** Observe failure before moving the real borrowed monotonic clock. */
  const handle = silent.table.attach('process', carrier)
  /** The new profile maps retired JSONRPC startup classification onto canonical TIMEOUT. */
  const timed = expect(handle.ready).rejects.toMatchObject({
    code: RpcCoreErrorCode.deadlineExceeded
  })
  silent.scheduler.advance(9999)
  expect(close).toHaveBeenCalledTimes(0)
  silent.scheduler.advance(1)
  await timed
  await handle.closed
  expect(close).toHaveBeenCalledTimes(1)
  expect(silent.scheduler.pendingCount).toBe(0)
  expect(carrier.unsubscribed).toBe(1)
  /** A cold native namespace lends its configured deadline to this same Session timer owner. */
  const configured = new Host('configured')
  /** No native or transport-owned timer is introduced for an explicit connect timeout. */
  const scope = configured.table.stage('process', { handshakeTimeoutMs: 7 })
  /** Silent native IO still uses the original physical close and one readiness Promise. */
  const native = new MemoryCarrier('configured-startup')
  /** Attachment borrows its staged namespace's policy before starting the actual handshake. */
  const connecting = configured.table.attach('process', native, undefined, scope)
  /** Observe the same canonical deadline failure before advancing the one clock. */
  const configuredTimeout = expect(connecting.ready).rejects.toMatchObject({
    code: RpcCoreErrorCode.deadlineExceeded
  })
  expect(configured.scheduler.pendingCount).toBe(1)
  configured.scheduler.advance(6)
  expect(native.unsubscribed).toBe(0)
  configured.scheduler.advance(1)
  await configuredTimeout
  await connecting.closed
  expect(native.unsubscribed).toBe(1)
  expect(configured.scheduler.pendingCount).toBe(0)
  await configured.table.close()
  /** A second actual startup is abandoned by its original native source reason. */
  const aborted = new Host('aborted')
  /** The original receiver survives until actual lifecycle cancellation. */
  const source = new MemoryCarrier('aborted-startup')
  /** A real close count remains independent of ready's failure projection. */
  const abortedClose = vi.spyOn(source, 'close')
  /** Exact reason identity is the existing native source cancellation contract. */
  const reason = new Error('caller cancellation')
  /** Actual source close cancels the one pending handshake rather than a fabricated caller task. */
  const opening = aborted.table.attach('process', source)
  aborted.scheduler.advance(5000)
  await opening.close(reason)
  await expect(opening.ready).rejects.toBe(reason)
  expect(aborted.scheduler.pendingCount).toBe(0)
  expect(abortedClose).toHaveBeenCalledTimes(1)
  await Promise.all([silent.table.close(), aborted.table.close()])
})

it.each([true, false])(
  'reclaims real Session resources when handshake timer cancellation throws (hello=%s)',
  async (hello) => {
    /** Both accepted negotiation and source abort retain this original cleanup failure. */
    const cleanup = new Error('timer cancellation fixture')
    /** A previously selected caller reason stays first when physical cleanup also fails. */
    const primary = new Error('opening abort fixture')
    /** The native scheduler receipt remains real; only its post-cancellation failure is observed. */
    const scheduler = createManualScheduler()
    /** Existing timer ownership is delegated before throwing the exact original error. */
    const observedScheduler = {
      ...scheduler,
      schedule: ((callback, delay) => {
        const task = scheduler.schedule(callback, delay)
        return {
          ...task,
          cancel() {
            task.cancel()
            throw cleanup
          }
        }
      }) as typeof scheduler.schedule
    }
    /** Only the first host's actual timer cleanup fails; the counterpart stays independently owned. */
    const left = new Host('a', 'a', undefined, { scheduler: observedScheduler })
    /** The original counterpart supplies real hello/accept rather than an invented readiness flag. */
    const right = new Host('b')
    /** Each resource has one genuine subscription; both removals must still occur after failure. */
    const pair = connect(left, right)
    /** Count physical source release while retaining the actual stable close arrow. */
    const close = vi.spyOn(pair.a, 'close')
    /** The accepted and aborted paths preserve their own original primary error. */
    const opening = Promise.allSettled([pair.first.ready])
    if (!hello) void pair.first.close(primary)
    /** Timer failure cannot prevent the original handshake/source-close cleanup from settling. */
    const [outcome] = await opening
    expect(outcome!.status).toBe('rejected')
    if (outcome!.status !== 'rejected') return expect.unreachable()
    expect(cleanup, 'cleanup contract').toMatchObject({ source: 'rpc.endpoint', code: 'INTERNAL' })
    if (hello) {
      expect(outcome!.reason).toBe(cleanup)
      await pair.first.closed
    } else {
      expect(outcome!.reason).toBe(primary)
      /** The separately observable physical close retains both the selected primary and cleanup. */
      const [closed] = await Promise.allSettled([pair.first.closed])
      expect(closed!.status).toBe('rejected')
      if (closed!.status !== 'rejected') return expect.unreachable()
      expect(closed!.reason).toBeInstanceOf(AggregateError)
      expect(closed!.reason.errors[0]).toBe(primary)
      expect(closed!.reason.errors).toContain(cleanup)
    }
    await Promise.allSettled([left.table.close(), right.table.close()])
    expect(left.report.mock.calls.some(([error]) => error === cleanup)).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
    expect(pair.a.unsubscribed + pair.b.unsubscribed).toBe(2)
    expect(scheduler.pendingCount).toBe(0)
    expect(right.scheduler.pendingCount).toBe(0)
  }
)

it.each(['batch@1', 'abort@1', 'wire-error@1'])(
  'rejects absent required handler %s through one real handshake and closes once',
  async (extension) => {
    /** Actual cold hook registration is the sole source of required handler negotiation. */
    const left = new Host('a', 'a', {
      extensions: [extension],
      requiredExtensions: [extension]
    })
    /** The counterpart genuinely installs no handler for this required extension. */
    const right = new Host('b')
    /** Both sides exchange real profile2 frames over the original physical pair. */
    const pair = connect(left, right)
    /** The original actual carrier owns its sole physical close receipt. */
    const close = vi.spyOn(pair.a, 'close')
    await expect(pair.first.ready).rejects.toMatchObject({ code: 'EXTENSION_NEGOTIATION_FAILED' })
    await Promise.allSettled([pair.first.closed, pair.second.closed])
    expect(close).toHaveBeenCalledTimes(1)
    expect(
      pair.a.written.filter((frame) => frame.kind === 'handshake' && frame.step === 'hello')
    ).toHaveLength(1)
    expect(pair.a.unsubscribed).toBe(1)
    expect(pair.b.unsubscribed).toBe(1)
    expect(left.scheduler.pendingCount + right.scheduler.pendingCount).toBe(0)
    await Promise.allSettled([left.table.close(), right.table.close()])
  }
)

it.each(['kind', 'step', 'profile', 'codec', 'unknown-field', 'peer'])(
  'preserves the actual admitted failure and redacts hostile reply %s',
  async (field) => {
    /** The actual sole Session owner must preserve its original codec validation exception. */
    const left = new Host('a'),
      right = new Host('b')
    /** Asynchronous hello hooks let the test observe the original physical write before delivery. */
    const pair = connect(left, right)
    /** Capture the exact source exception, without rebuilding an expected second parse. */
    let upstream: unknown
    /** The original restoring codec performs the real canonical pure validation. */
    const restore = pair.a.codec.restore
    vi.spyOn(pair.a.codec, 'restore').mockImplementation((value, context) => {
      try {
        return restore(value, context)
      } catch (error) {
        upstream = error
        throw error
      }
    })
    /** Original physical handoff is retained while the peer supplies hostile received metadata. */
    const write = pair.b.write
    vi.spyOn(pair.b, 'write').mockImplementation((frame, options) => {
      const message = frame.data as IRpcSemanticFrame
      if (message.kind !== 'handshake' || message.step !== 'accept') return write(frame, options)
      const hostile =
        field === 'unknown-field'
          ? { ...message, kind: 'invalid', [TOKEN]: true }
          : { ...message, [field]: field === 'peer' ? { id: TOKEN, runtime: [] } : TOKEN }
      return write({ ...frame, data: hostile }, options)
    })
    /** The original promise is observed before receiving the peer's malformed accept. */
    const [observed] = await Promise.allSettled([pair.first.ready])
    expect(observed!.status).toBe('rejected')
    if (observed!.status !== 'rejected') return expect.unreachable()
    expect(observed!.reason).toBe(upstream)
    expect(observed!.reason).toBeInstanceOf(TypeError)
    expect(leaks(observed!.reason, TOKEN)).toBe(false)
    expect(leaks({ error: observed!.reason, reports: left.report.mock.calls }, TOKEN)).toBe(false)
    await Promise.allSettled([left.table.close(), right.table.close()])
  }
)

it('records the original control.sent assertion through the real native Session ping owner', async () => {
  /** Only the test sink snapshots its reusable live view. */
  const caller: IRpcProbeEventView[] = []
  /** The genuine compiled sink consumes actual Session stage events through the same pipeline. */
  const emitter = createProbeEmitter(
    [
      defineProbe({
        stages: ['message'],
        emit: (event) => caller.push(Object.freeze({ ...event }))
      })
    ],
    () => 0,
    'a'
  )
  /** Existing Session fixtures retain the original native ping owner and physical carrier. */
  const left = new Host('a', 'alpha', { observe: emitter.observe })
  /** A genuine counterpart answers the same physical ping with its real pong. */
  const right = new Host('b', 'beta')
  /** Both real subscriptions precede the original hello/accept exchange. */
  const pair = connect(left, right)
  try {
    await Promise.all([pair.first.ready, pair.second.ready])
    await left.table.ping(pair.first)
    expect(
      caller.some(
        (event) => event.kind === RpcProbeKind.control && event.outcome === RpcProbeOutcome.sent
      )
    ).toBe(true)
  } finally {
    await Promise.all([left.table.close(), right.table.close()])
    emitter.dispose()
  }
})
