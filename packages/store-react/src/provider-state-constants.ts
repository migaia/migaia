/** Store provider readiness states used during hydration and startup. */
export const StoreProviderState = {
  pending: 'pending',
  ready: 'ready',
  error: 'error'
} as const;

/** Empty serialized feature map used as the canonical no-feature snapshot. */
export const EMPTY_EXPERIMENTAL_ENCODING = '[]';

export type IStoreProviderState = (typeof StoreProviderState)[keyof typeof StoreProviderState];
