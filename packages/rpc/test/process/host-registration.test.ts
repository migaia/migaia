import { describe, expect, it, vi } from 'vitest'
import { RemoteMethodName } from '../../src/remote/constants.js'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createServeProcessHost } from '../../src/process/host/serve.js'
import { createProcessResilience } from '../../src/process/resilience/index.js'
import { listenProcessByteChannel } from '../../src/process/adapters/node-socket.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createProcessError } from '../../src/process/error.js'
import { RpcProcessErrorCode } from '../../src/process/error-code.js'
import type { IProcessRegistrationListener } from '../../src/process/resilience/types.js'
import { nativeEndpoint } from './fixtures/native-runtime.js'
import { nativeHostCatalog, nativeHostChildPath, nativeHostToken } from './fixtures/host-native.js'
import { remoteHarness, REMOTE_FIXTURE_CONTRACT } from '../remote/fixture.js'
import { adoptHostRegistration } from '../../src/process/host/registration.js'
import type { IProcessServeHostOptions } from '../../src/process/host/types.js'

/** Cold process connection work stays within the existing 5000ms test envelope. */
const REGISTRATION_CONNECTION_TIMEOUT_MS = 4000

/** Bound fixture observation without replacing the rejection produced by the production owner. */
async function withinRegistration<T>(operation: T): Promise<Awaited<T>> {
  /** One timer belongs only to this observation and is always cleared after settlement. */
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

/** The peer initiates exactly once using the production native byte handshake. */
function reversePeer(address: string, token = nativeHostToken, badDescription = false) {
  const child = spawn(process.execPath, [nativeHostChildPath], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      RPC_REGISTRATION_ADDRESS: address,
      RPC_HOST_TOKEN: token,
      ...(badDescription ? { RPC_BAD_DESCRIPTION: '1' } : {})
    }
  })
  /** Successful provider installation precedes reverse description admission. */
  let observeReady!: () => void
  /** An early child exit must fail the current candidate instead of stranding its barrier. */
  let rejectReady!: (reason: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    observeReady = resolve
    rejectReady = reject
  })
  void ready.catch(() => undefined)
  const errors: string[] = []
  child.stderr.on('data', (chunk: Buffer) => {
    errors.push(chunk.toString())
    if (errors.join('').includes('registration-peer-ready')) observeReady()
  })
  const exited = new Promise<void>((resolve, reject) => {
    child.once('exit', () => {
      rejectReady(createProcessError(RpcProcessErrorCode.channelClosed))
      resolve()
    })
    child.once('error', reject)
  })
  return {
    child,
    errors,
    exited,
    ready,
    async close() {
      if (child.exitCode === null) child.kill('SIGKILL')
      await withinRegistration(exited)
    }
  }
}

