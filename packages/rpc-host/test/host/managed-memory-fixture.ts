/** Real in-process native units lend MessagePorts to the canonical SDK generation owner. */
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import type { EventEmitter } from 'node:events'
import { createRpcHost, type IRpcHostOptions } from '@migaia/rpc-host'
import {
  createRpcMessageCarrier,
  defaultRpcId,
  defineTransportPlugin,
  RpcMemberGeneration,
  type IRpcMemberGenerationOptions,
  type IRpcMemberSource,
  type IRpcMessageIO,
  type IRpcTransportSetupContext
} from '@migaia/rpc-host/sdk'
import type { IRpcCarrierWriteOptions } from '@migaia/rpc-contract/interfaces'
import { deferred } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IUnitHandle, IUnitLauncher, IUnitProfile } from '@migaia/supervision'
import { coreMemoryServer } from './core-fixture.ts'

/** A MessagePort lends its actual native listener/remover and write operations to one SDK carrier. */
class ManagedMessageIO implements IRpcMessageIO {
  /** The original acquired port remains the sole physical resource behind this endpoint. */
  readonly #port: MessagePort

  /** Capture no semantic state, handshake queue or parallel close lifecycle. */
  constructor(port: MessagePort) {
    this.#port = port
  }

  /** Mark physical handoff immediately before the original structured-clone operation. */
  send(value: unknown, transfer?: readonly ArrayBuffer[], options?: IRpcCarrierWriteOptions): void {
    options?.onWriteStart?.()
    this.#port.postMessage(value, transfer === undefined ? undefined : [...transfer])
  }

  /** Native message delivery carries the original value without parsing or copying it. */
  onMessage(listener: (value: unknown) => void): () => void {
    this.#port.on('message', listener)
    return () => this.#port.off('message', listener)
  }

  /** The SDK owns the remover and interprets the actual native terminal notification. */
  onClose(listener: () => void): () => void {
    this.#port.on('close', listener)
    return () => this.#port.off('close', listener)
  }

  /** Native decoding failure remains the original messageerror instance. */
  onError(listener: (error: unknown) => void): () => void {
    this.#port.on('messageerror', listener)
    return () => this.#port.off('messageerror', listener)
  }

  /** Idempotency and shared cleanup completion belong to the SDK carrier. */
  close(): void {
    this.#port.close()
  }
}

/** The original silent emitter provides native acquisition and disposal without a handshake reply. */
export class SilentManagedMessageIO implements IRpcMessageIO {
  /** This is the original native listener owner inspected by the rollback assertion. */
  readonly #events: EventEmitter
  /** The original native send callback observes actual first control handoff. */
  readonly #written: () => void

  /** Borrow the existing raw emitter and write callback without creating readiness state. */
  constructor(events: EventEmitter, written: () => void) {
    this.#events = events
    this.#written = written
  }

  /** Native handoff remains silent after recording the original write. */
  send(
    _value: unknown,
    _transfer?: readonly ArrayBuffer[],
    options?: IRpcCarrierWriteOptions
  ): void {
    options?.onWriteStart?.()
    this.#written()
  }

  /** The SDK owns the exact original emitter listener and removes it on failed preparation. */
  onMessage(listener: (value: unknown) => void): () => void {
    this.#events.on('message', listener)
    return () => {
      this.#events.off('message', listener)
    }
  }

  /** This original raw silent source supplies no native terminal event. */
  onClose(): () => void {
    return () => undefined
  }

  /** The original source owns no physical close work beyond the SDK's listener removal. */
  close(): void {}
}

/** Acquire the actual silent emitter through the same SDK carrier used by real native messages. */
export function silentManagedMemoryCarrier(
  events: EventEmitter,
  written: () => void,
  report: (error: unknown) => void
): IRpcMemberSource {
  return {
    carrier: createRpcMessageCarrier({
      id: 'reconnect-silent',
      report,
      nativeBinary: true,
      io: new SilentManagedMessageIO(events, written)
    }),
    localSourceFacts: { expectedPeerId: 'reconnect-remote' }
  }
}

/** Acquire both subscribed carriers, admit only the remote, and return the unattached local half. */
export async function openManagedMemoryCarrier(
  server: ReturnType<typeof coreMemoryServer>,
  report: (error: unknown) => void
): Promise<IRpcMemberSource> {
  /** Native ports queue tasks; the SDK's one cold slot bridges the only pre-attach hello. */
  const ports = new MessageChannel()
  /** Each original native endpoint has an independent physical identity. */
  const local = createRpcMessageCarrier({
    id: defaultRpcId(),
    io: new ManagedMessageIO(ports.port1),
    report,
    nativeBinary: true
  })
  /** Both SDK constructors subscribe before either Session can write its first hello. */
  const remote = createRpcMessageCarrier({
    id: defaultRpcId(),
    io: new ManagedMessageIO(ports.port2),
    report,
    nativeBinary: true
  })
  try {
    /** Remote readiness cannot be awaited until the SDK attaches the returned local carrier. */
    const accepted = server.accept(remote)
    void accepted.ready.catch(report)
    return {
      carrier: local,
      localSourceFacts: { expectedPeerId: server.options.self!.instanceId }
    }
  } catch (primary) {
    await Promise.all([local.close(), remote.close()]).catch(report)
    throw primary
  }
}

