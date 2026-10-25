/** Compile accepted metadata once for ordinary and private physical Sessions. */
import type { IRpcSessionView } from '@migaia/rpc-contract/interfaces'
import type { IRpcDirectory } from '@migaia/rpc-contract/protocol'

/** Both admission paths receive the same already-normalized directory from Session. */
export function createSessionView(
  namespace: string,
  directory: IRpcDirectory,
  codec: string,
  extensions: readonly string[],
  authentication?: IRpcSessionView['authentication'],
  callTimeoutCap?: IRpcSessionView['callTimeoutCap'],
  isExclusive?: IRpcSessionView['isExclusive']
): IRpcSessionView {
  return Object.freeze({
    namespace,
    peerId: directory.self.instanceId,
    name: directory.self.name,
    generation: directory.self.generation,
    nodeId: directory.nodeId,
    ...(authentication === undefined ? {} : { authentication }),
    ...(callTimeoutCap === undefined ? {} : { callTimeoutCap }),
    ...(isExclusive === undefined ? {} : { isExclusive }),
    methods: new Map(directory.methods.map((method) => [method.name, method])),
    codec,
    extensions: new Set(extensions)
  })
}
