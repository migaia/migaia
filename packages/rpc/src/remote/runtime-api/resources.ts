import type { IProcessUsage } from '@migaia/supervision/process'
import type { IThreadUsage } from '@migaia/supervision/threads'
import {
  runtimeMetric,
  runtimeUnavailable,
  type IRuntimeResources,
  type IRuntimeUnavailable
} from './overview.js'
import {
  RuntimeMetricScope,
  RuntimeMetricUnit,
  RuntimeQueryReason,
  RuntimeResourceKind
} from './constants.js'

/** Native handles retain this original optional cold port; no resource state is copied into remote. */
export type IRuntimeNativeUnit = Readonly<{
  identity?: Readonly<{ pid?: number; threadId?: number }>
  sampleUsage?(): Promise<IProcessUsage & IThreadUsage>
}>

/** Project only explicit native resource fields for this captured unit; failures remain reportable. */
export async function runtimeResources(
  unit: IRuntimeNativeUnit | undefined,
  kind: string,
  now: () => number,
  report: (error: unknown) => void
): Promise<IRuntimeResources | IRuntimeUnavailable> {
  if (
    !unit?.sampleUsage ||
    (kind !== RuntimeMetricScope.process && kind !== RuntimeMetricScope.thread)
  )
    return runtimeUnavailable(RuntimeQueryReason.resources)
  try {
    /** This read never selects by name or sends a management request to a different generation. */
    const sample = await unit.sampleUsage()
    /** The owner clock timestamps the actual cold completion, without asserting global atomicity. */
    const observedAt = now()
    /** Missing values are explicit; actual cumulative zero is a valid measured value. */
    const metric = (value: number | undefined, units: string) =>
      value === undefined
        ? runtimeUnavailable(RuntimeQueryReason.native)
        : runtimeMetric(value, kind, units, observedAt)
    /** Both cumulative CPU components must be provided by the exact same native sampler. */
    const cpu =
      sample.cpuUserMicros === undefined || sample.cpuSystemMicros === undefined
        ? runtimeUnavailable(RuntimeQueryReason.native)
        : Object.freeze({
            kind: RuntimeResourceKind.cpuTime,
            user: runtimeMetric(
              sample.cpuUserMicros,
              kind,
              RuntimeMetricUnit.microseconds,
              observedAt
            ),
            system: runtimeMetric(
              sample.cpuSystemMicros,
              kind,
              RuntimeMetricUnit.microseconds,
              observedAt
            )
          })
    if (kind === RuntimeMetricScope.process)
      return Object.freeze({
        scope: kind,
        ...(unit.identity?.pid === undefined ? {} : { pid: unit.identity.pid }),
        rssBytes: metric(sample.rssBytes, RuntimeMetricUnit.bytes),
        cpu
      })
    return Object.freeze({
      scope: kind,
      ...(sample.sharedPid === undefined ? {} : { sharedPid: sample.sharedPid }),
      ...(unit.identity?.threadId === undefined ? {} : { threadId: unit.identity.threadId }),
      heapUsedBytes: metric(sample.heapUsedBytes, RuntimeMetricUnit.bytes),
      heapTotalBytes: metric(sample.heapTotalBytes, RuntimeMetricUnit.bytes),
      cpu,
      ...(sample.elu
        ? {
            elu: Object.freeze({
              kind: RuntimeResourceKind.elu,
              active: runtimeMetric(
                sample.elu.active,
                kind,
                RuntimeMetricUnit.milliseconds,
                observedAt
              ),
              idle: runtimeMetric(
                sample.elu.idle,
                kind,
                RuntimeMetricUnit.milliseconds,
                observedAt
              ),
              utilization: runtimeMetric(
                sample.elu.utilization,
                kind,
                RuntimeMetricUnit.ratio,
                observedAt
              )
            })
          }
        : {})
    })
  } catch (error) {
    report(error)
    return runtimeUnavailable(RuntimeQueryReason.native)
  }
}
