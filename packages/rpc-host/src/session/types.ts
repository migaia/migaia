/** Explicit collaborators for accepted sessions; no owner receives a whole peer facade. */
import type { IScheduler } from '@migaia/utils/scheduler'
import type {
  IRpcCarrier,
  IRpcConnectionContext,
  IRpcCarrierWriteOptions,
  IRpcLocalSourceFacts,
  IRpcSessionView,
  IRpcTargetSource
} from '@migaia/rpc-contract/interfaces'
import type { IRpcDirectory, IRpcEnvelope, IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import type { FlowRegistry } from '../flow/registry.js'
import type { IRpcPipelineOwner } from '../sdk/flow-pipelines.js'

/** Only these flow operations participate in carrier preparation and session negotiation. */
export type IRpcSessionFlow = Pick<FlowRegistry, 'extensions' | 'requiredExtensions'> &
  Partial<Pick<FlowRegistry, 'observe' | 'observationFacts' | 'observing'>>

/** A native registration holds only this opaque table-owned publication token. */
export type IRpcSessionScope = Readonly<object>

/** The caller records handoff immediately before each actual physical write, including fragments. */
export type IRpcSessionWriteOptions = IRpcCarrierWriteOptions &
  Readonly<{ onWriteStart?: () => void }>

/** Global identity and business work remain separate from physical connection ownership. */
export type IRpcSessionTableOptions = Readonly<{
  flow: IRpcSessionFlow
  /** Execution authority is borrowed only after the one native Host has been constructed. */
  pipelines(): IRpcPipelineOwner
  self(): IRpcDirectory['self']
  directory(namespace: string): IRpcDirectory
  admitSourceFacts?(facts: IRpcLocalSourceFacts): void
  receive(
    carrierId: string,
    view: IRpcSessionView,
    frame: IRpcSemanticFrame,
    source?: IRpcTargetSource
  ): void | Promise<void>
  /** Admitted correlated hook failures belong to the operation, not physical connection failure. */
  rejected?(
    carrierId: string,
    view: IRpcSessionView,
    frame: IRpcEnvelope,
    error: unknown,
    source?: IRpcTargetSource
  ): void
  accepted?(carrierId: string, view: IRpcSessionView): void
  updated?(carrierId: string, view: IRpcSessionView): void
  /** Publication withdrawal removes routing prefixes without retiring physical work. */
  hidden?(carrierId: string, view: IRpcSessionView): void
  /** Physical failure is an ingress fact, distinct from an explicit local lifecycle close. */
  retired?(
    carrierId: string,
    view: IRpcSessionView | undefined,
    error: unknown,
    physicalFailure?: boolean,
    published?: boolean,
    source?: IRpcTargetSource
  ): void
  report(error: unknown): void
  scheduler?: IScheduler
  timestamp?: () => number
  maxFrameBytes?: number
  controlTimeoutMs?: number
  /** One actual physical handshake is bounded before it can publish readiness. */
  handshakeTimeoutMs?: number
  nameProbeTimeoutMs?: number
}>

/** One Session borrows only admission and work callbacks from its owning table. */
export type IRpcSessionOptions = Readonly<{
  namespace: string
  carrier: IRpcCarrier
  /** Secrets are removed from retained options and held only by the physical Session. */
  connection?: IRpcConnectionContext
  expectedPeerId?: string
  /** Borrow existing acquired native Session identity and current sole-reader qualification. */
  sessionId?: string
  /** The native owner samples its original reader after this Session subscribes. */
  isExclusive?(): boolean
  /** Private media retains only its transport-owned native lookup collaborator. */
  source?: IRpcTargetSource
  /** Directory changes notify the owning native projection after this Session commits its view. */
  changed?(): void
  /** Business drain uses the existing host drain tracker without indexing private members. */
  track<T>(promise: Promise<T>): Promise<T>
  draining(remainingMs: number, announce: (remainingMs: number) => Promise<void>): Promise<void>
  flow: IRpcSessionFlow
  /** The receiving Host lends its genuine named pipeline owner; Session has no runner. */
  pipelines(): IRpcPipelineOwner
  self(): IRpcDirectory['self']
  directory(): IRpcDirectory
  admit(
    directory: IRpcDirectory,
    codec: string,
    extensions: readonly string[],
    authentication?: IRpcSessionView['authentication']
  ): Promise<IRpcSessionView>
  publish(view: IRpcSessionView): void
  receive(view: IRpcSessionView, frame: IRpcSemanticFrame): void | Promise<void>
  /** Only shape- and identity-admitted envelopes can reach this local failure route. */
  rejected?(view: IRpcSessionView, frame: IRpcEnvelope, error: unknown): void
  /** Preserve actual physical failure admission for work owners without inspecting public errors. */
  retire(view: IRpcSessionView | undefined, error: unknown, physicalFailure?: boolean): void
  report(error: unknown): void
  scheduler: IScheduler
  timestamp(): number
  maxFrameBytes: number
  controlTimeoutMs: number
  /** Omission preserves the original ten-second native startup deadline. */
  handshakeTimeoutMs?: number
}>
