/** Original TS native business runs through the real public Process namespace. */
import { PeerMethod, PeerText } from './text.ts'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { openSync, closeSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, describe, expect, it, vi } from 'vitest'
import type { IRpcDirectory } from '@migaia/rpc-contract/protocol'
import { RpcWireProfile } from '@migaia/rpc-contract/protocol'
import type { IRpcSessionHandle } from '@migaia/rpc-contract/interfaces'
import { SessionTable } from '../../../../../rpc-host/dist/session/table.js'
import type { INodeProcessHandle } from '../../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { client, wireFrames } from '../../fixtures/conformance-business.ts'

/** Supervisor configuration may supply the installed executable; no download occurs. */
const runtime = process.env.RPC_PEERS_RUNTIME === 'node' ? 'node' : 'bun'
/** Keep the original explicit runtime override, independent from the Vitest parent's runtime. */
const executable =
  runtime === 'node'
    ? (process.env.RPC_PEERS_NODE ?? process.execPath)
    : (process.env.RPC_PEERS_BUN ?? 'bun')
/** Type erasure prepares the same real peer without importing removed runtime/endpoint owners. */
const peer = execFileSync(
  process.env.RPC_PEERS_NODE ?? process.execPath,
  [join(import.meta.dirname, 'node-runner.mjs'), '--executable'],
  { encoding: 'utf8' }
).trim()
/** Per-run evidence retains actual peer bytes and diagnostics without printing frame contents. */
const evidence = process.env.RPC_PEERS_EVIDENCE ?? '/tmp/m2-e-evidence'
mkdirSync(evidence, { recursive: true })
/** Existing conformance acquisition supplies the exact selected executable and original arguments. */
const selectedPeer = { language: runtime, command: executable, args: [peer], id: 'ts-peer' }
/** Removed remote-management methods must stay absent from the real ordinary directory. */
const removedManagementMethods = [
  'migaia.remote.host.use',
  'migaia.remote.host.unUse',
  'migaia.remote.host.inspect'
] as const

/** Original values remain independent from the production protocol and native source owners. */
const vectors = JSON.parse(
  readFileSync(new URL('./public-behavior.json', import.meta.url), 'utf8')
) as {
  request: { input: string; expected: string }
  oneWay: { inputs: string[]; expected: { count: number; values: string[] } }
  generator: { input: string[]; expected: string[] }
  error: Record<string, unknown>
  cancel: { reason: string; expectedCode: string; providerReason: Record<string, unknown> }
}

/** One receipt borrows only the actual SessionTable and the exact native attachment it returned. */
type INativeAttachment = Readonly<{ table: SessionTable; handle: IRpcSessionHandle }>

/** Observe the canonical native context's attachment without replacing attach, ping or any reader. */
class NativeControlReceipts {
  /** Receipts are scoped to one original client opening, never another test or a prior socket. */
  readonly #attachments: INativeAttachment[] = []
  /** Restoring the passive spy releases observation without closing the actual Session. */
  readonly #restore: () => void

  /** Capture exact this/handle pairs while delegating the complete original attach operation. */
  constructor() {
    /** Only this original production method constructs and publishes the Session. */
    const attach = SessionTable.prototype.attach
    /** The callback receives this one explicit observation destination. */
    const attachments = this.#attachments
    /** The passthrough preserves arguments, native receiver, return identity and thrown failures. */
    const observing = vi.spyOn(SessionTable.prototype, 'attach').mockImplementation(function (
      this: SessionTable,
      ...args: Parameters<SessionTable['attach']>
    ) {
      /** No fixture handle or Session can substitute for the exact canonical return value. */
      const handle = Reflect.apply(attach, this, args)
      if (args[0] === 'process') attachments.push({ table: this, handle })
      return handle
    })
    this.#restore = () => observing.mockRestore()
  }

  /** Stop observing after the real public client is ready, while its genuine resources stay live. */
  stopObserving(): void {
    this.#restore()
  }

