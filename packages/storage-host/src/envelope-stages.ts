import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import type { IStorageEnvelopeStages } from './types.js'
import type { IStorageObserverBinding } from './stages.js'
import type { IStorageHookMap } from './hook-types.js'
import { StorageHookName as Hook } from './hook-names.js'

/** Bind immutable operation metadata to the original migration observer, without executing a plan. */
export function createStorageEnvelopeStages(
  binding: IStorageObserverBinding,
  input: Readonly<{ operation: string; targetVersion: number }>
): IStorageEnvelopeStages {
  /** Capture caller metadata once before exposing a callback that may outlive the input object. */
  let metadata: Readonly<{ operation: string; targetVersion: number }>
  try {
    metadata = { operation: input.operation, targetVersion: input.targetVersion }
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  if (
    typeof metadata.operation !== 'string' ||
    !Number.isSafeInteger(metadata.targetVersion) ||
    metadata.targetVersion < 0
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  /** Observation failures only report; payload factories run after the shared subscriber size check. */
  const dispatch = <K extends keyof IStorageHookMap>(
    name: K,
    payload: () => IStorageHookMap[K]
  ): void => {
    try {
      binding.assertCurrent()
      binding.emit(name, payload)
    } catch (error) {
      binding.report(error)
    }
  }
  return {
    beforeEnvelopeCheck: () => {
      if (!binding.hasListeners(Hook.beforeEnvelopeCheck)) return
      dispatch(Hook.beforeEnvelopeCheck, () => ({ ...binding.identity(), ...metadata }))
    },
    afterEnvelopeCheck: (version) => {
      if (!binding.hasListeners(Hook.afterEnvelopeCheck)) return
      dispatch(Hook.afterEnvelopeCheck, () => ({ ...binding.identity(), ...metadata, version }))
    },
    onVersionRejected: (version, code) => {
      if (!binding.hasListeners(Hook.onVersionRejected)) return
      dispatch(Hook.onVersionRejected, () => ({
        ...binding.identity(),
        ...metadata,
        version,
        code
      }))
    },
    afterMigrate: (version, mode, stepCount, elapsedMs) => {
      if (!binding.hasListeners(Hook.afterMigrate)) return
      dispatch(Hook.afterMigrate, () => ({
        ...binding.identity(),
        ...metadata,
        version,
        mode,
        stepCount,
        elapsedMs
      }))
    },
    observe: {
      beforeStep: ({ fromVersion, toVersion }) => {
        if (!binding.hasListeners(Hook.beforeMigrationStep)) return
        dispatch(Hook.beforeMigrationStep, () => ({
          ...binding.identity(),
          operation: metadata.operation,
          fromVersion,
          toVersion
        }))
      },
      afterStep: ({ fromVersion, toVersion }) => {
        if (!binding.hasListeners(Hook.afterMigrationStep)) return
        dispatch(Hook.afterMigrationStep, () => ({
          ...binding.identity(),
          operation: metadata.operation,
          fromVersion,
          toVersion
        }))
      },
      report: (error) => {
        binding.report(error)
        return undefined
      }
    }
  }
}
