import { workerData } from 'node:worker_threads'
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { readThreadBootstrap } from '../../../../rpc-plugin-thread/dist/threads/bootstrap.js'

/** The real native launcher carries its attempt number as ordinary bootstrap business data. */
const data = readThreadBootstrap(workerData).data as { sequence: number }
if (data.sequence === 2) throw new Error('r6 terminal Worker rejects its second entry')
/** First entry must reach genuine readiness before the parent causes its native crash. */
await createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  provide: { read: (payload: unknown) => payload },
  report: () => undefined
})
