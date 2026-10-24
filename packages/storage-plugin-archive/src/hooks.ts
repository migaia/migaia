import type { IStorageHookIdentity } from '@migaia/storage-host'
import type { IArchiveRunResult, IArchiveSweepResult } from './types.js'
declare module '@migaia/storage-host' {
  /** Archive observes original host operations without retaining business data. */
  interface IStorageHookMap {
    beforeArchiveRun: IStorageHookIdentity & { readonly ruleCount: number; readonly limit?: number }
    afterArchiveRun: IStorageHookIdentity & IArchiveRunResult
    onArchiveRunError: IStorageHookIdentity & IArchiveRunResult & { readonly code?: string }
    afterArchiveRestore: IStorageHookIdentity & { readonly restored: boolean }
    afterArchiveSweep: IStorageHookIdentity & IArchiveSweepResult
  }
}
