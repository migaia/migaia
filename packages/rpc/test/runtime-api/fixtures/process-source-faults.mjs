import { createProcessPeer } from '../../../dist/process/index.js'

/** A genuine process observes publication and callback counts independently from returned labels. */
let publications = 0
/** A conflicting explicit source must never be invoked by automatic discovery. */
let sourceCalls = 0
/** No business handler can run while its authenticated factory remains unprepared. */
let handlerCalls = 0
/** Reading listener count observes the actual native stdin without subscribing to it. */
const beforeReaders = process.stdin.listenerCount('data')
/** The original launch args select only fixture behavior, never RPC authority. */
const mode = process.argv[2]
/** Only safe classification fields are returned to the fixture's independent stderr reader. */
let code
try {
  const peer = await createProcessPeer({
    provide: {
      probe: () => {
        handlerCalls += 1
        return 'unexpected-business'
      }
    },
    ...(mode === 'explicit'
      ? {
          connect: async () => {
            sourceCalls += 1
            return undefined
          }
        }
      : {}),
    report: () => undefined
  })
  publications += 1
  await peer.close()
} catch (error) {
  code = error?.code
}
/** The receipt is emitted only after the real factory settles, without any token or error message. */
await new Promise((resolve) =>
  process.stderr.write(
    `${JSON.stringify({ code, publications, sourceCalls, handlerCalls, beforeReaders, afterReaders: process.stdin.listenerCount('data') })}\n`,
    resolve
  )
)
process.exit(0)
