import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import type { IHostHandle } from '@migaia/plugin-host'
import type { IStorageExecutionPort, IStoragePipelineInput } from './types.ts'
/** Forward one registration to the original shared runners; no stage or retry state is retained. */
export function forwardStorageExecution(
  host: Pick<
    IHostHandle<object, IStoragePipelineInput, readonly []>,
    'runPipelineSync' | 'runPipelineAsync'
  >,
  assertCurrent: () => void,
  identity: () => Pick<IStoragePipelineInput, 'backendId' | 'backend' | 'orgId'>,
  observe?: <R>(
    describe: () => IStoragePipelineInput,
    invoke: (observing: boolean) => Promise<R>
  ) => Promise<R>
): IStorageExecutionPort {
  return {
    observe: (describe, invoke) =>
      observe === undefined
        ? invoke(false)
        : observe(() => ({ ...describe(), ...identity() }), invoke),
    run(request, invoke) {
      try {
        assertCurrent()
        /** The original one request snapshot also supplies telemetry without re-reading getters. */
        const forwarded = { ...request, ...identity() }
        /** Pipeline intervention may publish a different already-owned operation payload. */
        let current: IStoragePipelineInput = forwarded
        const run = () => {
          /** A reached terminal distinguishes successful undefined from intercepted execution. */
          let invoked = false
          /** Preserve the actual callback result while observing its failure channel. */
          const result = host.runPipelineAsync(forwarded, (value) => {
            invoked = true
            const captured = value.input
            if (observe !== undefined) current = { ...forwarded, input: captured }
            return invoke(captured as never)
          })
          if (invoked) return result as ReturnType<typeof invoke>
          return result.then((value) => {
            if (!invoked) throw new StorageContractError(StorageContractErrorCode.aborted)
            return value as Awaited<ReturnType<typeof invoke>>
          }) as ReturnType<typeof invoke>
        }
        return observe === undefined ? run() : observe(() => current, run)
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
