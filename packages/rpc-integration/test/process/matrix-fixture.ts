import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { createUnitBudget } from '@migaia/supervision'
import {
  createPrewarmPool,
  createProcessSupervisor,
  type IProcessSpec
} from '@migaia/supervision/process'
import { PluginHost } from '@migaia/plugin-host'
import { serializeRpcError } from '@migaia/rpc-contract'
import { vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { createRuntimeEndpointComposition } from '../../../rpc-host/dist/core/runtime-api-endpoint.js'
import { abort } from '../../../rpc-host/dist/core/middleware/abort.js'
import { codec } from '../../../rpc-host/dist/core/middleware/codec.js'
import { connect } from '../../../rpc-host/dist/core/middleware/connect.js'
import { framer } from '../../../rpc-host/dist/core/middleware/framer.js'
import { ping } from '../../../rpc-host/dist/core/middleware/ping.js'
import { createNodeProcessLauncher } from '../../../rpc-plugin-process/src/process/adapters/node-child-process.js'
import { dialProcessByteChannel } from '../../../rpc-plugin-process/src/process/adapters/node-socket.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { processPlugin, type IProcessPluginOptions } from '@migaia/rpc-plugin-process'
import type {
  IProcessPluginEstablish,
  ISpawnProcessPluginDeployment,
  IConnectProcessPluginDeployment
} from '../../../rpc-plugin-process/dist/process/plugin/types.js'
import type { IRuntimeOutlet } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import type { IProcessPluginSession } from '../../../rpc-plugin-process/dist/process/plugin/types.js'
import type {
  IProcessByteChannel,
  IProcessByteOptions
} from '../../../rpc-plugin-process/dist/process/types.js'
import type { IRemoteContract } from '@migaia/rpc-host/plugin'
import type { IRemoteChannel, IRemoteServeEndpoint } from '@migaia/rpc-host/plugin'
import type { IRpcEndpoint } from '../../../rpc-host/dist/core/typing.js'
import type { IIpcLogRecord } from '@migaia/rpc-host/plugin'

/** The same contract is served by owned children and borrowed socket peers. */
export const MATRIX_CONTRACT: IRemoteContract = {
  schemaVersion: 1,
  plugin: 'p',
  features: {
    f: {
      methods: {
        request: { mode: 'request', idempotent: false },
        generator: { mode: 'async-generator', idempotent: false }
      }
    }
  }
}

/** Composes one canonical stream owner beside authenticated channel IPC. */
export async function matrixEndpoint(channel: IRemoteChannel): Promise<IRemoteServeEndpoint> {
  /** Reuse the physical installation used by genuine Host startup, including its original roots. */
  const { installing } = createRuntimeEndpointComposition(
    {
      id: 'parent',
      transport: channel.transport,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        ping()
      ],
      features: channel.features
    },
    channel
  )
  const endpoint = await installing
  return { endpoint: endpoint as unknown as IRpcEndpoint, stream: endpoint.stream }
}

/** Only original native process policy and test-owned file gates vary between matrix cases. */
type IMatrixInput = {
  maxUnits?: number
  warm?: boolean
  holdIdle?: boolean
  borrowed?: boolean
  gated?: boolean
  env?: Record<string, string>
}
/** Actual native launcher receipts remain the independent resource oracle. */
type IMatrixHandle = Awaited<ReturnType<ReturnType<typeof createNodeProcessLauncher>['launch']>>

/** Acquire only this fixture's directory before preparing the original native process source. */
export async function matrixFixture(input: IMatrixInput = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'i15-'))
  if (input.gated) await writeFile(join(directory, 'describe'), '')
  const fixture = new MatrixFixture(input, directory)
  await fixture.prepare()
  return fixture
}

