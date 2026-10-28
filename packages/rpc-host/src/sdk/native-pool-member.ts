/** Shared projection of one original native generation into a repeatable transport resource. */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcNativeGeneration, IRpcPrivateSession } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcLifecycleError } from '../host/error-owner.ts'
import type { RpcMemberGeneration } from './member-generation.ts'
import type { IRpcNativePoolMember } from './native-feature-types.ts'
import type { IRpcNativeMemberRecord } from './native-members-types.ts'

/** Concrete transports lend only their actual generation, original registration and cleanup. */
type IRpcNativePoolMemberOptions = Readonly<{
  record: IRpcNativeMemberRecord
  native: IRpcNativeGeneration &
    Pick<RpcMemberGeneration<unknown, unknown>, 'currentHandle' | 'rebind'>
  close(): Promise<void>
}>

/** No readiness, lifecycle, media or supervision state is recreated by this native projection. */
export class RpcNativePoolMember implements IRpcNativePoolMember {
  /** The immutable collaborator object contains only original native owner methods. */
  readonly #options: IRpcNativePoolMemberOptions
  /** Queries borrow the exact source registration rather than constructing a descriptor. */
  readonly record: IRpcNativeMemberRecord
  /** Retry observes the same actual native generation that owns this resource. */
  readonly native: IRpcNativeGeneration
  /** Capture genuine source ownership without starting another native operation. */
  constructor(options: IRpcNativePoolMemberOptions) {
    this.#options = options
    this.record = options.record
    this.native = options.native
  }
  /** Only private-context native constructors can supply this physical Session handle. */
  current(): IRpcPrivateSession | undefined {
    return this.#options.native.currentHandle() as IRpcPrivateSession | undefined
  }
  /** Shared native preparation decides future readiness; no second waiter or restart policy exists. */
  async ready(signal?: IAbortSignal): Promise<IRpcPrivateSession> {
    await this.#options.native.rebind(signal)
    const current = this.current()
    if (!current) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    return current
  }
  /** Preserve the original generation/resource close Promise. */
  close(): Promise<void> {
    return this.#options.close()
  }
}
