import type { IStorageHookIdentity, IStorageHttpHookPayload } from '@migaia/storage-host'
/** Commit statistics expose counts, never native update text or quad values. */
export type ISparqlUpdateHookPayload = IStorageHookIdentity &
  Readonly<{ operationCount: number; preconditionCount: number }>
/** Failed preconditions expose only the already-known count. */
export type ISparqlPreconditionHookPayload = IStorageHookIdentity &
  Readonly<{ preconditionCount: number }>
declare module '@migaia/storage-host' {
  /** Interface semantics augment the existing host's only event map. */
  interface IStorageHookMap {
    onHttpRequest: IStorageHttpHookPayload
    beforeSparqlUpdate: ISparqlUpdateHookPayload
    onPreconditionFailed: ISparqlPreconditionHookPayload
  }
}
