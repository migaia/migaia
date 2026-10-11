import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { RpcCapability } from '@migaia/rpc-contract'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { createEventEmitterMessageResource } from '@migaia/rpc-core/adapter'
import { systemScheduler } from '@migaia/utils/scheduler'

/** Both local proposals travel through the actual two native message ports. */
const expanded = [
  RpcCapability.stream,
  RpcCapability.batch,
  RpcCapability.runtimeApi,
  RpcCapability.portableBinary,
  RpcCapability.nativeBinary,
  RpcCapability.transfer
]

describe('thread runtime resource ACK startup', () => {
  it('enables only extensions independently acknowledged by both actual ports', async () => {
    /** Actual native messaging supplies both independent control inputs and close operations. */
    const ports = new MessageChannel()
    /** The peer intentionally does not offer transfer, even though this side requests it. */
    const peerOffer = expanded.filter((value) => value !== RpcCapability.transfer)
    /** Runtime held resources await the existing Core ACK grammar before publication. */
    const channels = await Promise.all([
      createEventEmitterMessageResource(ports.port1).open({
        peerId: 'right',
        scheduler: systemScheduler,
        offer: expanded,
        control: rpcMessageCapabilityControl
      }),
      createEventEmitterMessageResource(ports.port2).open({
        peerId: 'left',
        scheduler: systemScheduler,
        offer: peerOffer,
        control: rpcMessageCapabilityControl
      })
    ])
    try {
      expect(channels[0].agreement.capabilities).toEqual(peerOffer)
      expect(channels[1].agreement.capabilities).toEqual(peerOffer)
      expect(channels[0].agreement.capabilities).not.toContain(RpcCapability.transfer)
      expect(channels[0].scheduler).toBe(systemScheduler)
    } finally {
      await Promise.all(channels.map((channel) => channel.close()))
      ports.port1.close()
      ports.port2.close()
    }
  })

  it('does not enable expanded local declarations when the peer never acknowledges', async () => {
    /** The second actual port stays silent so only one local proposal can ever be observed. */
    const ports = new MessageChannel()
    /** Core owns this raw port and its absent-ACK startup failure. */
    const resource = createEventEmitterMessageResource(ports.port1)
    try {
      await expect(
        resource.open({
          peerId: 'absent',
          scheduler: systemScheduler,
          offer: expanded,
          control: rpcMessageCapabilityControl,
          timeoutMs: 0
        })
      ).rejects.toMatchObject({
        source: '@migaia/rpc/core',
        code: 'INVALID_CONFIG',
        message: 'Thread data bootstrap was not acknowledged'
      })
    } finally {
      await resource.close()
      ports.port1.close()
      ports.port2.close()
    }
  })

  it('keeps omitted extension capabilities disabled after a valid actual ACK', async () => {
    /** This actual native peer sends one deliberately reduced capability proposal. */
    const ports = new MessageChannel()
    /** The original physical message resource controls startup admission. */
    const resource = createEventEmitterMessageResource(ports.port1)
    /** Publication awaits raw peer control rather than the locally supplied extension labels. */
    const opening = resource.open({
      peerId: 'scalar',
      scheduler: systemScheduler,
      offer: expanded,
      control: rpcMessageCapabilityControl
    })
    ports.port2.postMessage(
      rpcMessageCapabilityControl.acknowledgement([
        RpcCapability.stream,
        RpcCapability.batch,
        RpcCapability.runtimeApi
      ])
    )
    /** The accepted channel contains exactly the raw peer's admitted capability intersection. */
    const channel = await opening
    try {
      expect(channel.agreement.capabilities).not.toContain(RpcCapability.portableBinary)
      expect(channel.agreement.capabilities).not.toContain(RpcCapability.nativeBinary)
      expect(channel.agreement.capabilities).not.toContain(RpcCapability.transfer)
    } finally {
      await channel.close()
      ports.port1.close()
      ports.port2.close()
    }
  })

  it('rejects forged additional ACK fields with the original native failure identity', async () => {
    /** Real native message I/O carries the malicious control record through the normal reader. */
    const ports = new MessageChannel()
    /** Core constructs the resource; no existing transport is supplied for qualification. */
    const resource = createEventEmitterMessageResource(ports.port1)
    /** The same opening observes grammar rejection and original public diagnostic identity. */
    const opening = resource.open({
      peerId: 'forged',
      scheduler: systemScheduler,
      offer: expanded,
      control: rpcMessageCapabilityControl
    })
    ports.port2.postMessage({
      ...rpcMessageCapabilityControl.acknowledgement(expanded),
      trusted: true
    })
    try {
      await expect(opening).rejects.toBeInstanceOf(TypeError)
      await expect(opening).rejects.toMatchObject({
        source: '@migaia/rpc/core',
        code: 'INVALID_CONFIG'
      })
    } finally {
      await resource.close()
      ports.port1.close()
      ports.port2.close()
    }
  })
})
