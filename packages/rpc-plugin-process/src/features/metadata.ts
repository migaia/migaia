import type { IIpcLogRecord, IIpcSendQueueOptions } from '@migaia/rpc-host/plugin'

/** Cold options belong to the exact registered feature object, never a copied public descriptor. */
export type IProcessFeatureConfiguration = Readonly<{
  sendQueue?: Pick<IIpcSendQueueOptions, 'maxPendingData' | 'maxPendingControl'>
  log?: Readonly<{ report(record: IIpcLogRecord): void | Promise<void> }>
}>

/** Process normalization alone reads these options before its original physical connection opens. */
const configurations = new WeakMap<object, IProcessFeatureConfiguration>()

/** Retain immutable cold configuration without creating a queue, gate, log subscription or cleanup. */
export function registerProcessFeatureConfiguration(
  feature: object,
  configuration: IProcessFeatureConfiguration
): void {
  configurations.set(feature, configuration)
}

/** Exact feature possession selects configuration; public fields or copied objects grant none. */
export function readProcessFeatureConfiguration(
  feature: unknown
): IProcessFeatureConfiguration | undefined {
  return typeof feature === 'object' && feature !== null ? configurations.get(feature) : undefined
}
