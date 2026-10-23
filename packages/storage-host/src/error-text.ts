/** Canonical host boundary messages. */
export const StorageErrorText = {
  /**
   * Preserve the original fallback diagnostic text while the package source transfers to its
   * neutral owner.
   */
  defaultError: (code: string) => `[storage-web] ${code}`,
  /** Stable text for rejecting malformed backend identifiers before host mutation. */
  backendIdInvalid: 'storage backend id is invalid',
  /** Stable text for duplicate backend registration or install-batch identifiers. */
  backendDuplicate: 'storage backend is already installed',
  /** Stable text for a valid backend identifier absent from the host registry. */
  backendNotInstalled: 'storage backend is not installed',
  /** Stable text for backend plugin/store contract rejection. */
  backendPluginInvalid: 'storage backend plugin is invalid',
  /** Stable text for backend factory, preparation, or PluginHost install failure. */
  backendInstallFailed: 'storage backend installation failed',
  /** Stable text for rejecting host mutation while another batch is installing. */
  storageHostBusy: 'storage host is busy installing plugins',
  /** Stable text for host operations after seal or terminal disposal. */
  storageHostDisposed: 'storage host is disposed',
  /** Stable text for aggregate host cleanup failure. */
  storageHostDisposeFailed: 'storage host failed to dispose',
  /** Stable kind mismatch diagnostic; token identity remains the authority. */
  backendKindMismatch: 'storage backend kind does not match'
} as const
