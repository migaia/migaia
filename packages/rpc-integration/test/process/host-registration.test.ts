import { RpcCapability } from '@migaia/rpc-contract'
import { describe, expect, it, vi } from 'vitest'
import { RemoteMethodName } from '@migaia/rpc-host/plugin'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { deferred } from '@migaia/utils/promise'
import { createLifecycleScope } from '@migaia/lifecycle'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createProcessResilience } from '../../../rpc-plugin-process/dist/process/resilience/index.js'
import { listenProcessByteChannel } from '../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { createProcessError } from '../../../rpc-plugin-process/dist/process/error.js'
import { RpcProcessErrorCode } from '@migaia/rpc-plugin-process'
import type {
  IProcessRegistrationListener,
  IProcessRegistrationListenOptions
} from '../../../rpc-plugin-process/dist/process/resilience/types.js'
import {
  createRuntimePeer,
  type IRuntimePeer
} from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { nativeEndpoint } from './fixtures/native-runtime.js'
import { nativeHostChildPath, nativeHostToken } from './fixtures/host-native.js'

/** Cold process work keeps the original bounded observation envelope. */
const REGISTRATION_CONNECTION_TIMEOUT_MS = 4000
/** Observe settlement without replacing the production rejection or cause. */
async function withinRegistration<T>(operation: T): Promise<Awaited<T>> {
  /** This timer belongs only to observation and always retires after settlement. */
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(createProcessError(RpcProcessErrorCode.handshakeTimeout)),
          REGISTRATION_CONNECTION_TIMEOUT_MS
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
/** A real reverse peer initiates the original authenticated native process handshake once. */
function reversePeer(address: string, token = nativeHostToken) {
  /** The child serves an already-registered local provider, without remote Host control. */
  const child = spawn(process.execPath, [nativeHostChildPath], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { RPC_REGISTRATION_ADDRESS: address, RPC_HOST_TOKEN: token }
  })
  /** Native startup is visible independently of its exit and the listener's admission callback. */
  const ready = deferred<void>()
  /** Preserve stderr for token-redaction assertions without replaying its contents. */
  const errors: string[] = []
  /** Only the marker suffix crosses physical chunk boundaries. */
  let suffix = ''
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    errors.push(text)
    const pending = suffix + text
    if (pending.includes('registration-peer-ready')) ready.resolve()
    suffix = pending.slice(-'registration-peer-ready'.length)
  })
  /** An early exit rejects current readiness while retaining the real exit receipt. */
  const exited = new Promise<void>((resolve, reject) => {
    child.once('exit', () => {
      ready.reject(createProcessError(RpcProcessErrorCode.channelClosed))
      resolve()
    })
    child.once('error', reject)
  })
  void ready.promise.catch(() => undefined)
  return {
    child,
    errors,
    exited,
    ready: ready.promise,
    async close() {
      if (child.exitCode === null) child.kill('SIGKILL')
      await withinRegistration(exited)
    }
  }
}
/** Native candidate shape comes directly from the retained governor listener contract. */
type ICandidate = Parameters<IProcessRegistrationListenOptions['onCandidate']>[0]
/** Each accepted resource exposes the actual Peer and the original lease/cancellation capability. */
type IAccepted = Readonly<{ candidate: ICandidate; peer: IRuntimePeer }>

