import { detectServerRuntime } from '@migaia/utils'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { defineObjectDriver } from './driver.js'
import { ObjectDriverKind } from './constants.js'
import { invalidArgument, captureObjectOptions } from './errors.js'
import type { IObjectDriver } from './types.js'
/** A trusted plugin-managed directory must not contain unrelated application files. */
export type IFsObjectDriverOptions = { readonly root: string }
/** Capture one path without importing native adapters or opening a directory until installation. */
export function fsObjectDriver(options: IFsObjectDriverOptions): IObjectDriver {
  const root = captureObjectOptions(() => options?.root)
  if (typeof root !== 'string' || root.length === 0) throw invalidArgument()
  return defineObjectDriver(ObjectDriverKind.fs, async (context) => {
    const runtime = detectServerRuntime()
    const io =
      runtime === 'deno'
        ? (await import('./fs/deno.js')).fileIo
        : runtime === 'bun'
          ? (await import('./fs/bun.js')).fileIo
          : runtime === 'node'
            ? (await import('./fs/node.js')).fileIo
            : undefined
    if (!io)
      throw new StorageContractError(StorageContractErrorCode.unsupported, { backend: 'object' })
    const { openFileObjects } = await import('./fs/layout.js')
    return openFileObjects(root, io, context)
  })
}
