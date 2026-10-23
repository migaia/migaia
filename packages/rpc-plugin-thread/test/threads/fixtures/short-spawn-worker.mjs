import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { isThreadChild } from '@migaia/rpc-plugin-thread'

/** The original native bootstrap, rather than a caller-supplied flag, identifies this Worker. */
const child = await isThreadChild()
await createRpcHost({
  provide: {
    double: (value) => value * 2,
    child: () => child,
    flags: () => process.execArgv
  },
  plugins: [threadPlugin({ connectToParent: true })]
})
