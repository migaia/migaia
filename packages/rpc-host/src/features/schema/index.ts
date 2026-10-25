/** Optional application parser execution is separate from the host's inert method declarations. */
import { RpcCallMode, RpcWireKind } from '@migaia/rpc-contract/protocol'
import { defineBuiltinFlowFeature } from '../../sdk/flow-feature.js'
import type { IRpcFlowFeature } from '../../sdk/types.js'
import { RpcFlowPoint, type IRpcFlowStage } from '../../sdk/flow-pipelines.js'
import type { IRpcSchemaOptions } from './types.js'
import { validateContractData } from './validate.js'
import { RpcSchemaName } from './text.js'
export type { IRpcSchemaOptions, IRpcSchemaParser, IRpcMethodValidators } from './types.js'

/** One installed validator borrows configured parsers and owns no provider or pending state. */
class SchemaValidation {
  /** Actual parser configuration is retained only while its native plugin registration is live. */
  readonly #options: IRpcSchemaOptions

  /** Capture the caller's existing parser capabilities without rebuilding their receiver objects. */
  constructor(options: IRpcSchemaOptions) {
    this.#options = options
  }

  /** Validate outbound arguments before physical writing; provider results use dispatch. */
  readonly envelope: IRpcFlowStage<'envelopeOutbound'> = async (payload, next) => {
    const { prepared, context } = payload
    /** The codec already captured the admitted semantic envelope once. */
    const message = await context.restore(prepared)
    if (message === undefined) return next(payload)
    if (message.kind === RpcWireKind.call)
      validateContractData(this.#options, message.task.method!, 'params', message.payload)
    else if (message.kind === RpcWireKind.group)
      for (const step of message.steps)
        validateContractData(this.#options, step.method, 'params', step.payload)
    await next(payload)
  }

  /** Validate request results before completion so parser failures use the original error reply. */
  readonly dispatch: IRpcFlowStage<'dispatchInbound'> = async (payload, next) => {
    const { context } = payload
    /** Group validation finishes before next can execute its first member. */
    const message = context.envelope
    if (message.kind === RpcWireKind.group)
      for (const step of message.steps)
        validateContractData(this.#options, step.method, 'params', step.payload)
    else if (message.kind === RpcWireKind.call)
      validateContractData(this.#options, message.task.method!, 'params', message.payload)
    /** Provider execution still runs once; failed result parsing rejects its existing dispatch. */
    await next(payload)
    /** Native dispatch shares the original invocation's outcome cell through every stage. */
    const outcome = payload.outcome.value
    if (
      message.kind === RpcWireKind.call &&
      message.task.mode === RpcCallMode.request &&
      outcome.kind === 'value'
    )
      validateContractData(this.#options, message.task.method!, 'result', outcome.value)
  }

  /** Inbound results are checked without duplicating provider-side argument admission. */
  readonly inbound: IRpcFlowStage<'envelopeInbound'> = async (payload, next) => {
    const { prepared, context } = payload
    /** Codec admission is shared with auth and Session rather than rerunning a business validator. */
    const message = await context.restore(prepared)
    if (message === undefined) return next(payload)
    if (message.kind === RpcWireKind.result && message.task.method !== undefined)
      validateContractData(this.#options, message.task.method, 'result', message.result)
    await next(payload)
  }
}

/** Install actual schema behavior at the fixed envelope and provider dispatch boundaries. */
export function schema(options: IRpcSchemaOptions = {}): IRpcFlowFeature {
  return defineBuiltinFlowFeature('schema', {
    name: RpcSchemaName,
    namespaces: options.namespaces,
    setup() {
      /** Every receiving host retains its own explicit validator, with no shared live registry. */
      const validation = new SchemaValidation(options)
      return {
        stages: {
          [RpcFlowPoint.envelopeOutbound]: validation.envelope,
          [RpcFlowPoint.envelopeInbound]: validation.inbound,
          [RpcFlowPoint.dispatchInbound]: validation.dispatch
        }
      }
    }
  })
}

export default schema
