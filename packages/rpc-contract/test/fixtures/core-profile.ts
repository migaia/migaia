import type { IRpcTask } from '@migaia/rpc-contract/protocol'
import { RpcWireProfile, RpcWireKind } from '@migaia/rpc-contract/protocol'

/** Valid existing task/generation fields shared by every operational wire case. */
export function header(mode: IRpcTask['mode'] = 'request') {
  return {
    profile: RpcWireProfile,
    kind: RpcWireKind.call,
    id: 'call-1',
    route: {
      applicationVersion: 'app',
      senderId: 'caller',
      receiverId: 'provider',
      targetId: 'provider',
      sentAt: 0
    },
    task: {
      mode,
      callerId: 'caller',
      callerGeneration: { kind: 'session', value: 0, providerId: 'caller' },
      targetGeneration: { kind: 'restart', value: 1, providerId: 'provider' },
      ...(mode === 'request' || mode === 'notify' || mode === 'stream' ? { method: 'echo' } : {})
    }
  }
}

/** New directory reuses declared method mode/schema fields without reserved describe methods. */
export function directory(id: string) {
  return {
    schemaVersion: 3,
    self: { name: id, instanceId: id, generation: { kind: 'session', value: 0, providerId: id } },
    nodeId: id === 'caller' ? 'a'.repeat(32) : 'b'.repeat(32),
    methods: [
      {
        name: 'echo',
        supportedModes: ['request', 'notify'],
        modeSource: 'declared',
        input: { type: 'object' }
      }
    ]
  }
}

/** Hello proposes actual extension handlers rather than implying every optional feature exists. */
export function hello(id: string, extensions: string[] = [], requiredExtensions: string[] = []) {
  return {
    profile: RpcWireProfile,
    kind: RpcWireKind.handshake,
    step: 'hello',
    versions: [{ major: 2, minor: 0 }],
    codecs: ['json'],
    extensions,
    requiredExtensions,
    peer: { id, runtime: 'node' },
    directory: directory(id)
  }
}
