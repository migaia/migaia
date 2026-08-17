/** Field builder execution modes used by the store facade. */
export const StoreFieldMode = {
  sync: 'sync',
  async: 'async'
} as const;

export type IStoreFieldMode = (typeof StoreFieldMode)[keyof typeof StoreFieldMode];
