import { attachErrorIdentity } from '@migaia/utils/error'
import { CapabilityGraphErrorCode, type ICapabilityGraphErrorCode } from './error-code.js'
import { CapabilityGraphErrorText } from './error-text.js'

/** Stable source identity for all Graph-owned errors. */
export const CAPABILITY_GRAPH_SOURCE = '@migaia/capability/graph'

/** Graph error shape exposed at the public boundary. */
export type ICapabilityGraphError = Error & {
  readonly source: typeof CAPABILITY_GRAPH_SOURCE
  readonly code: ICapabilityGraphErrorCode
  readonly detail?: Readonly<Record<string, unknown>>
}

/** Snapshots public diagnostic data so callers cannot mutate error identity. */
function freezeDetail(
  detail: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = { ...detail }
  if (Array.isArray(snapshot.path)) snapshot.path = Object.freeze([...snapshot.path])
  return Object.freeze(snapshot)
}

/** Creates a graph-owned Error while preserving the original as cause. */
export function createCapabilityGraphError(
  code: ICapabilityGraphErrorCode,
  message: string,
  options?: { readonly cause?: unknown; readonly detail?: Readonly<Record<string, unknown>> }
): ICapabilityGraphError {
  const error = new Error(
    message,
    options !== undefined && 'cause' in options ? { cause: options.cause } : undefined
  )
  attachErrorIdentity(error, { source: CAPABILITY_GRAPH_SOURCE, code })
  if (options?.detail !== undefined) {
    Object.defineProperty(error, 'detail', {
      value: freezeDetail(options.detail),
      enumerable: true
    })
  }
  return error as ICapabilityGraphError
}

/** Keeps a same-source Error identity and wraps foreign errors so both sources remain traceable. */
export function graphFailure(
  code: ICapabilityGraphErrorCode,
  primary: unknown,
  detail?: Readonly<Record<string, unknown>>
): ICapabilityGraphError {
  if (primary instanceof Error) {
    const source = Object.getOwnPropertyDescriptor(primary, 'source')?.value
    if (source === undefined) {
      try {
        attachErrorIdentity(primary, { source: CAPABILITY_GRAPH_SOURCE, code })
        if (detail !== undefined)
          Object.defineProperty(primary, 'detail', {
            value: freezeDetail(detail),
            enumerable: true
          })
        return primary as ICapabilityGraphError
      } catch {
        // A frozen or conflicting error must be wrapped below.
      }
    } else if (source === CAPABILITY_GRAPH_SOURCE) {
      return primary as ICapabilityGraphError
    }
    if (primary instanceof AggregateError) {
      const aggregate = new AggregateError([...primary.errors], primary.message, {
        cause: primary
      })
      attachErrorIdentity(aggregate, { source: CAPABILITY_GRAPH_SOURCE, code })
      if (detail !== undefined)
        Object.defineProperty(aggregate, 'detail', {
          value: freezeDetail(detail),
          enumerable: true
        })
      return aggregate as unknown as ICapabilityGraphError
    }
  }
  return createCapabilityGraphError(code, graphMessageFor(code), { cause: primary, detail })
}

/** Maps a code to its stable public message without scattering literals at throw sites. */
export function graphMessageFor(code: ICapabilityGraphErrorCode): string {
  const messages: Record<ICapabilityGraphErrorCode, string> = {
    [CapabilityGraphErrorCode.graphDisposed]: CapabilityGraphErrorText.disposed,
    [CapabilityGraphErrorCode.graphFrozen]: CapabilityGraphErrorText.frozen,
    [CapabilityGraphErrorCode.invalidNode]: CapabilityGraphErrorText.invalidNode,
    [CapabilityGraphErrorCode.duplicateNode]: CapabilityGraphErrorText.duplicateNode,
    [CapabilityGraphErrorCode.unknownProvider]: CapabilityGraphErrorText.unknownProvider,
    [CapabilityGraphErrorCode.duplicateEdge]: CapabilityGraphErrorText.duplicateEdge,
    [CapabilityGraphErrorCode.dependencyCycle]: CapabilityGraphErrorText.dependencyCycle,
    [CapabilityGraphErrorCode.providerUnavailable]: CapabilityGraphErrorText.providerUnavailable,
    [CapabilityGraphErrorCode.startFailed]: CapabilityGraphErrorText.startFailed,
    [CapabilityGraphErrorCode.disposeFailed]: CapabilityGraphErrorText.disposeFailed,
    [CapabilityGraphErrorCode.admissionClosed]: CapabilityGraphErrorText.admissionClosed,
    [CapabilityGraphErrorCode.unknownNode]: CapabilityGraphErrorText.unknownNode,
    [CapabilityGraphErrorCode.reentrantOperation]: CapabilityGraphErrorText.reentrantOperation,
    [CapabilityGraphErrorCode.invalidOption]: CapabilityGraphErrorText.invalidOption
  }
  return messages[code]
}
