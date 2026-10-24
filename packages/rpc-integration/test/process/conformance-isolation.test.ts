import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync, writeFileSync, unlinkSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { serializeRpcError, createRpcHello } from '@migaia/rpc-contract'
import { encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'
import { RpcProcessErrorCode } from '@migaia/rpc-plugin-process'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { createProcessResilience } from '../../../rpc-plugin-process/dist/process/resilience/index.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import {
  client,
  peers,
  evidence,
  wireFrames,
  deployment,
  installBusinessClient,
  businessFeature
} from './fixtures/conformance-business.js'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { deferred } from '@migaia/utils/promise'
import { matrixEndpoint } from './matrix-fixture.js'
import { serveProcessSessions } from '../../../rpc-plugin-process/dist/process/plugin/serve.js'
import {
  createRuntimePeer,
  readRuntimePeerConnection,
  prepareRuntimePeerSourceContext
} from '../../../rpc-host/dist/remote/runtime-api/peer.js'

/** Observe actual child descriptors; lsof is never used as a simulated admission counter. */
function descriptors(pid: number): number {
  return execFileSync('lsof', ['-p', String(pid), '-Ff'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => /^f\d/.test(line)).length
}

/** Existing deployment helper provides the authenticated facade while retaining its physical port. */
async function observedClient(token: string, address: string, scheduler?: IScheduler) {
  /** Production deployment retains encoded outbound bytes for replay injection. */
  const fixture = deployment(fixturePeer, false, token, address)
  if (fixture.selected.kind !== 'connect')
    throw new TypeError('isolation observer requires connect deployment')
  /** The canonical establish callback remains the channel owner. */
  const establish = fixture.selected.establish
  /** This observer only exposes the existing physical port for a literal captured-frame replay. */
  let raw: Awaited<ReturnType<typeof dialProcessByteChannel>> | undefined
  const selected = {
    ...fixture.selected,
    supervision: { ...fixture.selected.supervision, ...(scheduler ? { scheduler } : {}) },
    establish: async (
      channel: Parameters<typeof establish>[0],
      context: Parameters<typeof establish>[1]
    ) => {
      raw = channel as typeof raw
      return establish(channel, context)
    }
  }
  if (scheduler) {
    /**
     * This deadline oracle needs the actual Core endpoint clock; the public Host owns a system
     * clock.
     */
    const signal = new AbortController().signal
    const channel = await selected.establish(await selected.dial(address, signal), {
      role: 'initiator',
      signal,
      scheduler,
      token,
      session: { connectionId: 'deadline-caller', sessionId: 'deadline-caller' },
      offer: {
        ...selected.offer!,
        capabilities: prepareRuntimePeerSourceContext({ name: 'caller', instanceId: 'caller' })
          .capabilities
      }
    })
    /**
     * Reuse the actual accepted channel and production Peer owner without a second endpoint or
     * dispatcher.
     */
    const active = await createRuntimePeer(
      {
        self: { name: 'caller', instanceId: 'caller' },
        report: (error) => {
          fixture.reports.push(error)
        }
      },
      { channel }
    )
    const accepted = readRuntimePeerConnection(active)
    return {
      ...fixture,
      raw: raw!,
      runtime: {
        endpoint: accepted.endpoint,
        oneWay: accepted.endpoint,
        stream: accepted.endpoint.stream
      },
      feature: businessFeature(active),
      close: active.close
    }
  }
  /** The actual ordinary Host shares the same native client owner as the foreign business matrix. */
  const installed = await installBusinessClient(fixture, selected)
  return {
    ...fixture,
    raw: raw!,
    runtime: installed.runtime,
    feature: businessFeature(installed.active),
    close: installed.close
  }
}

/** One new fixture is an actual Node child using public process and PluginHost implementations. */
const fixturePeer = {
  ...peers[3]!,
  args: [new URL('./fixtures/conformance-isolation-peer.mjs', import.meta.url).pathname]
}
/** Provider receipts carry no credentials and distinguish session state from principal cache state. */
type IResult = {
  input: unknown
  execution: number
  revision: number
  session: { sessionId: string; connectionId: string; principalId: string }
}
/** The actual child independently counts executions, cancellation and lifecycle replacement. */
type IStats = {
  executions: number
  contexts: Array<IResult['session'] & { method: string }>
  aborts: Array<IResult['session'] & { label: string; code?: string; localTimeout: boolean }>
  replacements: number
  revision: number
  pid: number
  reports: unknown[]
  frames: Array<{ sessionId: string; kind: string; id: string | null }>
}

/** Verify every six-character credential window without exposing the failed credential in output. */
function noSecret(value: unknown, secret: string): void {
  /** Hidden properties and original causes are included in this complete public inspection. */
  const text = inspect(value, { depth: null, showHidden: true })
  for (let offset = 0; offset + 6 <= secret.length; offset++)
    expect(text.includes(secret.slice(offset, offset + 6))).toBe(false)
}

/** Start a borrowed child with credentials inherited through one private read-only descriptor. */
async function listener(mode: string) {
  const directory = await mkdtemp(join(tmpdir(), 'rpc-hi-'))
  const active = new IsolationListener(mode, directory)
  await active.ready()
  return active
}

/** Owns only the external isolation peer, credentials and original stdout/stderr evidence. */
class IsolationListener {
  /** Existing fixture mode selects session/principal provider behavior in the real child. */
  readonly #mode: string
  /** Temporary auth/socket files belong only to this external peer owner. */
  readonly #directory: string
  /** Native stdout chunks are retained unchanged until physical exit. */
  readonly #stdout: Buffer[] = []
  /** Full stderr evidence remains independent from the bounded readiness sentinel carry. */
  readonly #stderr: Buffer[] = []
  /** Only the last marker-length minus one characters cross native chunk boundaries. */
  #readyTail = ''
  /** Readiness has one original child receipt, never a guessed scheduling delay. */
  readonly #prepared = deferred<void>()
  /** Unique authentication sentinels never enter child argv, environment or public logs. */
  readonly tokens = { alice: randomUUID(), bob: randomUUID() }
  /** Borrowed clients receive only this physical rendezvous address. */
  readonly address: string
  /** External ownership retains the actual process handle through physical exit. */
  readonly child: ReturnType<typeof spawn>

  /** Open the original private descriptor and attach native observations before awaiting readiness. */
  constructor(mode: string, directory: string) {
    this.#mode = mode
    this.#directory = directory
    this.address = join(directory, 'peer.sock')
    const authPath = join(directory, 'auth')
    writeFileSync(authPath, JSON.stringify(this.tokens), { mode: 0o600 })
    const descriptor = openSync(authPath, 'r')
    this.child = spawn(process.execPath, [...fixturePeer.args, mode, this.address], {
      stdio: ['ignore', 'pipe', 'pipe', descriptor]
    })
    closeSync(descriptor)
    unlinkSync(authPath)
    this.child.stdout!.on('data', (chunk: Buffer) => this.#stdout.push(chunk))
    this.child.stderr!.on('data', (chunk: Buffer) => this.#observeStderr(chunk))
    this.child.once('exit', (code) =>
      this.#prepared.reject(new Error(`isolation child exited before ready: ${code}`))
    )
    this.child.once('error', this.#prepared.reject)
  }
  /** Match a split ASCII marker with O(total bytes) work while preserving full raw chunks. */
  #observeStderr(chunk: Buffer): void {
    this.#stderr.push(chunk)
    const marker = 'ISOLATION_READY:'
    const text = this.#readyTail + chunk.toString()
    if (text.includes(marker)) this.#prepared.resolve()
    this.#readyTail = text.slice(-(marker.length - 1))
  }
  /** Join the actual peer readiness receipt before clients may borrow its socket. */
  ready(): Promise<void> {
    return this.#prepared.promise
  }
  /** Stop only the owned PID after clients close, then retain exact redacted diagnostic evidence. */
  close = async (): Promise<void> => {
    const exited = once(this.child, 'exit')
    this.child.kill('SIGTERM')
    await exited
    try {
      const stderr = Buffer.concat(this.#stderr)
      writeFileSync(
        join(evidence, `isolation-${this.#mode}.stdout.log`),
        Buffer.concat(this.#stdout)
      )
      writeFileSync(join(evidence, `isolation-${this.#mode}.stderr.log`), stderr)
      noSecret(stderr.toString(), this.tokens.alice)
      noSecret(stderr.toString(), this.tokens.bob)
    } finally {
      await rm(this.#directory, { recursive: true, force: true })
    }
  }
}

/** Query receipts through the same publicly installed proxy that performs business work. */
async function stats(active: Pick<Awaited<ReturnType<typeof client>>, 'feature'>): Promise<IStats> {
  return (await active.feature.request(['stats'])) as IStats
}

describe('real process session and principal isolation', () => {
  it('no-token native listener never constructs an endpoint or publishes a service', async () => {
    /** The reverse-registration socket is owned by the original authenticated listener. */
    const directory = await mkdtemp(join(tmpdir(), 'rpc-hi-reverse-'))
    /** Native authentication must finish before this real endpoint constructor can run. */
    const endpointFactory = vi.fn((channel: Parameters<typeof matrixEndpoint>[0]) =>
      matrixEndpoint(channel)
    )
    /** No unauthorized candidate may publish a real provider service. */
    const ready = vi.fn()
    /** Responder reports preserve native authentication error identity. */
    const reports: unknown[] = []
    /** Native required authentication rejects absent credentials before any Host adoption path. */
    const verify = (auth: unknown) => {
      if (auth !== 'reverse-required') throw new TypeError('reverse credential required')
      return 'approved-principal'
    }
    /** The canonical governor owns authentication and never offers an unauthenticated candidate. */
    const resilience = createProcessResilience({
      scheduler: systemScheduler,
      report: (error) => reports.push(error)
    })
    const service = await serveProcessSessions(
      {
        kind: 'listener',
        address: join(directory, 'reverse.sock'),
        listen: listenProcessByteChannel,
        verify,
        offer: createNativeProcessOffer({ peer: { id: 'server', runtime: 'node' } }),
        createConnectionContext: () => ({
          peerId: 'caller',
          ipc: { connectionId: 'reverse', sessionId: 'reverse', log: () => undefined }
        }),
        scheduler: systemScheduler
      },
      endpointFactory,
      ready,
      resilience,
      (error) => {
        reports.push(error)
      }
    )
    /** This actual reverse candidate sends a valid native hello without an auth field. */
    const raw = await dialProcessByteChannel({ address: join(directory, 'reverse.sock') })
    try {
      await expect(
        createProcessTransport(raw, {
          role: 'initiator',
          peerId: 'server',
          offer: createNativeProcessOffer({ peer: { id: 'caller', runtime: 'node' } }),
          report: (error) => reports.push(error),
          ipc: { connectionId: 'missing-auth', sessionId: 'missing-auth', log: () => undefined }
        })
      ).rejects.toMatchObject({
        code: 'HANDSHAKE_REJECTED',
        cause: { code: 'PROCESS_CHANNEL_AUTH_REJECTED' }
      })
      expect(endpointFactory).not.toHaveBeenCalled()
      expect(ready).not.toHaveBeenCalled()
      writeFileSync(
        join(evidence, 'isolation-reverse.receipt.json'),
        JSON.stringify(
          {
            endpoints: endpointFactory.mock.calls.length,
            publications: ready.mock.calls.length,
            reports: reports.map((error) => serializeRpcError(error, { report: () => undefined }))
          },
          null,
          2
        )
      )
    } finally {
      await raw.close()
      await service.close()
      await resilience.close()
      /** The listener closes before its fixture-created rendezvous directory is removed. */
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('rejects actual over-capacity socket flood and returns every rejected descriptor', async () => {
    /** Two admitted physical connections fill the real production governor configured capacity. */
    const peer = await listener('flood')
    /** The provider's descriptor baseline includes two established sockets. */
    const sessions = [
      await client(fixturePeer, false, peer.tokens.alice, peer.address),
      await client(fixturePeer, false, peer.tokens.bob, peer.address)
    ]
    /** Refused ports remain fixture-owned until finally, even if their remote end already closes. */
    const refused: Awaited<ReturnType<typeof dialProcessByteChannel>>[] = []
    /** Channel establishment errors preserve native public error identity. */
    const reports: unknown[] = []
    try {
      const baseline = descriptors(peer.child.pid!)
      for (let index = 0; index < 12; index++) {
        const raw = await dialProcessByteChannel({ address: peer.address })
        refused.push(raw)
        await expect(
          createProcessTransport(raw, {
            role: 'initiator',
            peerId: 'ts-peer',
            offer: createNativeProcessOffer({
              peer: { id: 'caller', runtime: 'node' },
              auth: peer.tokens.alice
            }),
            ipc: {
              connectionId: `flood-${index}`,
              sessionId: `flood-${index}`,
              log: () => undefined
            },
            report: (error) => reports.push(error)
          })
        ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
      }
      await vi.waitFor(() => expect(descriptors(peer.child.pid!)).toBe(baseline))
      const receipt = await stats(sessions[1]!)
      expect(
        receipt.reports.filter(
          (value) => (value as { wire: { code: string } }).wire.code === 'PROCESS_CONNECTION_LIMIT'
        )
      ).toHaveLength(12)
      expect(await sessions[0]!.feature.request(['still-alice'])).toMatchObject({
        session: { principalId: 'alice' }
      })
      expect(await sessions[1]!.feature.request(['still-bob'])).toMatchObject({
        session: { principalId: 'bob' }
      })
      writeFileSync(
        join(evidence, 'isolation-flood.receipt.json'),
        JSON.stringify(
          { baseline, after: descriptors(peer.child.pid!), refused: refused.length },
          null,
          2
        )
      )
    } finally {
      await Promise.allSettled(refused.map((raw) => raw.close()))
      await Promise.allSettled(sessions.map((session) => session.close()))
      await peer.close()
    }
  })

  it('malformed hello and secret-bearing verifier failure redact native cause, report and reject', async () => {
    /** A real public responder receives adversarial framed hello messages in its actual child PID. */
    const peer = await listener('redaction')
    /** Each invalid candidate has its own unique credential sentinel. */
    const sentinel = randomUUID()
    /** These raw ports are used only to observe handshake reject bytes. */
    const raws: Awaited<ReturnType<typeof dialProcessByteChannel>>[] = []
    /** Actual responder rejects are decoded by the public frame owner. */
    const received: Uint8Array[] = []
    /** Verifier exceptions must not survive in the initiator's cause or serialization. */
    const reports: unknown[] = []
    /** A valid observer session remains alive after both invalid candidates. */
    let valid: Awaited<ReturnType<typeof client>> | undefined
    try {
      const raw = await dialProcessByteChannel({ address: peer.address })
      raws.push(raw)
      const closed = new Promise<void>((resolve) => raw.onClose(() => resolve()))
      raw.onData((chunk) => received.push(chunk.slice()))
      const hello = JSON.parse(
        createRpcHello(
          createNativeProcessOffer({ peer: { id: 'caller', runtime: 'node' }, auth: sentinel })
        )
      )
      hello.kind = sentinel
      await raw.write(encodeRpcStreamFrame(new TextEncoder().encode(JSON.stringify(hello))))
      await closed
      const invalid = await dialProcessByteChannel({ address: peer.address })
      raws.push(invalid)
      invalid.onData((chunk) => received.push(chunk.slice()))
      let failure: unknown
      await expect(
        createProcessTransport(invalid, {
          role: 'initiator',
          peerId: 'ts-peer',
          offer: createNativeProcessOffer({
            peer: { id: 'caller', runtime: 'node' },
            auth: sentinel,
            capabilities: ['runtime-api@1']
          }),
          ipc: {
            connectionId: 'verifier-denied',
            sessionId: 'verifier-denied',
            log: () => undefined
          },
          report: (error) => reports.push(error)
        }).catch((error) => {
          failure = error
          throw error
        })
      ).rejects.toMatchObject({
        code: 'HANDSHAKE_REJECTED',
        cause: { code: 'PROCESS_CHANNEL_AUTH_REJECTED' }
      })
      noSecret(failure, sentinel)
      noSecret(serializeRpcError(failure, { report: ({ error }) => reports.push(error) }), sentinel)
      noSecret(reports, sentinel)
      const frames = wireFrames(received)
      /**
       * Malformed kind is rejected before a legal handshake reply exists; verifier failure emits
       * reject.
       */
      expect(frames).toHaveLength(1)
      expect(frames.every((frame) => frame.step === 'reject')).toBe(true)
      noSecret(frames, sentinel)
      valid = await client(fixturePeer, false, peer.tokens.alice, peer.address)
      const receipt = await stats(valid)
      noSecret(receipt, sentinel)
      expect(await valid.feature.request(['after-invalid'])).toMatchObject({
        session: { principalId: 'alice' }
      })
      writeFileSync(
        join(evidence, 'isolation-redaction.receipt.json'),
        JSON.stringify({ frames, reports: receipt.reports }, null, 2)
      )
    } finally {
      await valid?.close()
      await Promise.allSettled(raws.map((raw) => raw.close()))
      await peer.close()
    }
  })

  it('equal inbound msgid replay is connection-local while repeated same-session frames do not execute twice', async () => {
    /** Same route sender on two authenticated sockets exposes an accidental global replay ledger. */
    const peer = await listener('replay')
    /** Both proxies have caller route identity but different physical session identities. */
    const first = await observedClient(peer.tokens.alice, peer.address)
    const second = await observedClient(peer.tokens.bob, peer.address)
    try {
      const result = (await first.feature.request(['original'])) as IResult
      const request = first.sent.find((chunk) =>
        wireFrames([chunk]).some(
          (frame) => frame.kind === 'request' && JSON.stringify(frame.data).includes('original')
        )
      )!
      expect(request).toBeDefined()
      /** Literal byte replay preserves the exact original envelope id on both sockets. */
      const id = wireFrames([request])[0].id
      expect(id).toEqual(expect.any(String))
      await first.raw.write(request)
      expect(((await first.feature.request(['stats'])) as IStats).executions).toBe(1)
      await second.raw.write(request)
      const receipt = (await second.feature.request(['stats'])) as IStats
      expect(receipt.executions).toBe(2)
      expect(receipt.contexts.map((context) => context.principalId)).toEqual(['alice', 'bob'])
      expect(receipt.contexts[0]!.sessionId).toBe(result.session.sessionId)
      expect(receipt.contexts[1]!.sessionId).not.toBe(result.session.sessionId)
      expect(
        receipt.frames.filter((frame) => frame.id === id).map((frame) => frame.sessionId)
      ).toEqual([
        result.session.sessionId,
        result.session.sessionId,
        receipt.contexts[1]!.sessionId
      ])
      writeFileSync(
        join(evidence, 'isolation-replay.receipt.json'),
        JSON.stringify(receipt, null, 2)
      )
    } finally {
      await Promise.allSettled([first.close(), second.close()])
      await peer.close()
    }
  })

  it('bootstrap peer splits stderr token into three-character writes; IPC keeps only identity and fixed text', async () => {
    /** The secret is delivered only through the actual production stdin bootstrap. */
    const token = randomUUID()
    /** The stdio business facade owns its child and drains stderr through production binding. */
    const fixture = deployment(
      { ...fixturePeer, args: [...fixturePeer.args, 'stderr'] },
      false,
      token
    )
    /** The production establish hook receives the canonical stderr source and identity. */
    const establish = fixture.selected.establish
    /**
     * IPC records are observed independently of raw stderr; raw contains the intended adversarial
     * bytes.
     */
    const records: unknown[] = []
    /** Active generation identity comes from production process binding. */
    let identity: { connectionId: string; sessionId: string; processId?: string } | undefined
    const selected = {
      ...fixture.selected,
      establish: (
        raw: Parameters<typeof establish>[0],
        context: Parameters<typeof establish>[1]
      ) => {
        identity = context.session
        if (raw.kind !== 'byte') throw new TypeError('isolation stderr requires byte channel')
        raw.onData((chunk) => fixture.stdout.push(chunk.slice()))
        return createProcessTransport(raw, {
          role: 'initiator',
          peerId: fixturePeer.id,
          offer: context.offer!,
          scheduler: context.scheduler,
          signal: context.signal as AbortSignal,
          report: (error) => fixture.reports.push(error),
          ipc: {
            ...context.session,
            stderr: context.stderr,
            log: (record) => {
              records.push(record)
            }
          }
        })
      }
    }
    /** This original native source uses the same actual ordinary Host client as all business peers. */
    const installed = await installBusinessClient(fixture, selected)
    try {
      const feature = businessFeature(installed.active)
      expect(await feature.request(['stderr'])).toBe(true)
      const stderr = records.filter((record) => (record as { name: string }).name === 'ipc.stderr')
      expect(stderr.length).toBeGreaterThanOrEqual(Math.ceil(token.length / 3))
      expect(stderr).toEqual(
        stderr.map(() => expect.objectContaining({ ...identity, text: '[child stderr redacted]' }))
      )
      expect(stderr.every((record) => !('trace' in (record as object)))).toBe(true)
      noSecret(records, token)
      noSecret(fixture.reports, token)
      expect(Buffer.concat(fixture.output).toString().includes(token)).toBe(true)
      writeFileSync(
        join(evidence, 'isolation-stderr.receipt.json'),
        JSON.stringify({ identity, records }, null, 2)
      )
    } finally {
      await installed.close()
      for (const handle of fixture.handles) await handle.exited
      /**
       * Raw secret-bearing stderr is deliberately not persisted; the redacted receipt is
       * sufficient.
       */
      writeFileSync(join(evidence, 'isolation-stderr.stdout.bin'), Buffer.concat(fixture.stdout))
    }
  })
  it('shares stable principal results across sessions while isolating abort and context', async () => {
    /** Three real sockets share one actual provider PID and its canonical process governor. */
    const peer = await listener('shared')
    /** Proxy installation uses existing production business facade helpers. */
    const sessions: Awaited<ReturnType<typeof client>>[] = []
    try {
      for (const token of [peer.tokens.alice, peer.tokens.alice, peer.tokens.bob])
        sessions.push(await client(fixturePeer, false, token, peer.address))
      /** Same method/key in concurrent sessions must coalesce into one provider execution. */
      const [first, second, other] = (await Promise.all(
        sessions.map((session) =>
          session.feature.request(['same'], { idempotencyKey: 'stable-key' })
        )
      )) as IResult[]
      expect(second).toEqual(first)
      expect(first!.session.principalId).toBe('alice')
      expect(other!.session.principalId).toBe('bob')
      expect(other!.execution).toBe(2)
      expect((await stats(sessions[1]!)).executions).toBe(2)
      await sessions[0]!.close()
      expect(
        await sessions[1]!.feature.request(['same'], { idempotencyKey: 'stable-key' })
      ).toEqual(first)
      /** A released borrowed socket leaves both the shared cache and its external provider alive. */
      expect(peer.child.exitCode).toBeNull()
      /** Two independent provider calls receive their own session cancellation signal. */
      const controller = new AbortController()
      /** This cancellation targets only Alice's second physical session. */
      const waiting = sessions[1]!.feature.request([['wait', 'alice-wait']], {
        signal: controller.signal
      })
      /** Bob's simultaneous request returns independently. */
      const bob = (await sessions[2]!.feature.request(['bob-live'])) as IResult
      controller.abort(new RangeError('alice-only-cancel'))
      await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' })
      /** Subsequent request observes the second session instead of cached first-session context. */
      const alice = (await sessions[1]!.feature.request(['alice-live'])) as IResult
      expect(alice.session.sessionId).not.toBe(first!.session.sessionId)
      expect(alice.session.sessionId).not.toBe(bob.session.sessionId)
      /** Target one-way and stream calls also receive physical-session context. */
      await sessions[1]!.feature.oneWay(['one-way'])
      for await (const value of sessions[2]!.feature.generator(['stream']))
        expect((value as IResult).session.sessionId).toBe(bob.session.sessionId)
      /** Provider receipts, rather than sender Promise, prove the target received context. */
      const receipt = await stats(sessions[2]!)
      expect(receipt.aborts).toHaveLength(1)
      expect(receipt.aborts[0]).toMatchObject({
        label: 'alice-wait',
        sessionId: alice.session.sessionId
      })
      expect(
        receipt.contexts
          .filter((context) => context.method === 'oneWay')
          .map((context) => context.sessionId)
      ).toEqual([alice.session.sessionId])
      expect(
        receipt.contexts
          .filter((context) => context.method === 'generator')
          .map((context) => context.sessionId)
      ).toEqual([bob.session.sessionId])
      expect(receipt.pid).toBe(peer.child.pid)
      writeFileSync(
        join(evidence, 'isolation-principal.receipt.json'),
        JSON.stringify(receipt, null, 2)
      )
    } finally {
      await Promise.allSettled(sessions.map((session) => session.close()))
      await peer.close()
    }
  })

  it.each(['shared', 'per-connection'] as const)(
    '%s consecutive request timeouts close only the offending borrowed socket',
    async (mode) => {
      /** One real child contains either one shared Host or one Host per physical connection. */
      const peer = await listener(mode)
      /** Two independently installed facades borrow the same provider PID. */
      /** Caller timers remain unadvanced; only the actual child's local deadline can fire. */
      const callerScheduler = createManualScheduler()
      const first = await observedClient(peer.tokens.alice, peer.address, callerScheduler)
      const other = await observedClient(peer.tokens.bob, peer.address)
      /**
       * These callbacks observe actual remote socket EOF rather than disposal requested by the
       * test.
       */
      const offenderClosed = vi.fn()
      const otherClosed = vi.fn()
      first.raw.onClose(offenderClosed)
      other.raw.onClose(otherClosed)
      const sessions: Array<{
        feature: Awaited<ReturnType<typeof client>>['feature']
        close(): Promise<unknown>
      }> = [first, other]
      /**
       * Finally may release a failed oracle's local waits without changing the deadline
       * observation.
       */
      const controller = new AbortController()
      /** Core calls use the already-installed channel and avoid proxy retry of completed timeouts. */
      const pending = Array.from({ length: 3 }, (_, index) =>
        first.runtime.endpoint
          .send(fixturePeer.id, 'p.f.request', [['wait', `timeout-${index}`]], {
            timeoutMs: 30,
            signal: controller.signal
          })
          .then(
            (value) => value,
            (error: unknown) => error
          )
      )
      try {
        await vi.waitFor(() => expect(offenderClosed).toHaveBeenCalledTimes(1))
        /** EOF naturally rejects every core caller before finally performs any cancellation. */
        const outcomes = await Promise.all(pending)
        expect(outcomes).toHaveLength(3)
        expect(outcomes.every((error) => error instanceof Error)).toBe(true)
        for (const error of outcomes) {
          expect(error).toMatchObject({
            source: 'rpc.transport.process',
            code: RpcProcessErrorCode.channelClosed
          })
        }
        /** The actual provider proves trusted local timeout instances, not deserialized wire codes. */
        const receipt = await stats(other)
        expect(receipt.aborts).toHaveLength(3)
        expect(
          receipt.aborts.every((event) => event.localTimeout && event.code === 'DEADLINE_EXCEEDED')
        ).toBe(true)
        writeFileSync(
          join(evidence, `isolation-${mode}-provider-deadlines.receipt.json`),
          JSON.stringify(
            {
              receipt,
              outcomes: outcomes.map((error) =>
                serializeRpcError(error, { report: () => undefined })
              ),
              callerTime: callerScheduler.now(),
              callerPending: callerScheduler.pendingCount
            },
            null,
            2
          )
        )
        expect(callerScheduler.now()).toBe(0)
        expect(otherClosed).not.toHaveBeenCalled()
        /** The peer still serves the unaffected session without rebuilding its shared target. */
        const unaffected = (await sessions[1]!.feature.request(['after-timeouts'])) as IResult
        expect((await stats(sessions[1]!)).replacements).toBe(0)
        expect(peer.child.exitCode).toBeNull()
        await sessions[0]!.close()
        expect(unaffected.session.principalId).toBe('bob')
      } finally {
        controller.abort()
        await Promise.all(pending)
        await Promise.allSettled(sessions.map((session) => session.close()))
        expect(peer.child.exitCode).toBeNull()
        await peer.close()
      }
    }
  )
  it.each(['shared', 'per-connection'] as const)(
    '%s explicit health replaces only its owned instance in the same PID',
    async (mode) => {
      /** Explicit health has no dependency on the consecutive-timeout policy under test above. */
      const peer = await listener(mode)
      /** These actual sockets expose whether shared or per-connection fallback closes them. */
      const first = await observedClient(peer.tokens.alice, peer.address)
      const other = await observedClient(peer.tokens.bob, peer.address)
      /** Physical EOF callbacks observe production close without requesting disposal. */
      const firstClosed = vi.fn()
      const otherClosed = vi.fn()
      first.raw.onClose(firstClosed)
      other.raw.onClose(otherClosed)
      /** New described sessions are released together with the initial facade owners. */
      const sessions: Array<{
        feature: Awaited<ReturnType<typeof client>>['feature']
        close(): Promise<unknown>
      }> = [first, other]
      try {
        const initial = (await first.feature.request(['identity'])) as IResult
        const unaffected = (await other.feature.request(['other-identity'])) as IResult
        await first.feature.request([['health', initial.session.connectionId]])
        await vi.waitFor(() => expect(firstClosed).toHaveBeenCalledTimes(1))
        if (mode === 'per-connection') {
          expect(otherClosed).not.toHaveBeenCalled()
          expect(await other.feature.request(['other-instance'])).toMatchObject({
            revision: unaffected.revision,
            session: unaffected.session
          })
          expect((await stats(other)).replacements).toBe(0)
        } else {
          await vi.waitFor(() => expect(otherClosed).toHaveBeenCalledTimes(1))
          const successor = await client(fixturePeer, false, peer.tokens.bob, peer.address)
          sessions.push(successor)
          const value = (await successor.feature.request(['replacement'])) as IResult
          expect(value.revision).toBe(1)
          const receipt = await stats(successor)
          expect(receipt.replacements).toBe(1)
          expect(receipt.pid).toBe(peer.child.pid)
          writeFileSync(
            join(evidence, 'isolation-explicit-health.receipt.json'),
            JSON.stringify(receipt, null, 2)
          )
        }
        expect(peer.child.exitCode).toBeNull()
      } finally {
        await Promise.allSettled(sessions.map((session) => session.close()))
        await peer.close()
      }
    }
  )
})
