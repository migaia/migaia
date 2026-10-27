import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync, writeFileSync, unlinkSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { createConnection } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { serializeRpcError, type IRpcSerializedError } from '@migaia/rpc-contract/errors'
import { RpcProbeLifecycle } from '@migaia/rpc-contract/interfaces'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { probe } from '@migaia/rpc-host/plugins/probe'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { encodeRpcStreamFrame, RpcEventByteIO, type IRpcByteIO } from '@migaia/rpc-host/sdk'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { ipcLog, type IIpcLogContext } from '@migaia/rpc-plugin-process/features'
import {
  peers,
  evidence,
  wireFrames,
  deployment,
  installBusinessClient
} from './fixtures/conformance-business.js'
import { type IScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { deferred } from '@migaia/utils/promise'

/**
 * Native listener default from rpc-plugin-process/src/process/resilience/constants.ts; not a public
 * export.
 */
const listenerCapacity = 64

/** Fixture-owned raw socket terminal text never replaces a production protocol or Session error. */
const nativeSocketClosed = 'isolation native socket closed'

/** Borrow Node's actual socket through the public byte owner, without importing a private adapter. */
async function dialIsolationSocket(address: string): Promise<IRpcByteIO> {
  /** Every supported address in this fixture is its owned local socket path. */
  const socket = createConnection({ path: address })
  /** Pause and subscribe before native connect can deliver an early peer frame. */
  const raw = new RpcEventByteIO(socket, socket, () => socket.destroy(), {
    closedError: () => new Error(nativeSocketClosed),
    report: () => undefined
  }).value
  try {
    await once(socket, 'connect')
    return raw
  } catch (error) {
    await raw.close()
    throw error
  }
}

/** Observe actual child descriptors; lsof is never used as a simulated admission counter. */
function descriptors(pid: number): number {
  return execFileSync('lsof', ['-p', String(pid), '-Ff'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => /^f\d/.test(line)).length
}

/** Borrow the existing real native recipe and retain its original raw replay receipt. */
async function observedClient(token: string, address: string, scheduler?: IScheduler) {
  const fixture = deployment(fixturePeer, false, token, address)
  if (fixture.selected.kind !== 'connect')
    throw new TypeError('isolation observer requires connect deployment')
  const selected = {
    ...fixture.selected,
    supervision: { ...fixture.selected.supervision, ...(scheduler ? { scheduler } : {}) }
  }
  /** Each simultaneously admitted public Host has its own genuine name and instance identity. */
  const identity = `caller-${randomUUID()}`
  const installed = await installBusinessClient(fixture, selected, undefined, {
    name: identity,
    instanceId: identity
  })
  return { ...fixture, ...installed, raw: fixture.rawChannels[0]! }
}
/** The same native acquisition path serves all original isolation socket callers. */
async function client(_peer: typeof fixturePeer, _host: boolean, token: string, address: string) {
  return observedClient(token, address)
}
/** One already-open raw socket remains fixture-owned while public Host performs the real handshake. */
async function connectRaw(raw: IRpcByteIO, token: string, reports: unknown[]) {
  return installBusinessClient(
    { reports },
    {
      kind: 'connect',
      address: 'native-isolation-raw',
      token,
      dial: async () => raw
    }
  )
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
  session: { sessionId: string; connectionId: string; principalId: string }
}
/** The actual child independently counts executions, cancellation and lifecycle replacement. */
type IStats = {
  targetInstance: string
  executions: number
  contexts: Array<IResult['session'] & { method: string }>
  aborts: Array<IResult['session'] & { label: string; code?: string; localTimeout: boolean }>
  pid: number
  reports: Array<{ inspected: string; wire: IRpcSerializedError }>
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
async function stats(
  active: Pick<Awaited<ReturnType<typeof client>>, 'namespace'>
): Promise<IStats> {
  return (await active.namespace.request('p.f.request', ['stats'])) as IStats
}

describe('real process session and principal isolation', () => {
  it('no-token native listener never constructs an endpoint or publishes a service', async () => {
    /** The reverse-registration socket is owned by the original authenticated listener. */
    const directory = await mkdtemp(join(tmpdir(), 'rpc-hi-reverse-'))
    /** No unauthorized candidate may publish a real provider service. */
    const ready = vi.fn()
    /** Responder reports preserve native authentication error identity. */
    const reports: unknown[] = []
    /** Required authentication remains strict on the actual installed auth owner. */
    const verify = (value: unknown) => {
      if (value !== 'reverse-required') throw new TypeError('reverse credential required')
      return 'approved-principal'
    }
    const service = await createRpcHost({
      self: { name: 'server', instanceId: 'server' },
      plugins: [
        auth({
          verifyCredentials(value) {
            verify(value)
          }
        }),
        probe({
          stages: ['peer'],
          emit(view) {
            if (view.lifecycle === RpcProbeLifecycle.ready) ready()
          }
        }),
        processPlugin({
          listen: join(directory, 'reverse.sock'),
          token: 'reverse-required',
          verify
        })
      ],
      report: (error) => reports.push(error)
    })
    /** This real initiator sends its canonical hello without installing credentials. */
    const raw = await dialIsolationSocket(join(directory, 'reverse.sock'))
    let candidate: Awaited<ReturnType<typeof createRpcHost>> | undefined
    try {
      await expect(
        createRpcHost({
          self: { name: 'caller', instanceId: 'caller' },
          plugins: [
            processPlugin({
              connect: {
                target: {
                  kind: 'connect',
                  address: 'missing-auth',
                  token: 'fixture-connect-input',
                  dial: async () => raw
                }
              }
            })
          ],
          report: (error) => reports.push(error)
        }).then((value) => {
          candidate = value
          return value
        })
      ).rejects.toMatchObject({
        code: 'REMOTE_START_FAILED',
        cause: { code: 'PROCESS_CHANNEL_AUTH_REJECTED' }
      })
      expect(ready).not.toHaveBeenCalled()
      writeFileSync(
        join(evidence, 'isolation-reverse.receipt.json'),
        JSON.stringify(
          {
            publications: ready.mock.calls.length,
            reports: reports.map((error) => serializeRpcError(error, { report: () => undefined }))
          },
          null,
          2
        )
      )
    } finally {
      await candidate?.close()
      await raw.close()
      await service.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('rejects actual over-capacity socket flood and returns every rejected descriptor', async () => {
    /** Two authenticated sessions and pending sockets share the current native default capacity. */
    const peer = await listener('flood')
    /** The provider's descriptor baseline includes two established sockets. */
    const sessions: Awaited<ReturnType<typeof client>>[] = []
    /** Unauthenticated native candidates reserve the remaining real listener slots until released. */
    const held: IRpcByteIO[] = []
    /** Refused ports remain fixture-owned until finally, even if their remote end already closes. */
    const refused: Awaited<ReturnType<typeof dialIsolationSocket>>[] = []
    /** Channel establishment errors preserve native public error identity. */
    const reports: unknown[] = []
    try {
      for (const token of [peer.tokens.alice, peer.tokens.bob])
        sessions.push(await client(fixturePeer, false, token, peer.address))
      const baseline = descriptors(peer.child.pid!)
      /** The canonical default is 64, so two ready sessions leave exactly 62 pending slots. */
      for (let index = 2; index < listenerCapacity; index++)
        held.push(await dialIsolationSocket(peer.address))
      await vi.waitFor(() =>
        expect(descriptors(peer.child.pid!)).toBe(baseline + listenerCapacity - 2)
      )
      for (let index = 0; index < 12; index++) {
        const raw = await dialIsolationSocket(peer.address)
        refused.push(raw)
        /** The raw peer close is independent from the managed caller's startup error projection. */
        const closed = vi.fn()
        raw.onClose(closed)
        await expect(
          connectRaw(raw, peer.tokens.alice, reports).then(async (active) => {
            await active.close()
          })
        ).rejects.toMatchObject({
          source: 'rpc.remote',
          code: 'REMOTE_START_FAILED'
        })
        await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1))
      }
      await Promise.all(held.map((raw) => raw.close()))
      await vi.waitFor(() => expect(descriptors(peer.child.pid!)).toBe(baseline))
      const receipt = await stats(sessions[1]!)
      expect(
        receipt.reports.filter(
          (value) =>
            value.wire.source === 'rpc.transport.process' &&
            value.wire.code === 'PROCESS_CONNECTION_LIMIT'
        )
      ).toHaveLength(12)
      expect(await sessions[0]!.namespace.request('p.f.request', ['still-alice'])).toMatchObject({
        session: { principalId: 'alice' }
      })
      expect(await sessions[1]!.namespace.request('p.f.request', ['still-bob'])).toMatchObject({
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
      await Promise.allSettled([...held, ...refused].map((raw) => raw.close()))
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
    const raws: Awaited<ReturnType<typeof dialIsolationSocket>>[] = []
    /** Actual responder rejects are decoded by the public frame owner. */
    const received: Uint8Array[] = []
    /** Verifier exceptions must not survive in the initiator's cause or serialization. */
    const reports: unknown[] = []
    /** A valid observer session remains alive after both invalid candidates. */
    let valid: Awaited<ReturnType<typeof client>> | undefined
    try {
      const raw = await dialIsolationSocket(peer.address)
      raws.push(raw)
      const closed = new Promise<void>((resolve) => raw.onClose(() => resolve()))
      raw.onData((chunk) => received.push(chunk.slice()))
      const hello = {
        profile: 'migaia.rpc/2',
        kind: 'handshake',
        step: 'hello',
        peer: { id: 'caller', runtime: 'node' },
        versions: [{ major: 2, minor: 0 }],
        codecs: ['json'],
        extensions: [],
        auth: sentinel,
        directory: {
          schemaVersion: 3,
          self: {
            name: 'caller',
            instanceId: 'caller',
            generation: { kind: 'connection', value: 0 },
            applicationVersion: '0.0.0'
          },
          methods: []
        }
      }
      hello.kind = sentinel
      await raw.write(encodeRpcStreamFrame(new TextEncoder().encode(JSON.stringify(hello))))
      await closed
      const invalid = await dialIsolationSocket(peer.address)
      raws.push(invalid)
      invalid.onData((chunk) => received.push(chunk.slice()))
      let failure: unknown
      await expect(
        connectRaw(invalid, sentinel, reports)
          .then(async (active) => {
            await active.close()
            return active
          })
          .catch((error) => {
            failure = error
            throw error
          })
      ).rejects.toMatchObject({
        code: 'REMOTE_START_FAILED',
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
      expect(await valid.namespace.request('p.f.request', ['after-invalid'])).toMatchObject({
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
    /** Equal message IDs on two admitted native sources expose an accidental global replay ledger. */
    const peer = await listener('replay')
    /** Each physical source has its own admitted public Host identity and authentication scope. */
    const sessions: Awaited<ReturnType<typeof observedClient>>[] = []
    try {
      sessions.push(await observedClient(peer.tokens.alice, peer.address))
      sessions.push(await observedClient(peer.tokens.bob, peer.address))
      const first = sessions[0]!
      const second = sessions[1]!
      const result = (await first.namespace.request('p.f.request', ['original'])) as IResult
      const request = first.sent.find((chunk) =>
        wireFrames([chunk]).some(
          (frame) => frame.kind === 'call' && JSON.stringify(frame.payload).includes('original')
        )
      )!
      expect(request).toBeDefined()
      /** Literal replay on the original socket preserves every byte, including the envelope id. */
      const id = wireFrames([request])[0].id
      expect(id).toEqual(expect.any(String))
      await first.raw.write(request)
      expect(((await first.namespace.request('p.f.request', ['stats'])) as IStats).executions).toBe(
        1
      )
      /** Borrow source-bound routing and generation facts from this second actual Host's own call. */
      await second.namespace.request('p.f.request', ['stats'])
      /** Native byte receipts supply both original envelopes without inventing admission metadata. */
      const original = wireFrames([request])[0]
      /** The uncounted stats call is already valid on Bob's independently admitted connection. */
      const secondSource = wireFrames(second.sent).find(
        (frame) => frame.kind === 'call' && frame.task.method === 'p.f.request'
      )!
      /** Keep the original id and payload while respecting this source's authenticated identity. */
      const repeated = {
        ...original,
        route: secondSource.route,
        task: {
          ...original.task,
          callerGeneration: secondSource.task.callerGeneration,
          targetGeneration: secondSource.task.targetGeneration
        }
      }
      expect(repeated.id).toBe(id)
      expect(repeated.payload).toEqual(original.payload)
      await second.raw.write(
        encodeRpcStreamFrame(new TextEncoder().encode(JSON.stringify(repeated)))
      )
      const receipt = (await second.namespace.request('p.f.request', ['stats'])) as IStats
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
      await Promise.allSettled(sessions.map((session) => session.close()))
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
    /** Native installation facts remain independent from the records under assertion. */
    const observed: {
      records: unknown[]
      identity?: { connectionId: string; sessionId?: string }
    } = { records: [] }
    /** Delegate to the same actual log feature after borrowing its real native context once. */
    const logging = ipcLog({
      report: (record) => {
        observed.records.push(record)
      }
    })
    const installed = await installBusinessClient(fixture, fixture.selected, [
      {
        ...logging,
        install(context: IIpcLogContext) {
          observed.identity = { connectionId: context.connectionId, sessionId: context.sessionId }
          return logging.install(context)
        }
      }
    ])
    /** Actual launched PID is sampled from the original handle, independently from IPC records. */
    const identity = { ...observed.identity, processId: String(fixture.handles[0]!.identity.pid) }
    const records = observed.records
    try {
      expect(await installed.namespace.request('p.f.request', ['stderr'])).toBe(true)
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
          session.namespace.request('p.f.request', ['same'], { idempotencyKey: 'stable-key' })
        )
      )) as IResult[]
      expect(second).toEqual(first)
      expect(first!.session.principalId).toBe('alice')
      expect(other!.session.principalId).toBe('bob')
      expect(other!.execution).toBe(2)
      expect((await stats(sessions[1]!)).executions).toBe(2)
      await sessions[0]!.close()
      expect(
        await sessions[1]!.namespace.request('p.f.request', ['same'], {
          idempotencyKey: 'stable-key'
        })
      ).toEqual(first)
      /** A released borrowed socket leaves both the shared cache and its external provider alive. */
      expect(peer.child.exitCode).toBeNull()
      /** Two independent provider calls receive their own session cancellation signal. */
      const controller = new AbortController()
      /** This cancellation targets only Alice's second physical session. */
      const waiting = sessions[1]!.namespace.request('p.f.request', [['wait', 'alice-wait']], {
        signal: controller.signal
      })
      /** Bob's simultaneous request returns independently. */
      const bob = (await sessions[2]!.namespace.request('p.f.request', ['bob-live'])) as IResult
      controller.abort(new RangeError('alice-only-cancel'))
      await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' })
      /** Subsequent request observes the second session instead of cached first-session context. */
      const alice = (await sessions[1]!.namespace.request('p.f.request', ['alice-live'])) as IResult
      expect(alice.session.sessionId).not.toBe(first!.session.sessionId)
      expect(alice.session.sessionId).not.toBe(bob.session.sessionId)
      /** Target one-way and stream calls also receive physical-session context. */
      await sessions[1]!.namespace.notify('p.f.oneWay', ['one-way'])
      /** The real unique method returns one iterator; no per-session facade is reconstructed. */
      const stream = sessions[2]!.namespace.stream('p.f.generator', ['stream'])
      if (!(Symbol.asyncIterator in stream))
        throw new TypeError('isolation requires one stream target')
      for await (const value of stream)
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
    '%s provider deadlines close only the offending borrowed socket',
    async (mode) => {
      /** One real child contains either one shared Host or one Host per physical connection. */
      const peer = await listener(mode)
      /** Two independently installed facades borrow the same provider PID. */
      /** Caller timers remain unadvanced; only the actual child's local deadline can fire. */
      const callerScheduler = createManualScheduler()
      const sessions: Awaited<ReturnType<typeof observedClient>>[] = []
      /** Actual business operations remain joined by finally when a later admission fails. */
      const pending: Promise<unknown>[] = []
      /**
       * Finally may release a failed oracle's local waits without changing the deadline
       * observation.
       */
      const controller = new AbortController()
      try {
        sessions.push(await observedClient(peer.tokens.alice, peer.address, callerScheduler))
        sessions.push(await observedClient(peer.tokens.bob, peer.address))
        const first = sessions[0]!
        const other = sessions[1]!
        /**
         * Actual application targets distinguish real per-connection construction from a renamed
         * shared fixture.
         */
        const firstTarget = await stats(first)
        const otherTarget = await stats(other)
        expect(firstTarget.pid).toBe(peer.child.pid)
        expect(otherTarget.pid).toBe(peer.child.pid)
        if (mode === 'per-connection')
          expect(firstTarget.targetInstance).not.toBe(otherTarget.targetInstance)
        else expect(firstTarget.targetInstance).toBe(otherTarget.targetInstance)
        /** Observe original remote EOF rather than disposal requested by this test. */
        const offenderClosed = vi.fn()
        const otherClosed = vi.fn()
        first.raw.onClose(offenderClosed)
        other.raw.onClose(otherClosed)
        for (let index = 0; index < 3; index++)
          pending.push(
            first.namespace
              .request('p.f.request', [['wait', `timeout-${index}`]], {
                timeout: timeout({ ms: 30, scheduler: callerScheduler }),
                signal: controller.signal
              })
              .then(
                (value) => value,
                (error: unknown) => error
              )
          )
        await vi.waitFor(() => expect(offenderClosed).toHaveBeenCalledTimes(1))
        /** EOF naturally rejects every core caller before finally performs any cancellation. */
        const outcomes = await Promise.all(pending)
        expect(outcomes).toHaveLength(3)
        expect(outcomes.every((error) => error instanceof Error)).toBe(true)
        /** The actual provider proves trusted local timeout instances, not deserialized wire codes. */
        const receipt = await stats(other)
        expect(receipt.pid).toBe(peer.child.pid)
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
        for (const error of outcomes) {
          /** A received deadline is final; a still-written request instead retains liquidation. */
          const wire = serializeRpcError(error, { report: () => undefined })
          if (wire.code === 'DEADLINE_EXCEEDED')
            expect(wire).toMatchObject({ source: 'rpc.endpoint', name: 'TimeoutError' })
          else
            expect(wire).toMatchObject({
              source: 'rpc.remote',
              code: 'REMOTE_RESULT_UNKNOWN',
              cause: {
                source: 'rpc.transport.process',
                code: 'PROCESS_LIQUIDATED',
                cause: { source: 'rpc.endpoint', code: 'DEADLINE_EXCEEDED' }
              }
            })
        }
        expect(callerScheduler.now()).toBe(0)
        expect(otherClosed).not.toHaveBeenCalled()
        /** The peer still serves the unaffected session without rebuilding its shared target. */
        const unaffected = (await sessions[1]!.namespace.request('p.f.request', [
          'after-timeouts'
        ])) as IResult
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
})
