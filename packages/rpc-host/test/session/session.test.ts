/** Genuine native Session and Table fixtures preserve admission, controls and supported cleanup. */
import {
  defineProbe,
  RpcProbeKind,
  RpcProbeOutcome,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import { createProbeEmitter } from '../../dist/plugins/probe/emitter.js'
import { createDirectorySnapshot } from '../../dist/session/view.js'
import { MemoryCarrier } from '../fixtures/core-carrier.js'
import { assert, describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { deferred } from '@migaia/utils/promise'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import {
  defineFlowFeature,
  createRpcByteCarrier,
  RpcEventByteIO,
  rpcHostPipelines,
  type IRpcFlowInstallation
} from '@migaia/rpc-host/sdk'
import { PassThrough } from 'node:stream'
import { TOKEN, leaks } from '../../../rpc-contract/test/fixtures/handshake-privacy.js'

import {
  RpcWireProfile,
  type IRpcDirectory,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode, RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { SessionTable } from '../../dist/session/table.js'
import { SessionDrain } from '../../dist/session/drain.js'
import { FlowRegistry, type IRpcFlowGroup } from '../../dist/flow/registry.js'
import {
  rpcPipelineOwner,
  RpcFlowPipelines,
  type IRpcPipelineOwner
} from '../../dist/sdk/flow-pipelines.js'
import { RpcTransportFlowProgram } from '../../dist/sdk/flow-program.js'
import type { IRpcSessionScope, IRpcSessionTableOptions } from '../../dist/session/types.js'

/** These two cold groups cover every physical namespace used by the actual Session fixtures. */
const sessionNamespaces = ['process', 'thread'] as const

/** One bounded host fixture owns the actual SessionTable and its narrow work callbacks. */
class Host {
  /** Manual time proves control cleanup without wall-clock sleeps. */
  readonly scheduler = createManualScheduler()
  /** Actual work/lifecycle callbacks provide the observable host boundary. */
  readonly receive = vi.fn<IRpcSessionTableOptions['receive']>()
  /** Rejections keep every original diagnostic available to assertions. */
  readonly report = vi.fn<IRpcSessionTableOptions['report']>()
  /** One table covers every installed namespace after its genuine native groups are ready. */
  #table!: SessionTable
  /** Exact native group scopes lend their original pipeline ports to each physical Session. */
  readonly #scopes = new Map<string, IRpcSessionScope>()

  /** Expose the existing table only after create() has completed native installation. */
  get table(): SessionTable {
    return this.#table
  }
  /** A real directory supplies method and generation authority. */
  directory: IRpcDirectory

  /** Capture global identity before native installation begins. */
  constructor(id: string, name: string) {
    this.directory = directory(id, name)
  }

  /** Complete genuine asynchronous native Feature setup before a physical Session can attach. */
  static async create(
    id: string,
    name = id,
    installed: IRpcFlowInstallation<object> = {},
    options?: Pick<
      IRpcSessionTableOptions,
      'scheduler' | 'handshakeTimeoutMs' | 'maxFrameBytes' | 'retired'
    >
  ): Promise<Host> {
    /** This bounded fixture retains the same global identity and original hook callbacks. */
    const host = new Host(id, name)
    await host.#install(installed, options)
    return host
  }

  /** Native groups own real short-name declarations and canonical setup, without a copied runner. */
  async #install(
    installed: IRpcFlowInstallation<object>,
    options?: Pick<
      IRpcSessionTableOptions,
      'scheduler' | 'handshakeTimeoutMs' | 'maxFrameBytes' | 'retired'
    >
  ): Promise<void> {
    /** Genuine native construction fixes one execution port per namespace registration. */
    const owners = new Map<string, IRpcPipelineOwner>()
    /** Negotiation resolves only actual prepared groups for this fixture's two namespaces. */
    const groups = new Map<string, IRpcFlowGroup>()
    /** The original SDK owner borrows native construction provenance without synthetic scope data. */
    const rpc = rpcHostPipelines(
      () => native,
      (name, request) => native.pipeline(name, request)
    )
    /** Each domain core receives its original native construction request. */
    const native = defineHost({
      domainCore(request) {
        /** The captured port belongs to this exact namespace's native registration. */
        const domain = rpc.domainCore(request)
        owners.set(request.pluginName, domain[rpcPipelineOwner])
        return domain
      },
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** The genuine Feature exposes only these original hook and observation callbacks. */
    const feature = defineFlowFeature({ name: 'session-flow', setup: () => installed })
    /** Source lifetime is explicitly borrowed by canonical native preparation. */
    const setup = new AbortController()
    /** Host observations and scoped negotiation share the original report callback. */
    const flow = new FlowRegistry(this.report, (namespace) => groups.get(namespace))
    /** Canonical setup reports to the same original fixture spy. */
    const flowReport = this.report
    for (const namespace of sessionNamespaces) {
      /** Each actual namespace selects the same original fixture Feature under its own native core. */
      const program = new RpcTransportFlowProgram([feature])
      await native.use(
        definePlugin({
          name: namespace,
          pipelines: RpcFlowPipelines,
          features: program.features,
          async install(core) {
            groups.set(
              namespace,
              await flow.prepareTransport(core, program, setup.signal, {
                signal: setup.signal,
                report: flowReport,
                retire: async () => undefined,
                call: async () => undefined
              })
            )
            return {}
          }
        })
      )
    }
    flow.start()
    this.#table = new SessionTable({
      flow,
      pipelines: () => owners.get('process')!,
      self: () => this.directory.self,
      directory: () => createDirectorySnapshot(this.directory),
      receive: this.receive,
      report: this.report,
      scheduler: options?.scheduler ?? this.scheduler,
      handshakeTimeoutMs: options?.handshakeTimeoutMs,
      maxFrameBytes: options?.maxFrameBytes,
      retired: options?.retired,
      timestamp: () => 0,
      nameProbeTimeoutMs: 20
    })
    for (const namespace of sessionNamespaces) {
      /** Existing SessionTable staging borrows this group's exact ports without another owner. */
      const scope = this.#table.stage(namespace, {
        flow: groups.get(namespace)!,
        pipelines: () => owners.get(namespace)!
      })
      this.#table.commit(scope)
      this.#scopes.set(namespace, scope)
    }
  }

  /** Attach through the real table while retaining the installed namespace's original group. */
  attach(
    namespace: string,
    carrier: Parameters<SessionTable['attach']>[1],
    connection?: Parameters<SessionTable['attach']>[2]
  ) {
    return this.#table.attach(namespace, carrier, connection, this.#scopes.get(namespace))
  }

  /** Closing controls use the installed scope's native grace hook without synthetic readiness. */
  onClosing(handler: Parameters<SessionTable['onClosing']>[1]): () => void {
    return this.#table.onClosing(this.#scopes.get('process')!, handler)
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
function connect(
  left: Host,
  right: Host,
  namespace = 'process',
  holdAccept = false,
  key = '',
  closingWrites?: true
) {
  /** Endpoint ids are local physical identities, independent of peer display names. */
  const a = new MemoryCarrier(
    `${left.directory.self.instanceId}-${right.directory.self.instanceId}${key}`,
    ['native', 'json'],
    undefined,
    true,
    closingWrites
  )
  /** Opposite preference proves the smaller-id initiating offer owns codec priority. */
  const b = new MemoryCarrier(
    `${right.directory.self.instanceId}-${left.directory.self.instanceId}${key}`,
    ['json', 'native'],
    undefined,
    true,
    closingWrites
  )
  a.link(b)
  b.link(a)
  if (holdAccept) b.holdAccept()
  /** Both Session owners subscribe before asynchronous hello processing completes. */
  const first = left.attach(namespace, a)
  /** Every supported path exchanges real hello/accept through the public carrier contract. */
  const second = right.attach(namespace, b)
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
    const left = await Host.create('a', 'alpha', {
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
    const right = await Host.create('b', 'beta', {
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
    const left = await Host.create('a'),
      right = await Host.create('b')
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
    const left = await Host.create('a'),
      right = await Host.create('b')
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
    const local = await Host.create('z'),
      first = await Host.create('a', 'first'),
      next = await Host.create('a', 'next')
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
    const local = await Host.create('a'),
      old = await Host.create('b', 'worker'),
      newcomer = await Host.create('c', 'worker')
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
    const local = await Host.create('a'),
      old = await Host.create('b', 'worker'),
      replacement = await Host.create('c', 'worker')
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
    const local = await Host.create('a'),
      remote = await Host.create('b')
    /** This connection intentionally presents a different real peer than its parent fact. */
    const a = new MemoryCarrier('fact-a'),
      b = new MemoryCarrier('fact-b')
    a.link(b)
    b.link(a)
    /** Readiness is observed immediately so a rejected handshake owns its original failure. */
    const handle = local.attach('process', a, { expectedPeerId: 'parent' })
    /** The counterpart still exchanges a genuine pure-valid hello. */
    const other = remote.attach('process', b)
    await expect(handle.ready).rejects.toMatchObject({ code: RpcCoreErrorCode.protocolInvalid })
    await Promise.all([handle.closed, other.closed])
    expect(local.table.values('process')).toEqual([])
    /** Equal ids cannot select either simultaneous-hello role. */
    const one = await Host.create('same'),
      two = await Host.create('same')
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

  it('keeps a replacement admissible when the retired same-name source cleanup fails', async () => {
    /** Name arbitration starts with the original accepted physical peer. */
    const local = await Host.create('replace-a')
    /** Distinct instance identities share only their application display name. */
    const old = await Host.create('replace-b', 'worker')
    /** The new real peer must not inherit an older resource's cleanup failure. */
    const replacement = await Host.create('replace-c', 'worker')
    /** The old source's actual close still runs before its independently observed cleanup fails. */
    const first = connect(local, old)
    await Promise.all([first.first.ready, first.second.ready])
    /** One original native cleanup error belongs to the departing Session. */
    const cleanup = new RangeError('old source cleanup failed')
    /** Preserve native teardown and its peer notification rather than inventing a dead Session. */
    const close = first.a.close
    /** The existing native disposer seam exposes a real cleanup failure after physical release. */
    const fault = vi.spyOn(first.a, 'close').mockImplementation(async (reason) => {
      await close(reason)
      throw cleanup
    })
    first.a.silentPing = true
    /** Observe both handshake completions before the name-health deadline is advanced. */
    const next = connect(local, replacement)
    /** Neither original rejecting close nor handshake completion is left unobserved. */
    const readiness = Promise.allSettled([next.first.ready, next.second.ready])
    /** The old physical cleanup retains its own exact failure. */
    const closed = first.first.closed.catch((error: unknown) => error)
    try {
      await vi.waitFor(() => expect(local.scheduler.pendingCount).toBe(2))
      local.scheduler.advance(20)
      expect(await readiness).toEqual([
        expect.objectContaining({ status: 'fulfilled' }),
        expect.objectContaining({ status: 'fulfilled' })
      ])
      expect(await closed).toBe(cleanup)
      expect(local.table.get('process', 'worker')?.carrierId).toBe(next.a.id)
      expect(local.report.mock.calls.filter(([error]) => error === cleanup)).toHaveLength(1)
    } finally {
      fault.mockRestore()
      await Promise.allSettled([local.table.close(), old.table.close(), replacement.table.close()])
    }
  })

  it('cancels a retiring candidate probe without retiring its existing same-name source', async () => {
    /** Candidate cancellation is independent of whether the established source is healthy. */
    const local = await Host.create('a'),
      old = await Host.create('b', 'worker'),
      candidate = await Host.create('c', 'worker')
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
    expect(local.report).not.toHaveBeenCalled()
    await Promise.all([local.table.close(), old.table.close(), candidate.table.close()])
  })

  it('updates O(1) directory/name indexes and rejects ambiguous cross-namespace forwarding', async () => {
    /** The host has two actual namespaces sharing one global self identity. */
    const local = await Host.create('a'),
      remote = await Host.create('b', 'worker'),
      other = await Host.create('c', 'worker')
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
  const silent = await Host.create('silent')
  /** The actual native resource keeps its original receiver and idempotent physical cleanup. */
  const carrier = new MemoryCarrier('silent-startup')
  /** Count the original native close, without replacing the cleanup implementation. */
  const close = vi.spyOn(carrier, 'close')
  /** Observe failure before moving the real borrowed monotonic clock. */
  const handle = silent.attach('process', carrier)
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
  const configured = await Host.create('configured')
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
  const aborted = await Host.create('aborted')
  /** The original receiver survives until actual lifecycle cancellation. */
  const source = new MemoryCarrier('aborted-startup')
  /** A real close count remains independent of ready's failure projection. */
  const abortedClose = vi.spyOn(source, 'close')
  /** Exact reason identity is the existing native source cancellation contract. */
  const reason = new Error('caller cancellation')
  /** Actual source close cancels the one pending handshake rather than a fabricated caller task. */
  const opening = aborted.attach('process', source)
  aborted.scheduler.advance(5000)
  await opening.close(reason)
  await expect(opening.ready).rejects.toBe(reason)
  expect(aborted.scheduler.pendingCount).toBe(0)
  expect(abortedClose).toHaveBeenCalledTimes(1)
  await Promise.all([silent.table.close(), aborted.table.close()])
})

it.each(['batch@1', 'abort@1', 'wire-error@1'])(
  'rejects absent required handler %s through one real handshake and closes once',
  async (extension) => {
    /** Actual cold hook registration is the sole source of required handler negotiation. */
    const left = await Host.create('a', 'a', {
      extensions: [extension],
      requiredExtensions: [extension]
    })
    /** The counterpart genuinely installs no handler for this required extension. */
    const right = await Host.create('b')
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
    const left = await Host.create('a'),
      right = await Host.create('b')
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
  const left = await Host.create('a', 'alpha', { observe: emitter.observe })
  /** A genuine counterpart answers the same physical ping with its real pong. */
  const right = await Host.create('b', 'beta')
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

it('A36 handshake timeout closes locally without consulting a native terminal reason', async () => {
  /** Manual startup time exercises the genuine unpublished Session timeout. */
  const local = await Host.create('timeout-owner', 'timeout-owner', {}, { handshakeTimeoutMs: 5 })
  /** No linked peer means the actual hello remains unanswered. */
  const carrier = new MemoryCarrier('unanswered')
  /** An unrelated native exit must not be awaited by a local handshake timeout. */
  const terminalReason = vi.fn(async () => new Error('unrelated native exit'))
  Object.assign(carrier, { terminalReason })
  /** The real table publishes the original readiness and close completions. */
  const session = local.attach('process', carrier)
  /** Observe readiness rejection before advancing the original manual deadline. */
  const failed = expect(session.ready).rejects.toMatchObject({
    code: RpcCoreErrorCode.deadlineExceeded
  })
  try {
    local.scheduler.advance(5)
    await failed
    await session.closed
    expect(terminalReason).not.toHaveBeenCalled()
    expect(local.report).toHaveBeenCalledOnce()
    expect(local.scheduler.pendingCount).toBe(0)
  } finally {
    await local.table.close()
  }
})

it('A39 late track after physical retirement preserves its promise without allocating drain state', async () => {
  /** Both original Sessions first complete a genuine native handshake. */
  const left = await Host.create('late-track-a')
  /** The peer owns the opposite original physical endpoint. */
  const right = await Host.create('late-track-b')
  /** Actual carrier retirement removes its existing business barrier. */
  const pair = connect(left, right)
  try {
    await Promise.all([pair.first.ready, pair.second.ready])
    await pair.first.close()
    await pair.second.closed
    /** The original owner method reveals any attempt to recreate a retired barrier. */
    const tracking = vi.spyOn(SessionDrain.prototype, 'track')
    /** Completion still belongs to the late caller, even though no live source can track it. */
    const original = Promise.resolve('late result')
    try {
      expect(left.table.track(pair.a.id, original)).toBe(original)
      expect(tracking).not.toHaveBeenCalled()
      expect(left.scheduler.pendingCount).toBe(0)
    } finally {
      tracking.mockRestore()
    }
    expect(await original).toBe('late result')
  } finally {
    await Promise.all([left.table.close(), right.table.close()])
  }
})

it('A39 reentrant retirement track is inert while closing grace keeps its original tracking', async () => {
  /** One real grace callback remains active before the Session seals its final writes. */
  const entered = deferred<void>()
  const release = deferred<void>()
  /** Retirement must preserve this independently owned business Promise without wrapping it. */
  const original = deferred<string>()
  /** Capture genuine advanced handle methods only after their actual native handshake succeeds. */
  let track!: <T>(promise: Promise<T>) => Promise<T>
  let canKeepalive!: () => boolean
  /** Snapshot both callback phases outside assertions that Session cleanup intentionally reports. */
  let graceResult: Promise<string> | undefined
  let retiredResult: Promise<string> | undefined
  let graceAllowed: boolean | undefined
  let retiredAllowed: boolean | undefined
  /** The synchronous table collaborator reenters before the Session aborts its controller. */
  const left = await Host.create(
    'reentrant-track-a',
    'reentrant-track-a',
    {},
    {
      retired: () => {
        retiredAllowed = canKeepalive()
        retiredResult = track(original.promise)
      }
    }
  )
  const right = await Host.create('reentrant-track-b')
  const pair = connect(left, right, 'process', false, '', true)
  /** Observe the existing drain owner rather than replacing its record or settlement behavior. */
  const tracking = vi.spyOn(SessionDrain.prototype, 'track')
  const off = left.onClosing(async () => {
    graceAllowed = canKeepalive()
    graceResult = track(original.promise)
    entered.resolve()
    await release.promise
  })
  try {
    await Promise.all([pair.first.ready, pair.second.ready])
    expect(typeof Reflect.get(pair.first, 'track')).toBe('function')
    expect(typeof Reflect.get(pair.first, 'canKeepalive')).toBe('function')
    track = Reflect.get(pair.first, 'track')
    canKeepalive = Reflect.get(pair.first, 'canKeepalive')
    const closing = pair.first.close()
    await entered.promise
    expect(graceAllowed).toBe(true)
    expect(graceResult).toBe(original.promise)
    expect(tracking).toHaveBeenCalledExactlyOnceWith(pair.a.id, original.promise)
    release.resolve()
    await closing
    expect(retiredAllowed).toBe(false)
    expect(retiredResult).toBe(original.promise)
    expect(tracking).toHaveBeenCalledExactlyOnceWith(pair.a.id, original.promise)
    expect(left.table.get('process', right.directory.self.instanceId)).toBeUndefined()
    expect(left.scheduler.pendingCount).toBe(0)
  } finally {
    release.resolve()
    original.resolve('finished independently')
    off()
    tracking.mockRestore()
    await Promise.all([left.table.close(), right.table.close()])
  }
})

it('A38 accepted byte Session replaces the bootstrap cap with its configured frame limit', async () => {
  /** A real accepted handshake fits within this smaller configured business-frame budget. */
  const left = await Host.create('byte-a', 'byte-a', {}, { maxFrameBytes: 1024 })
  /** The opposite actual Session negotiates using the same canonical byte carrier. */
  const right = await Host.create('byte-b')
  /** Each direction is one original native ordered stream. */
  const toLeft = new PassThrough()
  /** Peer writes feed the opposite real IO subscriber. */
  const toRight = new PassThrough()
  /** Actual native input/output ownership is shared only across its two physical endpoints. */
  const io = (input: PassThrough, output: PassThrough) =>
    new RpcEventByteIO(
      input,
      output,
      () => {
        input.pause()
        output.end()
      },
      { closedError: () => new Error('byte session fixture closed'), report: left.report }
    ).value
  /** Both real Session owners subscribe before any asynchronous handshake is written. */
  const first = left.attach(
    'process',
    createRpcByteCarrier({ id: 'byte-left', io: io(toLeft, toRight), report: left.report })
  )
  /** The peer has its own physical carrier and original frame decoder. */
  const second = right.attach(
    'process',
    createRpcByteCarrier({ id: 'byte-right', io: io(toRight, toLeft), report: right.report })
  )
  try {
    await Promise.all([first.ready, second.ready])
    /** A header above the accepted limit must fail without waiting for its nonexistent payload. */
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, 1025)
    /** The configured cap is enforced before any semantic JSON parse starts. */
    const parse = vi.spyOn(JSON, 'parse')
    try {
      toLeft.emit('data', header)
      expect(left.report).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'FRAME_LIMIT_EXCEEDED' })
      )
      expect(parse).not.toHaveBeenCalled()
    } finally {
      parse.mockRestore()
    }
  } finally {
    await Promise.all([left.table.close(), right.table.close()])
    toLeft.destroy()
    toRight.destroy()
  }
})

it('labels a handshake scheduler failure without calling it disposal cleanup', async () => {
  /** A primitive thrown by the supported scheduler needs the owner's fallback diagnostic. */
  const cause = 17
  /** All other scheduler operations remain the original manually controlled implementation. */
  const clock = createManualScheduler()
  /** The original native Session starts and fails its real first handshake scheduling operation. */
  const host = await Host.create(
    'schedule-a',
    'schedule-a',
    {},
    {
      scheduler: {
        ...clock,
        schedule: () => {
          throw cause
        }
      }
    }
  )
  /** No fabricated peer reply is needed to reach this startup failure. */
  const carrier = new MemoryCarrier('schedule-carrier')
  /** Session readiness exposes the original owner-classified startup error. */
  const handle = host.attach('process', carrier)
  await expect(handle.ready).rejects.toMatchObject({
    code: RpcCoreErrorCode.internal,
    message: 'RPC handshake scheduling failed',
    cause
  })
  await handle.closed
  await host.table.close()
})

it('A40 closing keepalive queue leaves cancellation with its original caller', async () => {
  /** Real accepted native sources enter the existing closing-write grace window. */
  const left = await Host.create('keepalive-queue-a')
  /** The actual peer remains able to receive the final close notification. */
  const right = await Host.create('keepalive-queue-b')
  /** Both original carriers explicitly grant closing writes. */
  const pair = connect(left, right, 'process', false, '', true)
  /** The original close reason remains the public keepalive lifecycle cause. */
  const reason = new Error('closing keepalive queue')
  /** Only the original send rejection fills this caller-owned observation. */
  let failure: unknown
  /** The real namespace hook starts and observes one cancelled closing write. */
  const off = left.onClosing(async () => {
    /** This genuine caller cancellation happens within the existing permitted grace period. */
    const cancellation = new AbortController()
    cancellation.abort(new Error('keepalive caller stopped'))
    failure = await left.table
      .send(pair.a.id, call(left, right), {
        keepalive: true,
        signal: cancellation.signal
      })
      .catch((error: unknown) => error)
  })
  try {
    await Promise.all([pair.first.ready, pair.second.ready])
    await pair.first.close(reason)
    expect(failure).toMatchObject({ code: RpcCoreErrorCode.endpointDisposed, cause: reason })
    expect(left.report).not.toHaveBeenCalled()
  } finally {
    off()
    await Promise.all([left.table.close(), right.table.close()])
  }
})

it('A40 closing a physically written pending ping reports no cancellation acknowledgment', async () => {
  /** Both original native Session owners first complete the genuine accepted handshake. */
  const left = await Host.create('closing-ping-a')
  const right = await Host.create('closing-ping-b')
  /** Closing capability uses the same native control conversion as real process transports. */
  const pair = connect(left, right, 'process', false, '', true)
  try {
    await Promise.all([pair.first.ready, pair.second.ready])
    pair.a.silentPing = true
    /** Observe rejection before close; the peer never answers this physically written control. */
    const pending = left.table
      .ping(pair.first, { timeoutMs: false })
      .catch((error: unknown) => error)
    await vi.waitFor(() =>
      expect(
        pair.a.written.some((frame) => frame.kind === 'control' && frame.operation === 'ping')
      ).toBe(true)
    )
    /** Pending controls keep the original close reason rather than a new lifecycle wrapper. */
    const reason = new Error('close with ping outstanding')
    await pair.first.close(reason)
    const failure = await pending
    expect(failure).toBe(reason)
    /** The original utility race owns its late rejection handler; no extra timer is needed. */
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(left.report).not.toHaveBeenCalled()
    expect(left.scheduler.pendingCount).toBe(0)
  } finally {
    await Promise.all([left.table.close(), right.table.close()])
  }
})

it('A45 errors delivered during native close keep their original cause after terminal selection', async () => {
  /** Real accepted native sources expose the existing SessionTable send boundary. */
  const left = await Host.create('immutable-close-a')
  /** Its peer owns the closing Session and lends the same unmodified table send interface. */
  const right = await Host.create('immutable-close-b')
  /** Accepted closing-capable resources preserve the same real handshake and native EOF path. */
  const pair = connect(left, right, 'process', false, '', true)
  /** Native completion follows the first EOF without replacing either caller-owned Error. */
  const terminal = deferred<unknown>()
  /** Native reason selection is observed before issuing the closing-window operation. */
  const selecting = deferred<void>()
  /** This initial native Error must remain reachable from the first delivered wrapper. */
  const eof = new Error('provisional physical EOF')
  /** Later native completion may replace the Session reason without changing delivered errors. */
  const final = new Error('selected native terminal reason')
  Object.assign(pair.b, {
    terminalReason: () => {
      selecting.resolve()
      return terminal.promise
    }
  })
  try {
    await Promise.all([pair.first.ready, pair.second.ready])
    await pair.a.close(eof)
    await selecting.promise
    /** Sending during the closing window receives its own wrapper with the current cause. */
    const first = await right.table
      .send(pair.b.id, call(right, left))
      .catch((error: unknown) => error)
    expect(first).toMatchObject({ code: RpcCoreErrorCode.endpointDisposed, cause: eof })
    terminal.resolve(final)
    await pair.second.closed
    expect(first).toMatchObject({ cause: eof })
    expect(eof).not.toHaveProperty('cause')
    expect(final).not.toHaveProperty('cause')
    expect(right.report).not.toHaveBeenCalled()
  } finally {
    terminal.resolve(final)
    await Promise.all([left.table.close(), right.table.close()])
  }
})
