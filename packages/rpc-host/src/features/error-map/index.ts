/** Outbound error presentation reuses the actual flow stages and canonical error graph owner. */
import type { IRpcFlowContext } from '@migaia/rpc-contract/interfaces'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import {
  RpcCallMode,
  RpcWireHandshakeStep,
  RpcWireKind,
  RpcWireStepState,
  type IRpcCompletion,
  type IRpcSemanticFrame,
  type IRpcStepOutcome,
  type IRpcWireError
} from '@migaia/rpc-contract/protocol'
import { originalHostWireError, serializeHostWireError } from '../../host/error-wire-metadata.ts'
import { createRpcConfigurationError } from '../../host/error-owner.ts'
import { defineBuiltinFlowFeature } from '../../sdk/flow-feature.ts'
import { RpcFlowPoint, invalidFlow, type IRpcFlowStage } from '../../sdk/flow-pipelines.ts'
import type { IRpcFlowFeature } from '../../sdk/types.ts'
import { RpcErrorMapName, RpcErrorMapText } from './text.ts'
import type { IRpcErrorMap } from './types.ts'
export type { IRpcErrorMap } from './types.ts'

/** One installed mapper changes fixed wire error slots without observing business payload graphs. */
class OutboundErrorMapping {
  /** The native feature registration owns this developer-supplied mapping callback. */
  readonly #map: IRpcErrorMap

  /** Capture the callback without changing the receiver used by ordinary function invocation. */
  constructor(map: IRpcErrorMap) {
    this.#map = map
  }

  /** A rejection crosses both outbound pipelines; map it once at its actual handshake boundary. */
  readonly handshake: IRpcFlowStage<'handshakeOutbound'> = async (payload, next) => {
    const { handshake, context } = payload
    if (handshake.step !== RpcWireHandshakeStep.reject) return next(payload)
    await next({
      ...payload,
      handshake: { ...handshake, error: this.#error(handshake.error, context) }
    })
  }

  /** Retain the codec's original manifest, sidecars and backing ownership during shallow mapping. */
  readonly envelope: IRpcFlowStage<'envelopeOutbound'> = async (payload, next) => {
    /** The real codec admitted this metadata before any envelope stage executes. */
    const message = payload.prepared.message as IRpcSemanticFrame
    if (message.kind === RpcWireKind.handshake) return next(payload)
    /** Only fixed error-bearing protocol slots may change; business values remain untouched. */
    const selected = this.#frame(message, payload.context)
    await next(
      selected === message
        ? payload
        : { ...payload, prepared: { ...payload.prepared, message: selected } }
    )
  }

  /** A mapper failure is locally reported unchanged and retains the original default wire graph. */
  #error(error: IRpcWireError, context: IRpcFlowContext): IRpcWireError {
    /** Call through a lexical reference so an ordinary mapper receives no feature-owned receiver. */
    const map = this.#map
    try {
      /** Mapping remains synchronous so a pending developer Promise cannot hold the outbound queue. */
      const selected = map(originalHostWireError(error), context)
      /** Capture then once; only its eventual rejection is observed, never awaited by this stage. */
      const inspection = inspectThenable(selected)
      if ('error' in inspection) throw inspection.error
      if ('then' in inspection) {
        observeThenableRejection(selected, inspection, context.report)
        throw createRpcConfigurationError(RpcErrorMapText.mapperMustBeSynchronous)
      }
      return serializeHostWireError(selected, {
        /** Abort a failed projection rather than sending its partial placeholder or reporting twice. */
        report: (failure) => {
          throw failure.error
        }
      })
    } catch (failure) {
      context.report(failure)
      return error
    }
  }

  /** Group success values are opaque; only explicit failed steps carry transport error graphs. */
  #group(values: readonly IRpcStepOutcome[], context: IRpcFlowContext): readonly IRpcStepOutcome[] {
    /** Allocate a replacement only when a real failure slot is encountered, copying the prefix once. */
    let selected: IRpcStepOutcome[] | undefined
    for (let index = 0; index < values.length; index++) {
      /** Each original step remains unchanged unless it contains this boundary's explicit error. */
      const step = values[index]
      if (step.state === RpcWireStepState.failure) {
        selected ??= values.slice(0, index)
        selected.push({ ...step, error: this.#error(step.error, context) })
      } else selected?.push(step)
    }
    return selected === undefined ? values : Object.freeze(selected)
  }

  /** Retained outcomes reuse the same failure/group slots as an immediate completion. */
  #completion(value: IRpcCompletion, mode: string, context: IRpcFlowContext): IRpcCompletion {
    if (!value.ok) return { ...value, error: this.#error(value.error, context) }
    if (mode !== RpcCallMode.group || !Object.hasOwn(value, 'result')) return value
    /** Group metadata is already admitted by the codec; a scalar result never enters this path. */
    const result = this.#group(value.result as readonly IRpcStepOutcome[], context)
    return result === value.result ? value : { ...value, result }
  }

  /** Project each error-bearing variant in O(its fixed slots plus actual group steps). */
  #frame(message: IRpcSemanticFrame, context: IRpcFlowContext): IRpcSemanticFrame {
    switch (message.kind) {
      case RpcWireKind.error:
        return { ...message, error: this.#error(message.error, context) }
      case RpcWireKind.cancel:
      case RpcWireKind.control:
        return message.reason === undefined
          ? message
          : { ...message, reason: this.#error(message.reason, context) }
      case RpcWireKind.stream: {
        /** Stream terminal errors and cancellation reasons are distinct fixed optional slots. */
        const stream = message.stream
        if (stream.error === undefined && stream.reason === undefined) return message
        return {
          ...message,
          stream: {
            ...stream,
            ...(stream.error === undefined ? {} : { error: this.#error(stream.error, context) }),
            ...(stream.reason === undefined ? {} : { reason: this.#error(stream.reason, context) })
          }
        }
      }
      case RpcWireKind.result: {
        if (message.task.mode !== RpcCallMode.group || !Object.hasOwn(message, 'result'))
          return message
        /** The group discriminant distinguishes protocol failures from ordinary array payloads. */
        const result = this.#group(message.result as readonly IRpcStepOutcome[], context)
        return result === message.result ? message : { ...message, result }
      }
      case RpcWireKind.outcome: {
        if (message.operation !== 'result' || message.state !== 'done') return message
        /** Preserve the original store, generation and successful business value identities. */
        const completion = this.#completion(
          message.outcome.completion,
          message.outcome.mode,
          context
        )
        return completion === message.outcome.completion
          ? message
          : { ...message, outcome: { ...message.outcome, completion } }
      }
      default:
        return message
    }
  }
}

/** Install one outbound-only mapper at its fixed built-in position before authentication. */
export function errorMapFeature(map: IRpcErrorMap): IRpcFlowFeature {
  if (typeof map !== 'function') invalidFlow(RpcErrorMapText.mapperMustBeFunction)
  return defineBuiltinFlowFeature('errorMap', {
    name: RpcErrorMapName,
    setup() {
      /** Each actual registration holds its selected host or transport-local developer callback. */
      const mapping = new OutboundErrorMapping(map)
      return {
        stages: {
          [RpcFlowPoint.handshakeOutbound]: mapping.handshake,
          [RpcFlowPoint.envelopeOutbound]: mapping.envelope
        }
      }
    }
  })
}

export default errorMapFeature
