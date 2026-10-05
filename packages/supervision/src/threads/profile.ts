import { SupervisionErrorCode, SupervisionErrorText, type IUnitProfile } from '../index.js'
import { createSupervisionError } from '../errors.js'
import { ThreadCapability, ThreadLimit, ThreadUnitKind } from './constants.js'
import type { IThreadExitStatus, IThreadHandle, IThreadSpec } from './types.js'

/** Rejects a thread-only option with its public field and native error class. */
export function invalidThreadOption(
  field: string,
  Constructor: TypeErrorConstructor | RangeErrorConstructor = TypeError,
  detail: Readonly<Record<string, unknown>> = {}
): never {
  throw createSupervisionError(
    Constructor,
    SupervisionErrorCode.invalidOption,
    SupervisionErrorText.invalidOption,
    { detail: { kind: ThreadUnitKind.thread, field, ...detail } }
  )
}

/** Validate only the thread-specific specification, including positive limits. */
export function validateThreadSpec(spec: IThreadSpec): void {
  if (spec === null || typeof spec !== 'object' || typeof spec.entry !== 'string' || !spec.entry)
    invalidThreadOption('spec.entry')
  if (spec.name !== undefined && typeof spec.name !== 'string') invalidThreadOption('spec.name')
  if (spec.limits === undefined) return
  if (spec.limits === null || typeof spec.limits !== 'object' || Array.isArray(spec.limits))
    invalidThreadOption('spec.limits')
  for (const field of [ThreadLimit.heapBytes, 'callWallTimeMs'] as const) {
    /** Only positive finite numbers can be delegated as launcher limits. */
    const value = spec.limits[field]
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0))
      invalidThreadOption(`spec.limits.${field}`, RangeError)
  }
}

/** Supplies termination and exit semantics without another lifecycle machine. */
export function createThreadProfile<THandle extends IThreadHandle>(): IUnitProfile<
  IThreadSpec,
  THandle,
  IThreadExitStatus
> {
  return {
    kind: ThreadUnitKind.thread,
    gracefulTermination: false,
    requirements: (spec) =>
      spec.limits?.heapBytes === undefined
        ? ['termination']
        : ['termination', ThreadCapability.heapLimit],
    validateSpec: validateThreadSpec,
    terminate: (handle) => handle.terminate(),
    exitStatus: (status) => ({ code: status.code }),
    classifyExit: (status) => {
      if (status.limit === ThreadLimit.heapBytes)
        return {
          reason: 'resource-violation',
          detail: { limit: status.limit, code: status.code },
          cause: status.error
        }
      if (status.error !== undefined || status.code !== 0)
        return { reason: 'crashed', detail: { code: status.code }, cause: status.error }
      return { reason: 'exited' }
    }
  }
}