/** Native exit preserves the original optional failure supplied to the real Supervisor. */
type IManagedMemoryExit = Readonly<{ error?: unknown }>

/** Each real unit owns its original remote Host, provider completion and native exit receipt. */
export type IManagedMemoryUnit = IUnitHandle<IManagedMemoryExit> & {
  remote: Readonly<{ close(): Promise<void> }>
  source: ReturnType<typeof coreMemoryServer>
  exit(value: IManagedMemoryExit): void
  finish(): void
}

/** Preserve native finish, remote cleanup and exit publication order under the original profile. */
function terminateManagedMemoryUnit(unit: IManagedMemoryUnit): void {
  unit.finish()
  void unit.remote.close().then(
    () => unit.exit({}),
    (error: unknown) => unit.exit({ error })
  )
}

/** Original unit recipe is cold data; launch and finish resources belong to the named fixture owner. */
type IManagedMemoryUnitOptions = {
  kind: string
  provide(ordinal: number, finished: Promise<void>): IRpcHostOptions['provide']
  contract?: IRpcHostOptions['contract']
  beforeLaunch?(ordinal: number): void | Promise<void>
}

/** The original test-side launcher owns acquired remote resources, without a second native manager. */
class ManagedMemoryUnits {
  /** Cold provider and held-launch recipe remains independent from native Supervisor state. */
  readonly #options: IManagedMemoryUnitOptions
  /** The original array records actual launcher acquisitions, never invented accepted generations. */
  readonly units: IManagedMemoryUnit[] = []
  /** These same-process units enforce termination but do not claim OS fault isolation. */
  readonly launcher: IUnitLauncher<string, IManagedMemoryUnit> = {
    capabilities: { termination: 'enforced' },
    launch: () => this.#launch()
  }
  /** The original native profile owns stop/exit classification, not another SDK state machine. */
  readonly profile: IUnitProfile<string, IManagedMemoryUnit, IManagedMemoryExit>

  /** Capture cold data once; construction neither launches nor creates a readiness generation. */
  constructor(options: IManagedMemoryUnitOptions) {
    this.#options = options
    this.profile = {
      kind: options.kind,
      gracefulTermination: false,
      requirements: () => ['termination'],
      validateSpec: () => undefined,
      terminate: terminateManagedMemoryUnit,
      classifyExit: (value) =>
        value.error === undefined ? { reason: 'exited' } : { reason: 'crashed', cause: value.error }
    }
  }

  /** Acquire one actual remote Host in original ordinal, gate and completion order. */
  async #launch(): Promise<IManagedMemoryUnit> {
    /** Preserve the original ordinal and held second-launch ordering. */
    const ordinal = this.units.length + 1
    await this.#options.beforeLaunch?.(ordinal)
    /** This remote Host is a genuine independent provider/session owner. */
    const source = coreMemoryServer('remote', `remote-${ordinal}`)
    /** Native termination settles the same original exit promise. */
    const exited = deferred<IManagedMemoryExit>()
    /** Pending business work leaves only when the original fixture unit finishes. */
    const finished = deferred<void>()
    /** Provider setup belongs to the actual remote public Host. */
    const remote = await createRpcHost({
      ...source.options,
      provide: this.#options.provide(ordinal, finished.promise),
      contract: this.#options.contract
    })
    /** Preserve the original unit identity and exact resource callbacks. */
    const unit: IManagedMemoryUnit = {
      identity: { fingerprint: `${this.#options.kind}-${ordinal}` },
      exited: exited.promise,
      exit: exited.resolve,
      finish: finished.resolve,
      source,
      remote
    }
    this.units.push(unit)
    return unit
  }
}

/** Existing launcher/profile behavior now acquires real new-profile Hosts and native MessagePorts. */
export function nativeManagedMemoryUnits(options: IManagedMemoryUnitOptions) {
  return new ManagedMemoryUnits(options)
}

/** Cold source configuration borrows the existing Supervisor and genuine acquisition operation. */
type IManagedMemoryTransportOptions<TUnit, TSpec> = Omit<
  IRpcMemberGenerationOptions<TUnit, TSpec>,
  'context' | 'signal' | 'binding'
> & {
  name: string
  handshakeTimeoutMs: number
  binding: Omit<IRpcMemberGenerationOptions<TUnit, TSpec>['binding'], 'scheduler'>
}

/** Install one SDK generation per native open, keeping readiness and final release on that owner. */
async function openManagedMemoryTransport<TUnit, TSpec>(
  options: IManagedMemoryTransportOptions<TUnit, TSpec>,
  context: IRpcTransportSetupContext
) {
  /** The SDK owns native subscription, candidate rollback, readiness and final release. */
  const generation = new RpcMemberGeneration({
    ...options,
    context,
    signal: context.signal,
    binding: { ...options.binding, scheduler: systemScheduler }
  })
  await generation.open()
  return { dispose: () => generation.close() }
}

/** Install exactly one real native generation around the caller's original Supervisor and source. */
export function managedMemoryTransport<TUnit, TSpec>(
  options: IManagedMemoryTransportOptions<TUnit, TSpec>
) {
  return defineTransportPlugin({
    name: options.name,
    namespace: 'memory',
    handshakeTimeoutMs: options.handshakeTimeoutMs,
    open: (context) => openManagedMemoryTransport(options, context)
  })
}