  /** Select the accepted peer identity instead of borrowing the first unfiltered spy invocation. */
  async forPeer(instanceId: string): Promise<INativeAttachment> {
    /** Only genuinely accepted handles from this same opening may satisfy the identity predicate. */
    const matches: INativeAttachment[] = []
    for (const receipt of this.#attachments) {
      /** Readiness alone does not imply health; it is used only to select the actual handle. */
      const view = await receipt.handle.ready
      if (view.namespace === 'process' && view.peerId === instanceId) matches.push(receipt)
    }
    expect(matches).toHaveLength(1)
    assert(matches[0])
    return matches[0]
  }
}

/** Existing deployment/client owns spawn, socket admission, public Host and all native cleanup. */
async function nativeClient(token: string, address?: string) {
  /** This observer adds no transport, supervisor, queue, codec or management facade. */
  const controls = new NativeControlReceipts()
  try {
    /**
     * Token proof and semantic handshake run through the same actual Process recipe as foreign
     * peers.
     */
    const active = await client(selectedPeer, false, token, address)
    return { ...active, controls }
  } finally {
    controls.stopObserving()
  }
}

/**
 * Assert original request, notification, error, cancellation and stream business on real
 * namespaces.
 */
async function business(active: Awaited<ReturnType<typeof nativeClient>>): Promise<void> {
  /**
   * Owned launch identity is native fact; the external listener retains its explicit fixed
   * identity.
   */
  const identity = active.handles.length
    ? (active.handles[0] as INodeProcessHandle).runtimeApiIdentity
    : { name: 'ts-peer', instanceId: 'ts-peer' }
  expect(identity).toBeDefined()
  assert(identity)
  /** Passive original bytes expose the directory already admitted by this real public Host. */
  const handshake = wireFrames(active.stdout).find(
    (frame) =>
      frame.kind === 'handshake' && frame.directory?.self.instanceId === identity.instanceId
  )
  expect(handshake).toBeDefined()
  /** Replaces the removed reserved-describe schemaVersion spelling with the sole wire profile. */
  expect(handshake.profile).toBe(RpcWireProfile)
  /** The peer's actual directory remains a protocol-owned value, not a reconstructed fixture DTO. */
  const description = handshake.directory as IRpcDirectory
  expect(description.self.instanceId).toBe(identity.instanceId)
  expect(description.self.name).toBe(identity.name)
  expect(description.methods).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'p.f.request', supportedModes: ['request'] }),
      expect.objectContaining({ name: 'p.f.oneWay', supportedModes: ['notify'] }),
      expect.objectContaining({ name: 'p.f.generator', supportedModes: ['stream'] }),
      expect.objectContaining({ name: 'p.f.asyncGenerator', supportedModes: ['stream'] })
    ])
  )
  for (const name of removedManagementMethods)
    expect(description.methods.some((method) => method.name === name)).toBe(false)
  expect(await active.namespace.request('p.f.request', [vectors.request.input])).toBe(
    vectors.request.expected
  )
  for (const input of vectors.oneWay.inputs) await active.namespace.notify('p.f.oneWay', [input])
  expect(await active.namespace.request(PeerMethod.received, [])).toEqual(vectors.oneWay.expected)
  for (const method of ['p.f.generator', 'p.f.asyncGenerator']) {
    /** Three distinct values preserve the original generator order/cardinality and terminal. */
    const observed: unknown[] = []
    /** A single actual accepted peer must provide one real iterator, never a manufactured fanout. */
    const stream = active.namespace.stream(method, [vectors.generator.input])
    assert(Symbol.asyncIterator in stream)
    for await (const value of stream) observed.push(value)
    expect(observed).toEqual(vectors.generator.expected)
  }
  await expect(active.namespace.request(PeerMethod.error, [])).rejects.toMatchObject(vectors.error)
  /** Only the original caller signal owns cancellation and its portable RangeError reason. */
  const controller = new AbortController()
  /** This is an actual written business call; query of provider aborts proves remote receipt later. */
  const waiting = active.namespace.request(PeerMethod.wait, [], { signal: controller.signal })
  await new Promise<void>((resolve) => setTimeout(resolve, 20))
  controller.abort(new RangeError(vectors.cancel.reason))
  await expect(waiting).rejects.toMatchObject({ code: vectors.cancel.expectedCode })
  expect(await active.namespace.request(PeerMethod.aborts, [])).toMatchObject([
    vectors.cancel.providerReason
  ])
  expect(await active.namespace.request('p.f.request', ['after-abort'])).toBe('after-abort')
  /**
   * Genuine accepted identity selects this original native control receipt, including borrowed
   * sockets.
   */
  const attachment = await active.controls.forPeer(identity.instanceId)
  /** Healthy pong must settle the real canonical ping; readiness cannot satisfy this assertion. */
  await expect(
    attachment.table.ping(attachment.handle, { timeoutMs: 1000 })
  ).resolves.toBeUndefined()
  /** Preserve the original ordinary liveness value without recreating remote plugin management. */
  expect(await active.namespace.request(PeerMethod.echo, 'still-alive')).toBe('still-alive')
}

