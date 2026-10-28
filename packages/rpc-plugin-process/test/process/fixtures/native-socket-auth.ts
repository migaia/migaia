/** Real current Hosts and the original Process socket owner supply native authentication evidence. */
import { vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost } from '@migaia/rpc-host'
import { authFeature, type IRpcAuthenticationOptions } from '@migaia/rpc-host/plugins/auth'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { defaultRpcId, type IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import { RpcProbeDirection } from '@migaia/rpc-contract/interfaces'
import * as carrierOwner from '../../../dist/process/carrier.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../dist/process/adapters/node-socket.js'
import type {
  IProcessByteListener,
  IProcessPendingByteConnection,
  IListenProcessByteChannel,
  IProcessByteChannel
} from '../../../dist/process/types.js'

/** Observation retains original native objects and operations; it implements no old channel API. */
export class NativeSocketAuth {
  /** The actual native listener publishes the only bound address and pending-close authority. */
  listener: IProcessByteListener | undefined
  /** Original SDK context supplies readonly lookup of the actual accepted server Session. */
  context: IRpcTransportSetupContext | undefined
  /** The independent dialer context resolves only that actual root's accepted native Session. */
  clientContext: IRpcTransportSetupContext | undefined
  /** Native admission exposes the original pending capability before it is adopted. */
  readonly pending = deferred<IProcessPendingByteConnection>()
  /** Original native carrier construction proves an incoming candidate entered actual preparation. */
  readonly nativeAttached = deferred<void>()
  /**
   * An original native read supplies a positive control before the header-only deadline is
   * advanced.
   */
  readonly inbound = deferred<void>()
  /** The original native callback has completed its actual candidate ownership transfer. */
  readonly admitted = deferred<void>()
  /** The first raw pending candidate may remain with its genuine listener before adoption begins. */
  #holdNext = false
  /** A held listener callback resumes through its original Process admission function. */
  readonly #releasePending = deferred<void>()
  /** Actual member publication, rather than a fabricated ready flag, completes server admission. */
  readonly #ready = deferred<void>()
  /** Original report failures remain rejected with their exact native objects. */
  readonly #failed = deferred<never>()
  /** This observation settles only on actual native readiness or the actual report outlet. */
  readonly connection = Promise.race([this.#ready.promise, this.#failed.promise])
  /** Native failure and cleanup diagnostics remain available without rewriting their causes. */
  readonly reports: unknown[] = []
  /** Server physical writes are copied at the existing borrowed observation callback. */
  readonly writes: Uint8Array[] = []
  /** Exact acquired observer removers are returned before the original native resources close. */
  readonly #removers: (() => void)[] = []
  /** The original public roots retain all Session and OS socket cleanup ownership. */
  readonly #hosts: { close(): Promise<void> }[] = []
  /** Startup promises remain observed until their own rollback or successful admission settles. */
  readonly #opening: Promise<unknown>[] = []
  /** Only the exact factory spy installed by this fixture is restored at final cleanup. */
  readonly #restore: () => void
  /** Native token tests can omit application authentication without changing the real transport. */
  readonly #applicationAuth: boolean
  /** The optional existing application verifier observes per-Session resolver output independently. */
  readonly #applicationVerifier: IRpcAuthenticationOptions['verifyCredentials']

  /** Observe the genuine carrier factory while returning every original carrier unchanged. */
  constructor(
    applicationAuth = true,
    applicationVerifier?: IRpcAuthenticationOptions['verifyCredentials']
  ) {
    this.#applicationAuth = applicationAuth
    this.#applicationVerifier = applicationVerifier
    /** This original factory alone installs native Process IO and its complete features. */
    const create = carrierOwner.createProcessCarrier
    /** The observer borrows original context and media facts, without replacing an SDK port. */
    const observer = vi
      .spyOn(carrierOwner, 'createProcessCarrier')
      .mockImplementation((raw, context, options) => {
        /** The actual factory result remains the Session's original physical resource. */
        const carrier = create(raw, context, options)
        if (context.self().instanceId === 'listener-route') {
          this.context = context
          this.nativeAttached.resolve()
          this.#observeRaw(raw)
        } else if (context.self().instanceId === 'dialer-route') this.clientContext = context
        return carrier
      })
    this.#restore = () => observer.mockRestore()
    void this.connection.catch(() => undefined)
  }
  /**
   * Existing trusted native observation sees actual gate rejection before a carrier can be
   * admitted.
   */
  #observeRaw(
    raw: IProcessByteChannel | Parameters<typeof carrierOwner.createProcessCarrier>[0]
  ): void {
    if (raw.kind !== 'byte' || !raw.observation) return
    this.#removers.push(
      raw.observation.subscribe((event) => {
        if (event.direction === RpcProbeDirection.inbound) this.inbound.resolve()
        if (event.direction === RpcProbeDirection.outbound && event.content instanceof Uint8Array)
          this.writes.push(event.content.slice())
      })
    )
  }
  /** Observe the same raw pending handoff before the complete native token gate starts reading. */
  #observePending(pending: IProcessPendingByteConnection): IProcessPendingByteConnection {
    return {
      accept: <T>(adopt: (raw: IProcessByteChannel) => Promise<T>): Promise<T> =>
        pending.accept((raw) => {
          this.nativeAttached.resolve()
          this.#observeRaw(raw)
          return adopt(raw)
        }),
      close: pending.close
    }
  }
  /** Hold only the next real pending callback before invoking the original native admission owner. */
  holdNextPending(): void {
    this.#holdNext = true
  }
  /** Observe completion while returning the exact original Process candidate callback result. */
  #forwardPending(
    pending: IProcessPendingByteConnection,
    forward: Parameters<IListenProcessByteChannel>[0]['onConnection']
  ): void | Promise<void> {
    /** Only the original native owner performs Session attachment and candidate adoption. */
    const completion = forward(pending)
    void Promise.resolve(completion).then(this.admitted.resolve, this.#failed.reject)
    return completion
  }
  /** Open the original listener recipe with a legal selected auth plugin and original verifier. */
  async listen(verify: (credential: unknown) => string | Promise<string>) {
    /** This native root publishes its real source before any separate client starts. */
    const server = await createRpcHost({
      self: { name: 'listener-route', instanceId: 'listener-route' },
      provide: { echo: (value: unknown) => value },
      plugins: [
        ...(this.#applicationAuth
          ? [
              authFeature({
                encodedType: 'string',
                sign: (value) => value,
                verify: (value) => value,
                credentials: (context) => context.credentials,
                verifyCredentials: this.#applicationVerifier
              })
            ]
          : []),
        processPlugin({
          listen: {
            kind: 'listener',
            address: 'tcp://127.0.0.1:0',
            verify,
            createConnectionContext: () => {
              /** Multiple real connections retain unique original native labels in the same owner. */
              const id = defaultRpcId()
              return { peerId: id, ipc: { connectionId: id, sessionId: id, log: () => undefined } }
            },
            listen: async (options) => {
              this.listener = await listenProcessByteChannel({
                ...options,
                onConnection: (pending) => {
                  this.pending.resolve(pending)
                  if (this.#holdNext) {
                    this.#holdNext = false
                    return this.#releasePending.promise.then(() =>
                      this.#forwardPending(this.#observePending(pending), options.onConnection)
                    )
                  }
                  return this.#forwardPending(this.#observePending(pending), options.onConnection)
                }
              })
              return this.listener
            }
          }
        })
      ],
      report: (error) => {
        this.reports.push(error)
        this.#failed.reject(error)
      }
    })
    this.#hosts.push(server)
    server.process.members.on('ready', () => this.#ready.resolve())
    return server
  }
  /** The actual independent client lends its native token through the current Process recipe. */
  connect(token: string, name = 'dialer-route') {
    /** The public client and its genuine dialer own all actual acquisition and failure wrapping. */
    const opening = createRpcHost({
      self: { name, instanceId: name },
      provide: { echo: (value: unknown) => value },
      plugins: [
        ...(this.#applicationAuth
          ? [
              authFeature({
                encodedType: 'string',
                sign: (value) => value,
                verify: (value) => value,
                credentials: (context) => context.credentials
              })
            ]
          : []),
        processPlugin({
          connect: {
            target: {
              kind: 'connect',
              address: this.listener!.address,
              token,
              supervision: { restart: { mode: 'never' } },
              dial: (address, signal) =>
                dialProcessByteChannel({ address, signal: signal as AbortSignal })
            }
          }
        })
      ],
      report: () => undefined
    })
    this.#opening.push(opening)
    void opening.then(
      (host) => {
        this.#hosts.push(host)
      },
      () => undefined
    )
    return opening
  }
  /** Join actual startup and original root teardown before restoring exact fixture observations. */
  async close(): Promise<void> {
    try {
      this.#releasePending.resolve()
      await Promise.allSettled(this.#opening)
      for (const remove of this.#removers) remove()
      await Promise.all(this.#hosts.map((host) => host.close()))
    } finally {
      this.#restore()
    }
  }
}
