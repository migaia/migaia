/** Genuine Worker parent acquisition remains the Thread plugin's responsibility. */
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { workerData } from 'node:worker_threads'
import { runCloseChild, type ICloseFixtureMode } from './close-child.ts'

await runCloseChild(
  threadPlugin({ namespace: 'native', connectToParent: true }),
  workerData.data as ICloseFixtureMode | undefined
)
