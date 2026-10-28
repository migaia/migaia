import type { IRpcWarning } from './warning.ts'

/** Stable public warning text belongs to Host, independently from error/report contracts. */
export const HostWarningText = {
  /** Describe only the explicit identity values replaced by actual trusted parent facts. */
  selfIgnored: (data: IRpcWarning['data']): string =>
    [
      ...(data.ignoredName === undefined
        ? []
        : [
            `self.name will be ignored: parent name ${JSON.stringify(data.parentName)}, configured name ${JSON.stringify(data.ignoredName)}`
          ]),
      ...(data.ignoredInstanceId === undefined
        ? []
        : [
            `self.instanceId will be ignored: parent instanceId ${JSON.stringify(data.parentInstanceId)}, configured instanceId ${JSON.stringify(data.ignoredInstanceId)}`
          ])
    ].join('; ')
} as const
