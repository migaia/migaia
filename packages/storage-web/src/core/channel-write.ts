import { StorageError, StorageErrorCode, type IStorageChannel } from '../types/errors';
import type { IStorageKey } from '../types/context';

export type IChannelPresence = ReadonlySet<IStorageChannel>;
export type IChannelMutationPlan = {
  readonly remove: readonly IStorageChannel[];
};

/** Resolve cross-channel conflict once; backend adapters only execute returned removals. */
export const planChannelWrite = (
  key: IStorageKey,
  attempted: IStorageChannel,
  existing: IChannelPresence,
  policy: 'conflict' | 'replace' = 'conflict',
  backend: 'memory' | 'indexeddb' = 'memory'
): IChannelMutationPlan => {
  const conflicts = [...existing].filter((channel) => channel !== attempted);
  if (conflicts.length > 0 && policy !== 'replace')
    throw new StorageError(StorageErrorCode.duplicateKey, {
      backend,
      key,
      existingChannel: conflicts[0],
      attemptedChannel: attempted
    });
  return { remove: conflicts };
};
