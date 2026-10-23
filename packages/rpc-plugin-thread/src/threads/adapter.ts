import { defineMessageAdapter, type IAdapterDefinition } from '@migaia/rpc-host/plugin'
import type { IThreadParentPort } from './runtime-types.js'
import type { IThreadWebPort } from './types.js'

/** Importing another owner stays inert; an actual native factory acquires this definition. */
let threadMessageAdapter:
  | IAdapterDefinition<IThreadParentPort | IThreadWebPort, 'thread'>
  | undefined

/** Reuse one definition after the native factory has entered its existing instance boundary. */
export function getThreadMessageAdapter(): IAdapterDefinition<
  IThreadParentPort | IThreadWebPort,
  'thread'
> {
  return (threadMessageAdapter ??= defineMessageAdapter({
    open: (port: IThreadParentPort | IThreadWebPort) => port
  }))
}
