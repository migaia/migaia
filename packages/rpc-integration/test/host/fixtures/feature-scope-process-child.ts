/** The original Process plugin authenticates and acquires the real stdio parent channel. */
import { processPlugin } from '@migaia/rpc-plugin-process'
import { runFeatureScopeChild } from './feature-scope-child.ts'

await runFeatureScopeChild(
  processPlugin({ namespace: 'native', connectToParent: true }),
  process.argv[2]!
)
