/** A real Node child or Worker originates application calls through its actual parent namespace. */
import { createRpcHost, type IRpcNamespace } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'

/** Only real native bootstrap discovery selects the source; no fixture flag creates a generation. */
const thread = await isThreadChild()
/** Both genuine native factories use the same actual automatic parent acquisition as production. */
const transport = thread
  ? threadPlugin({ connectToParent: true })
  : processPlugin({ connectToParent: true })
/** This is application input to the child provider, never a synthetic frame or transport facade. */
type IParentCall = Readonly<{ method: string; orderKey?: string }>
/** One actual public Host owns the native parent Session and local relay provider. */
const opening: ReturnType<typeof createRpcHost<unknown, readonly [typeof transport]>> =
  createRpcHost({
    plugins: [transport],
    provide: {
      async invoke(input: IParentCall): Promise<unknown> {
        /** The real namespace is installed by the selected native plugin before provider entry. */
        const namespace = Reflect.get(await opening, thread ? 'thread' : 'process') as IRpcNamespace
        return namespace.request(input.method, undefined, { orderKey: input.orderKey })
      }
    },
    report: (error) => console.error(error)
  })
await opening
