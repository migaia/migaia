import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

/** The original native bootstrap, rather than a caller-supplied flag, identifies this Worker. */
const child = await isThreadChild()
await createThreadPeer({
  provide: {
    double: (value) => value * 2,
    child: () => child,
    flags: () => process.execArgv
  }
})