/** Own actual listener/adopted resources while Core owns description, endpoint and native leases. */
class RegistrationFixture {
  /** Preserve complete original failures for authentication, capacity and cleanup assertions. */
  readonly reports: unknown[] = []
  /** Native policy owns authentication admission and EOF lease release. */
  readonly governor = createProcessResilience({
    scheduler: systemScheduler,
    report: (error) => this.reports.push(error),
    maxConnections: 2
  })
  /** A listener close must never close this borrowed governor. */
  readonly closeGovernor = vi.fn(() => this.governor.close())
  /** Existing lifecycle scope supplies the stable complete cleanup Promise. */
  readonly scope = createLifecycleScope({
    scheduler: systemScheduler,
    report: (error) => this.reports.push(error)
  })
  /** Accepted Peers remain alive independently of listener close until their actual owner releases. */
  readonly entries: IAccepted[] = []
  /** Every started candidate retains its real Core preparation Promise for abort assertions. */
  readonly attempts: Promise<IRuntimePeer>[] = []
  /** Listener resources are acquired once by open. */
  listener: IProcessRegistrationListener | undefined
  /** A test may hold actual outbound describe while native cancellation proceeds. */
  holdDescription = false
  /** Actual endpoint dispose calls remain visible independently of lease close. */
  readonly dispose = vi.fn()
  /** The first real describe send resolves this observation before any optional hold. */
  readonly describing = deferred<void>()
  /** Only the delayed-description test holds and releases this original send boundary. */
  readonly continueDescription = deferred<void>()
  /** A sequential spawned candidate resolves the exact current acceptance observer. */
  #accepted: ((entry: IAccepted) => void) | undefined
  /** Authenticate before actual Peer construction and retain the verifier's principal identity. */
  async open(address: string): Promise<void> {
    this.listener = await this.governor.listenRegistrations({
      listen: listenProcessByteChannel,
      address,
      serviceId: 'host-reverse-fixture',
      wire: 'native',
      scheduler: systemScheduler,
      handshakeTimeoutMs: REGISTRATION_CONNECTION_TIMEOUT_MS,
      offer: createNativeProcessOffer({
        peer: { id: 'registration-server', runtime: 'node' },
        stream: true,
        capabilities: [RpcCapability.runtimeApi]
      }),
      createConnectionContext: () => ({
        peerId: 'registration-peer',
        ipc: {
          connectionId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          log: () => undefined
        }
      }),
      verifyToken: (token) => {
        if (token !== nativeHostToken && token !== 'second-reverse-fixture')
          throw createProcessError(RpcProcessErrorCode.authRejected)
        return token === 'second-reverse-fixture' ? 'approved-second' : 'approved-principal'
      },
      onCandidate: this.#onCandidate
    })
    this.scope.own(this.entries, {
      force: async () => {
        await Promise.allSettled(this.attempts)
        await Promise.all(
          this.entries.map(async (entry) => {
            await entry.peer.close()
            await entry.candidate.close()
          })
        )
      }
    })
    this.scope.own(this.listener, { force: () => this.listener!.close() })
  }
  /** Canonical Core construction owns startup rollback; only accepted resources transfer out. */
  #onCandidate: IProcessRegistrationListenOptions['onCandidate'] = async (candidate) => {
    /** The actual scope derives principal replay policy from this authenticated candidate. */
    const session = {
      identity: candidate.identity,
      ...this.governor.sessionOptions(candidate.identity)
    }
    /** These are the original native roots, including the retained foreign stream wire oracle. */
    const served = await nativeEndpoint(candidate.channel, 'registration-server', session)
    /** Observation changes no directory, grammar or physical transport identity. */
    const endpoint = {
      ...served,
      endpoint: Object.create(
        served.endpoint,
        Object.getOwnPropertyDescriptors({
          send: async <T>(...args: Parameters<typeof served.endpoint.send>) => {
            if (args[1] === RemoteMethodName.runtimeDescribe) {
              this.describing.resolve()
              if (this.holdDescription) await this.continueDescription.promise
            }
            return served.endpoint.send<T>(...args)
          },
          dispose: () => {
            this.dispose()
            return served.endpoint.dispose()
          }
        })
      )
    }
    /** Actual cancellation is the governor candidate signal, never a manufactured terminal state. */
    const preparing = createRuntimePeer(
      {
        self: { name: 'registration-server', instanceId: 'registration-server' },
        report: (error) => this.reports.push(error)
      },
      { channel: candidate.channel, signal: candidate.signal, endpoint }
    )
    this.attempts.push(preparing)
    /** Await the original Peer readiness before transferring the original lease. */
    const peer = await preparing
    /** Keep the actual resource and verifier identity together, without a Plugin proxy. */
    const entry = Object.freeze({ candidate, peer })
    this.entries.push(entry)
    this.#accepted?.(entry)
    return 'adopt' as const
  }
  /** Spawn and join one actual native reverse connection through its acceptance event. */
  async accept(address: string, token = nativeHostToken) {
    /** This one acceptance observer belongs to the sequential native setup call. */
    const accepted = deferred<IAccepted>()
    this.#accepted = (entry) => accepted.resolve(entry)
    /** The actual child readiness and accepted Peer are independent original native facts. */
    const child = reversePeer(address, token)
    try {
      return { child, entry: await withinRegistration(accepted.promise) }
    } catch (error) {
      await child.close()
      throw error
    } finally {
      this.#accepted = undefined
    }
  }
}

