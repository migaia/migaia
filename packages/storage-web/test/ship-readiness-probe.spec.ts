import { describe, expect, it } from 'vitest';
import { defineEntity } from '../src/entity/define';
import { memoryStorage } from '../src/backends/memory';
import { indexedDb } from '../src/backends/indexed-db';
import { passthrough } from '../src/schema/passthrough';
import { StorageError, StorageErrorCode } from '../src/types/errors';
import 'fake-indexeddb/auto';

type IUser = { readonly id: string; readonly name: string };

describe('ship-readiness probe: repository.batch scope key-domain guard', () => {
  it('tx.remove(invalid id) inside batch() should raise a StorageError, not a raw TypeError', async () => {
    const users = defineEntity<IUser>({
      name: 'users',
      key: 'id',
      schema: passthrough<IUser>()
    });
    const repo = users.connect(memoryStorage());
    await repo.put({ id: 'u1', name: 'a' });

    let thrown: unknown;
    try {
      await repo.batch(async (tx) => {
        // boolean is not a member of IStorageKey; caller cast bypasses the type system,
        // simulating `any`-typed or untyped-JS callers.
        await tx.remove(true as unknown as string);
      });
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(StorageError);
    // Real bug: repo.remove(invalidId) at the top level throws INVALID_KEY directly via
    // assertStorageKey. batch.remove() throws the SAME logical error but the code is
    // TRANSACTION_FAILED because encodeFlatStorageKey() throws a raw TypeError before the
    // key ever reaches a backend-level assertStorageKey call, and the transaction runner's
    // catch-all wraps any non-StorageError as transactionFailed.
    console.log('batch.remove(invalid) code =', (thrown as StorageError).code);

    let directThrown: unknown;
    try {
      await repo.remove(true as unknown as string);
    } catch (cause) {
      directThrown = cause;
    }
    console.log('repo.remove(invalid) code =', (directThrown as StorageError).code);
  });

  it('tx.get(invalid id) inside batch() should raise a StorageError, not a raw TypeError', async () => {
    const users = defineEntity<IUser>({
      name: 'users',
      key: 'id',
      schema: passthrough<IUser>()
    });
    const repo = users.connect(memoryStorage());

    let thrown: unknown;
    try {
      await repo.batch(async (tx) => {
        await tx.get({} as unknown as string);
      });
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(StorageError);
    console.log('batch.get(invalid) code =', (thrown as StorageError).code);
  });

  it('same bug reproduces on IndexedDB backend (not memory-specific)', async () => {
    const users = defineEntity<IUser>({
      name: 'users2',
      key: 'id',
      schema: passthrough<IUser>()
    });
    const repo = users.connect(indexedDb({ dbName: 'ship-readiness-probe-db' }));

    let thrown: unknown;
    try {
      await repo.batch(async (tx) => {
        await tx.remove(42n as unknown as string); // BigInt: not a valid IStorageKey member
      });
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(StorageError);
    console.log('indexeddb batch.remove(invalid) code =', (thrown as StorageError).code);
    expect((thrown as StorageError).code).not.toBe(StorageErrorCode.invalidKey);
  });
});
