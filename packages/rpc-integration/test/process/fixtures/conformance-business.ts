import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { expect, vi } from 'vitest'
import { RpcProbeDirection } from '@migaia/rpc-contract/interfaces'
import { createRpcHost } from '@migaia/rpc-host'
import {
  createRpcStreamFrameDecoder,
  readRpcLaunchFacts,
  withRpcLaunchFacts
} from '@migaia/rpc-host/sdk'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { createUnitBudget, type IUnitBudget } from '@migaia/supervision'
import type { IProcessHandle } from '@migaia/supervision/process'
import {
  processPlugin,
  type ISpawnProcessPluginDeployment,
  type IProcessFeature,
  type IConnectProcessPluginDeployment
} from '@migaia/rpc-plugin-process'
import type { IProcessByteChannel } from '../../../../rpc-plugin-process/dist/process/types.js'
import {
  createNodeProcessLauncher,
  type INodeProcessHandle
} from '../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { dialProcessByteChannel } from '../../../../rpc-plugin-process/dist/process/adapters/node-socket.js'

/** Original business expectations remain independent from the production protocol owners. */
const expected = JSON.parse(
  await readFile(new URL('../peers/ts/public-behavior.json', import.meta.url), 'utf8')
)
/** Failed native runs retain their original physical evidence outside ignored program documents. */
const evidence = process.env.RPC_H_EVIDENCE ?? '/tmp/m2-h-evidence'
mkdirSync(evidence, { recursive: true })
/** Stable original scenario IDs remain available to each receiving suite. */
const businessVectors = JSON.parse(
  await readFile(new URL('../../../schema/vectors/process-business.json', import.meta.url), 'utf8')
)
/**
 * Legacy declarations are fixture data; the native TS provider projects them into its new
 * declaration.
 */
const contract = JSON.parse(
  await readFile(new URL('../../../schema/vectors/remote-contract.json', import.meta.url), 'utf8')
).contracts[0].value
/** Historical bridge schema data remains available only to receiving cases pending BC2 retirement. */
const bridgeContract = {
  ...contract,
  features: {
    f: {
      methods: {
        request: contract.features.f.methods.request,
        oneWay: contract.features.f.methods.oneWay
      }
    }
  }
}

/** Peer-owned launch scripts prepare only the selected language, never the whole matrix at collect. */
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
    args: [new URL('../peers/ts/node-runner.mjs', import.meta.url).pathname],
    id: 'ts-peer'
  },
  {
    language: 'bun',
    command: 'bun',
    args: [new URL('../peers/ts/node-runner.mjs', import.meta.url).pathname],
    id: 'ts-peer'
  }
]

/** Own only passive receipts around the same fixture-owned raw channel and original native writes. */
class BusinessNativeObservations {
  /** Original native process handles remain authoritative for exit and budget assertions. */
  readonly handles: IProcessHandle[] = []
  /** Original stderr bytes preserve the peer's readiness and cleanup receipts. */
  readonly output: Uint8Array[] = []
  /** Original inbound bytes permit protocol assertions after the live reader has admitted them. */
  readonly stdout: Uint8Array[] = []
  /** Original outbound chunks preserve native frame order, including final close before exit. */
  readonly sent: Uint8Array[] = []
  /** Original diagnostic objects are retained unchanged for source/cause assertions. */
  readonly reports: unknown[] = []
  /** Physical EOF assertions borrow the exact raw resources acquired by the native source. */
  readonly rawChannels: IProcessByteChannel[] = []

  /** Install passive observations once without replacing the channel, reader or framing owner. */
  observe(raw: IProcessByteChannel): IProcessByteChannel {
    this.rawChannels.push(raw)
    if (raw.observation) {
      /** Native IO publishes each original chunk at the real read/write point. */
      const remove = raw.observation.subscribe((event) => {
        if (!(event.content instanceof Uint8Array)) return
        const chunks = event.direction === RpcProbeDirection.outbound ? this.sent : this.stdout
        chunks.push(event.content.slice())
      })
      raw.onClose(remove)
    } else raw.onData((chunk) => this.stdout.push(chunk.slice()))
    return raw
  }
}