/** Owns native fixture observations; PluginHost/RPC/supervision retain all runtime lifecycle. */
class MatrixFixture {
  /** Cold file/native policy never changes after preparation. */
  readonly #input: IMatrixInput
  /** Fixture bootstrap travels only through original stdin/handshake channels. */
  readonly #token = 'matrix-private-bootstrap'
  /** Borrowed external peer retains one test-local Unix address. */
  readonly #address: string
  /** Original launcher remains the actual process acquisition/termination authority. */
  readonly #nativeLauncher = createNodeProcessLauncher()
  /** Held idle termination receipts deliberately retain their original native lease. */
  readonly #delayedRetires = new Set<() => void>()
  /** Physical hello writes are observed without retaining authentication payloads. */
  #hellos = 0
  /** Actual outbound reserved directory frames prove setup cannot dispatch early business. */
  #describes = 0
  /** Actual outbound business frames prove closed generations do not send. */
  #business = 0
  /** All temporary gates and sockets remain owned by this fixture directory. */
  readonly directory: string
  /** Ordinary native PluginHost uses the existing SDK prepared transport installation. */
  readonly host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** The original virtual clock remains the sole owner of all native supervision deadlines. */
  readonly #clock = createManualScheduler()
  /** Passive schedule receipts locate real restart timing without replacing production policy. */
  readonly scheduled: { at: number; delay: number; fired: boolean }[] = []
  /** Supervision timers remain virtual; native deferred jobs retain their original host ordering. */
  readonly scheduler = {
    ...this.#clock,
    defer: systemScheduler.defer,
    schedule: (callback: () => void, delay: number) => {
      const receipt = { at: this.#clock.now(), delay, fired: false }
      this.scheduled.push(receipt)
      return this.#clock.schedule(() => {
        receipt.fired = true
        callback()
      }, delay)
    }
  }
  /** Actual process leases prove admission and teardown behavior. */
  readonly budget: ReturnType<typeof createUnitBudget<'process'>>
  /** Original spec identity is retained by native prewarm refill. */
  readonly spec: IProcessSpec
  /** Retained physical receipts expose real PIDs and exit promises. */
  readonly handles: IMatrixHandle[] = []
  /** Native termination calls establish exact resource ownership. */
  readonly terminations: { processId: string; mode: Parameters<IMatrixHandle['terminate']>[0] }[] =
    []
  /** Original/refill specs remain distinguishable by reference identity. */
  readonly launchedSpecs: IProcessSpec[] = []
  /** Full drained child stderr keeps original lifecycle marker order. */
  readonly chunks: string[] = []
  /** Caller drainage proves adopted prewarm output reaches its original observer once. */
  readonly callerChunks: string[] = []
  /** Original error objects retain primary and cleanup identity. */
  readonly reports: unknown[] = []
  /** Generation IPC logs retain original connection/session attribution. */
  readonly logs: IIpcLogRecord[] = []
  /** Actual authenticated establishment inputs retain physical session identity. */
  readonly sessions: IProcessPluginSession[] = []
  /** Original physical carriers allow EOF without fabricated supervisor events. */
  readonly rawChannels: IProcessByteChannel[] = []
  /** The observed launcher adds receipts only; native lifetime behavior remains unchanged. */
  readonly launcher: ReturnType<typeof createNodeProcessLauncher>
  /** Canonical prewarm pool owns its native idle units and refill order. */
  readonly pool: ReturnType<typeof createPrewarmPool<IMatrixHandle>> | undefined
  /** Existing method spies observe actual native pool operations. */
  readonly take: ReturnType<typeof vi.spyOn> | undefined
  /** Invalidation observation retains original call order and exact pool identity. */
  readonly invalidate: ReturnType<typeof vi.spyOn> | undefined
  /** Borrowed peer PID belongs to this separate external supervisor, not a client. */
  external: ReturnType<typeof createProcessSupervisor> | undefined
  /** Public native factory options contain no legacy remote contract/registration facade. */
  readonly settings: Pick<IProcessPluginOptions, 'name' | 'self' | 'report'>
  /** The exact full owned source remains available to failure injection cases. */
  readonly spawn: ISpawnProcessPluginDeployment<IMatrixHandle> | undefined
  /** The exact full borrowed source remains available to failure injection cases. */
  readonly connect: IConnectProcessPluginDeployment | undefined
  /** Public native options select one original full source without widening its fixture type. */
  readonly options: IProcessPluginOptions
  /** Genuine transport definition is installed directly through the ordinary native Host. */
  readonly plugin: ReturnType<typeof processPlugin>

  /** Capture native observations, policy and source before any public Host installation. */
  constructor(input: IMatrixInput, directory: string) {
    this.#input = input
    this.directory = directory
    this.#address = join(directory, 'peer.sock')
    this.budget = createUnitBudget({
      kind: 'process',
      maxUnits: input.maxUnits ?? 1,
      overflow: 'reject',
      launchRate: false,
      scheduler: this.scheduler
    })
    this.spec = {
      command: process.execPath,
      args: [join(import.meta.dirname, './fixtures/matrix-process-plugin-child.mjs')],
      env: {
        inherit: [],
        set: {
          ...input.env,
          ...(input.gated ? { RPC_DESCRIBE_GATE: join(directory, 'describe') } : {}),
          ...(input.borrowed ? { RPC_SOCKET: this.#address } : {})
        }
      },
      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
      bootstrap: { via: 'stdin', payload: new TextEncoder().encode(this.#token) }
    }
    this.launcher = {
      ...this.#nativeLauncher,
      launch: async (value, context) => {
        const handle = await this.#nativeLauncher.launch(value, {
          ...context,
          output: (stream, bytes) => {
            this.chunks.push(new TextDecoder().decode(bytes))
            context.output?.(stream, bytes)
          }
        })
        const index = this.handles.length
        this.handles.push(handle)
        this.launchedSpecs.push(value)
        return {
          ...handle,
          terminate: (mode) => {
            this.terminations.push({ processId: handle.identity.fingerprint, mode })
            if (input.holdIdle && index === 1)
              this.#delayedRetires.add(() => {
                void handle.terminate(mode)
              })
            else return handle.terminate(mode)
          }
        }
      }
    }
    this.pool = input.warm
      ? createPrewarmPool({
          id: 'matrix-pool',
          size: 1,
          spec: this.spec,
          budget: this.budget,
          launcher: this.launcher,
          isolation: 'best-effort',
          scheduler: this.scheduler,
          report: (error) => this.reports.push(error)
        })
      : undefined
    this.take = this.pool ? vi.spyOn(this.pool, 'take') : undefined
    this.invalidate = this.pool ? vi.spyOn(this.pool, 'invalidate') : undefined
    const common = {
      name: 'p',
      self: { name: 'parent', instanceId: 'parent' },
      report: (error: unknown) => this.reports.push(error)
    }
    this.settings = common
    this.spawn = input.borrowed ? undefined : this.#spawnSource()
    this.connect = input.borrowed ? this.#connectSource() : undefined
    this.options = this.connect
      ? { ...common, connect: { target: this.connect } }
      : { ...common, spawn: this.spawn! }
    this.plugin = processPlugin(this.options)
  }
  /** Start only the separately owned external peer for a borrowed-socket case. */
  async prepare(): Promise<void> {
    if (!this.#input.borrowed) return
    this.external = createProcessSupervisor({
      id: 'external-peer',
      spec: this.spec,
      launcher: this.launcher,
      budget: this.budget,
      isolation: 'best-effort',
      scheduler: this.scheduler,
      health: { check: async () => undefined },
      report: (error) => this.reports.push(error)
    })
    await this.external.start()
    await vi.waitFor(
      () => {
        if (!this.chunks.join('').includes('matrix:serving-ready'))
          throw new Error('listener not ready')
      },
      { timeout: 5000 }
    )
  }
  /** Authentication and session identity remain in the canonical process handshake. */
  #establish: IProcessPluginEstablish = async (raw, context) => {
    if (raw.kind !== 'byte') throw new TypeError('byte fixture required')
    this.sessions.push(context.session)
    const options: IProcessByteOptions = {
      role: 'initiator',
      offer: context.offer!,
      peerId: 'child',
      scheduler: context.scheduler,
      signal: context.signal as AbortSignal,
      ipc: {
        ...context.session,
        stderr: context.stderr,
        log: (event) => {
          this.logs.push(event)
        }
      },
      report: (error) => this.reports.push(error)
    }
    return createProcessTransport(raw, options)
  }
  /** Observe only this matrix's small original outgoing physical frames, before their actual write. */
  #tracked(raw: IProcessByteChannel): IProcessByteChannel {
    return {
      ...raw,
      write: async (bytes) => {
        const text = new TextDecoder().decode(bytes)
        if (text.includes('"step":"hello"')) this.#hellos += 1
        if (
          text.includes('"kind":"request"') &&
          text.includes('"method":"migaia.remote.runtime.describe"')
        )
          this.#describes += 1
        if (text.includes('"method":"p.f.request"') || text.includes('"method":"p.f.generator"'))
          this.#business += 1
        return raw.write(bytes)
      }
    }
  }
  /** Original managed child source retains lease/prewarm and caller stderr ownership. */
  #spawnSource(): ISpawnProcessPluginDeployment<IMatrixHandle> {
    return {
      kind: 'spawn',
      channelKind: 'byte',
      wire: 'native',
      token: this.#token,
      supervision: {
        id: 'matrix-child',
        spec: this.spec,
        launcher: this.launcher,
        budget: this.budget,
        prewarm: this.pool,
        scheduler: this.scheduler,
        isolation: 'best-effort',
        health: { check: async () => undefined },
        output: {
          onChunk: (_stream, bytes) => this.callerChunks.push(new TextDecoder().decode(bytes))
        },
        restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 2 },
        report: (error) => this.reports.push(error)
      },
      rawChannel: async (handle) => {
        const raw = handle.channel!
        this.rawChannels.push(raw)
        return this.#tracked(raw)
      },
      establish: this.#establish
    }
  }
  /** Borrowed clients own only their local sockets while the external PID remains live. */
  #connectSource(): IConnectProcessPluginDeployment {
    return {
      kind: 'connect',
      address: this.#address,
      token: this.#token,
      supervision: {
        scheduler: this.scheduler,
        health: { check: async () => undefined },
        restart: { mode: 'always', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 2 }
      },
      dial: async (address, signal) => {
        const raw = await dialProcessByteChannel({ address, signal: signal as AbortSignal })
        this.rawChannels.push(raw)
        return this.#tracked(raw)
      },
      establish: this.#establish
    }
  }
  /** Original native SDK slot is returned directly, with no fixture forwarding facade. */
  get outlet(): IRuntimeOutlet {
    return Reflect.get(this.host, 'process') as IRuntimeOutlet
  }
  /** Physical startup observations remain independent of client in-flight counts. */
  get hellos() {
    return this.#hellos
  }
  /** Directory writes are counted at the actual outgoing carrier boundary. */
  get describes() {
    return this.#describes
  }
  /** Business write observations prove rejection happened before physical dispatch. */
  get business() {
    return this.#business
  }
  /** Open only this fixture's next file gate. */
  gate = (name: string) => writeFile(join(this.directory, name), '')
  /** Remove only this fixture's controlled gate so a later generation blocks again. */
  closeGate = (name: string) => rm(join(this.directory, name), { force: true })
  /** Release the deliberately retained native idle lease in original insertion order. */
  releaseIdle = (): void => {
    for (const release of this.#delayedRetires) release()
    this.#delayedRetires.clear()
  }
  /** Native Host closes before pool/external ownership, preserving original physical cleanup order. */
  cleanup = async (): Promise<void> => {
    this.releaseIdle()
    await this.host.dispose()
    await this.pool?.dispose()
    await this.external?.dispose()
    const receiptDirectory = process.env.I15_MATRIX_RECEIPTS
    if (receiptDirectory) {
      await mkdir(receiptDirectory, { recursive: true })
      await writeFile(
        join(receiptDirectory, `${basename(this.directory)}.json`),
        JSON.stringify(
          {
            stderr: this.chunks.join(''),
            callerStderr: this.callerChunks.join(''),
            helloCount: this.#hellos,
            describeCount: this.#describes,
            businessCount: this.#business,
            sessions: this.sessions,
            /**
             * Exact existing reports are serialized with full native chain and private token
             * redaction.
             */
            reports: this.reports.map((error) => ({
              ...JSON.parse(
                JSON.stringify(serializeRpcError(error, { report: () => undefined })).replaceAll(
                  this.#token,
                  '<redacted>'
                )
              ),
              reason:
                error && typeof error === 'object'
                  ? (Reflect.get(error, 'reason') ?? Reflect.get(error, 'detail')?.reason ?? null)
                  : null
            })),
            children: this.handles.map((handle) => handle.identity),
            terminations: this.terminations,
            budgetInUse: this.budget.inUse,
            schedulerNow: this.#clock.now(),
            scheduled: this.scheduled
          },
          null,
          2
        )
      )
    }
    await rm(this.directory, { recursive: true, force: true })
  }
}
