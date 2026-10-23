import { createAutomaticWebThreadPeer } from '../../protocol.js'
import type { IThreadWebPort } from '../../../dist/threads/types.js'

/** Real DedicatedWorker bootstrap owns its provider until the parent terminates this Worker. */
await createAutomaticWebThreadPeer(
  { provide: { twice: (value: number) => value * 2 } },
  globalThis as unknown as IThreadWebPort
)
