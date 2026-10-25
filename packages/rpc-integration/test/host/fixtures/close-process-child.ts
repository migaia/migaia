/** Genuine stdio acquisition and native authentication remain the Process plugin's responsibility. */
import { processPlugin } from '@migaia/rpc-plugin-process'
import { runCloseChild, type ICloseFixtureMode } from './close-child.ts'

await runCloseChild(
  processPlugin({ namespace: 'native', connectToParent: true }),
  process.argv[2] as ICloseFixtureMode | undefined
)
