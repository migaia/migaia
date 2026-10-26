/** Stable host diagnostics never reflect plugin options, connection secrets or remote method input. */
export const HostErrorText = {
  /**
   * An admitted late terminal cannot settle absent work and is reported without retaining its
   * payload.
   */
  replyUnclaimed: 'RPC response has no active call',
  /** Namespace isolation requires unique own keys before any transport starts. */
  namespaceDuplicate: 'RPC host transport namespace is already installed',
  /** Native extensions cannot replace mandatory namespace calls or an earlier extension member. */
  namespaceExtensionConflict: 'RPC namespace extension conflicts with an existing member',
  /** Namespace names must be safe public keys and cannot replace host lifecycle methods. */
  namespaceInvalid: 'RPC host transport namespace is invalid or reserved',
  /** Full feature instances are the only executing call policy syntax admitted by revision 11. */
  callFeatureInvalid: 'RPC call policy must be a complete feature instance or false',
  /** A plugin can select only one implementation of each call policy. */
  featureCombinationConflict: 'RPC plugin installs the same call feature kind more than once',
  /** Fixed flow hooks cannot be changed after transport startup. */
  flowStarted: 'RPC flow hooks cannot be installed after transport startup',
  /** Advanced stage authoring accepts only the SDK's finite public positions. */
  flowLayerInvalid: 'RPC flow stage layer must be a supported RpcFlowLayer value',
  /** Information flow belongs to reusable Features; native observer plugins cannot add stages. */
  flowFeatureRequired: 'RPC flow stages must be declared by defineFlowFeature',
  /** Native SDK installations require declarations and execution authority from their actual host. */
  nativePipelinesRequired:
    'RPC native host must configure rpcHostPipelines with its actual pipeline owner',
  /** Synchronous admission requires one transport before any resource opens. */
  transportMissing: 'RPC host requires one transport plugin',
  /** Only the exact SDK-created plugin object carries registration identity. */
  pluginInvalid: 'RPC host plugin is not registered by its definition owner',
  /** A live old connection retains its remote display name until departure or one failed ping. */
  peerNameDuplicate: 'RPC host peer name is already connected',
  /** Physical connection budgets remain finite nonnegative numbers across adapter families. */
  connectTimeoutInvalid: 'RPC host connect timeoutMs must be a finite non-negative number',
  /** Cleanup failures remain observable without replacing an original assembly failure. */
  cleanupFailed: 'RPC host resource cleanup failed'
} as const
