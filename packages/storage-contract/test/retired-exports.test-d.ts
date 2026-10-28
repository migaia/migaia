// @ts-expect-error byte guards are owned exclusively by utils/bytes.
import { isArrayBuffer } from '../src/index.ts'
// @ts-expect-error byte guards are owned exclusively by utils/bytes.
import { isUint8Array } from '../src/index.ts'
// @ts-expect-error use the canonical ConflictPolicy value.
import { StorageContractConflictPolicy } from '../src/index.ts'
// @ts-expect-error use the canonical IConflictPolicy type.
import type { IStorageContractConflictPolicy } from '../src/index.ts'

void (undefined as unknown as IStorageContractConflictPolicy)
void isArrayBuffer
void isUint8Array
void StorageContractConflictPolicy

// @ts-expect-error Storage contracts no longer own a collection value codec.
import { collectionsJsonCodec } from '../src/index.ts'
// @ts-expect-error The removed collection format has no retained compatibility constant.
import { COLLECTIONS_JSON_CODEC_NAME } from '../src/index.ts'
void collectionsJsonCodec
void COLLECTIONS_JSON_CODEC_NAME
