import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { childService, type IParentApi } from './service.ts'

/** The actual native child opens the public parent source and retains its one original host. */
const opening: Promise<IRpcHost<IParentApi>> = createRpcHost<IParentApi>({
  plugins: [processPlugin({ connectToParent: true })],
  provide: childService(() => opening, 'process')
})
await opening
