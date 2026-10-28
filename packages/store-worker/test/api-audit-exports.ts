import { StoreWorkerErrorCode } from '../src/index.ts'
import { WorkerAdapter, workerComputed } from '../src/index.ts'
import { workerParser as parser } from '../src/serialize/worker.ts'
// @ts-expect-error Worker-C02 uses the existing canonical serialization subpath only.
import { workerParser } from '../src/index.ts'
// @ts-expect-error Worker-C02 removes the duplicate root plugin alias.
import { workerPlugin } from '../src/index.ts'
// @ts-expect-error Worker-C02 removes the duplicate root handler alias.
import { createSerializeWorkerHandler } from '../src/index.ts'
// @ts-expect-error Worker-C01 removes the internal input wrapper export.
import { encodeWorkerValue } from '../src/serialize/worker.ts'
// @ts-expect-error Worker-C01 removes the identical internal result wrapper export.
import { decodeWorkerValue } from '../src/serialize/worker.ts'
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

/** These removed options must stay absent from the supported TypeScript surface. */
function removedOptions(
  adapter: WorkerAdapter,
  worker: ConstructorParameters<typeof WorkerAdapter>[0]
): void {
  // @ts-expect-error Worker calls always copy; callers cannot request transfer.
  void adapter.request(1, { transfer: [] })
  // @ts-expect-error Resource worker input uses the same copy-only contract.
  void workerComputed(adapter, () => 1, { transfer: () => [] })
  // @ts-expect-error The worker parser has no byte ownership policy option.
  void parser({ worker, ownership: 'copy' })
}
void removedOptions
