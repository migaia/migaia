import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { expect } from 'vitest'
import { createRpcStreamFrameDecoder } from '@migaia/rpc/contract/framing/stream'
import { PluginHost } from '@migaia/plugin-host'
import { createUnitBudget, type IUnitBudget } from '@migaia/supervision'
import type { IProcessHandle } from '@migaia/supervision/process'
import { createProcessTransport, createNativeProcessOffer } from '@migaia/rpc/process'
import {
  createProcessPlugin,
  type IProcessByteChannel,
  type IProcessPluginOptions
} from '@migaia/rpc/process'
import { createProcessHost } from '@migaia/rpc/process'
import { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'
import { dialProcessByteChannel } from '@migaia/rpc/process/adapters/node-socket'
import type { IRemoteContract, IRemoteServeEndpoint } from '@migaia/rpc/remote'
import { endpointFor, bridgeEndpointFor } from '../peers/ts/runtime.js'
import { fdLauncher } from '../../bridge/fixtures/jsonrpc-process.js'
import { createJsonRpcRemoteChannel } from '@migaia/rpc/bridge/jsonrpc'
import { RpcError, RpcCoreErrorCode } from '@migaia/rpc/core'
import { RpcCoreErrorText } from '../../../src/core/error-text.js'
import { createProcessPeer } from '../../../src/process/adapters/node-peer.js'
import {
  readRuntimePeerConnection,
  prepareRuntimePeerSourceContext
} from '../../../src/remote/runtime-api/peer.js'

/** Portable business outputs are observed on the provider, never inferred from send completion. */
const expected = JSON.parse(
  await readFile(new URL('../peers/ts/public-behavior.json', import.meta.url), 'utf8')
)
/** Every failing run retains full process output and received frames outside ignored docs. */
const evidence = process.env.RPC_H_EVIDENCE ?? '/tmp/m2-h-evidence'
mkdirSync(evidence, { recursive: true })
/** Published vectors freeze actual facade deployments and ownership expectations. */
const businessVectors = JSON.parse(
  await readFile(new URL('../../../schema/vectors/process-business.json', import.meta.url), 'utf8')
)
/** One published contract is shared by all independent producers and the public client facades. */
const contract = JSON.parse(
  await readFile(new URL('../../../schema/vectors/remote-contract.json', import.meta.url), 'utf8')
).contracts[0].value as IRemoteContract
/** The bridge's published contract deliberately contains only its two supported modes. */
const bridgeContract: IRemoteContract = {
  ...contract,
  features: {
    f: {
      methods: {
        request: contract.features.f!.methods.request!,
        oneWay: contract.features.f!.methods.oneWay!
      }
    }
  }
}
/** Emit the public TS fixture before launch; Node and Bun execute the same JavaScript artifact. */
const compiledTsPeer = execFileSync(
  process.execPath,
  [new URL('../peers/ts/node-runner.mjs', import.meta.url).pathname, '--executable'],
  { encoding: 'utf8' }
).trim()
/**
 * Four public/independent executables run directly, without language wrapping or protocol
 * forwarding.
 */
const peers = [
  {
    language: 'python',
    command: 'python3',
    args: ['-B', new URL('../peers/python/peer.py', import.meta.url).pathname, '--business'],
    id: 'python-peer'
  },
  {
    language: 'go',
    command: 'sh',
    args: [new URL('../peers/go/run.sh', import.meta.url).pathname, '--business'],
    id: 'go-peer'
  },
  {
    language: 'rust',
    command: 'sh',
    args: [new URL('../peers/rust/run.sh', import.meta.url).pathname, '--business'],
    id: 'rust-peer'
  },
  {
    language: 'node',
    command: process.execPath,
    args: [compiledTsPeer],
    id: 'ts-peer'
  },
  {
    language: 'bun',
    command: 'bun',
    args: [compiledTsPeer],
    id: 'ts-peer'
  }
]
/** Real feature calls use the public facade's contract-projected methods. */
type IBusinessFeature = {
  request(
    params: unknown[],
    options?: { signal?: AbortSignal; timeoutMs?: number; idempotencyKey?: string }
  ): Promise<unknown>
  oneWay(params: unknown[]): Promise<void>
  generator(params: unknown[]): AsyncIterable<unknown>
  asyncGenerator(params: unknown[]): AsyncIterable<unknown>
}
/** Native proposal is produced by the package and includes every control exercised below. */
const offer = createNativeProcessOffer({
  peer: { id: 'caller', runtime: 'node' },
  stream: true,
  capabilities: ['abort@1', 'wire-error@1']
})
/** Deployment creation retains actual handles and raw outputs for release and error attribution. */
function deployment(
  peer: (typeof peers)[number],
  host: boolean,
  token: string,
  address?: string,
  bridge = false,
  budget?: IUnitBudget<'process'>
) {
  /** Independent U36 peers removed RPC bridge support; never launch their obsolete profile. */
  if (bridge && ['python', 'go', 'rust'].includes(peer.language))
    throw new RpcError(
      RpcCoreErrorCode.capabilityUnsupported,
      RpcCoreErrorText.capabilityUnsupported
    )
  const handles: IProcessHandle[] = []
  const output: Uint8Array[] = []
  const stdout: Uint8Array[] = []
  /** An observer retains emitted wire frames without implementing framing or changing backpressure. */
  const sent: Uint8Array[] = []
  const reports: unknown[] = []
  /** Exact public byte ports permit a physical EOF independent of endpoint abort/close messages. */
  const rawChannels: IProcessByteChannel[] = []
  const launcher = bridge ? fdLauncher() : createNodeProcessLauncher()
  /** Build with the real tool environment before the existing FD fixture's intentionally empty env. */
  const executable =
    bridge && (peer.language === 'go' || peer.language === 'rust')
      ? {
          command: execFileSync('sh', [peer.args[0]!, '--executable'], { encoding: 'utf8' }).trim(),
          args: peer.args.slice(1)
        }
      : peer
  const establish: IProcessPluginOptions['deployment']['establish'] = (raw, context) => {
    if (raw.kind !== 'byte') throw new TypeError('business peer requires bytes')
    rawChannels.push(raw)
    raw.onData((chunk) => stdout.push(chunk.slice()))
    const observed = {
      ...raw,
      write: async (chunk: Uint8Array) => {
        sent.push(chunk.slice())
        await raw.write(chunk)
      }
    }
    if (bridge)
      return createJsonRpcRemoteChannel({
        byte: observed,
        peerId: peer.id,
        target: host
          ? { kind: 'host', catalog: { p: bridgeContract } }
          : { kind: 'plugin', contract: bridgeContract },
        offer: {
          versions: [{ major: 1, minor: 1 }],
          capabilities: ['deadline@1', 'trace@1', 'idempotency@1'],
          peer: { id: 'caller', runtime: 'node' }
        },
        token,
        scheduler: context.scheduler,
        wallClock: { timestamp: () => Date.now() },
        signal: context.signal as AbortSignal,
        report: (error) => reports.push(error),
        ipc: { ...context.session, log: () => undefined }
      }).then((channel) => {
        return channel
      })
    return createProcessTransport(observed, {
      role: 'initiator',
      peerId: peer.id,
      offer: context.offer!,
      scheduler: context.scheduler,
      signal: context.signal as AbortSignal,
      report: (error) => reports.push(error),
      ipc: { ...context.session, log: () => undefined }
    })
  }
  const proposal = bridge
    ? {
        versions: [{ major: 1, minor: 1 }],
        codecs: ['json'],
        capabilities: [
          'jsonrpc-bridge@1',
          'abort@1',
          'wire-error@1',
          'deadline@1',
          'trace@1',
          'idempotency@1'
        ],
        peer: { id: 'caller', runtime: 'node' },
        auth: token
      }
    : { ...offer, auth: token }
  const selected: IProcessPluginOptions['deployment'] = address
    ? {
        kind: 'connect',
        wire: bridge ? 'jsonrpc' : 'native',
        address,
        token,
        offer: proposal,
        dial: (target, signal) =>
          dialProcessByteChannel({ address: target, signal: signal as AbortSignal }),
        establish
      }
    : {
        kind: 'spawn',
        channelKind: 'byte',
        wire: bridge ? 'jsonrpc' : 'native',
        token,
        offer: proposal,
        supervision: {
          id: `business-${peer.language}`,
          isolation: 'best-effort',
          budget: budget ?? createUnitBudget({ kind: 'process', maxUnits: 1 }),
          report: (error) => reports.push(error),
          spec: {
            command: executable.command,
            args: [
              ...executable.args,
              '--stdio',
              ...(bridge ? ['--jsonrpc', '--auth-fd', '3'] : ['--bootstrap', 'stdin']),
              ...(host ? ['--host'] : [])
            ],
            env: { inherit: ['PATH'], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: bridge
              ? { via: 'fd', fd: 3, payload: new TextEncoder().encode(token) }
              : { via: 'stdin', payload: new TextEncoder().encode(token) }
          },
          launcher: {
            ...launcher,
            launch: async (spec, context) => {
              const handle = await launcher.launch(spec, {
                ...context,
                output: (stream, chunk) => {
                  if (stream === 'stderr') output.push(chunk.slice())
                  context.output(stream, chunk)
                }
              })
              handles.push(handle)
              return handle
            }
          }
        },
        rawChannel: async (handle) => {
          if (!('channel' in handle)) throw new TypeError('business handle requires channel')
          return handle.channel as IProcessByteChannel
        },
        establish
      }
  return { selected, handles, output, stdout, sent, reports, rawChannels }
}
/**
 * Install the public processPlugin or processHost and retain its exact composed endpoint for
 * control observations.
 */
async function client(
  peer: (typeof peers)[number],
  hostProfile: boolean,
  token: string,
  address?: string,
  bridge = false,
  budget?: IUnitBudget<'process'>
) {
  const fixture = deployment(peer, hostProfile, token, address, bridge, budget)
  /** Independent peers exchange v2 directories; no v1 contract parser participates. */
  if (!bridge && ['python', 'go', 'rust'].includes(peer.language)) {
    /** Source identity and capabilities belong to the canonical runtime Peer preparation. */
    const self = { name: 'caller', instanceId: 'caller' }
    /** Existing native proposal retains physical controls while requiring the new runtime baseline. */
    const source = {
      ...fixture.selected,
      offer: {
        ...fixture.selected.offer!,
        capabilities: prepareRuntimePeerSourceContext(self).capabilities
      }
    }
    /** Native supervision, budgets, channel ownership and provider roots remain production-owned. */
    const active = await createProcessPeer({
      self,
      ...(source.kind === 'spawn' ? { spawn: source } : { connect: source }),
      report: (error) => fixture.reports.push(error)
    })
    /** The actual selected runtime exposes its original core controls to existing observations. */
    const accepted = readRuntimePeerConnection(active)
    /** Pure fixture method projections exercise the current production caller, not a legacy facade. */
    const feature: IBusinessFeature = {
      request: (params, options) => active.request('p.f.request', params, options),
      oneWay: (params) => active.notify('p.f.oneWay', params),
      generator: (params) => active.stream('p.f.generator', params),
      asyncGenerator: (params) => active.stream('p.f.asyncGenerator', params)
    }
    if (hostProfile) await active.request('migaia.remote.host.use', ['p', { local: 'value' }])
    return {
      ...fixture,
      feature,
      runtime: {
        endpoint: accepted.endpoint,
        oneWay: accepted.endpoint,
        stream: accepted.endpoint.stream
      },
      close: active.close,
      remove: hostProfile ? () => active.request('migaia.remote.host.unUse', ['p']) : undefined,
      inspect: hostProfile ? () => active.request('migaia.remote.host.inspect', []) : undefined
    }
  }
  const selectedContract = bridge ? bridgeContract : contract
  let runtime: IRemoteServeEndpoint | undefined
  const endpointFactory = async (channel: Parameters<typeof endpointFor>[0]) => {
    runtime = await (bridge ? bridgeEndpointFor : endpointFor)(channel, 'caller')
    return runtime
  }
  const local = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  if (hostProfile) {
    const facade = createProcessHost({
      catalog: { p: selectedContract },
      deployment: fixture.selected,
      endpointFactory,
      report: (error) => fixture.reports.push(error)
    })
    try {
      await facade.ready()
      const installed = await facade.use('p', { local: 'value' })
      expect(await facade.inspect()).toMatchObject({ plugins: [{ name: 'p' }] })
      return {
        ...fixture,
        feature: installed.f as unknown as IBusinessFeature,
        runtime: runtime!,
        close: () => facade.release(),
        remove: () => facade.unUse('p'),
        inspect: () => facade.inspect()
      }
    } catch (error) {
      await facade.release()
      throw error
    }
  }
  const definition = createProcessPlugin({
    name: 'p',
    contract: selectedContract,
    registrationOwner: { name: 'p', host: local },
    host: local.plugin,
    deployment: fixture.selected,
    endpointFactory,
    report: (error) => fixture.reports.push(error)
  })
  try {
    const [installed] = await local.use(definition)
    return {
      ...fixture,
      feature: installed!.getFeature('f') as unknown as IBusinessFeature,
      runtime: runtime!,
      close: async () => {
        await local.dispose()
      },
      remove: undefined,
      inspect: undefined
    }
  } catch (error) {
    await local.dispose()
    throw error
  }
}
/**
 * Facade methods prove actual request/one-way/stream behavior; same endpoint observes error and
 * cancellation controls.
 */
async function business(
  active: Awaited<ReturnType<typeof client>>,
  peerId: string,
  bridge = false
) {
  const { feature, runtime } = active
  expect(
    await feature.request(
      [expected.request.input],
      bridge ? { timeoutMs: 1000, idempotencyKey: 'h-bridge-key' } : undefined
    )
  ).toBe(expected.request.expected)
  for (const input of expected.oneWay.inputs) await feature.oneWay([input])
  expect(await runtime.endpoint.send(peerId, 'peer.received', [])).toEqual(expected.oneWay.expected)
  for (const method of (bridge ? [] : ['generator', 'asyncGenerator']) as Array<
    'generator' | 'asyncGenerator'
  >) {
    const values: unknown[] = []
    for await (const value of feature[method]([expected.generator.input])) values.push(value)
    expect(values).toEqual(expected.generator.expected)
  }
  let receivedError: unknown
  await expect(
    runtime.endpoint.send(peerId, 'peer.error', []).catch((error) => {
      receivedError = error
      throw error
    })
  ).rejects.toMatchObject(expected.error)
  expect((receivedError as { name: string }).name).toMatch(/^Rpc/)
  const failedWire = bridge
    ? bridgeFrames(active.stdout).find((frame) => frame.error)?.error.data.migaiaWireError
    : wireFrames(active.stdout).find(
        (frame) =>
          frame.kind === 'response' &&
          frame.ok === false &&
          frame.data.route.method === 'peer.error'
      )?.error
  expect(failedWire).toBeDefined()
  assertWireGraph((receivedError as { cause: unknown }).cause, failedWire)
  const controller = new AbortController()
  const waiting = bridge
    ? feature.request(['__wait'], { signal: controller.signal })
    : runtime.endpoint.send(peerId, 'peer.wait', [], { signal: controller.signal })
  await new Promise((resolve) => setTimeout(resolve, 20))
  controller.abort(new RangeError(expected.cancel.reason))
  await expect(waiting).rejects.toMatchObject({ code: expected.cancel.expectedCode })
  expect(await runtime.endpoint.send(peerId, 'peer.aborts', [])).toMatchObject([
    expected.cancel.providerReason
  ])
  expect(await feature.request(['after-cancel'])).toBe('after-cancel')
  if (bridge)
    expect(
      active.reports.filter(
        (error) => (error as { source?: string }).source === '@migaia/rpc/bridge/jsonrpc'
      )
    ).toEqual([
      expect.objectContaining({
        source: '@migaia/rpc/bridge/jsonrpc',
        code: 'JSONRPC_PROFILE_INVALID'
      })
    ])
  /** Explicit core trace remains request-local; facade invocations above never gain a trace. */
  expect(
    await Promise.all([
      runtime.endpoint.send(peerId, 'peer.trace', [], { trace: 'h-trace-one' }),
      runtime.endpoint.send(peerId, 'peer.trace', [], { trace: 'h-trace-two' }),
      runtime.endpoint.send(peerId, 'peer.trace', [])
    ])
  ).toEqual(['h-trace-one', 'h-trace-two', null])
  if (!bridge)
    expect(await runtime.endpoint.ping!(peerId, undefined, { timeoutMs: 1000 })).toBe(true)
  if (active.remove) {
    expect(await active.remove()).toEqual({ ok: true })
    expect(await active.inspect!()).toMatchObject({ plugins: [] })
    await expect(feature.request(['old'])).rejects.toMatchObject({ code: 'REMOTE_CLOSED' })
  }
}

/** Decode observed bytes exclusively with the published framing owner. */
function bridgeFrames(chunks: readonly Uint8Array[]) {
  /** This observer decodes retained receipts only; production bridge owns all live framing. */
  let bytes = Buffer.concat(chunks)
  const messages: any[] = []
  while (bytes.length) {
    const end = bytes.indexOf('\r\n\r\n')
    expect(end).toBeGreaterThan(-1)
    const length = Number(/Content-Length: (\d+)/i.exec(bytes.subarray(0, end).toString())![1])
    expect(bytes.length).toBeGreaterThanOrEqual(end + 4 + length)
    messages.push(JSON.parse(bytes.subarray(end + 4, end + 4 + length).toString()))
    bytes = bytes.subarray(end + 4 + length)
  }
  return messages
}
/** Native receipts use the package's published frame decoder. */
function wireFrames(chunks: readonly Uint8Array[]) {
  const frames: any[] = []
  const decoder = createRpcStreamFrameDecoder({
    onFrame: (frame) => frames.push(JSON.parse(new TextDecoder().decode(frame))),
    onError: (error) => {
      throw error
    }
  })
  for (const chunk of chunks) decoder.push(chunk)
  decoder.finish()
  decoder.close()
  return frames
}

/** Every received graph node keeps the exact remote stack and semantic identity, including causes. */
function assertWireGraph(actual: unknown, wire: Record<string, any>) {
  expect(actual).toMatchObject({
    source: wire.source,
    code: wire.code,
    name: wire.name,
    message: wire.message,
    stack: wire.stack
  })
  expect(wire.stack.length).toBeGreaterThan(0)
  if (wire.cause) assertWireGraph((actual as { cause: unknown }).cause, wire.cause)
  if (wire.errors)
    for (let index = 0; index < wire.errors.length; index++)
      assertWireGraph((actual as { errors: unknown[] }).errors[index], wire.errors[index])
}
export {
  peers,
  expected,
  businessVectors,
  evidence,
  bridgeContract,
  contract,
  offer,
  client,
  business,
  deployment,
  wireFrames,
  bridgeFrames,
  assertWireGraph
}
