/** The original Thread plugin acquires its actual Worker parent channel. */
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { workerData } from 'node:worker_threads'
import { runFeatureScopeChild } from './feature-scope-child.ts'

await runFeatureScopeChild(
  threadPlugin({ namespace: 'native', connectToParent: true }),
  workerData.data
)