describe('process Host reverse native registration', () => {
  it('[A7] aborts a delayed description before target installation and closes its registration without a tombstone', async () => {
    const fixture = remoteHarness()
    const target = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const use = vi.spyOn(target, 'use')
    const governor = createProcessResilience({
      scheduler: fixture.binding.scheduler,
      report: () => undefined
    })
    const attach = vi.fn((...args: Parameters<typeof governor.attachRegistration>) =>
      governor.attachRegistration(...args)
    )
    const controller = new AbortController()
    let continueDescription!: () => void
    let describeStarted!: () => void
    const delayed = new Promise<void>((resolve) => {
      continueDescription = resolve
    })
    const started = new Promise<void>((resolve) => {
      describeStarted = resolve
    })
    const candidate = {
      channel: fixture.channel,
      identity: {
        connectionId: 'pending-connection',
        sessionId: 'pending-session',
        principalId: 'verified'
      },
      signal: controller.signal,
      close: vi.fn(async () => undefined)
    }
    const definition = definePlugin({ name: 'p', install: () => ({}) })
    const options: IProcessServeHostOptions = {
      host: target,
      catalog: { p: REMOTE_FIXTURE_CONTRACT },
      resolvePlugin: () => definition,
      scheduler: fixture.binding.scheduler,
      report: () => undefined,
      ingress: {
        kind: 'listener',
        address: 'unused',
        listen: vi.fn(),
        offer: createNativeProcessOffer({ peer: { id: 'local', runtime: 'fixture' } }),
        verify: () => 'verified',
        createConnectionContext: vi.fn()
      },
      endpointFactory: async () => ({
        ...fixture.served,
        endpoint: {
          ...fixture.served.endpoint,
          async send<T>() {
            describeStarted()
            await withinRegistration(delayed)
            return REMOTE_FIXTURE_CONTRACT as T
          }
        }
      }),
      registrations: {
        address: 'unused',
        listen: vi.fn(),
        offer: createNativeProcessOffer({ peer: { id: 'local', runtime: 'fixture' } }),
        createConnectionContext: vi.fn(),
        verifyToken: () => 'verified',
        resolveRegistration: () => ({
          targetHost: target,
          name: 'p',
          contract: REMOTE_FIXTURE_CONTRACT
        })
      }
    }
    const adopting = adoptHostRegistration(
      candidate,
      options,
      { ...governor, attachRegistration: attach },
      new Set()
    )
    const outcome = Promise.allSettled([adopting])
    try {
      await withinRegistration(started)
      expect(use).not.toHaveBeenCalled()
      controller.abort(new Error('pending registration closed'))
      continueDescription()
      expect((await withinRegistration(outcome))[0]).toMatchObject({ status: 'rejected' })
      expect(use).not.toHaveBeenCalled()
      expect(fixture.calls.filter((item) => item === 'endpoint.dispose')).toHaveLength(1)
      expect(attach).toHaveBeenCalledTimes(1)
      expect(governor.inspect(attach.mock.calls[0]![0])).toBeUndefined()
      expect(candidate.close).not.toHaveBeenCalled()
    } finally {
      continueDescription()
      await withinRegistration(governor.close())
      await withinRegistration(target.dispose())
    }
  })
  it('[A7] installs only the verified principal, suspends on EOF and adopts a new connection', async () => {
    const directory = await withinRegistration(mkdtemp('/tmp/rpc-adopt-'))
    const address = join(directory, 'r')
    const target = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** The same plugin name on another trusted Host has independent adoption authority. */
    const secondTarget = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** Observe actual installation entry so CPU load cannot outrun a polling deadline. */
    let observeSecondUse!: () => void
    /** This connection installs on the independent approved Host. */
    const secondInstalling = new Promise<void>((resolve) => {
      observeSecondUse = resolve
    })
    /** Capture the original method before installing the spy, without bind/call/apply. */
    const secondMethod = secondTarget.use
    const secondUse = vi.spyOn(secondTarget, 'use').mockImplementation((definition) => {
      /** Native invocation preserves the private-field receiver of the original class method. */
      const operation = Reflect.apply(secondMethod, secondTarget, [definition])
      observeSecondUse()
      return operation
    })
    const reports: unknown[] = []
    const report = (error: unknown) => {
      reports.push(error)
    }
    const governor = createProcessResilience({
      scheduler: systemScheduler,
      report,
      maxConnections: 2
    })
    /** The rejected description releases its canonical physical lease before another candidate. */
    let observeBadClose!: () => void
    const badClosed = new Promise<void>((resolve) => {
      observeBadClose = resolve
    })
    /** The duplicate also returns its lease before the independently authorized connection. */
    let observeDuplicateClose!: () => void
    const duplicateClosed = new Promise<void>((resolve) => {
      observeDuplicateClose = resolve
    })
    /** Only authenticated rejected candidates have a close barrier in this scenario. */
    let rejectedCandidates = 0
    /** Authentication rejection has no candidate callback, but still owns a physical lease. */
    let observeRejectedClose!: () => void
    /** The manager returns the failed handshake lease in the close caller's finally. */
    const rejectedClosed = new Promise<void>((resolve) => {
      observeRejectedClose = resolve
    })
    /** The first physical connection is deliberately the unauthenticated rejection. */
    let physicalConnections = 0
    /** EOF-driven removal also finishes its physical lease before the replacement connects. */
    let observeFirstClose!: () => void
    const firstClosed = new Promise<void>((resolve) => {
      observeFirstClose = resolve
    })
    let listener: IProcessRegistrationListener | undefined
    const closeGovernor = vi.fn(() => governor.close())
    /** Each spawned peer publishes its provider before the candidate starts cold discovery. */
    let peerReady: Promise<void> = Promise.resolve()
    /** A rejection races every success-only barrier and preserves its original cause. */
    let rejectCandidate!: (reason: unknown) => void
    const failedCandidate = new Promise<never>((_resolve, reject) => {
      rejectCandidate = reject
    })
    void failedCandidate.catch(() => undefined)
    /** Observe production close only; this test never calls a candidate's close capability. */
    const external = {
      ...governor,
      close: closeGovernor,
      async listenRegistrations(options: Parameters<typeof governor.listenRegistrations>[0]) {
        listener = await withinRegistration(
          governor.listenRegistrations({
            ...options,
            handshakeTimeoutMs: REGISTRATION_CONNECTION_TIMEOUT_MS,
            listen: (listenOptions) =>
              options.listen({
                ...listenOptions,
                onConnection(pending) {
                  const ordinal = ++physicalConnections
                  listenOptions.onConnection({
                    ...pending,
                    async accept(acceptOptions) {
                      const accepted = await withinRegistration(pending.accept(acceptOptions))
                      return {
                        ...accepted,
                        channel: {
                          ...accepted.channel,
                          async close() {
                            await withinRegistration(accepted.channel.close())
                            // Observe after the manager's synchronous lease-release finally.
                            setImmediate(() => {
                              if (ordinal === 2) observeFirstClose()
                              if (ordinal === 3) observeBadClose()
                              if (ordinal === 4) observeDuplicateClose()
                            })
                          }
                        }
                      }
                    },
                    async close() {
                      await withinRegistration(pending.close())
                      if (ordinal === 1) setImmediate(observeRejectedClose)
                    }
                  })
                }
              }),
            async onCandidate(candidate) {
              try {
                await withinRegistration(peerReady)
              } catch (error) {
                rejectCandidate(error)
                throw error
              }
              const [outcome] = await withinRegistration(
                Promise.allSettled([options.onCandidate(candidate)])
              )
              if (outcome!.status === 'rejected') {
                rejectedCandidates += 1
                /**
                 * Bad description and duplicate rejection are intentional; other rejection is
                 * fatal.
                 */
                if (physicalConnections !== 3 && physicalConnections !== 4)
                  rejectCandidate(outcome!.reason)
                throw outcome!.reason
              }
              return outcome!.value
            }
          })
        )
        return listener
      }
    }
    /** This blueprint supplies a name-addressed dependency reference, not executable peer authority. */
    const blueprint = definePlugin({
      name: 'p',
      features: { f: defineFeature(() => ({ request: (_params: unknown) => undefined })) },
      install: () => ({})
    })
    const resolveRegistration = vi.fn((principal: string) =>
      principal === 'approved-principal'
        ? { targetHost: target, name: 'p', contract: nativeHostCatalog.p! }
        : principal === 'approved-second'
          ? { targetHost: secondTarget, name: 'p', contract: nativeHostCatalog.p! }
          : undefined
    )
    /** First installation and reconnection each have a separate observable entry event. */
    let observeFirstUse!: () => void
    /** Replacement must not be mistaken for the duplicate registration attempt. */
    let observeReplacementUse!: () => void
    /** The initial approved peer waits for actual target installation. */
    const firstInstalling = new Promise<void>((resolve) => {
      observeFirstUse = resolve
    })
    /** The new physical connection must reach its own target installation. */
    const replacementInstalling = new Promise<void>((resolve) => {
      observeReplacementUse = resolve
    })
    /** Capture the original method before the spy replaces it. */
    const targetMethod = target.use
    const use = vi.spyOn(target, 'use').mockImplementation((definition) => {
      /** Native invocation preserves the original private-field receiver and returned Promise. */
      const operation = Reflect.apply(targetMethod, target, [definition])
      if (use.mock.calls.length === 1) observeFirstUse()
      if (use.mock.calls.length === 4) observeReplacementUse()
      return operation
    })
    const unUse = vi.spyOn(target, 'unUse')
    /** Wait for the authenticated candidate's actual loss event, not a polling interval. */
    let observeFirstLoss!: () => void
    /** The first approved candidate alone proves EOF-driven suspension. */
    const firstLost = new Promise<void>((resolve) => {
      observeFirstLoss = resolve
    })
    /** Later duplicate and replacement candidates must not replace the original EOF observer. */
    let observedFirst = false
    const service = await withinRegistration(
      createServeProcessHost({
        host: target,
        catalog: nativeHostCatalog,
        resolvePlugin: () => blueprint,
        scheduler: systemScheduler,
        report,
        resilience: external,
        ingress: {
          kind: 'listener',
          address: join(directory, 's'),
          listen: (options) =>
            listenProcessByteChannel({ ...options, serviceId: 'host-ingress-fixture' }),
          offer: createNativeProcessOffer({
            peer: { id: 'server', runtime: 'node' },
            stream: true
          }),
          verify: () => 'principal',
          createConnectionContext: () => ({
            peerId: 'client',
            ipc: {
              connectionId: crypto.randomUUID(),
              sessionId: crypto.randomUUID(),
              log: () => undefined
            }
          })
        },
        endpointFactory: async (channel, signal, session) => {
          if (!observedFirst && session?.identity.principalId === 'approved-principal') {
            observedFirst = true
            signal.addEventListener('abort', observeFirstLoss, { once: true })
          }
          const served = await withinRegistration(
            nativeEndpoint(channel, 'registration-server', session)
          )
          return {
            ...served,
            endpoint: {
              ...served.endpoint,
              send<T>(...input: Parameters<typeof served.endpoint.send>) {
                return served.endpoint.send<T>(
                  input[0],
                  input[1],
                  input[2],
                  input[1] === RemoteMethodName.describe
                    ? { ...input[3], timeoutMs: REGISTRATION_CONNECTION_TIMEOUT_MS }
                    : input[3]
                )
              }
            }
          }
        },
        registrations: {
          listen: listenProcessByteChannel,
          address,
          serviceId: 'host-reverse-fixture',
          offer: createNativeProcessOffer({
            peer: { id: 'registration-server', runtime: 'node' },
            stream: true
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
            if (token === 'second-reverse-fixture') return 'approved-second'
            return 'approved-principal'
          },
          resolveRegistration
        }
      })
    )
    const rejected = reversePeer(address, 'wrong-fixture-token')
    await withinRegistration(rejected.exited)
    await withinRegistration(rejectedClosed)
    const first = reversePeer(address)
    peerReady = first.ready
    let replacement: ReturnType<typeof reversePeer> | undefined
    let independent: ReturnType<typeof reversePeer> | undefined
    try {
      await withinRegistration(rejected.exited)
      await withinRegistration(Promise.race([firstInstalling, failedCandidate]))
      expect(use).toHaveBeenCalledTimes(1)
      const [proxy] = await withinRegistration(
        use.mock.results[0]!.value as ReturnType<typeof target.use>
      )
      expect(resolveRegistration.mock.calls).toEqual([['approved-principal']])
      const bad = reversePeer(address, nativeHostToken, true)
      peerReady = bad.ready
      await withinRegistration(bad.exited)
      await withinRegistration(badClosed)
      expect(use).toHaveBeenCalledTimes(1)
      const duplicate = reversePeer(address)
      peerReady = duplicate.ready
      await withinRegistration(duplicate.exited)
      await withinRegistration(duplicateClosed)
      expect(use).toHaveBeenCalledTimes(2)
      expect(unUse).not.toHaveBeenCalled()
      independent = reversePeer(address, 'second-reverse-fixture')
      peerReady = independent.ready
      await withinRegistration(Promise.race([secondInstalling, failedCandidate]))
      expect(secondUse).toHaveBeenCalledTimes(1)
      const [independentProxy] = await withinRegistration(
        secondUse.mock.results[0]!.value as ReturnType<typeof target.use>
      )
      const independentFeature = independentProxy.getFeature('f') as Record<
        string,
        (...args: unknown[]) => unknown
      >
      const feature = proxy.getFeature('f') as Record<string, (...args: unknown[]) => unknown>
      expect(await withinRegistration(feature.request!(['reverse']))).toMatchObject({
        pid: first.child.pid
      })
      const [dependent] = await withinRegistration(
        target.use(
          definePlugin({
            name: 'dependent',
            features: {
              f: defineFeature(
                (_core, dependencies) => ({ read: () => dependencies.p.request(['dependent']) }),
                { p: blueprint.getFeature('f') }
              )
            },
            install: () => ({})
          })
        )
      )
      await withinRegistration(first.close())
      await withinRegistration(firstLost)
      expect(unUse).toHaveBeenCalledTimes(1)
      await withinRegistration(unUse.mock.results[0]!.value)
      await withinRegistration(firstClosed)
      expect(unUse.mock.calls[0]).toEqual(['p', { policy: 'suspend' }])
      expect(await withinRegistration(independentFeature.request!(['unaffected']))).toMatchObject({
        pid: independent.child.pid
      })
      expect(() => dependent.getFeature('f')).toThrow(
        expect.objectContaining({ code: 'PLUGIN_SUSPENDED' })
      )
      replacement = reversePeer(address)
      peerReady = replacement.ready
      await withinRegistration(Promise.race([replacementInstalling, failedCandidate]))
      expect(use).toHaveBeenCalledTimes(4)
      const [newProxy] = await withinRegistration(
        use.mock.results[3]!.value as ReturnType<typeof target.use>
      )
      expect(
        await withinRegistration((newProxy.getFeature('f') as typeof feature).request!(['new']))
      ).toMatchObject({
        pid: replacement.child.pid
      })
      expect(resolveRegistration.mock.calls).toEqual([
        ['approved-principal'],
        ['approved-principal'],
        ['approved-principal'],
        ['approved-second'],
        ['approved-principal']
      ])
      expect(() => dependent.getFeature('f')).not.toThrow()
      await withinRegistration(listener!.close())
      expect(
        await withinRegistration(
          (newProxy.getFeature('f') as typeof feature).request!(['listener-closed'])
        )
      ).toMatchObject({ pid: replacement.child.pid })
      const closing = service.close()
      expect(service.close()).toBe(closing)
      await withinRegistration(closing)
      await withinRegistration(replacement.exited)
      await withinRegistration(independent.exited)
      expect(closeGovernor).not.toHaveBeenCalled()
      expect(first.errors.join('')).not.toContain(nativeHostToken)
      expect(replacement.errors.join('')).not.toContain(nativeHostToken)
      expect(rejectedCandidates).toBe(2)
    } finally {
      await withinRegistration(service.close())
      await withinRegistration(
        Promise.allSettled([
          first.close(),
          rejected.close(),
          replacement?.close(),
          independent?.close()
        ])
      )
      await withinRegistration(target.dispose())
      await withinRegistration(secondTarget.dispose())
      await withinRegistration(governor.close())
      await withinRegistration(rm(directory, { recursive: true, force: true }))
    }
  })
})
