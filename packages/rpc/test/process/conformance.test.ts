import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { inspect } from 'node:util'
import { serializeRpcError } from '@migaia/rpc/contract'
import { closeSync, openSync, writeFileSync, mkdirSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRpcStreamFrameDecoder } from '@migaia/rpc/contract/framing/stream'
import { PluginHost } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
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
import type { IRemoteContract, IRemoteServeEndpoint, IRemoteChannel } from '@migaia/rpc/remote'
import { endpointFor, bridgeEndpointFor } from './peers/ts/runtime.js'
import { fdLauncher } from '../bridge/fixtures/jsonrpc-process.js'
import { createJsonRpcRemoteChannel } from '@migaia/rpc/bridge/jsonrpc'
import { systemScheduler } from '@migaia/utils/scheduler'

/** Portable business outputs are observed on the provider, never inferred from send completion. */
const expected = JSON.parse(
  await readFile(new URL('./peers/ts/public-behavior.json', import.meta.url), 'utf8')
)
/** Every failing run retains full process output and received frames outside ignored docs. */
const evidence = process.env.RPC_H_EVIDENCE ?? '/tmp/m2-h-evidence'
mkdirSync(evidence, { recursive: true })
/** Published vectors freeze actual facade deployments and ownership expectations. */
const businessVectors = JSON.parse(
  await readFile(new URL('../../schema/vectors/process-business.json', import.meta.url), 'utf8')
)
/** One published contract is shared by all independent producers and the public client facades. */
const contract = JSON.parse(
  await readFile(new URL('../../schema/vectors/remote-contract.json', import.meta.url), 'utf8')
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
/**
 * Four public/independent executables run directly, without language wrapping or protocol
 * forwarding.
 */
const peers = [
  {
    language: 'python',
    command: 'python3',
    args: ['-B', new URL('./peers/python/peer.py', import.meta.url).pathname, '--business'],
    id: 'python-peer'
  },
  {
    language: 'go',
    command: 'sh',
    args: [
      new URL('./peers/go/run.sh', import.meta.url).pathname,
      '--business',
      '--contract',
      new URL('../../schema/vectors/remote-contract.json', import.meta.url).pathname
    ],
    id: 'go-peer'
  },
  {
    language: 'rust',
    command: 'sh',
    args: [
      new URL('./peers/rust/run.sh', import.meta.url).pathname,
      '--business',
      '--contract',
      new URL('../../schema/vectors/remote-contract.json', import.meta.url).pathname
    ],
    id: 'rust-peer'
  },
  {
    language: 'node',
    command: process.execPath,
    args: [new URL('./peers/ts/node-runner.mjs', import.meta.url).pathname],
    id: 'ts-peer'
  },
  {
    language: 'bun',
    command: 'bun',
    args: [new URL('./peers/ts/peer.mts', import.meta.url).pathname],
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
  bridge = false
) {
  const handles: IProcessHandle[] = []
  const output: Uint8Array[] = []
  const stdout: Uint8Array[] = []
  /** An observer retains emitted wire frames without implementing framing or changing backpressure. */
  const sent: Uint8Array[] = []
  const reports: unknown[] = []
  const launcher = bridge ? fdLauncher() : createNodeProcessLauncher()
  /** Borrowed bridge uses the existing explicit health override; default none remains K231 blocked. */
  let established: IRemoteChannel | undefined
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
        established = channel
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
        address,
        token,
        offer: proposal,
        ...(bridge
          ? {
              supervision: {
                health: {
                  check: async () => {
                    if (established?.transport.closed)
                      throw new Error('bridge fixture channel closed')
                  }
                }
              }
            }
          : {}),
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
          budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
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
  return { selected, handles, output, stdout, sent, reports }
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
  bridge = false
) {
  const fixture = deployment(peer, hostProfile, token, address, bridge)
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
    expect(await runtime.endpoint.ping(peerId, undefined, { timeoutMs: 1000 })).toBe(true)
  if (active.remove) {
    expect(await active.remove()).toEqual({ ok: true })
    expect(await active.inspect!()).toMatchObject({ plugins: [] })
    await expect(feature.request(['old'])).rejects.toMatchObject({ code: 'REMOTE_CLOSED' })
  }
}

describe('[A3] independent JSON-RPC business through public process facades', () => {
  for (const peer of peers.slice(0, 3))
    for (const host of [false, true]) {
      it(`${peer.language} JSON-RPC owned stdio Host=${host}`, async () => {
        const active = await client(peer, host, randomUUID(), undefined, true)
        try {
          await business(active, peer.id, true)
        } finally {
          await active.close()
          for (const handle of active.handles) await handle.exited
          writeFileSync(
            join(evidence, `${peer.language}-jsonrpc-stdio-${host}.stderr.log`),
            Buffer.concat(active.output)
          )
          writeFileSync(
            join(evidence, `${peer.language}-jsonrpc-stdio-${host}.frames.bin`),
            Buffer.concat(active.stdout)
          )
        }
        const frames = bridgeFrames(active.sent)
        expect(Buffer.concat(active.sent)[0]).toBe(67)
        expect(frames[0].method).toBe('migaia.hello')
        expect(frames.some((frame) => frame.method === 'migaia.describe')).toBe(true)
        const request = frames.find(
          (frame) => frame.method === 'migaia.invoke' && frame.params.method === 'p.f.request'
        )
        expect(request.id).toEqual(expect.any(String))
        expect(request.params.meta.idempotencyKey).toBe('h-bridge-key')
        expect(request.params.meta.timeoutMs).toBeGreaterThan(0)
        expect(request.params.meta.timeoutMs).toBeLessThanOrEqual(1000)
        expect(
          frames
            .filter(
              (frame) => frame.method === 'migaia.invoke' && frame.params.method === 'peer.trace'
            )
            .map((frame) => frame.params.meta?.trace ?? null)
        ).toEqual(['h-trace-one', 'h-trace-two', null])
        const notifications = frames.filter(
          (frame) => frame.method === 'migaia.invoke' && frame.params.method === 'p.f.oneWay'
        )
        expect(notifications).toHaveLength(expected.oneWay.inputs.length)
        expect(
          notifications.every((frame) => frame.id === undefined && frame.params.meta === undefined)
        ).toBe(true)
        const cancels = frames.filter((frame) => frame.method === 'migaia.cancel')
        expect(cancels).toHaveLength(1)
        expect(cancels[0]).not.toHaveProperty('id')
        expect(frames.findIndex((frame) => frame.id === cancels[0].params.id)).toBeLessThan(
          frames.indexOf(cancels[0])
        )
        expect(frames.every((frame) => frame.jsonrpc === '2.0' && frame.kind === undefined)).toBe(
          true
        )
        expect(active.handles).toHaveLength(1)
      }, 15000)
      it(`${peer.language} JSON-RPC borrowed Unix Host=${host}`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rpc-h-bridge-'))
        const token = randomUUID()
        const authPath = join(directory, 'auth')
        writeFileSync(authPath, token, { mode: 0o600 })
        const fd = openSync(authPath, 'r')
        const address = join(directory, 'peer.sock')
        const child = spawn(
          peer.command,
          [
            ...peer.args,
            '--jsonrpc',
            '--listen-unix',
            address,
            '--auth-fd',
            '3',
            ...(host ? ['--host'] : [])
          ],
          { stdio: ['ignore', 'pipe', 'pipe', fd] }
        )
        closeSync(fd)
        const exited = once(child, 'close')
        const output: Buffer[] = []
        child.stderr!.on('data', (chunk) => output.push(chunk))
        try {
          await new Promise<void>((resolve, reject) => {
            child.stderr!.on('data', (chunk) => {
              if (chunk.toString().includes('READY')) resolve()
            })
            child.once('error', reject)
            child.once('exit', () =>
              reject(
                new Error('bridge peer exited before ready: ' + Buffer.concat(output).toString())
              )
            )
          })
          /** A denied JSON-RPC hello preserves fixed errors and cannot poison the next session. */
          const deniedToken = randomUUID()
          const denied = await dialProcessByteChannel({ address })
          const deniedFrames: Uint8Array[] = []
          denied.onData((chunk) => deniedFrames.push(chunk.slice()))
          const deniedReports: unknown[] = []
          let deniedError: unknown
          try {
            await expect(
              createJsonRpcRemoteChannel({
                byte: denied,
                peerId: peer.id,
                target: host
                  ? { kind: 'host', catalog: { p: bridgeContract } }
                  : { kind: 'plugin', contract: bridgeContract },
                offer: {
                  versions: [{ major: 1, minor: 1 }],
                  capabilities: [],
                  peer: { id: 'caller', runtime: 'node' }
                },
                token: deniedToken,
                scheduler: systemScheduler,
                wallClock: { timestamp: () => Date.now() },
                ipc: {
                  connectionId: 'denied-bridge',
                  sessionId: 'denied-bridge',
                  log: () => undefined
                },
                report: (error) => deniedReports.push(error)
              }).catch((error) => {
                deniedError = error
                throw error
              })
            ).rejects.toBeInstanceOf(Error)
          } finally {
            await denied.close()
          }
          const deniedSnapshot = inspect(
            {
              error: deniedError,
              reports: deniedReports,
              wire: bridgeFrames(deniedFrames),
              serialized: serializeRpcError(deniedError, { report: () => undefined })
            },
            { depth: null, showHidden: true }
          )
          for (let offset = 0; offset <= deniedToken.length - 6; offset++)
            expect(deniedSnapshot).not.toContain(deniedToken.slice(offset, offset + 6))
          for (let index = 0; index < 2; index++) {
            const active = await client(peer, host, token, address, true)
            try {
              if (index === 0) await business(active, peer.id, true)
              else expect(await active.feature.request(['still-alive'])).toBe('still-alive')
            } finally {
              await active.close()
              writeFileSync(
                join(evidence, `${peer.language}-jsonrpc-socket-${host}-${index}.frames.bin`),
                Buffer.concat(active.stdout)
              )
            }
            expect(child.exitCode).toBeNull()
            expect(active.reports).toHaveLength(index === 0 ? 1 : 0)
            expect(
              bridgeFrames(active.sent).every(
                (frame) => frame.jsonrpc === '2.0' && frame.kind === undefined
              )
            ).toBe(true)
          }
        } finally {
          child.kill()
          await exited
          writeFileSync(
            join(evidence, `${peer.language}-jsonrpc-socket-${host}.stderr.log`),
            Buffer.concat(output)
          )
          await rm(directory, { recursive: true, force: true })
        }
      }, 15000)
    }
})

describe('[A1] independent native business peers through public process facades', () => {
  for (const peer of peers)
    for (const host of businessVectors.hostProfiles as boolean[]) {
      it(`${peer.language} owned stdio Host=${host}`, async () => {
        const active = await client(peer, host, randomUUID())
        try {
          await business(active, peer.id)
        } finally {
          await active.close()
          for (const handle of active.handles) await handle.exited
          writeFileSync(
            join(evidence, `${peer.language}-stdio-${host}.stderr.log`),
            Buffer.concat(active.output)
          )
          writeFileSync(
            join(evidence, `${peer.language}-stdio-${host}.stdout.bin`),
            Buffer.concat(active.stdout)
          )
        }
        expect(active.handles).toHaveLength(1)
        const outcome = await active.handles[0]!.exited
        expect(outcome.code === 0 || outcome.signal === 'SIGKILL').toBe(true)
        expect(Buffer.concat(active.output).toString()).toContain('READY')
        const frames = wireFrames(active.sent)
        const closeAt = frames.findIndex(
          (frame) => frame.kind === 'variation' && frame.data.route.variation === 'close'
        )
        expect(closeAt).toBeGreaterThan(-1)
        expect(
          frames.filter(
            (frame) => frame.kind === 'variation' && frame.data.route.variation === 'close'
          )
        ).toHaveLength(1)
        expect(frames.slice(closeAt + 1).filter((frame) => frame.kind === 'request')).toHaveLength(
          0
        )
        expect(active.reports).toMatchObject([
          {
            source: '@migaia/supervision',
            code: 'CAPABILITY_UNSUPPORTED',
            detail: { capability: 'termination', level: 'unsupported', kind: 'process' }
          }
        ])
      }, 15000)
      it(`${peer.language} borrowed Unix listener Host=${host}`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rpc-h-'))
        const token = randomUUID()
        const authPath = join(directory, 'auth')
        writeFileSync(authPath, token, { mode: 0o600 })
        const fd = openSync(authPath, 'r')
        const child = spawn(
          peer.command,
          [
            ...peer.args,
            '--listen-unix',
            join(directory, 'peer.sock'),
            '--auth-fd',
            '3',
            ...(host ? ['--host'] : [])
          ],
          { stdio: ['ignore', 'pipe', 'pipe', fd] }
        )
        closeSync(fd)
        const exited = once(child, 'close')
        const output: Buffer[] = []
        child.stderr!.on('data', (chunk) => output.push(chunk))
        try {
          await new Promise<void>((resolve, reject) => {
            child.stderr!.on('data', (chunk) => {
              if (chunk.toString().includes('READY')) resolve()
            })
            child.once('error', reject)
            child.once('exit', () =>
              reject(
                new Error('business peer exited before ready: ' + Buffer.concat(output).toString())
              )
            )
          })
          /** Failed authentication must not affect a later valid session on this same listener. */
          const denied = await dialProcessByteChannel({ address: join(directory, 'peer.sock') })
          const deniedToken = randomUUID()
          const deniedFrames: Uint8Array[] = []
          denied.onData((chunk) => deniedFrames.push(chunk.slice()))
          const deniedReports: unknown[] = []
          let deniedError: unknown
          try {
            await expect(
              createProcessTransport(denied, {
                role: 'initiator',
                peerId: peer.id,
                offer: { ...offer, auth: deniedToken },
                report: (error) => deniedReports.push(error),
                ipc: { connectionId: 'denied', sessionId: 'denied', log: () => undefined }
              }).catch((error) => {
                deniedError = error
                throw error
              })
            ).rejects.toBeInstanceOf(Error)
          } finally {
            await denied.close()
          }
          const deniedSnapshot = inspect(
            {
              error: deniedError,
              reports: deniedReports,
              wire: wireFrames(deniedFrames),
              serialized: serializeRpcError(deniedError, { report: () => undefined })
            },
            { depth: null, showHidden: true }
          )
          for (let offset = 0; offset <= deniedToken.length - 6; offset++)
            expect(deniedSnapshot).not.toContain(deniedToken.slice(offset, offset + 6))
          for (let index = 0; index < 2; index++) {
            const active = await client(peer, host, token, join(directory, 'peer.sock'))
            try {
              if (index === 0) {
                await business(active, peer.id)
                expect(
                  wireFrames(active.sent)
                    .filter(
                      (frame) => frame.kind === 'request' && String(frame.method).startsWith('p.f.')
                    )
                    .every((frame) => frame.data.route.trace === undefined)
                ).toBe(true)
              } else expect(await active.feature.request(['still-alive'])).toBe('still-alive')
            } finally {
              await active.close()
              writeFileSync(
                join(evidence, `${peer.language}-socket-${host}-${index}.frames.bin`),
                Buffer.concat(active.stdout)
              )
            }
            expect(active.reports).toEqual([])
            expect(child.exitCode).toBeNull()
          }
        } finally {
          child.kill()
          await exited
          writeFileSync(
            join(evidence, `${peer.language}-socket-${host}.stderr.log`),
            Buffer.concat(output)
          )
          await rm(directory, { recursive: true, force: true })
        }
        expect(Buffer.concat(output).toString()).toContain('READY')
      }, 15000)
    }
})

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

describe('[A1] default native health stays idle without restarting', () => {
  for (const peer of peers)
    it.concurrent(`${peer.language} default 20s health`, async () => {
      const active = await client(peer, false, randomUUID())
      try {
        const pid = active.handles[0]!.identity
        await new Promise((resolve) => setTimeout(resolve, 20000))
        expect(active.handles).toHaveLength(1)
        expect(active.handles[0]!.identity).toBe(pid)
        const frames = wireFrames(active.stdout)
        expect(
          frames.filter(
            (frame) => frame.kind === 'variation' && frame.data.route.variation === 'pong'
          ).length
        ).toBeGreaterThanOrEqual(3)
        expect(await active.feature.request(['after-idle'])).toBe('after-idle')
      } finally {
        await active.close()
        for (const handle of active.handles) await handle.exited
      }
    }, 25000)
})

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
