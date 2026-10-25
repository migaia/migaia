import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { childService, type IParentApi } from './service.ts'

/** The actual native child opens the public parent source and retains its one original host. */
const opening: Promise<IRpcHost<IParentApi>> = createRpcHost<IParentApi>({
  plugins: [threadPlugin({ connectToParent: true })],
  provide: childService(() => opening, 'thread')
})
await opening
