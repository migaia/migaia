import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import type { IHostHandle } from '@migaia/plugin-host'
import type { IStorageExecutionPort, IStoragePipelineInput } from './types.js'
/** Forward one registration to the original shared runners; no stage or retry state is retained. */
export function forwardStorageExecution(
  host: Pick<
    IHostHandle<object, IStoragePipelineInput, readonly []>,
    'runPipelineSync' | 'runPipelineAsync'
  >,
  assertCurrent: () => void,
  identity: () => Pick<IStoragePipelineInput, 'backendId' | 'backend'>
): IStorageExecutionPort {
  return {
    run(request, invoke) {
      try {
        assertCurrent()
        /** A reached terminal distinguishes successful undefined from intercepted execution. */
        let invoked = false
        /** Preserve the actual callback result while observing its failure channel. */
        const result = host.runPipelineAsync({ ...request, ...identity() }, (value) => {
          invoked = true
          return invoke(value.input as never)
        })
        if (invoked) return result as ReturnType<typeof invoke>
        return result.then((value) => {
          if (!invoked) throw new StorageContractError(StorageContractErrorCode.aborted)
          return value as Awaited<ReturnType<typeof invoke>>
        }) as ReturnType<typeof invoke>
      } catch (error) {
        return Promise.reject(error)
      }
    },
    runSync(request, invoke) {
      assertCurrent()
      /** Synchronous halt must never be confused with a terminal that returned void. */
      let invoked = false
      /** Preserve the actual callback result while observing its failure channel. */
      const result = host.runPipelineSync({ ...request, ...identity() }, (value) => {
        invoked = true
        return invoke(value.input as never)
      })
      if (!invoked) throw new StorageContractError(StorageContractErrorCode.aborted)
      return result as ReturnType<typeof invoke>
    }
  }
}
