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
  /** One scope selects at most one feature per call, flow or transport-native role. */
  featureCombinationConflict: 'RPC plugin installs the same feature role more than once',
  /** Custom execution phases are bounded so cold ordering stays linear in the selected features. */
  flowPhaseInvalid: 'RPC custom flow phase must be an integer from 0 to 65535',
  /** Equal custom phases on one point and layer cannot be ordered by caller record position. */
  flowPhaseConflict: 'RPC custom flows on the same point and layer must use distinct phases',
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
