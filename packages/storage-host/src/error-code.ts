/** Canonical host boundary codes. */
export const StorageErrorCode = {
  /**
   * A backend definition contains an invalid identifier. Callers must correct the bounded backend
   * ID before retrying installation.
   */
  backendIdInvalid: 'BACKEND_ID_INVALID',
  /**
   * A backend ID is already present in the host install batch or registry. Callers must use a
   * distinct ID or wait for the existing batch before retrying.
   */
  backendDuplicate: 'BACKEND_DUPLICATE',
  /**
   * A lookup requested a valid backend ID that has not been installed. Callers must install that
   * exact backend or select an installed ID.
   */
  backendNotInstalled: 'BACKEND_NOT_INSTALLED',
  /**
   * A backend plugin or store failed its runtime contract check. Callers must repair the plugin
   * definition rather than relying on an unvalidated store.
   */
  backendPluginInvalid: 'BACKEND_PLUGIN_INVALID',
  /**
   * Backend creation, preparation, or PluginHost installation failed. Callers may retry after
   * fixing the cause, while the failed batch remains unpublished.
   */
  backendInstallFailed: 'BACKEND_INSTALL_FAILED',
  /**
   * A host mutation was requested while another install batch is active. Callers must wait for that
   * batch to settle and explicitly retry.
   */
  storageHostBusy: 'STORAGE_HOST_BUSY',
  /**
   * A host or its public operation was used after sealing or terminal disposal. Callers must create
   * a new host instead of reviving this one.
   */
  storageHostDisposed: 'STORAGE_HOST_DISPOSED',
  /**
   * Host cleanup collected one or more failures. Callers must treat the host as terminal while
   * inspecting the aggregate errors for cleanup diagnostics.
   */
  storageHostDisposeFailed: 'STORAGE_HOST_DISPOSE_FAILED',
  /** A backend token does not match the installed store or selected Feature. */
  backendKindMismatch: 'BACKEND_KIND_MISMATCH'
} as const

export type IStorageErrorCode = (typeof StorageErrorCode)[keyof typeof StorageErrorCode]
