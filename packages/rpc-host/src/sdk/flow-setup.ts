/** Admit async flow installations into the native cleanup owner before publishing their hooks. */
import type { IPluginHostCore } from '@migaia/plugin-host'
import type { ILifecycleScope } from '@migaia/lifecycle'
import { attachSecondaryErrors, UtilsAbortError } from '@migaia/utils/error'
import { raceWithAbort, type IAbortSignal, type INativeAbortSignal } from '@migaia/utils/promise'
import { identifyRpcBoundaryFailure, RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { createRpcAbortError } from '../host/error-owner.ts'
import type {
  IRpcFlowDefinition,
  IRpcFlowInstallation,
  IRpcFlowSetupContext,
  IRpcTransportSetupContext
} from './types.ts'

/** One native install borrows its original acquisition, cleanup admission and operation signals. */
type IInstallationSetupInput<T> = Readonly<{
  setup(): T | PromiseLike<T>
  own(installed: T): void
  report(error: unknown): void
  signals: readonly IAbortSignal[]
  /** Pending members borrow the same scope that owns the final native installation. */
  nativeStartup?: Readonly<{ owner: IPluginHostCore; resources: ILifecycleScope }>
}>

/** Native preparation shares failure choice and cleanup admission with this one active install. */
type INativeMemberStartupOwner = Readonly<{
  own(dispose: () => Promise<void>): void
  failed(error: unknown): void
}>
/** Installation identity reaches private members across transport context projections. */
const nativeMemberStartups = new WeakMap<IPluginHostCore, INativeMemberStartupOwner>()

/** Borrow only an active native startup; this private collaboration is not part of the SDK export. */
export function nativeMemberStartup(context: object): INativeMemberStartupOwner | undefined {
  /** Real transport setup already carries this core; direct generation users need no install owner. */
  const owner = (context as Partial<IRpcTransportSetupContext>).owner
  return owner === undefined ? undefined : nativeMemberStartups.get(owner)
}

/** Cold definitions create independent preparation attempts without retaining installation state. */
export class RpcFlowSetup {
  /** Frozen configuration supplies a receiverless setup callback for each installation. */
  readonly #definition: IRpcFlowDefinition<object>

  /** Capture only the cold definition; each native install supplies its own lifecycle owner. */
  constructor(definition: IRpcFlowDefinition<object>) {
    this.#definition = definition
  }

  /** Race this install against root/native cancellation without changing the public setup context. */
  readonly prepare = (
    core: IPluginHostCore,
    rootSignal: IAbortSignal,
    context: IRpcFlowSetupContext
  ): Promise<IRpcFlowInstallation<object>> =>
    new RpcInstallationSetup({
      setup: () => (0, this.#definition.setup)(context),
      own: (installed) => core.onDispose(() => installed.dispose?.()),
      report: context.report,
      signals: [rootSignal, core.operation.signal]
    }).run()
}

/** One setup attempt hands off acquired cleanup or releases a value that arrived after cancellation. */
export class RpcInstallationSetup<T extends { dispose?(): void | Promise<void> }> {
  /** Inputs remain alive only until the original setup and its ownership handoff finish. */
  readonly #input: IInstallationSetupInput<T>
  /** Distinguish business-thrown UtilsAbortError from cancellation produced by the utility race. */
  #failure: unknown
  /** Successful handoff removes pending-member receipts from the original native scope. */
  readonly #pendingMembers: (() => Promise<void>)[] = []

  /** Capture the original native operation signal before asynchronous setup can outlive rollback. */
  constructor(input: IInstallationSetupInput<T>) {
    this.#input = input
  }

  /** Preserve original setup failures; only utility cancellation crosses the canonical RPC boundary. */
  async run(): Promise<T> {
    /** One native install owns pending member cleanup before its final installation value exists. */
    const startup = this.#input.nativeStartup
    if (startup)
      nativeMemberStartups.set(startup.owner, {
        own: (dispose) => {
          startup.resources.own(dispose, { force: dispose })
          this.#pendingMembers.push(dispose)
        },
        failed: (error) => {
          if (this.#failure === undefined) this.#failure = error
        }
      })
    try {
      return await raceWithAbort(this.#invoke, {
        signals: this.#input.signals,
        report: this.#input.report,
        cleanupPolicy: 'report'
      })
    } catch (error) {
      if (this.#failure !== undefined) throw this.#failure
      if (error instanceof UtilsAbortError)
        throw createRpcAbortError(undefined, undefined, error.cause)
      throw error
    } finally {
      if (startup) nativeMemberStartups.delete(startup.owner)
      this.#pendingMembers.length = 0
    }
  }

  /**
   * Fulfill only after native cleanup owns the exact acquired installation; late values are
   * released.
   */
  readonly #invoke = async ({ signal }: { signal: INativeAbortSignal }): Promise<T> => {
    try {
      /** Acquisition callbacks receive no configuration object as their receiver. */
      const installed = await (0, this.#input.setup)()
      if (signal.aborted) {
        await installed.dispose?.()
        this.#releasePendingMembers()
        return installed
      }
      try {
        ;(0, this.#input.own)(installed)
        this.#releasePendingMembers()
      } catch (error) {
        return await releaseUnownedInstallation(installed, error)
      }
      return installed
    } catch (error) {
      this.#failure ??= identifyRpcBoundaryFailure(
        error,
        RpcCoreErrorCode.callbackFailed,
        RpcCoreErrorText.callbackFailed
      )
      throw this.#failure
    }
  }

  /** Final installation cleanup supersedes temporary member ownership without changing its order. */
  #releasePendingMembers(): void {
    for (const dispose of this.#pendingMembers)
      this.#input.nativeStartup!.resources.release(dispose)
    this.#pendingMembers.length = 0
  }
}

/** Release a value rejected by native cleanup admission while retaining the original primary first. */
async function releaseUnownedInstallation(
  installed: { dispose?(): void | Promise<void> },
  primary: unknown
): Promise<never> {
  try {
    await installed.dispose?.()
  } catch (error) {
    throw attachSecondaryErrors(primary, [error])
  }
  throw primary
}
