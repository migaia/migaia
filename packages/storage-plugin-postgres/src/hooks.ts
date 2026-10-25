import type { IStorageCapabilities } from '@migaia/storage-contract'
import type { IStorageHookIdentity } from '@migaia/storage-host'
/** Actual server facts contain no driver configuration or database credentials. */
export type IPgCapabilityProbeHookPayload = IStorageHookIdentity &
  Readonly<{
    version: string
    isolationLevel: string
    capabilities: IStorageCapabilities
    maxSlotWalKeepSize?: string
    /** PostgreSQL numeric byte counts remain decimal strings rather than rounded JS numbers. */
    confirmedFlushLagBytes?: string
    retainedWalBytes?: string
  }>
/** Notifications report only their channel identity and never copy the application payload. */
export type IPgNotifyHookPayload = IStorageHookIdentity & Readonly<{ channel: string }>
declare module '@migaia/storage-host' {
  /** This package is the sole owner of PostgreSQL-specific hook payload declarations. */
  interface IStorageHookMap {
    onCapabilityProbe: IPgCapabilityProbeHookPayload
    onNotify: IPgNotifyHookPayload
  }
}
