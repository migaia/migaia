/**
 * Declares native registration, carrier acquisition and accepted-generation collaboration ports.
 * Real supervisors and transport contexts supply lifecycle authority; these compact contracts carry
 * source facts and callbacks without restoring a per-member business-call facade.
 */
import type { ISupervisor, ISupervisorEvent } from '@migaia/supervision'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IScheduler } from '@migaia/utils/scheduler'
import type {
  IRpcCarrier,
  IRpcConnectionContext,
  IRpcLocalSourceFacts,
  IRpcSessionView,
  IRpcSessionHandle,
  IRpcTransportContext
} from '@migaia/rpc-contract/interfaces'

/** Native source retirement is evidence from the original physical owner, never a wire error code. */
export type IRpcMemberSource = Readonly<{
  carrier: IRpcCarrier
  localSourceFacts?: IRpcLocalSourceFacts
  /** Original private bootstrap credentials bypass descriptive source facts and observations. */
  connectionContext?: IRpcConnectionContext
  onRetire?(listener: (reason: unknown) => void): () => void
}>
/** All execution and clock authority stays with the exact original native supervisor and scheduler. */
export type IRpcMemberBinding<TUnit, TSpec> = Readonly<{
  ownership: 'owned' | 'borrowed'
  supervisor: ISupervisor<TUnit, TSpec>
  scheduler: IScheduler
  /** Ordinals advance only when this candidate really reaches accepted Session readiness. */
  openCarrier(unit: TUnit, signal: IAbortSignal, acceptedOrdinal: number): Promise<IRpcMemberSource>
}>
/** One reusable SDK registration contains no request/Peer facade or second supervision policy. */
export type IRpcMemberGenerationOptions<TUnit, TSpec> = Readonly<{
  context: Pick<IRpcTransportContext, 'attach' | 'detach'>
  binding: IRpcMemberBinding<TUnit, TSpec>
  signal: IAbortSignal
  report(error: unknown): void
  /** Existing native drain completes before the accepted Session is detached. */
  beforeRelease?(): Promise<void>
  onReady?(
    session: IRpcSessionView,
    generation: number,
    unit: TUnit,
    handle: IRpcSessionHandle
  ): void
  onNative?(event: ISupervisorEvent<TUnit>, current: IRpcMemberCurrent): void
}>
/** Readonly current metadata never exposes mutable Session ownership to business callers. */
export type IRpcMemberCurrent = Readonly<{
  generation: number
  active: boolean
  session?: IRpcSessionView
}>
/** The holder transfers only real candidate resources and exact readiness/leave observations. */
export type IRpcMemberRegistration = Readonly<{
  current(): IRpcMemberCurrent
  observedGeneration(): number
  prepareGeneration(
    signal: IAbortSignal,
    own: (dispose: () => Promise<void>) => void
  ): Promise<number>
  onLeave(generation: number, listener: (reason: unknown) => void): () => void
  whenClosed(generation: number): Promise<void>
  releaseRegistration(): Promise<void>
}>
