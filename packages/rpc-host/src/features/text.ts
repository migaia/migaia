/** Stable feature registration names are shared by factory definitions and their native Host owner. */
export const RpcFeatureName = {
  /** Installs the canonical framing lifecycle root. */ chunk: 'rpc-chunk',
  /** Configures the canonical frame authentication owner. */ auth: 'rpc-auth',
  /** Selects the canonical generation retry policy. */ retry: 'rpc-retry',
  /** Supplies the inherited call timeout budget. */ timeout: 'rpc-timeout',
  /** Writes accepted peer capabilities through a caller-owned output capability. */ typegen:
    'rpc-typegen'
} as const

/** Declaration spellings stay local to the one peer-schema renderer. */
export const RpcTypegenText = {
  /** Missing schemas deliberately confer no inferred type information. */ unknown: 'unknown',
  /** An empty admitted alternative set has no possible inhabitant. */ never: 'never',
  /** JSON integer and number domains share the TypeScript number representation. */ number:
    'number',
  /** Portable scalar spellings match the corresponding TypeScript primitive domains. */ scalar: {
    null: 'null',
    boolean: 'boolean',
    number: 'number',
    integer: 'number',
    string: 'string'
  },
  /** Root declaration names are fixed locally and never derived from remote identifiers. */ api: 'IRemoteApi',
  /** Consumers may select a remote peer by its escaped original name. */ peers: 'IRemotePeers',
  /** Every schema alias uses a local numeric suffix rather than an untrusted definition key. */
  alias: (index: number): string => `IType${index}`,
  /** This comment contains no peer data, configuration or authentication material. */
  header: '// Generated from accepted peer method schemas.\n',
  /** Only a fixed prefix, UTF-8 hex and fixed extension reach the caller-owned output capability. */
  fileName: (hex: string): string => `peer-${hex}.d.ts`,
  /** All remote keys and string literals use JSON's valid quoted TypeScript spelling. */
  quote: (value: string): string => JSON.stringify(value),
  /** JSON Schema permits undeclared object members in this closed keyword subset. */
  additionalProperties: '[key: string]: unknown',
  /** Undeclared inputs remain optional so no-argument peers stay usable. */
  unknownPayload: 'payload?: unknown'
} as const
