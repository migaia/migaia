/** Concrete native transports install complete resource features using their existing constructors. */
import type { ISupervisorEvent } from '@migaia/supervision'
import type { IFeature } from '@migaia/plugin-host'
import type { IAbortSignal } from '@migaia/utils/promise'
import type {
  IRpcDispose,
  IRpcNativeGeneration,
  IRpcPrivateSession,
  IRpcSessionView
} from '@migaia/rpc-contract/interfaces'
import type { IRpcTransportSetupContext } from './types.ts'
import type { IRpcNativeMemberRecord } from './native-members-types.ts'
import type { IRpcMemberCurrent } from './member-types.ts'
import type { RpcNativeMemberKind } from './native-members-constants.ts'

/** Canonical native pool role registers private metadata; no Feature carries this as a field. */
export const RpcNativeFeatureKind = { pool: 'pool' } as const

/** Native source ownership stays with the original generation and supervisor. */
export type IRpcNativePoolMember = Readonly<{
  record: IRpcNativeMemberRecord
  native: IRpcNativeGeneration
  current(): IRpcPrivateSession | undefined
  ready(signal?: IAbortSignal): Promise<IRpcPrivateSession>
  close(): Promise<void>
}>

/** Existing native callbacks feed the one published pool receiver without another subscription. */
export type IRpcNativePoolEvents = Readonly<{
  changed(): void
  ready(record: IRpcNativeMemberRecord, view: IRpcSessionView, generation: number): void
  native(
    record: IRpcNativeMemberRecord,
    event: ISupervisorEvent<unknown>,
    current?: IRpcMemberCurrent
  ): void
}>

/** Absence of a repeatable opener is the real parent/listener capability boundary. */
export type IRpcNativeFeatureContext = IRpcTransportSetupContext &
  Readonly<{
    memberKind: RpcNativeMemberKind
    openMember?(
      context: IRpcTransportSetupContext,
      events: IRpcNativePoolEvents
    ): Promise<IRpcNativePoolMember>
  }>

/** A complete feature owns scheduler resources and returns the actual native namespace extension. */
export type IRpcNativeTransportFeature<E extends object = object> = IFeature<
  Record<never, never>,
  Readonly<{
    install(
      context: IRpcNativeFeatureContext
    ): Promise<Readonly<{ value: E; dispose: IRpcDispose }>>
  }>
>
