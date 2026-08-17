import { StorageError, StorageErrorCode, type IStorageChannel } from '../types/errors.js';
import type { IStorageKey } from '../types/context.js';
import {
  StorageBackend,
  StorageConflictPolicy,
  type IStorageBackend,
  type IStorageConflictPolicy
} from '../constants.js';

export type IChannelPresence = ReadonlySet<IStorageChannel>;
export type IChannelMutationPlan = {
  readonly remove: readonly IStorageChannel[];
};

/** Resolve cross-channel conflict once; backend adapters only execute returned removals. */
export const planChannelWrite = (
  key: IStorageKey,
  attempted: IStorageChannel,
  existing: IChannelPresence,
  policy: IStorageConflictPolicy = StorageConflictPolicy.conflict,
  backend: IStorageBackend = StorageBackend.memory
): IChannelMutationPlan => {
  const conflicts = [...existing].filter((channel) => channel !== attempted);
  if (conflicts.length > 0 && policy !== StorageConflictPolicy.replace)
    throw new StorageError(StorageErrorCode.duplicateKey, {
      backend,
      key,
      existingChannel: conflicts[0],
      attemptedChannel: attempted
    });
  return { remove: conflicts };
};