/** Retain actual native launch/source ownership; removed semantic profiles never enter a live codec. */
function deployment(
  peer: (typeof peers)[number],
  host: boolean,
  token: string,
  address?: string,
  bridge = false,
  budget?: IUnitBudget<'process'>
) {
  if (bridge) throw new TypeError('JSON-RPC semantic profile retired by BC2')
  /** One set of receipts belongs to this actual native deployment. */
  const observed = new BusinessNativeObservations()
  /** The production launcher still owns spawn, bootstrap, signals and the native exit receipt. */
  const launcher = createNodeProcessLauncher()
  /** Acquisition remains a real native recipe; Host alone owns semantic handshake and Sessions. */
  const selected: ISpawnProcessPluginDeployment | IConnectProcessPluginDeployment = address
    ? {
        kind: 'connect',
        address,
        token,
        dial: async (target, signal) =>
          observed.observe(
            await dialProcessByteChannel({ address: target, signal: signal as AbortSignal })
          )
      }
    : {
        kind: 'spawn',
        channelKind: 'byte',
        token,
        supervision: {
          id: `business-${peer.language}`,
          isolation: 'best-effort',
          budget: budget ?? createUnitBudget({ kind: 'process', maxUnits: 1 }),
          report: (error) => observed.reports.push(error),
          spec: {
            command: peer.command,
            args: [...peer.args, '--stdio', '--bootstrap', 'stdin', ...(host ? ['--host'] : [])],
            env: { inherit: ['PATH'], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
          },
          launcher: {
            ...launcher,
            launch: async (spec, context) => {
              /** The original native launch context carries real bootstrap custody in the SDK. */
              const facts = readRpcLaunchFacts(context)
              /**
               * Only the passive output callback changes; every launch fact stays with this native
               * call.
               */
              const forwarded = {
                ...context,
                output: (stream: 'stdout' | 'stderr', chunk: Uint8Array) => {
                  if (stream === 'stderr') observed.output.push(chunk.slice())
                  context.output(stream, chunk)
                }
              }
              /** Explicit operation keeps the launch callback independent of three captured inputs. */
              const operation = { launcher, spec, context: forwarded }
              const handle = await (facts
                ? withRpcLaunchFacts(forwarded, facts, () =>
                    operation.launcher.launch(operation.spec, operation.context)
                  )
                : operation.launcher.launch(operation.spec, operation.context))
              observed.handles.push(handle)
              return handle
            }
          }
        },
        rawChannel: async (handle) => observed.observe((handle as INodeProcessHandle).channel!)
      }
  return {
    selected,
    handles: observed.handles,
    output: observed.output,
    stdout: observed.stdout,
    sent: observed.sent,
    reports: observed.reports,
    rawChannels: observed.rawChannels
  }
}

/** Install the exact native recipe; all public work uses the actual process namespace. */
async function installBusinessClient(
  fixture: Pick<ReturnType<typeof deployment>, 'reports'>,
  source: ISpawnProcessPluginDeployment | IConnectProcessPluginDeployment,
  features?: readonly IProcessFeature[]
) {
  /** Credentials remain mandatory when the original foreign peer requires its inherited token. */
  const host = await createRpcHost({
    self: { name: 'caller', instanceId: 'caller' },
    plugins: [
      auth({ credentials: source.token }),
      processPlugin({
        name: 'p',
        features,
        ...(source.kind === 'spawn' ? { spawn: source } : { connect: { target: source } }),
        report: (error) => fixture.reports.push(error)
      })
    ],
    report: (error) => fixture.reports.push(error)
  })
  return { host, namespace: host.process, close: host.close }
}

/** Both former Host profiles now expose the same explicit declared methods under one namespace. */
async function client(
  peer: (typeof peers)[number],
  hostProfile: boolean,
  token: string,
  address?: string,
  bridge = false,
  budget?: IUnitBudget<'process'>
) {
  const fixture = deployment(peer, hostProfile, token, address, bridge, budget)
  const installed = await installBusinessClient(fixture, fixture.selected)
  if (peer.language === 'node' || peer.language === 'bun') {
    /** The TS fixture separately publishes its original peer.* methods through host.provide. */
    await vi.waitFor(() =>
      expect(
        Object.values(installed.namespace.peers).some((entry) => {
          const group = Reflect.get(entry, 'peer')
          return (
            group && typeof group === 'object' && typeof Reflect.get(group, 'wait') === 'function'
          )
        })
      ).toBe(true)
    )
  }
  return { ...fixture, ...installed }
}

/** Original result/count/order/error/abort/trace assertions use the genuine namespace directly. */
async function business(
  active: Awaited<ReturnType<typeof client>>,
  _peerId: string,
  bridge = false
) {
  if (bridge) throw new TypeError('JSON-RPC semantic profile retired by BC2')
  const namespace = active.namespace
  expect(
    await namespace.request('p.f.request', [expected.request.input], {
      timeout: timeout({ ms: 1000 }),
      idempotencyKey: 'h-bridge-key'
    })
  ).toBe(expected.request.expected)
  for (const input of expected.oneWay.inputs) await namespace.notify('p.f.oneWay', [input])
  expect(await namespace.request('peer.received', [])).toEqual(expected.oneWay.expected)
  for (const method of ['generator', 'asyncGenerator']) {
    const values: unknown[] = []
    const stream = namespace.stream(`p.f.${method}`, [expected.generator.input])
    if (!(Symbol.asyncIterator in stream)) throw new TypeError('single peer requires one stream')
    for await (const value of stream) values.push(value)
    expect(values).toEqual(expected.generator.expected)
  }
  let receivedError: unknown
  await expect(
    namespace.request('peer.error', []).catch((error) => {
      receivedError = error
      throw error
    })
  ).rejects.toMatchObject(expected.error)
  expect((receivedError as Error).name).toMatch(/^Rpc/)
  const failedWire = wireFrames(active.stdout).find(
    (frame) => frame.kind === 'error' && frame.task.method === 'peer.error'
  )?.error
  expect(failedWire).toBeDefined()
  assertWireGraph((receivedError as { cause: unknown }).cause, failedWire)
  const controller = new AbortController()
  const waiting = namespace.request('peer.wait', [], { signal: controller.signal })
  await new Promise((resolve) => setTimeout(resolve, 20))
  controller.abort(new RangeError(expected.cancel.reason))
  await expect(waiting).rejects.toMatchObject({ code: expected.cancel.expectedCode })
  expect(await namespace.request('peer.aborts', [])).toMatchObject([expected.cancel.providerReason])
  expect(await namespace.request('p.f.request', ['after-cancel'])).toBe('after-cancel')
  expect(
    await Promise.all([
      namespace.request('peer.trace', [], { trace: 'h-trace-one' }),
      namespace.request('peer.trace', [], { trace: 'h-trace-two' }),
      namespace.request('peer.trace', [])
    ])
  ).toEqual(['h-trace-one', 'h-trace-two', null])
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
    /** Logical assertions keep order while the bridge owns the negotiated physical batch. */
    const physical = JSON.parse(bytes.subarray(end + 4, end + 4 + length).toString())
    messages.push(...(Array.isArray(physical) ? physical : [physical]))
    bytes = bytes.subarray(end + 4 + length)
  }
  return messages
}
/** Decode retained native receipts with the same sole SDK framing owner used by Process. */
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

/** Match every flat graph node's native fields and original cause/errors topology. */
function assertWireGraph(
  actual: unknown,
  wire: { root: number; nodes: Array<Record<string, any>> }
) {
  /** This bounded assertion stack traverses only received test evidence, never live business data. */
  const pending: Array<{ actual: any; index: number }> = [{ actual, index: wire.root }]
  while (pending.length) {
    const item = pending.pop()!
    const node = wire.nodes[item.index]!
    expect(item.actual).toMatchObject({
      source: node.source,
      code: node.code,
      name: node.name,
      message: node.message,
      stack: node.stack
    })
    expect(node.stack.length).toBeGreaterThan(0)
    if (node.cause !== undefined) pending.push({ actual: item.actual.cause, index: node.cause })
    if (node.errors)
      for (let index = 0; index < node.errors.length; index++)
        pending.push({ actual: item.actual.errors[index], index: node.errors[index] })
  }
}
export {
  peers,
  expected,
  businessVectors,
  evidence,
  bridgeContract,
  contract,
  client,
  business,
  deployment,
  installBusinessClient,
  wireFrames,
  bridgeFrames,
  assertWireGraph
}