describe('process native reverse registration ownership', () => {
  it('aborts a delayed description before publication and releases its candidate without a tombstone', async () => {
    /** The real Unix listener and child retain the original authenticated transport path. */
    const directory = await mkdtemp('/tmp/rpc-adopt-')
    /** Candidate resources remain separate from the borrowed governor's lifetime. */
    const fixture = new RegistrationFixture()
    fixture.holdDescription = true
    await fixture.open(join(directory, 'r'))
    /** This peer is never accepted into the fixture's live resource collection. */
    const child = reversePeer(fixture.listener!.address)
    try {
      await withinRegistration(fixture.describing.promise)
      expect(fixture.entries).toHaveLength(0)
      await withinRegistration(fixture.listener!.close())
      fixture.continueDescription.resolve()
      expect((await withinRegistration(Promise.allSettled(fixture.attempts)))[0]).toMatchObject({
        status: 'rejected'
      })
      expect(fixture.entries).toHaveLength(0)
      expect(fixture.dispose).toHaveBeenCalledTimes(1)
      expect(fixture.governor.inspect('pending-connection')).toBeUndefined()
      expect(fixture.closeGovernor).not.toHaveBeenCalled()
    } finally {
      fixture.continueDescription.resolve()
      await withinRegistration(fixture.scope.dispose())
      await child.close()
      await fixture.governor.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('retains verified principals, rejects capacity, releases EOF and admits a fresh real connection', async () => {
    /** Original native admission policy limits this listener to two physical connections. */
    const directory = await mkdtemp('/tmp/rpc-adopt-')
    /** The same governor supplies actual authenticated identities and original native leases. */
    const fixture = new RegistrationFixture()
    await fixture.open(join(directory, 'r'))
    /** Auth rejection precedes candidate publication and cannot consume a permanent lease. */
    const rejected = reversePeer(fixture.listener!.address, 'wrong-fixture-token')
    await withinRegistration(rejected.exited)
    /** Join the original async failed-handshake cleanup before starting the accepted candidates. */
    await vi.waitFor(
      () =>
        expect(fixture.reports).toContainEqual(
          expect.objectContaining({ code: RpcProcessErrorCode.authRejected })
        ),
      { timeout: REGISTRATION_CONNECTION_TIMEOUT_MS }
    )
    /** Each accepted actual Peer keeps its original authenticated principal and child PID. */
    const first = await fixture.accept(fixture.listener!.address)
    /** A separate approved principal is independent while both actual connections are live. */
    const independent = await fixture.accept(fixture.listener!.address, 'second-reverse-fixture')
    /** No third candidate can pass connection admission while both leases remain held. */
    const excess = reversePeer(fixture.listener!.address)
    let replacement: Awaited<ReturnType<typeof fixture.accept>> | undefined
    try {
      expect(first.entry.candidate.identity.principalId).toBe('approved-principal')
      expect(independent.entry.candidate.identity.principalId).toBe('approved-second')
      expect(
        await withinRegistration(first.entry.peer.request('p.f.request', ['reverse']))
      ).toMatchObject({ pid: first.child.child.pid })
      await withinRegistration(excess.exited)
      expect(fixture.reports).toContainEqual(
        expect.objectContaining({ code: RpcProcessErrorCode.connectionLimit })
      )
      expect(fixture.entries).toHaveLength(2)
      await first.child.close()
      await vi.waitFor(() => expect(first.entry.candidate.signal.aborted).toBe(true), {
        timeout: REGISTRATION_CONNECTION_TIMEOUT_MS
      })
      await withinRegistration(first.entry.candidate.close())
      expect(
        await withinRegistration(independent.entry.peer.request('p.f.request', ['unaffected']))
      ).toMatchObject({ pid: independent.child.child.pid })
      replacement = await fixture.accept(fixture.listener!.address)
      expect(replacement.entry.candidate.identity.principalId).toBe('approved-principal')
      expect(
        await withinRegistration(replacement.entry.peer.request('p.f.request', ['new']))
      ).toMatchObject({ pid: replacement.child.child.pid })
      await withinRegistration(fixture.listener!.close())
      expect(
        await withinRegistration(replacement.entry.peer.request('p.f.request', ['listener-closed']))
      ).toMatchObject({ pid: replacement.child.child.pid })
      /** The existing scope, not an adoption wrapper, retains the stable complete cleanup receipt. */
      const closing = fixture.scope.dispose()
      expect(fixture.scope.dispose()).toBe(closing)
      await withinRegistration(closing)
      await withinRegistration(Promise.all([replacement.child.exited, independent.child.exited]))
      expect(fixture.closeGovernor).not.toHaveBeenCalled()
      expect(first.child.errors.join('')).not.toContain(nativeHostToken)
      expect(replacement.child.errors.join('')).not.toContain(nativeHostToken)
    } finally {
      await withinRegistration(fixture.scope.dispose())
      await Promise.allSettled([
        first.child.close(),
        independent.child.close(),
        rejected.close(),
        excess.close(),
        replacement?.child.close()
      ])
      await fixture.governor.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
