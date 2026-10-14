import { workerData } from 'node:worker_threads'
import { createThreadPeer, readThreadBootstrap } from '@migaia/rpc-threads'

/** The real native launcher carries its attempt number as ordinary bootstrap business data. */
const data = readThreadBootstrap(workerData).data as { sequence: number }
if (data.sequence === 2) throw new Error('r6 terminal Worker rejects its second entry')
/** First entry must reach genuine readiness before the parent causes its native crash. */
await createThreadPeer({
  provide: { read: (payload: unknown) => payload },
  report: () => undefined
})
