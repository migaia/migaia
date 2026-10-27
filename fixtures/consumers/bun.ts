// @migaia/storage-plugin-browser remains excluded: Bun has no browser storage globals.
import { createRpcHost, type IRpcHostOptions } from '@migaia/rpc-host'

/** The native Host's declaration closure is portable; consumers supply their real transport. */
const nativeHostFactory: (options: IRpcHostOptions) => ReturnType<typeof createRpcHost> =
  createRpcHost
void nativeHostFactory
