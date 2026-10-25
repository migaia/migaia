/** Original native cold projection is separate from the source owner's exact retirement fact. */
import type { IProcessUsage } from '@migaia/supervision/process'
import type { IThreadUsage } from '@migaia/supervision/threads'
import {
  rpcMemberMetric,
  rpcMemberUnavailable,
  type IRpcMemberResources,
  type IRpcMemberUnavailable
} from './native-members-overview.js'
import {
  RpcMemberMetricScope,
  RpcMemberMetricUnit,
  RpcMemberQueryReason,
  RpcMemberResourceKind
} from './native-members-constants.js'

/** Native handles retain this original optional cold port; no resource state is copied into remote. */
export type IRpcMemberNativeUnit = Readonly<{
  identity?: Readonly<{ pid?: number; threadId?: number }>
  sampleUsage?(): Promise<IProcessUsage & IThreadUsage>
}>

/** Project only explicit native resource fields for this captured unit; failures remain reportable. */
async function sampleMemberResources(
  unit: IRpcMemberNativeUnit | undefined,
  kind: string,
  now: () => number,
  report: (error: unknown) => void
): Promise<IRpcMemberResources | IRpcMemberUnavailable> {
  if (
    !unit?.sampleUsage ||
    (kind !== RpcMemberMetricScope.process && kind !== RpcMemberMetricScope.thread)
  )
    return rpcMemberUnavailable(RpcMemberQueryReason.resources)
  try {
    /** This read never selects by name or sends a management request to a different generation. */
    const sample = await unit.sampleUsage()
    /** The owner clock timestamps the actual cold completion, without asserting global atomicity. */
    const observedAt = now()
    /** Missing values are explicit; actual cumulative zero is a valid measured value. */
    const metric = (value: number | undefined, units: string) =>
      value === undefined
        ? rpcMemberUnavailable(RpcMemberQueryReason.native)
        : rpcMemberMetric(value, kind, units, observedAt)
    /** Both cumulative CPU components must be provided by the exact same native sampler. */
    const cpu =
      sample.cpuUserMicros === undefined || sample.cpuSystemMicros === undefined
        ? rpcMemberUnavailable(RpcMemberQueryReason.native)
        : Object.freeze({
            kind: RpcMemberResourceKind.cpuTime,
            user: rpcMemberMetric(
              sample.cpuUserMicros,
              kind,
              RpcMemberMetricUnit.microseconds,
              observedAt
            ),
            system: rpcMemberMetric(
              sample.cpuSystemMicros,
              kind,
              RpcMemberMetricUnit.microseconds,
              observedAt
            )
          })
    if (kind === RpcMemberMetricScope.process)
      return Object.freeze({
        scope: kind,
        ...(unit.identity?.pid === undefined ? {} : { pid: unit.identity.pid }),
        rssBytes: metric(sample.rssBytes, RpcMemberMetricUnit.bytes),
        cpu
      })
    return Object.freeze({
      scope: kind,
      ...(sample.sharedPid === undefined ? {} : { sharedPid: sample.sharedPid }),
      ...(unit.identity?.threadId === undefined ? {} : { threadId: unit.identity.threadId }),
      heapUsedBytes: metric(sample.heapUsedBytes, RpcMemberMetricUnit.bytes),
      heapTotalBytes: metric(sample.heapTotalBytes, RpcMemberMetricUnit.bytes),
      cpu,
      ...(sample.elu
        ? {
            elu: Object.freeze({
              kind: RpcMemberResourceKind.elu,
              active: rpcMemberMetric(
                sample.elu.active,
                kind,
                RpcMemberMetricUnit.milliseconds,
                observedAt
              ),
              idle: rpcMemberMetric(
                sample.elu.idle,
                kind,
                RpcMemberMetricUnit.milliseconds,
                observedAt
              ),
              utilization: rpcMemberMetric(
                sample.elu.utilization,
                kind,
                RpcMemberMetricUnit.ratio,
                observedAt
              )
            })
          }
        : {})
    })
  } catch (error) {
    report(error)
    return rpcMemberUnavailable(RpcMemberQueryReason.native)
  }
}

/** Sample only the captured native unit; a retired read never samples its successor by name. */
export async function rpcMemberResources(
  unit: IRpcMemberNativeUnit | undefined,
  kind: string,
  now: () => number,
  report: (error: unknown) => void,
  isCurrent: () => boolean
): Promise<IRpcMemberResources | IRpcMemberUnavailable> {
  /** Both success and reported sampler failure retain the same source-owner retirement check. */
  const sampled = await sampleMemberResources(unit, kind, now, report)
  return unit && !isCurrent() ? rpcMemberUnavailable(RpcMemberQueryReason.retired) : sampled
}
