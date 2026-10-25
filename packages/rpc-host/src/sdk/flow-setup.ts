/** Admit async flow installations into the native cleanup owner before publishing their hooks. */
import type { IPluginHostCore } from '@migaia/plugin-host'
import { attachSecondaryErrors, UtilsAbortError } from '@migaia/utils/error'
import { raceWithAbort, type IAbortSignal, type INativeAbortSignal } from '@migaia/utils/promise'
import { identifyRpcBoundaryFailure, RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { createRpcAbortError } from '../host/error-owner.js'
import type { IRpcFlowDefinition, IRpcFlowInstallation, IRpcFlowSetupContext } from './types.js'

/** One native install borrows its original definition, report context and captured operation signal. */
type IFlowSetupInput = Readonly<{
  definition: IRpcFlowDefinition<object>
  core: IPluginHostCore
  context: IRpcFlowSetupContext
  signals: readonly IAbortSignal[]
}>

/** Cold definitions create independent preparation attempts without retaining installation state. */
export class RpcFlowSetup {
  /** The frozen original definition preserves the setup method receiver and configuration identity. */
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
    new RpcFlowSetupAttempt({
      definition: this.#definition,
      core,
      context,
      signals: [rootSignal, core.operation.signal]
    }).run()
}

/** One setup attempt hands off acquired cleanup or releases a value that arrived after cancellation. */
class RpcFlowSetupAttempt {
  /** Inputs remain alive only until the original setup and its ownership handoff finish. */
  readonly #input: IFlowSetupInput
  /** Distinguish business-thrown UtilsAbortError from cancellation produced by the utility race. */
  #failure: unknown

  /** Capture the original native operation signal before asynchronous setup can outlive rollback. */
  constructor(input: IFlowSetupInput) {
    this.#input = input
  }

  /** Preserve original setup failures; only utility cancellation crosses the canonical RPC boundary. */
  async run(): Promise<IRpcFlowInstallation<object>> {
    try {
      return await raceWithAbort(this.#invoke, {
        signals: this.#input.signals,
        report: this.#input.context.report,
        cleanupPolicy: 'report'
      })
    } catch (error) {
      if (error === this.#failure) throw error
      if (error instanceof UtilsAbortError)
        throw createRpcAbortError(undefined, undefined, error.cause)
      throw error
    }
  }

  /**
   * Fulfill only after native cleanup owns the exact acquired installation; late values are
   * released.
   */
  readonly #invoke = async ({
    signal
  }: {
    signal: INativeAbortSignal
  }): Promise<IRpcFlowInstallation<object>> => {
    try {
      /** The original setup call retains its definition receiver and unchanged lifecycle context. */
      const installed = await this.#input.definition.setup(this.#input.context)
      if (signal.aborted) {
        await installed.dispose?.()
        return installed
      }
      try {
        this.#input.core.onDispose(() => installed.dispose?.())
      } catch (error) {
        return await releaseUnownedInstallation(installed, error)
      }
      return installed
    } catch (error) {
      this.#failure = identifyRpcBoundaryFailure(
        error,
        RpcCoreErrorCode.callbackFailed,
        RpcCoreErrorText.callbackFailed
      )
      throw this.#failure
    }
  }
}

/** Release a value rejected by native cleanup admission while retaining the original primary first. */
async function releaseUnownedInstallation(
  installed: IRpcFlowInstallation<object>,
  primary: unknown
): Promise<never> {
  try {
    await installed.dispose?.()
  } catch (error) {
    throw attachSecondaryErrors(primary, [error])
  }
  throw primary
}
