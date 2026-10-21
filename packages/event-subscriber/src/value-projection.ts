import {
  parseObjectPath,
  probeObjectPathSegments,
  type IObjectPathInput,
  type IObjectPathTuple,
  type IObjectPathTupleFor,
  type IPathProbe
} from '@migaia/utils/object-path'
import { EventSubscriberErrorCode } from './error-code.js'
import { createEventTypeError, eventErrorText } from './errors.js'
import {
  createSystemTerminalRuntime,
  reportTerminalDiagnostic
} from './internal/terminal-runtime.js'
import type { IEventChannelOptions, IEventContext } from './types.js'
import type { IEventApiStyle } from './style.js'

/** Validated value alias: its property name, the dotted read path, and the parsed path segments. */
export type IEventProjectionPlan = {
  readonly alias: string
  readonly readPath: string
  readonly segments: IObjectPathTuple
}

/** Result of reading the path for one value: the value, or a diagnostic when reading failed. */
export type IEventProjectionOutcome = {
  readonly value: unknown
  readonly diagnostic: Error | undefined
}

/** Shares the canonical host terminal sinks without adding a projection-specific scheduler. */
const systemTerminalRuntime = createSystemTerminalRuntime()

/** Reads a static valueConfig once and freezes its parsed path before registration can escape. */
export function createEventValueProjectionPlan(config: unknown): IEventProjectionPlan | undefined {
  if (config === undefined) return undefined
  if (typeof config !== 'object' || config === null || Array.isArray(config))
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions)
    )
  /** Raw `readPath` member, read once. */
  let readPath: unknown
  try {
    readPath = (config as { readonly readPath?: unknown }).readPath
  } catch (error) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions),
      error
    )
  }
  if (readPath === undefined) return undefined
  if (typeof readPath !== 'string')
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions)
    )
  if (readPath.trim() === '') return undefined
  /** Raw `alias` member, read once. */
  let alias: unknown
  try {
    alias = (config as { readonly alias?: unknown }).alias
  } catch (error) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions),
      error
    )
  }
  /** Names an alias may not use at runtime, matching the type-level check. */
  const reservedContextKeys = new Set([
    '__proto__',
    'prototype',
    'constructor',
    'value',
    'aborted',
    'abortReason',
    'taskId',
    'abort',
    'setTaskId'
  ])
  if (
    typeof alias !== 'string' ||
    alias.length === 0 ||
    alias !== alias.trim() ||
    reservedContextKeys.has(alias)
  )
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions)
    )
  /** Path segments parsed from `readPath`. */
  let segments: IObjectPathTuple
  try {
    segments = parseObjectPath(readPath)
  } catch (error) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions),
      error
    )
  }
  return Object.freeze({ alias, readPath, segments })
}

/** Probes one frozen path tuple and converts non-value outcomes into one operation diagnostic. */
export function projectEventValue<T>(
  value: T,
  plan: IEventProjectionPlan | undefined
): IEventProjectionOutcome {
  if (!plan) return { value: undefined, diagnostic: undefined }
  /** Result of walking the read path on the payload. */
  const probe = probeObjectPathSegments(
    value,
    plan.segments as IObjectPathTupleFor<T>
  ) as IPathProbe<T, IObjectPathInput<T>>
  if (probe.kind === 'value') return { value: probe.value, diagnostic: undefined }
  /** `VALUE_PROJECTION_FAILED` error carrying the path failure, if any, as `cause`. */
  const diagnostic = createEventTypeError(
    EventSubscriberErrorCode.valueProjectionFailed,
    eventErrorText(EventSubscriberErrorCode.valueProjectionFailed),
    probe.kind === 'failed' ? probe.error : undefined
  )
  Object.defineProperties(diagnostic, {
    kind: { configurable: false, enumerable: true, value: probe.kind },
    readPath: { configurable: false, enumerable: true, value: plan.readPath },
    alias: { configurable: false, enumerable: true, value: plan.alias }
  })
  return { value: undefined, diagnostic }
}

/** Adds one immutable alias data property while keeping every context control live. */
export function addEventProjection<T>(
  context: IEventContext<T>,
  plan: IEventProjectionPlan | undefined,
  outcome: IEventProjectionOutcome
): IEventContext<T> {
  if (!plan) return context
  Object.defineProperty(context, plan.alias, {
    configurable: false,
    enumerable: true,
    writable: false,
    value: outcome.value
  })
  return context
}

/** Copies only canonical projection data so overlays retain ownership of their control methods. */
export function copyEventProjection<T>(
  context: IEventContext<T>,
  source: IEventContext<T>,
  plan: IEventProjectionPlan | undefined
): IEventContext<T> {
  if (!plan) return context
  return addEventProjection(context, plan, {
    value: (source as unknown as Record<string, unknown>)[plan.alias],
    diagnostic: undefined
  })
}

/** Reports one projection diagnostic through the existing report and terminal failure chain. */
export function reportEventProjectionFailure<T, S extends IEventApiStyle | undefined, V>(
  options: IEventChannelOptions<T, S, V>,
  event: IEventContext<T>,
  diagnostic: Error
): void {
  /** Caller's reporter, if configured. */
  const report = options.report
  if (report) {
    try {
      /** Reporter result; a rejection is forwarded to the terminal path. */
      const result = report({ event: event as never, error: diagnostic })
      Promise.resolve(result).catch((failure: unknown) =>
        reportProjectionTerminal(options, diagnostic, failure)
      )
      return
    } catch (failure) {
      reportProjectionTerminal(options, diagnostic, failure)
      return
    }
  }
  reportProjectionTerminal(options, diagnostic, undefined)
}

/** Preserves projection code while appending reporter and terminal failures in order. */
function reportProjectionTerminal<T, S extends IEventApiStyle | undefined, V>(
  options: IEventChannelOptions<T, S, V>,
  diagnostic: Error,
  failure: unknown
): void {
  /** Errors passed to the terminal reporter: the diagnostic plus the reporter's own failure, if any. */
  const errors = failure === undefined ? [diagnostic] : [diagnostic, failure]
  reportTerminalDiagnostic(
    EventSubscriberErrorCode.valueProjectionFailed,
    errors,
    options.terminalReport,
    systemTerminalRuntime
  )
}
