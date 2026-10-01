import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync, writeFileSync, unlinkSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { serializeRpcError, createRpcHello } from '@migaia/rpc/contract'
import { encodeRpcStreamFrame } from '@migaia/rpc/contract/framing/stream'
import {
  createNativeProcessOffer,
  createProcessTransport,
  createServeProcessHost
} from '@migaia/rpc/process'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '@migaia/rpc/process/adapters/node-socket'
import {
  client,
  peers,
  evidence,
  wireFrames,
  deployment,
  contract
} from './fixtures/conformance-business.js'
import { PluginHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createProcessPlugin } from '@migaia/rpc/process'
import { endpointFor } from './peers/ts/runtime.js'

/** Observe actual child descriptors; lsof is never used as a simulated admission counter. */
function descriptors(pid: number): number {
  return execFileSync('lsof', ['-p', String(pid), '-Ff'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => /^f\d/.test(line)).length
}

/** Existing deployment helper provides the authenticated facade while retaining its physical port. */
async function observedClient(token: string, address: string) {
  /** Production deployment retains encoded outbound bytes for replay injection. */
  const fixture = deployment(fixturePeer, false, token, address)
  /** The canonical establish callback remains the channel owner. */
  const establish = fixture.selected.establish
  /** This observer only exposes the existing physical port for a literal captured-frame replay. */
  let raw: Awaited<ReturnType<typeof dialProcessByteChannel>> | undefined
  const selected = {
    ...fixture.selected,
    establish: async (
      channel: Parameters<typeof establish>[0],
      context: Parameters<typeof establish>[1]
    ) => {
      raw = channel as typeof raw
      return establish(channel, context)
    }
  }
  /** An actual PluginHost installs the same public process facade used by the business matrix. */
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** No alternate replay or idempotency implementation participates in this fixture. */
  const definition = createProcessPlugin({
    name: 'p',
    contract,
    registrationOwner: { name: 'p', host },
    host: host.plugin,
    deployment: selected,
    endpointFactory: (channel) => endpointFor(channel, 'caller'),
    report: (error) => fixture.reports.push(error)
  })
  /** The installed feature is the production proxy, rather than a test provider stand-in. */
  const [installed] = await host.use(definition)
  return {
    ...fixture,
    raw: raw!,
    feature: installed!.getFeature('f') as Awaited<ReturnType<typeof client>>['feature'],
    close: async () => {
      await host.dispose()
    }
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
  aborts: Array<IResult['session'] & { label: string; code?: string }>
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
  /** Temporary files and socket belong only to this fixture. */
  const directory = await mkdtemp(join(tmpdir(), 'rpc-hi-'))
  /** Unique authentication sentinels distinguish principals without being process metadata. */
  const tokens = { alice: randomUUID(), bob: randomUUID() }
  /** Private descriptor input contains credentials; only the child reads this content. */
  const authPath = join(directory, 'auth')
  writeFileSync(authPath, JSON.stringify(tokens), { mode: 0o600 })
  /** The child never receives a token in arguments or environment. */
  const descriptor = openSync(authPath, 'r')
  /** Physical rendezvous location carries no business or authentication material. */
  const address = join(directory, 'peer.sock')
  /** This fixture owns the external PID; processPlugin clients only borrow its sockets. */
  const child = spawn(process.execPath, [...fixturePeer.args, mode, address], {
    stdio: ['ignore', 'pipe', 'pipe', descriptor]
  })
  closeSync(descriptor)
  /** The inherited open descriptor survives unlink; no private credential file remains on disk. */
  unlinkSync(authPath)
  /** All raw outputs survive success and failure for precise child-side diagnosis. */
  const stdout: Buffer[] = []
  /** Listener diagnostics must contain no credential substring. */
  const stderr: Buffer[] = []
  child.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr!.on('data', (chunk: Buffer) => stderr.push(chunk))
  /** Readiness is an explicit child receipt rather than a timing assumption. */
  await new Promise<void>((resolve, reject) => {
    /** The ready output can arrive across chunks. */
    const onData = () => {
      if (Buffer.concat(stderr).includes('ISOLATION_READY:')) {
        child.stderr!.off('data', onData)
        resolve()
      }
    }
    child.stderr!.on('data', onData)
    child.once('exit', (code) => reject(new Error(`isolation child exited before ready: ${code}`)))
    child.once('error', reject)
  })
  return {
    child,
    address,
    tokens,
    close: async () => {
      /** Client sockets are closed by their owners before this fixture stops its external PID. */
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
      writeFileSync(join(evidence, `isolation-${mode}.stdout.log`), Buffer.concat(stdout))
      writeFileSync(join(evidence, `isolation-${mode}.stderr.log`), Buffer.concat(stderr))
      noSecret(Buffer.concat(stderr).toString(), tokens.alice)
      noSecret(Buffer.concat(stderr).toString(), tokens.bob)
    }
  }
}

/** Query receipts through the same publicly installed proxy that performs business work. */
async function stats(active: Pick<Awaited<ReturnType<typeof client>>, 'feature'>): Promise<IStats> {
  return (await active.feature.request(['stats'])) as IStats
}

describe('[A7] real process session and principal isolation', () => {
  it('[A7.1] no-token reverse native registration never resolves permission, constructs endpoint or installs plugin', async () => {
    /** Both main ingress and reverse-registration sockets are real public listeners. */
    const directory = await mkdtemp(join(tmpdir(), 'rpc-hi-reverse-'))
    /** The target Host begins empty; an actual use observer detects any unauthorized installation. */
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** This approved implementation remains strictly local and is never transferred over the socket. */
    const definition = definePlugin({
      name: 'p',
      install: () => ({}),
      features: { f: defineFeature(() => ({ request: (input: unknown) => input })) }
    })
    /** Installation observes the real Host method rather than substituting a fake target. */
    const use = vi.spyOn(host, 'use')
    /** Responder reports preserve native authentication error identity. */
    const reports: unknown[] = []
    /** Permission selection is allowed only after authenticated pending.accept. */
    const resolveRegistration = vi.fn(() => ({ targetHost: host, name: 'p', contract }))
    /** No unauthorized candidate may reach endpoint construction. */
    const endpointFactory = vi.fn((channel: Parameters<typeof endpointFor>[0]) =>
      endpointFor(channel, 'server')
    )
    /** Native required authentication rejects absent credentials before any Host adoption path. */
    const verify = (auth: unknown) => {
      if (auth !== 'reverse-required') throw new TypeError('reverse credential required')
      return 'approved-principal'
    }
    /** A production process Host owns both its public ingress and reverse-registration listener. */
    const service = await createServeProcessHost({
      host,
      catalog: { p: contract },
      resolvePlugin: () => definition,
      scheduler: systemScheduler,
      report: (error) => reports.push(error),
      endpointFactory,
      ingress: {
        kind: 'listener',
        address: join(directory, 'main.sock'),
        listen: listenProcessByteChannel,
        verify,
        offer: createNativeProcessOffer({ peer: { id: 'server', runtime: 'node' } }),
        createConnectionContext: () => ({
          peerId: 'caller',
          ipc: { connectionId: 'main', sessionId: 'main', log: () => undefined }
        })
      },
      registrations: {
        address: join(directory, 'reverse.sock'),
        serviceId: 'rpc-hi-reverse',
        listen: listenProcessByteChannel,
        verifyToken: verify,
        offer: createNativeProcessOffer({ peer: { id: 'server', runtime: 'node' } }),
        createConnectionContext: () => ({
          peerId: 'caller',
          ipc: { connectionId: 'reverse', sessionId: 'reverse', log: () => undefined }
        }),
        resolveRegistration
      }
    })
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
      expect(resolveRegistration).not.toHaveBeenCalled()
      expect(endpointFactory).not.toHaveBeenCalled()
      expect(use).not.toHaveBeenCalled()
      writeFileSync(
        join(evidence, 'isolation-reverse.receipt.json'),
        JSON.stringify(
          {
            permission: resolveRegistration.mock.calls.length,
            endpoints: endpointFactory.mock.calls.length,
            installs: use.mock.calls.length,
            reports: reports.map((error) => serializeRpcError(error, { report: () => undefined }))
          },
          null,
          2
        )
      )
    } finally {
      await raw.close()
      await service.close()
      await host.dispose()
    }
  })
  it('[A7.1] rejects actual over-capacity socket flood and returns every rejected descriptor', async () => {
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

  it('[A7.2] malformed hello and secret-bearing verifier failure redact native cause, report and reject', async () => {
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
            auth: sentinel
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

  it('[A7.4] equal inbound msgid replay is connection-local while repeated same-session frames do not execute twice', async () => {
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

  it('[A7.3] bootstrap peer splits stderr token into three-character writes; IPC keeps only identity and fixed text', async () => {
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
    /** A real local Host owns public proxy installation and cleanup. */
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** The public process plugin owns the actual launcher, endpoint and generation subscriptions. */
    const definition = createProcessPlugin({
      name: 'p',
      contract,
      registrationOwner: { name: 'p', host },
      host: host.plugin,
      deployment: selected,
      endpointFactory: (channel) => endpointFor(channel, 'caller'),
      report: (error) => fixture.reports.push(error)
    })
    try {
      const [installed] = await host.use(definition)
      const feature = installed!.getFeature('f') as Awaited<ReturnType<typeof client>>['feature']
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
      await host.dispose()
      for (const handle of fixture.handles) await handle.exited
      /**
       * Raw secret-bearing stderr is deliberately not persisted; the redacted receipt is
       * sufficient.
       */
      writeFileSync(join(evidence, 'isolation-stderr.stdout.bin'), Buffer.concat(fixture.stdout))
    }
  })
  it('[A7.4/A7.5/A7.6] shares stable principal results across sessions while isolating abort and context', async () => {
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
    '[A7.7/A7.8] %s consecutive request timeouts close only the offending borrowed socket',
    async (mode) => {
      /** One real child contains either one shared Host or one Host per physical connection. */
      const peer = await listener(mode)
      /** Two independently installed facades borrow the same provider PID. */
      const first = await observedClient(peer.tokens.alice, peer.address)
      const other = await observedClient(peer.tokens.bob, peer.address)
      /**
       * These callbacks observe actual remote socket EOF rather than disposal requested by the
       * test.
       */
      const offenderClosed = vi.fn()
      const otherClosed = vi.fn()
      first.raw.onClose(offenderClosed)
      other.raw.onClose(otherClosed)
      const sessions: Array<Pick<Awaited<ReturnType<typeof client>>, 'feature' | 'close'>> = [
        first,
        other
      ]
      try {
        for (let index = 0; index < 3; index++)
          await expect(
            sessions[0]!.feature.request([['wait', `timeout-${index}`]], { timeoutMs: 30 })
          ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
        /** Persist provider cancellation evidence before the decisive physical-close assertion. */
        writeFileSync(
          join(evidence, `isolation-${mode}-timeouts.receipt.json`),
          JSON.stringify(await stats(other), null, 2)
        )
        await vi.waitFor(() => expect(offenderClosed).toHaveBeenCalledTimes(1))
        expect(otherClosed).not.toHaveBeenCalled()
        /** The peer still serves the unaffected session without rebuilding its shared target. */
        const unaffected = (await sessions[1]!.feature.request(['after-timeouts'])) as IResult
        expect((await stats(sessions[1]!)).replacements).toBe(0)
        expect(peer.child.exitCode).toBeNull()
        await sessions[0]!.close()
        expect(unaffected.session.principalId).toBe('bob')
      } finally {
        await Promise.allSettled(sessions.map((session) => session.close()))
        expect(peer.child.exitCode).toBeNull()
        await peer.close()
      }
    }
  )
  it.each(['shared', 'per-connection'] as const)(
    '[A7.7/A7.8] %s explicit health replaces only its owned instance in the same PID',
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
      const sessions: Array<Pick<Awaited<ReturnType<typeof client>>, 'feature' | 'close'>> = [
        first,
        other
      ]
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
