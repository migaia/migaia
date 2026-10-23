/** Stable host diagnostics never reflect plugin options, connection secrets or remote method input. */
export const HostErrorText = {
  /** Synchronous admission requires one transport before any resource opens. */
  transportMissing: 'RPC host requires one transport plugin',
  /** A host has one physical transport owner and cannot merge transport definitions. */
  transportDuplicate: 'RPC host accepts only one transport plugin',
  /** Only the exact SDK-created plugin object carries registration identity. */
  pluginInvalid: 'RPC host plugin is not registered by its definition owner',
  /** Two assembly policies cannot both select the host logical member. */
  assemblerDuplicate: 'RPC host accepts only one assembling feature',
  /** Feature factory identity, rather than instance name, determines duplicate installation. */
  featureDuplicate: 'RPC host feature definition is already installed',
  /** A live old connection retains its remote display name until departure or one failed ping. */
  peerNameDuplicate: 'RPC host peer name is already connected',
  /** Physical connection budgets remain finite nonnegative numbers across adapter families. */
  connectTimeoutInvalid: 'RPC host connect timeoutMs must be a finite non-negative number',
  /** A deployment token must belong to the canonical adapter owner before it may acquire resources. */
  deploymentInvalid: 'RPC host deployment is not prepared by its adapter owner',
  /** Cleanup failures remain observable without replacing an original assembly failure. */
  cleanupFailed: 'RPC host resource cleanup failed'
} as const
