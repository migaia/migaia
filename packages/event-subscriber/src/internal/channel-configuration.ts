/**
 * Reads channel construction options once and validates their public contract before state exists.
 * Exposes the admitted configuration; registration and dispatch own all mutable runtime state.
 */
import { validateEventReporter } from './channel-options.js'
import { EventSubscriberErrorCode } from '../error-code.js'
import { codeExistingError } from '../errors.js'
import {
  EventAdmissionPolicy,
  EventDispatchPolicy,
  EventRemovalPolicy
} from '../state-constants.js'
import { readEventApiStyle, type IEventApiStyle, type IEventApiStylePlan } from '../style.js'
import type { IEventChannelOptions } from '../types.js'
import { createEventValueProjectionPlan, type IEventProjectionPlan } from '../value-projection.js'
import { isRecord } from './record.js'
import { createInvalidOptionsError } from './channel-options.js'

/** Validated configuration shared by the channel's composed runtime owners. */
export type IChannelConfiguration<T, V> = {
  /** Reporter and dispatch settings after all caller getters have been read. */
  readonly options: IEventChannelOptions<T, undefined, V>
  /** Listener identity policy used only by registration admission. */
  readonly admissionPolicy: IEventChannelOptions<T, undefined, V>['admissionPolicy']
  /** Fixed alias projection resolved before allocating the public channel. */
  readonly stylePlan: IEventApiStylePlan
  /** Optional static payload projection reused by every dispatch. */
  readonly projectionPlan: IEventProjectionPlan | undefined
}

/** Rejects malformed options with the incumbent read order, native errors and cause identity. */
export function readChannelConfiguration<T, V>(
  options: IEventChannelOptions<T, IEventApiStyle | undefined, V>,
  suppliedProjectionPlan?: IEventProjectionPlan
): IChannelConfiguration<T, V> {
  /** Validated `report` option. */
  let report: IEventChannelOptions<T, undefined, V>['report']
  /** Validated `terminalReport` option. */
  let terminalReport: IEventChannelOptions<T, undefined, V>['terminalReport']
  /** Validated `dispatchPolicy` option. */
  let dispatchPolicy: IEventChannelOptions<T, undefined, V>['dispatchPolicy']
  /** The selected mode is read once before creating any registration state. */
  let admissionPolicy: IEventChannelOptions<T, undefined, V>['admissionPolicy']
  /** Validated `removalPolicy` option; defaults to removing only the called handle. */
  let removalPolicy: IEventChannelOptions<T, undefined, V>['removalPolicy']
  /** Validated `publishBudget` option. */
  let publishBudget: number | undefined
  /** Validated `throwOnAborted` option. */
  let throwOnAborted: boolean
  /** Raw `valueConfig` option; validated when the projection plan is built. */
  let valueConfig: unknown
  try {
    if (!isRecord(options)) {
      throw createInvalidOptionsError()
    }
    report = options.report
    terminalReport = options.terminalReport
    dispatchPolicy = options.dispatchPolicy ?? EventDispatchPolicy.recursive
    admissionPolicy = options.admissionPolicy
    removalPolicy = options.removalPolicy ?? EventRemovalPolicy.handle
    publishBudget = options.publishBudget ?? 100_000
    /** Raw `throwOnAborted` option, read once so a getter cannot change between checks. */
    const suppliedThrowOnAborted = options.throwOnAborted
    throwOnAborted = suppliedThrowOnAborted === undefined ? false : suppliedThrowOnAborted
    valueConfig = options.valueConfig as unknown
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions)
  }
  /** Alias reads and failures share the same owner and wrapping as Hub construction. */
  const stylePlan = readEventApiStyle(options)
  validateEventReporter(report)
  validateEventReporter(terminalReport)
  if (
    (dispatchPolicy !== EventDispatchPolicy.recursive &&
      dispatchPolicy !== EventDispatchPolicy.queued) ||
    (admissionPolicy !== undefined &&
      admissionPolicy !== EventAdmissionPolicy.multiple &&
      admissionPolicy !== EventAdmissionPolicy.unique) ||
    (removalPolicy !== EventRemovalPolicy.handle &&
      removalPolicy !== EventRemovalPolicy.listenerAll) ||
    !Number.isSafeInteger(publishBudget) ||
    publishBudget < 1 ||
    typeof throwOnAborted !== 'boolean'
  ) {
    throw createInvalidOptionsError()
  }
  /** Options after validation, shared by dispatch, reporters and helper functions. */
  const normalizedOptions: IEventChannelOptions<T, undefined, V> = {
    report,
    terminalReport,
    valueConfig: valueConfig as IEventChannelOptions<T, undefined, V>['valueConfig'],
    removalPolicy,
    dispatchPolicy,
    publishBudget,
    throwOnAborted
  }
  /** Projection plan of the value alias; `undefined` when no `valueConfig` was given. */
  const projectionPlan = suppliedProjectionPlan ?? createEventValueProjectionPlan(valueConfig)
  return { options: normalizedOptions, admissionPolicy, stylePlan, projectionPlan }
}
