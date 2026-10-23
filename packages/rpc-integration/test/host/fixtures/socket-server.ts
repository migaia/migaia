import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { childService, type IParentApi } from './service.ts'

/** An unrelated process owns the explicit socket listener rather than a parent's child bootstrap. */
const opening: Promise<IRpcHost<IParentApi>> = createRpcHost<IParentApi>({
  self: { name: 'socket-service', instanceId: 'socket-service' },
  plugins: [processPlugin({ listen: process.argv[2]!, token: process.argv[3]! })],
  provide: childService(() => opening)
})
/** Native stdout readiness is setup-only and never carries an RPC request or stream. */
const host = await opening
process.stdout.write('ready\n')
process.once('SIGTERM', () => {
  void host.close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    }
  )
})
