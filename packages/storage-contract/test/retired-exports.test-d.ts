// @ts-expect-error byte guards are owned exclusively by utils/bytes.
import { isArrayBuffer } from '../src/index.js'
// @ts-expect-error byte guards are owned exclusively by utils/bytes.
import { isUint8Array } from '../src/index.js'
// @ts-expect-error use the canonical ConflictPolicy value.
import { StorageContractConflictPolicy } from '../src/index.js'
// @ts-expect-error use the canonical IConflictPolicy type.
import type { IStorageContractConflictPolicy } from '../src/index.js'

void (undefined as unknown as IStorageContractConflictPolicy)
void isArrayBuffer
void isUint8Array
void StorageContractConflictPolicy
