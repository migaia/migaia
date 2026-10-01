import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { createUnitBudget } from '@migaia/supervision'
import {
  createPrewarmPool,
  createProcessSupervisor,
  type IProcessSpec
} from '@migaia/supervision/process'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createCanonicalChunkFeature } from '../../src/core/features/canonical-chunk.js'
import { createControlFeature } from '../../src/core/features/control.js'
import { createDiscoveryFeature } from '../../src/core/features/discovery.js'
import { createOutboundFeature } from '../../src/core/features/outbound.js'
import { createProviderFeature } from '../../src/core/features/provider.js'
import { createStreamFeature } from '../../src/core/features/stream.js'
import { abort } from '../../src/core/middleware/abort.js'
import { codec } from '../../src/core/middleware/codec.js'
import { connect } from '../../src/core/middleware/connect.js'
import { framer } from '../../src/core/middleware/framer.js'
import { ping } from '../../src/core/middleware/ping.js'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { dialProcessByteChannel } from '../../src/process/adapters/node-socket.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import type {
  IProcessPluginOptions,
  IProcessPluginSession
} from '../../src/process/plugin/types.js'
import type { IProcessByteChannel } from '../../src/process/types.js'
import type { IRemoteContract } from '../../src/remote/contract.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../src/remote/types.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import type { IIpcLogRecord } from '../../src/core/plugins/flow-control.js'

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

/** The test uses the actual remote proxy request and stream API. */
export type IMatrixFeature = {
  request(params: unknown[], options?: { signal?: AbortSignal }): Promise<unknown>
  generator(params: unknown[], options?: { signal?: AbortSignal }): AsyncIterableIterator<unknown>
}

/** Composes one canonical stream owner beside authenticated channel IPC. */
export async function matrixEndpoint(channel: IRemoteChannel): Promise<IRemoteServeEndpoint> {
  /** Root objects belong to this endpoint alone. */
  const chunk = createCanonicalChunkFeature()
  /** The canonical outbound owner shares only this endpoint chunk state. */
  const outbound = createOutboundFeature(chunk)
  /** Discovery attaches to the endpoint outbound owner. */
  const discovery = createDiscoveryFeature(outbound)
  /** Control operations reuse the same discovery and outbound owners. */
  const control = createControlFeature(outbound, discovery)
  /** Provider registrations belong to this endpoint lifetime. */
  const provider = createProviderFeature(outbound)
  /** The negotiated transport is composed with dedicated stream roots. */
  const endpoint = await createComposedEndpoint(
    {
      id: 'parent',
      transport: channel.transport,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        ping()
      ]
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-discovery': discovery,
      'first-party-control': control,
      'first-party-provider': provider,
      'first-party-stream': createStreamFeature(outbound, provider),
      'channel-ipc-log': channel.features[0]!,
      'channel-ipc-gate': channel.features[1]!
    }
  )
  return { endpoint: endpoint as unknown as IRpcEndpoint, stream: endpoint.stream }
}

