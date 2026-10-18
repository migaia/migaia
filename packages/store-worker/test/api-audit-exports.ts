import { StoreWorkerErrorCode } from '../src/index.js'
// @ts-expect-error Worker-C02 uses the existing canonical serialization subpath only.
import { workerParser } from '../src/index.js'
// @ts-expect-error Worker-C02 removes the duplicate root plugin alias.
import { workerPlugin } from '../src/index.js'
// @ts-expect-error Worker-C02 removes the duplicate root handler alias.
import { createSerializeWorkerHandler } from '../src/index.js'
// @ts-expect-error Worker-C01 removes the internal input wrapper export.
import { encodeWorkerValue } from '../src/serialize/worker.js'
// @ts-expect-error Worker-C01 removes the identical internal result wrapper export.
import { decodeWorkerValue } from '../src/serialize/worker.js'
// @ts-expect-error Worker-C01 narrows package exports so transfer-list selection stays private.
import { transferablesOf } from '@migaia/store-worker/serialize/transferables'

// @ts-expect-error Worker-C03 removes the inactive historical merge code member.
void StoreWorkerErrorCode.chunkMergeFailed
void workerParser
void workerPlugin
void createSerializeWorkerHandler
void encodeWorkerValue
void decodeWorkerValue
void transferablesOf
