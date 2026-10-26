/** Native child/listener admission borrows the host's sole Session and supervision owners. */
import { raceWithAbort } from '@migaia/utils/promise'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { createParentLossGuard } from '@migaia/supervision/process'
import type {
  IRpcCarrier,
  IRpcLocalSourceFacts,
  IRpcSessionHandle
} from '@migaia/rpc-contract/interfaces'
import type { IRpcConnectionContext } from '@migaia/rpc-contract/interfaces'
import type { IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import { defaultRpcId, resolveAbortReason, RpcNativeMembers } from '@migaia/rpc-host/sdk'
import { createProcessCarrier } from '../carrier.js'
import { createProcessChannelClosedError, createProcessCleanupError } from '../error.js'
import { decodeProcessRuntimeBootstrap } from '../runtime-bootstrap.js'
import {
  acceptProcessConnectionBootstrap,
  openProcessConnectionBootstrap
} from '../connection-bootstrap.js'
import { PROCESS_CONNECTION_RUNTIME } from '../constants.js'
import { DEFAULT_DRAIN_MS } from '../resilience/constants.js'
import type {
  IProcessByteChannel,
  IProcessMessageChannel,
  IProcessByteListener,
  IProcessPendingByteConnection,
  IProcessCommonOptions
} from '../types.js'
import { reportSafely, invalidOption } from './binding.js'
import type { IProcessServeChildIngress, IProcessServeListenerIngress } from './types.js'
import { ProcessConnectionCapacity, type IProcessConnectionLease } from './serve/admission.js'
import { ProcessServeSession } from './serve/session.js'
import type { IProcessServeOptions, IProcessSessionsHandle } from './serve/types.js'
export type { IProcessServeOptions, IProcessSessionsHandle } from './serve/types.js'

/** The established child parent-loss default is explicitly lent to the one existing guard. */
const parentLossGraceMs = 5_000

/** One actual native ingress owns pending acquisition, resource records and their shared cleanup. */
class ProcessSessionOwner {
  /** The selected native recipe never carries an endpoint or old grammar factory. */
  readonly #ingress: IProcessServeChildIngress | IProcessServeListenerIngress
  /** Installation authority attaches resources to the host's canonical SessionTable. */
  readonly #context: IRpcTransportSetupContext
  /** Cold process features and existing native fallback belong to this exact installation. */
  readonly #options: IProcessServeOptions
  /** The original native scheduler also measures remaining parent-loss grace. */
  readonly #scheduler: IScheduler
  /** Reporter failures cannot overwrite a preparation or native cleanup failure. */
  readonly #report: (error: unknown) => void
  /** Only this native service's pending and accepted resources count against its capacity. */
  readonly #connections: ProcessConnectionCapacity
  /** Borrowed shared capacity remains owned by its original manager. */
  readonly #ownsConnections: boolean
  /** Native close cancels pending preparation without introducing a handshake or grace timer. */
  readonly #controller = new AbortController()
  /** Actual Session handles remain owned until their original physical cleanup finishes. */
  readonly #sessions = new Set<ProcessServeSession>()
  /** Extra native facts are keyed only by the original host-owned handle, never peer/name copies. */
  readonly #records = new WeakMap<IRpcSessionHandle, ProcessServeSession>()
  /** The actual shared SDK receiver projects readonly members and enforces borrowed controls. */
  #members: RpcNativeMembers<'process'> | undefined
  /** Pending preparations are joined before shutdown snapshots committed sessions. */
  readonly #accepting = new Set<Promise<void>>()
  /** Listener ownership is separate from the accepted physical resources. */
  #listener: IProcessByteListener | undefined
  /** Parent-loss observation is removed before intentional child cleanup can emit EOF. */
  #removeParentClose: (() => void) | undefined
  /** The optional native probe is acquired and released by the same child service. */
  #removeProbe: (() => void) | undefined
  /** One supervision guard owns the complete parent-loss deadline and exit decision. */
  #parentGuard: ReturnType<typeof createParentLossGuard> | undefined
  /** This monotonic fact only computes remaining budget; the guard remains the sole timer. */
  #parentDeadline: number | undefined
  /** Explicit and reentrant shutdown callers receive the exact same cleanup Promise. */
  #closing: Promise<void> | undefined
  /** The public native handle contains no per-peer business operations or service projections. */
  #value: IProcessSessionsHandle | undefined

  /** Capture validated native policy before any socket, stream or child ingress opens. */
  constructor(
    ingress: IProcessServeChildIngress | IProcessServeListenerIngress,
    context: IRpcTransportSetupContext,
    options: IProcessServeOptions
  ) {
    if (ingress.kind === 'listener' && typeof ingress.verify !== 'function')
      invalidOption('ingress.verify')
    if (ingress.kind === 'child' && typeof ingress.parentLoss?.exit !== 'function')
      invalidOption('ingress.parentLoss.exit')
    if (options.drainMs !== undefined && (!Number.isFinite(options.drainMs) || options.drainMs < 0))
      invalidOption('drainMs')
    this.#ingress = ingress
    this.#context = context
    this.#options = options
    this.#scheduler =
      options.scheduler ??
      (ingress.kind === 'listener' ? ingress.scheduler : undefined) ??
      systemScheduler
    this.#report = (error) => reportSafely(options.report ?? context.report, error)
    this.#connections = options.connections ?? new ProcessConnectionCapacity(options.maxConnections)
    this.#ownsConnections = options.connections === undefined
  }

  /** Readiness creates one native operation view after child bootstrap has supplied source facts. */
  #handle(): IProcessSessionsHandle {
    return (this.#value ??= Object.freeze({
      close: this.#close,
      closed: () => this.#closing !== undefined,
      members: this.#memberControls().value
    }))
  }

  /** Construct the one actual local receiver only after child bootstrap may supply global self. */
  #memberControls(): RpcNativeMembers<'process'> {
    if (this.#members) return this.#members
    const context = this.#context
    this.#members = new RpcNativeMembers({
      kind: 'process',
      self: context.self,
      report: this.#report,
      source: {
        values: () => this.#sessions,
        byName: (name) => {
          const selected = context.lookup(name)
          return selected?.view.name === name ? this.#records.get(selected.handle) : undefined
        },
        byInstance: (id) => {
          const selected = context.lookup(id)
          return selected?.view.peerId === id ? this.#records.get(selected.handle) : undefined
        }
      }
    })
    if (this.#closing) this.#members.close()
    return this.#members
  }

  /** Register cancellation before native callbacks can run, then open the one selected ingress. */
  async open(): Promise<IProcessSessionsHandle> {
    this.#context.signal.addEventListener('abort', this.#abort, { once: true })
    if (this.#context.signal.aborted) this.#abort()
    if (this.#ingress.kind === 'child') return this.#serveChild(this.#ingress)
    try {
      this.#assertOpen()
      /** A pending bind keeps ownership until this still-open service can accept its receipt. */
      const listener = await this.#ingress.listen({
        address: this.#ingress.address,
        signal: this.#controller.signal,
        report: this.#report,
        onConnection: this.#acceptListener
      })
      try {
        this.#assertOpen()
      } catch (error) {
        // Shutdown may already have drained the service before this native acquisition settles.
        try {
          await listener.close()
        } catch (cleanup) {
          this.#report(cleanup)
        }
        throw error
      }
      this.#listener = listener
      return this.#handle()
    } catch (error) {
      try {
        await this.#close()
      } catch (cleanup) {
        this.#report(cleanup)
      }
      throw error
    }
  }

  /** External installation cancellation retires this original native resource scope. */
  readonly #abort = (): void => {
    /** Publish cleanup before synchronous cancellation can reenter the same native owner. */
    const closing = this.#close()
    this.#controller.abort(resolveAbortReason(this.#context.signal))
    void closing.catch((error: unknown) => {
      /** The published handle's native cleanup owns this flight; pending acquisition still reports. */
      if (!this.#value) this.#report(error)
    })
  }

  /** Publish close before native callbacks can reenter and observe a second teardown. */
  readonly #close = (): Promise<void> => {
    return (this.#closing ??= Promise.resolve().then(() => this.#release()))
  }

  /** Close native admission first, join every candidate, then drain and detach actual Sessions. */
  async #release(): Promise<void> {
    /** All independent cleanup errors remain reachable in their original cleanup order. */
    const errors: unknown[] = []
    for (const remove of [this.#removeParentClose, this.#removeProbe]) {
      try {
        remove?.()
      } catch (error) {
        errors.push(error)
      }
    }
    this.#removeParentClose = undefined
    this.#removeProbe = undefined
    this.#context.signal.removeEventListener('abort', this.#abort)
    this.#members?.close()
    if (this.#ownsConnections) this.#connections.close()
    this.#controller.abort(resolveAbortReason(this.#context.signal))
    /** Fallback recovery is revoked before it can publish another candidate. */
    const fallback = Promise.allSettled([
      Promise.resolve().then(() => this.#options.fallback?.close())
    ])
    try {
      await this.#listener?.close()
    } catch (error) {
      errors.push(error)
    }
    await Promise.allSettled(this.#accepting)
    for (const session of this.#sessions) {
      try {
        await session.close()
      } catch (error) {
        errors.push(error)
      }
    }
    for (const result of await fallback)
      if (result.status === 'rejected') errors.push(result.reason)
    if (errors.length) throw createProcessCleanupError(errors)
  }

  /** Every caller passes its current remaining grace without starting another deadline. */
  readonly #remaining = (): number => {
    const requested = this.#options.drainMs ?? DEFAULT_DRAIN_MS
    return this.#parentDeadline === undefined
      ? requested
      : Math.min(requested, Math.max(0, this.#parentDeadline - this.#scheduler.now()))
  }

  /** Late candidates cannot publish after explicit close or parent-loss shutdown began. */
  #assertOpen(): void {
    /** Installation cancellation rethrows its own reason so upstream treats it as an echo. */
    if (this.#context.signal.aborted) throw resolveAbortReason(this.#context.signal)
    if (this.#closing || this.#controller.signal.aborted)
      throw createProcessChannelClosedError(resolveAbortReason(this.#controller.signal))
  }

  /** Keep preparation's original Promise while shutdown borrows its two-outcome completion. */
  #track<T>(preparing: Promise<T>): Promise<T> {
    /** The receipt cannot reject independently of the already observed original preparation. */
    const accepting = preparing.then(
      () => undefined,
      () => undefined
    )
    this.#accepting.add(accepting)
    void accepting.then(() => this.#accepting.delete(accepting))
    return preparing
  }

  /** Track native accepts before handing their completion back to an unawaited listener callback. */
  readonly #acceptListener = (pending: IProcessPendingByteConnection): Promise<void> => {
    return this.#track(this.#admitListener(pending))
  }

  /** Transfer only the authenticated native recipe's real resource; rollback never publishes a Peer. */
  async #admitListener(pending: IProcessPendingByteConnection): Promise<void> {
    /** The original quota receipt survives preparation until the actual Session takes ownership. */
    let lease: IProcessConnectionLease | undefined
    try {
      this.#assertOpen()
      lease = this.#connections.claim()
      if (this.#ingress.kind !== 'listener') invalidOption('ingress.kind')
      /** Native verification precedes user context side effects and any semantic Session. */
      const attachment = { owner: this, ingress: this.#ingress, pending }
      await pending.accept(async (raw) => {
        await attachment.owner.#attachListener(raw, lease!, attachment.ingress, attachment.pending)
        lease = undefined
      })
    } catch (error) {
      lease?.release()
      try {
        await pending.close()
      } catch (cleanup) {
        this.#report(cleanup)
      }
      this.#report(error)
    }
  }

  /** The original pending owner lends raw bytes only after native token/principal verification. */
  async #attachListener(
    raw: IProcessByteChannel,
    lease: IProcessConnectionLease,
    ingress: IProcessServeListenerIngress,
    pending: IProcessPendingByteConnection
  ): Promise<void> {
    /** This single existing bootstrap reader hands its unconsumed semantic tail to Session. */
    const admitted = await acceptProcessConnectionBootstrap(
      raw,
      { verify: (credential, peer) => (0, ingress.verify)(credential, peer) },
      {
        signal: this.#controller.signal,
        scheduler: this.#scheduler,
        report: this.#report
      }
    )
    this.#assertOpen()
    /** Only an admitted connection may execute the original user metadata callback. */
    const selected = (0, ingress.createConnectionContext)(pending)
    await this.#attach(
      admitted.channel,
      lease,
      selected.ipc.connectionId,
      selected.ipc,
      { expectedPeerId: admitted.peer?.id },
      admitted.connectionContext
    )
  }

  /** Create the sole guard before openRaw can wait for bootstrap or native EOF. */
  #serveChild(ingress: IProcessServeChildIngress): Promise<IProcessSessionsHandle> {
    this.#parentGuard = createParentLossGuard({
      shutdown: () => this.#close(),
      exit: ingress.parentLoss.exit,
      graceMs: ingress.parentLoss.graceMs ?? parentLossGraceMs,
      scheduler: this.#scheduler,
      report: this.#report
    })
    this.#removeProbe = ingress.parentLoss.probe?.(this.#parentLost)
    return this.#track(this.#prepareChild(ingress))
  }

  /** Capture deadline once before triggering the existing idempotent supervision shutdown. */
  readonly #parentLost = (reason?: unknown): void => {
    // Native registration disposal revokes lifetime before Session-first cleanup closes local stdio.
    if (
      (this.#closing || this.#context.owner.lifecycle.signal.aborted) &&
      this.#parentDeadline === undefined
    )
      return
    if (this.#parentDeadline === undefined && this.#ingress.kind === 'child')
      this.#parentDeadline =
        this.#scheduler.now() + (this.#ingress.parentLoss.graceMs ?? parentLossGraceMs)
    this.#parentGuard?.trigger(reason)
  }

  /** Bootstrap identity is trusted native source data; its secret token never enters Session facts. */
  async #prepareChild(ingress: IProcessServeChildIngress): Promise<IProcessSessionsHandle> {
    /** The child claims one original native capacity slot before acquiring its parent channel. */
    let lease: IProcessConnectionLease | undefined
    /** Until attachment owns raw IO, this transaction retains its original cleanup responsibility. */
    let raw: IProcessByteChannel | IProcessMessageChannel | undefined
    try {
      this.#assertOpen()
      lease = this.#connections.claim()
      /** OpenRaw owns native discovery and the one first-bootstrap frame handoff. */
      const opened = await ingress.openRaw(this.#controller.signal)
      raw = 'raw' in opened ? opened.raw : opened
      this.#removeParentClose = raw.onClose(this.#parentLost)
      /** Only native bootstrap fields are projected, with no business metadata authority. */
      let facts: IRpcLocalSourceFacts | undefined
      /** Credentials remain separate from nonsecret source identity throughout this native lifetime. */
      let connectionContext: IRpcConnectionContext | undefined
      if (ingress.channelKind === 'byte') {
        if (!('raw' in opened) || raw.kind !== 'byte') invalidOption('ingress.bootstrap')
        const bootstrap = decodeProcessRuntimeBootstrap(opened.bootstrap)
        facts = {
          self: bootstrap.self,
          generation: bootstrap.generation,
          expectedPeerId: bootstrap.parentInstanceId
        }
        /** The child proves the original private launch token before Session consumes its peer. */
        const admitted = await openProcessConnectionBootstrap(
          raw,
          bootstrap.token,
          { id: bootstrap.self.instanceId, runtime: PROCESS_CONNECTION_RUNTIME },
          { signal: this.#controller.signal, scheduler: this.#scheduler, report: this.#report }
        )
        raw = admitted.channel
        connectionContext = admitted.connectionContext
      } else if ('raw' in opened || raw.kind !== 'message') invalidOption('ingress.channelKind')
      /** Real connection labels are allocated once and never copied into authentication metadata. */
      const ipc = { connectionId: defaultRpcId(), sessionId: defaultRpcId(), log: () => undefined }
      await this.#attach(raw, lease, ipc.connectionId, ipc, facts, connectionContext)
      lease = undefined
      raw = undefined
      return this.#handle()
    } catch (error) {
      /** Early EOF must enter grace before rollback can suspend on original cleanup. */
      this.#parentLost(error)
      lease?.release()
      if (raw) {
        try {
          await raw.close()
        } catch (cleanup) {
          this.#report(cleanup)
        }
      }
      throw error
    }
  }

  /** One actual Session owns handshake, identity, codec, directory and physical retirement. */
  async #attach(
    raw: IProcessByteChannel | IProcessMessageChannel,
    lease: IProcessConnectionLease,
    id: string,
    ipc?: IProcessCommonOptions['ipc'],
    facts?: IRpcLocalSourceFacts,
    connectionContext?: IRpcConnectionContext
  ): Promise<void> {
    /** Failed native carrier construction leaves this original raw resource with its caller. */
    let carrier: IRpcCarrier | undefined
    /** Native attach may fail before returning a Session, so rollback keeps both acquisition stages. */
    let handle: IRpcSessionHandle | undefined
    try {
      this.#assertOpen()
      await raceWithAbort(() => this.#options.fallback?.ready() ?? Promise.resolve(), {
        signals: [this.#controller.signal],
        report: this.#report
      })
      this.#assertOpen()
      /** Recovery version is the existing native fallback owner's fact, not another generation. */
      const version = this.#options.fallback?.version
      carrier = createProcessCarrier(raw, this.#context, {
        id,
        ipc,
        features: this.#options.features
      })
      handle = this.#context.attach(
        carrier,
        {
          ...facts,
          sessionId: ipc?.sessionId ?? id,
          isExclusive: raw.kind === 'byte' ? raw.isExclusive : undefined
        },
        connectionContext
      )
      const view = await raceWithAbort(() => handle!.ready, {
        signals: [this.#controller.signal],
        report: this.#report
      })
      await raceWithAbort(() => this.#options.fallback?.ready() ?? Promise.resolve(), {
        signals: [this.#controller.signal],
        report: this.#report
      })
      this.#assertOpen()
      if (this.#options.fallback?.version !== version) throw createProcessChannelClosedError()
      /** Actual resources stay in the original Set; SessionTable owns all peer/address indexes. */
      const session = new ProcessServeSession(
        this.#context,
        handle,
        lease,
        (retired) => this.#sessions.delete(retired),
        this.#remaining,
        view,
        this.#ingress.kind,
        () => this.#scheduler.now(),
        id
      )
      this.#sessions.add(session)
      this.#records.set(handle, session)
      session.activate(this.#options.fallback, id)
      this.#memberControls().publishReady(session, view, session.current().generation)
    } catch (error) {
      try {
        if (handle) await this.#context.detach(handle)
        else if (carrier) await carrier.close(error)
      } catch (cleanup) {
        this.#report(cleanup)
      }
      throw error
    }
  }
}

/** Attach original native ingress resources to the one installed host runtime. */
export function serveProcessSessions(
  ingress: IProcessServeChildIngress | IProcessServeListenerIngress,
  context: IRpcTransportSetupContext,
  options: IProcessServeOptions = {}
): Promise<IProcessSessionsHandle> {
  return new ProcessSessionOwner(ingress, context, options).open()
}
