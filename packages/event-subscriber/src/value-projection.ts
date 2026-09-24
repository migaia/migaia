import {
  parseObjectPath,
  probeObjectPathSegments,
  type IObjectPathInput,
  type IObjectPathTuple,
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

export type IEventProjectionPlan = {
  readonly alias: string
  readonly readPath: string
  readonly segments: IObjectPathTuple
}

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
  const probe = probeObjectPathSegments(value, plan.segments as IObjectPathInput<T>) as IPathProbe<
    T,
    IObjectPathInput<T>
  >
  if (probe.kind === 'value') return { value: probe.value, diagnostic: undefined }
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

/** Reports one projection diagnostic through the existing report and terminal failure chain. */
export function reportEventProjectionFailure<T, S extends IEventApiStyle | undefined, V>(
  options: IEventChannelOptions<T, S, V>,
  event: IEventContext<T>,
  diagnostic: Error
): void {
  const report = options.report
  if (report) {
    try {
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
  const errors = failure === undefined ? [diagnostic] : [diagnostic, failure]
  reportTerminalDiagnostic(
    EventSubscriberErrorCode.valueProjectionFailed,
    errors,
    options.terminalReport,
    systemTerminalRuntime
  )
}