describe('public TS native peer', () => {
  it.each([false])(
    'stdio host=%s',
    async (hostProfile) => {
      /** Original token custody stays in native stdin bootstrap, outside argv and environment. */
      const active = await nativeClient(randomUUID())
      try {
        expect((active.handles[0] as INodeProcessHandle).channel).toBeDefined()
        await business(active)
        await active.close()
        await active.handles[0]!.exited
        expect(Buffer.concat(active.output).toString()).toContain(PeerText.ready)
      } finally {
        await active.close()
        for (const handle of active.handles) await handle.exited
        writeFileSync(
          join(evidence, `stdio-${hostProfile}.stdout.bin`),
          Buffer.concat(active.stdout)
        )
        writeFileSync(
          join(evidence, `stdio-${hostProfile}.stderr.log`),
          Buffer.concat(active.output)
        )
      }
    },
    10000
  )

  it.each([false])(
    'socket host=%s',
    async (hostProfile) => {
      /** Unique actual Unix address and inherited FD retain original listener/token isolation. */
      const directory = await mkdtemp(join(tmpdir(), 'rpc-ts-public-'))
      /** This original generated test token never enters child argv, environment or assertions. */
      const token = randomUUID()
      /** Parent closes its FD after spawn; only the child owns inherited FD3. */
      const tokenPath = join(directory, 'auth')
      writeFileSync(tokenPath, token, { mode: 0o600 })
      /** A direct native descriptor retains the original test's custody and cleanup order. */
      const descriptor = openSync(tokenPath, 'r')
      /** Each closing client must leave this same external listener process alive. */
      const child = spawn(
        executable,
        [peer, '--listen-unix', join(directory, 'peer.sock'), '--auth-fd', '3'],
        { stdio: ['ignore', 'pipe', 'pipe', descriptor], env: { PATH: process.env.PATH } }
      )
      closeSync(descriptor)
      /** Original stderr bytes retain readiness and any genuine native failure. */
      const stderr: Buffer[] = []
      /** Socket business does not use stdout, but its original diagnostic receipt remains retained. */
      const stdout: Buffer[] = []
      child.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr!.on('data', (chunk: Buffer) => stderr.push(chunk))
      try {
        await new Promise<void>((resolve, reject) => {
          child.stderr!.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes(PeerText.ready)) resolve()
          })
          child.once('error', reject)
          child.once('exit', () => reject(new Error(PeerText.earlyExit)))
        })
        for (let index = 0; index < 2; index += 1) {
          /** Two genuine canonical sources connect independently to the same existing listener. */
          const active = await nativeClient(token, join(directory, 'peer.sock'))
          try {
            if (index === 0) await business(active)
            else
              expect(await active.namespace.request(PeerMethod.echo, 'second-session')).toBe(
                'second-session'
              )
          } finally {
            await active.close()
            writeFileSync(
              join(evidence, `socket-${hostProfile}-${index}.frames.bin`),
              Buffer.concat(active.stdout)
            )
          }
          expect(child.exitCode).toBeNull()
        }
        expect(Buffer.concat(stderr).toString()).toContain(PeerText.ready)
      } finally {
        child.kill()
        await once(child, 'close')
        writeFileSync(join(evidence, `socket-${hostProfile}.stdout.bin`), Buffer.concat(stdout))
        writeFileSync(join(evidence, `socket-${hostProfile}.stderr.log`), Buffer.concat(stderr))
        await rm(directory, { recursive: true, force: true })
      }
    },
    10000
  )
})