/** Exact file gates control actual OS child startup, never a replacement protocol implementation. */
export async function matrixFixture(
  input: {
    maxUnits?: number
    warm?: boolean
    holdIdle?: boolean
    borrowed?: boolean
    gated?: boolean
    env?: Record<string, string>
  } = {}
) {
  /** File gates and the Unix socket live in this test-owned temporary directory. */
  const directory = await mkdtemp(join(tmpdir(), 'i15-'))
  /** The parent Host owns registration, suspension, and replacement. */
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** The parent clock drives only canonical supervision timers. */
  const scheduler = createManualScheduler()
  /** Real process leases enforce each replacement admission case. */
  const budget = createUnitBudget({
    kind: 'process',
    maxUnits: input.maxUnits ?? 1,
    overflow: 'reject',
    launchRate: false,
    scheduler
  })
  /** Private fixture bootstrap is transmitted only over stdin or the handshake. */
  const token = 'matrix-private-bootstrap'
  /** The borrowed peer listens on one test-local Unix socket. */
  const address = join(directory, 'peer.sock')
  if (input.gated) await writeFile(join(directory, 'describe'), '')
  /** The exact spec is also retained by the prewarm pool for refill identity. */
  const spec: IProcessSpec = {
    command: process.execPath,
    args: [join(import.meta.dirname, 'fixtures/matrix-process-plugin-child.mjs')],
    env: {
      inherit: [],
      set: {
        ...input.env,
        ...(input.gated ? { RPC_DESCRIBE_GATE: join(directory, 'describe') } : {}),
        ...(input.borrowed ? { RPC_SOCKET: address } : {})
      }
    },
    stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
    bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
  }
  /** The production Node launcher owns child process termination. */
  const nativeLauncher = createNodeProcessLauncher()
  /** Launched physical handles prove exit and process identity. */
  const handles: Awaited<ReturnType<typeof nativeLauncher.launch>>[] = []
  /** Spec identity distinguishes replacement launches from original-spec refill. */
  const launchedSpecs: IProcessSpec[] = []
  /** One selected idle process keeps its real lease until the test releases termination. */
  const delayedRetires: (() => void)[] = []
  /** Drained child stderr provides ordered lifecycle markers. */
  const chunks: string[] = []
  /** Caller stderr drainage must receive adopted output exactly once. */
  const callerChunks: string[] = []
  /** Original cleanup errors remain observable by identity. */
  const reports: unknown[] = []
  /** IPC records prove generation-specific stderr attribution. */
  const logs: IIpcLogRecord[] = []
  /** Each authenticated session records its physical channel identity. */
  const sessions: IProcessPluginSession[] = []
  /** Host callbacks expose suspension and replacement order. */
  const timeline: string[] = []
  /** Only output observation and one retiring lease are added to the production launcher. */
  const launcher: typeof nativeLauncher = {
    ...nativeLauncher,
    launch: async (value, context) => {
      /** The physical launch result remains the owned process handle. */
      const handle = await nativeLauncher.launch(value, {
        ...context,
        output: (stream, bytes) => {
          chunks.push(new TextDecoder().decode(bytes))
          context.output?.(stream, bytes)
        }
      })
      /** The second child is the idle prewarm lease used by the budget case. */
      const index = handles.length
      handles.push(handle)
      launchedSpecs.push(value)
      return input.holdIdle && index === 1
        ? {
            ...handle,
            terminate: (mode) => {
              delayedRetires.push(() => {
                void handle.terminate(mode)
              })
            }
          }
        : handle
    }
  }
  /** The canonical pool owns warm processes and original-spec refill. */
  const pool = input.warm
    ? createPrewarmPool({
        id: 'matrix-pool',
        size: 1,
        spec,
        budget,
        launcher,
        isolation: 'best-effort',
        scheduler,
        report: (error) => reports.push(error)
      })
    : undefined
  /** Pool take observation proves replacement never consumes a warm entry. */
  const take = pool ? vi.spyOn(pool, 'take') : undefined
  /** Pool invalidation must precede start-switch delegation. */
  const invalidate = pool ? vi.spyOn(pool, 'invalidate') : undefined
  /** Replacement delegates to the real Host exactly once. */
  const hostReplace = vi.fn(async (name: string, candidate: Parameters<typeof host.replace>[1]) => {
    timeline.push('replace')
    return host.replace(name, candidate)
  })
  /** Generation loss suspends dependencies through the real Host. */
  const disable = vi.fn((name: string, policy: { readonly policy: 'suspend' }) => {
    timeline.push('disable')
    return host.plugin.disable(name, policy)
  })
  /** Only verified replacement readiness resumes the existing dependencies. */
  const enable = vi.fn((name: string) => {
    timeline.push('enable')
    return host.plugin.enable(name)
  })
  /** Physical channels allow EOF without synthesizing supervisor events. */
  const rawChannels: IProcessByteChannel[] = []
  /** Actual hello emission count, with no wire payload retention. */
  let hellos = 0
  /** Describe dispatch count across verified generations. */
  let describes = 0
  /** Business sends prove closed proxies emit no requests. */
  let business = 0
  /** The borrowed server process has an independent external owner. */
  let external: ReturnType<typeof createProcessSupervisor> | undefined
  /** Only the external owner controls the borrowed peer process. */
  if (input.borrowed) {
    external = createProcessSupervisor({
      id: 'external-peer',
      spec,
      launcher,
      budget,
      isolation: 'best-effort',
      scheduler,
      health: { check: async () => undefined },
      report: (error) => reports.push(error)
    })
    await external.start()
    await vi.waitFor(
      () => {
        if (!chunks.join('').includes('matrix:serving-ready')) throw new Error('listener not ready')
      },
      { timeout: 5000 }
    )
  }
  /** The production handshake negotiates each observed physical channel. */
  const establish: IProcessPluginOptions['deployment']['establish'] = async (raw, context) => {
    if (raw.kind !== 'byte') throw new TypeError('byte fixture required')
    sessions.push(context.session)
    return createProcessTransport(raw, {
      role: 'initiator',
      offer: context.offer!,
      peerId: 'child',
      scheduler: context.scheduler,
      signal: context.signal as AbortSignal,
      ipc: {
        ...context.session,
        stderr: context.stderr,
        log: (event) => {
          logs.push(event)
        }
      },
      report: (error) => reports.push(error)
    })
  }
  /** Count actual wire hello and endpoint dispatch; business frames cannot escape a closed proxy. */
  const tracked = (raw: IProcessByteChannel): IProcessByteChannel => ({
    ...raw,
    write: async (bytes) => {
      if (new TextDecoder().decode(bytes).includes('"step":"hello"')) hellos += 1
      return raw.write(bytes)
    }
  })
  /** Both deployment modes consume the same canonical plugin and endpoint contract. */
  const options: IProcessPluginOptions = {
    name: 'p',
    contract: MATRIX_CONTRACT,
    registrationOwner: { name: 'p', host },
    host: { disable, enable, replace: hostReplace },
    report: (error) => reports.push(error),
    deployment: input.borrowed
      ? {
          kind: 'connect',
          address,
          token,
          offer: createNativeProcessOffer({
            peer: { id: 'parent', runtime: 'node' },
            auth: token,
            stream: true
          }),
          supervision: {
            scheduler,
            health: { check: async () => undefined },
            restart: { mode: 'always', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 2 }
          },
          dial: async (path, signal) => {
            const raw = await dialProcessByteChannel({
              address: path,
              signal: signal as AbortSignal
            })
            rawChannels.push(raw)
            return tracked(raw)
          },
          establish
        }
      : {
          kind: 'spawn',
          channelKind: 'byte',
          wire: 'native',
          token,
          offer: createNativeProcessOffer({
            peer: { id: 'parent', runtime: 'node' },
            auth: token,
            stream: true
          }),
          supervision: {
            id: 'matrix-child',
            spec,
            launcher,
            budget,
            prewarm: pool,
            scheduler,
            isolation: 'best-effort',
            health: { check: async () => undefined },
            output: {
              onChunk: (_stream, bytes) => callerChunks.push(new TextDecoder().decode(bytes))
            },
            restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 2 },
            report: (error) => reports.push(error)
          },
          rawChannel: async (handle) => {
            const raw = (handle as Awaited<ReturnType<typeof nativeLauncher.launch>>).channel!
            rawChannels.push(raw)
            return tracked(raw)
          },
          establish
        },
    endpointFactory: async (channel) => {
      /** The dedicated endpoint is owned by one generation. */
      const served = await matrixEndpoint(channel)
      /** The negotiated transport is composed with dedicated stream roots. */
      const endpoint = served.endpoint
      return {
        ...served,
        endpoint: {
          ...endpoint,
          send: (peer, method, params, sendOptions) => {
            if (method === 'migaia.remote.describe') describes += 1
            else if (method.startsWith('p.f.')) business += 1
            return endpoint.send(peer, method, params, sendOptions)
          }
        }
      }
    }
  }
  /** The public process plugin is the only parent registration entry point. */
  const plugin = createProcessPlugin(options)
  return {
    directory,
    host,
    scheduler,
    budget,
    spec,
    launcher,
    options,
    plugin,
    pool,
    take,
    invalidate,
    handles,
    launchedSpecs,
    sessions,
    logs,
    reports,
    chunks,
    callerChunks,
    timeline,
    disable,
    enable,
    hostReplace,
    rawChannels,
    external,
    gate: (name: string) => writeFile(join(directory, name), ''),
    closeGate: (name: string) => rm(join(directory, name), { force: true }),
    releaseIdle: () => {
      for (const release of delayedRetires.splice(0)) release()
    },
    get hellos() {
      return hellos
    },
    get describes() {
      return describes
    },
    get business() {
      return business
    },
    cleanup: async () => {
      for (const release of delayedRetires.splice(0)) release()
      await host.dispose()
      await pool?.dispose()
      await external?.dispose()
      /**
       * Optional ignored receipts preserve complete drained child stderr without native auth
       * frames.
       */
      const receiptDirectory = process.env.I15_MATRIX_RECEIPTS
      if (receiptDirectory) {
        await mkdir(receiptDirectory, { recursive: true })
        await writeFile(
          join(receiptDirectory, `${basename(directory)}.json`),
          JSON.stringify(
            {
              stderr: chunks.join(''),
              callerStderr: callerChunks.join(''),
              timeline,
              helloCount: hellos,
              describeCount: describes,
              businessCount: business,
              sessions,
              children: handles.map((handle) => handle.identity),
              budgetInUse: budget.inUse
            },
            null,
            2
          )
        )
      }
      await rm(directory, { recursive: true, force: true })
    }
  }
}

/** Captures the installed remote proxy without rebuilding it after generation changes. */
export function matrixDependency(fixture: Awaited<ReturnType<typeof matrixFixture>>) {
  const install = vi.fn(() => ({}))
  let feature!: IMatrixFeature
  let immediate!: Promise<unknown>
  const definition = definePlugin({
    name: 'dependent',
    features: {
      use: defineFeature(
        (_core, dependencies) => {
          feature = dependencies.remote as IMatrixFeature
          immediate = feature.request(['ready'])
          return {}
        },
        { remote: fixture.plugin.getFeature('f') }
      )
    },
    install
  })
  return {
    definition,
    install,
    get feature() {
      return feature
    },
    get immediate() {
      return immediate
    }
  }
}
