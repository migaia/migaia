import { createThreadPeer } from '@migaia/rpc-threads'

/** Real DedicatedWorker bootstrap owns its provider until the parent terminates this Worker. */
await createThreadPeer({ provide: { twice: (value: number) => value * 2 } })
