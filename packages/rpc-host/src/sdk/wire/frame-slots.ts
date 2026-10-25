/**
 * Projects only the fixed portable payload/result roots of an already-admitted semantic frame.
 * Binary execution reuses this shallow slot boundary without rewalking metadata or granting
 * protocol admission, Session identity or transport ownership.
 */
import {
  RpcCallMode,
  RpcWireKind as K,
  RpcWireStepState as S,
  RpcStreamEvent,
  type IRpcEnvelope,
  type IRpcPortableValue,
  type IRpcStepOutcome,
  type IRpcCompletion
} from '@migaia/rpc-contract/protocol'

/** One projection maps only already-admitted fixed portable slots; business graphs are never walked. */
type IProjectSlot = (value: IRpcPortableValue) => IRpcPortableValue

/** Preserve admitted group structure while selecting only already-built successful business roots. */
function group(
  values: readonly IRpcStepOutcome[],
  project: IProjectSlot
): readonly IRpcStepOutcome[] {
  return Object.freeze(
    values.map((step) =>
      step.state === S.success && Object.hasOwn(step, 'result')
        ? Object.freeze({ ...step, result: project(step.result!) })
        : step
    )
  )
}
/** Stored completion metadata remains unchanged; no error tree or business graph is revisited. */
function completion(value: IRpcCompletion, mode: string, project: IProjectSlot): IRpcCompletion {
  if (!value.ok || !Object.hasOwn(value, 'result')) return value
  return Object.freeze({
    ...value,
    result:
      mode === RpcCallMode.group
        ? group(value.result as readonly IRpcStepOutcome[], project)
        : project(value.result as IRpcPortableValue)
  })
}
/** Select the alternate result of the sole binary admission for each known fixed business slot. */
export function projectRpcFrameSlots(frame: IRpcEnvelope, project: IProjectSlot): IRpcEnvelope {
  /** Shallow replacement retains the original admitted metadata key positions. */
  let extensions: Record<string, IRpcPortableValue> | undefined
  if (frame.extensions) {
    /** Contract admits extensions before operation slots; occurrence order must stay identical. */
    extensions = {}
    for (const [key, value] of Object.entries(frame.extensions))
      Object.defineProperty(extensions, key, { value: project(value), enumerable: true })
  }
  /** Original discriminants preserve the type of each operation's shallow replacement. */
  let result = frame
  if (frame.kind === K.call && Object.hasOwn(frame, 'payload'))
    result = { ...frame, payload: project(frame.payload!) }
  else if (frame.kind === K.group)
    result = {
      ...frame,
      steps: Object.freeze(
        frame.steps.map((step) =>
          Object.hasOwn(step, 'payload')
            ? Object.freeze({ ...step, payload: project(step.payload!) })
            : step
        )
      )
    }
  else if (frame.kind === K.result && Object.hasOwn(frame, 'result'))
    result = {
      ...frame,
      result:
        frame.task.mode === RpcCallMode.group
          ? group(frame.result as readonly IRpcStepOutcome[], project)
          : project(frame.result as IRpcPortableValue)
    }
  else if (
    frame.kind === K.stream &&
    (frame.stream.event === RpcStreamEvent.item || frame.stream.event === RpcStreamEvent.end) &&
    Object.hasOwn(frame.stream, 'value')
  )
    result = {
      ...frame,
      stream: Object.freeze({ ...frame.stream, value: project(frame.stream.value!) })
    }
  else if (frame.kind === K.outcome && frame.operation === 'result' && frame.state === 'done')
    result = {
      ...frame,
      outcome: Object.freeze({
        ...frame.outcome,
        completion: completion(frame.outcome.completion, frame.outcome.mode, project)
      })
    }
  if (extensions) result = { ...result, extensions: Object.freeze(extensions) }
  return result === frame ? frame : Object.freeze(result)
}
