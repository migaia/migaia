// Borrowed backend projections of committed stores for one storage host (see ./storage-host.ts).
import {
  registerBackendChangeController,
  registerBackendEnvelopeStages,
  getBackendChangeController,
  registerBackendEntityAccess,
  type IBackendChangeController
} from './core/backend-registry.js'
import { borrowStorageBackend } from './borrow.js'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { snapshotStorageBaseDetailed } from './authoring/store.js'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { createStorageTypeError } from './errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from './error-text.js'
import type { IStorageBase } from '@migaia/storage-contract'
import type { StorageHost } from './storage-host.js'

/** Project a committed store into a borrowed backend view for one organization. */
export class StorageHostProjection {
  /** The host whose committed store contexts and lifecycle a projection reads. */
  readonly #owner: StorageHost<any>

  /** Capture the owning host. */
  constructor(owner: StorageHost<any>) {
    this.#owner = owner
  }

  /** Resolve native organization data through its original registration, then remove ownership. */
  projectBackend(store: IStorageBase, orgId: string): ReturnType<typeof borrowStorageBackend> {
    this.#owner.assertOpen()
    const context = this.#owner.storeContexts.get(store)?.context
    if (context === undefined)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    context.assertExecution()
    return context.storeCell.projectOrgBackend(orgId, () => {
      const native = context.storeCell.forOrg(orgId, this.#owner.orgId)
      /** The original base admission also governs a custom backend's newly exposed physical view. */
      const snapshot = snapshotStorageBaseDetailed(native, { asyncDisposeKey })
      if (!snapshot.valid)
        throw createStorageTypeError(
          StorageHostErrorCode.backendPluginInvalid,
          StorageErrorText.backendPluginInvalid,
          snapshot.cause
        )
      if (snapshot.backend !== context.getKind()?.name)
        throw createStorageTypeError(
          StorageHostErrorCode.backendKindMismatch,
          StorageErrorText.backendKindMismatch
        )
      const ports = context.getOrgContext(orgId)
      const api = context.storeCell.createOrgApi(native, ports.callContext, ports.execution)
      const view = borrowStorageBackend(
        native,
        () => {
          this.#owner.assertOpen()
          context.assertExecution()
        },
        { orgId, ...(api === undefined ? {} : { api }) }
      )
      this.#owner.storeContexts.set(view, { context, native, orgId })
      /** Entity borrows the same controller, filtered through this immutable organization boundary. */
      const controller = getBackendChangeController(native) ?? getBackendChangeController(store)
      if (controller !== undefined) {
        const projectedController: IBackendChangeController = {
          ...controller,
          publish: (change) => controller.publish({ ...change, orgId }),
          subscribe: (listener) =>
            controller.subscribe((change) => {
              if (change.orgId === orgId) return listener(change)
            })
        }
        context.storeCell.retainOrgBinding(
          registerBackendChangeController(view, projectedController)
        )
      }
      context.storeCell.retainOrgBinding(
        registerBackendEnvelopeStages(
          view,
          (operation) => context.getEnvelopeStages(operation, orgId),
          () => context.storeCell.getChainMethods('query')
        )
      )
      context.storeCell.retainOrgBinding(
        registerBackendEntityAccess(view, native, () => {
          this.#owner.assertOpen()
          context.assertExecution()
        })
      )
      return view
    }) as ReturnType<typeof borrowStorageBackend>
  }
}
