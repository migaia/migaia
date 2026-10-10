import assert from 'node:assert/strict'
import { it } from 'vitest'
import vectors from '../../../schema/vectors/runtime-api.json'
import { rpcProtocol } from '../../../src/contract/v1/protocol.js'
import { normalizeRpcEnvelope } from '../../../src/contract/v1/normalize.js'
import type { IRpcProtocol } from '../../../src/contract/types.js'
import type { IRpcEnvelope } from '../../../src/contract/v1/types.js'
import {
  isInboundNormalizedPayload,
  normalizeInboundRpcEnvelope,
  normalizeInboundRuntimeEnvelope
} from '../../../src/core/internal/inbound-normalization.js'
import {
  createForwardOptions,
  isForwardedPayload,
  retainForwardOptions
} from '../../../src/core/internal/outbound-envelope.js'
import type { IRpcContext } from '../../../src/core/typing.js'

/** Original legacy grammar drives the concrete receiver operation rather than a record-mint seam. */
function request() {
  return {
    kind: 'request',
    id: 'k284',
    method: 'echo',
    data: {
      route: {
        profile: 'migaia.rpc.route',
        type: 'request',
        applicationVersion: '1',
        senderId: 'a',
        targetId: 'b',
        sentAt: 0
      },
      payload: { value: 42 }
    }
  }
}

it('[K284/A45] only an exact canonical receiver payload is reusable through held forward options', () => {
  /** Successful canonical validation owns the sole membership insertion. */
  const envelope = normalizeInboundRpcEnvelope(request(), rpcProtocol)
  if (envelope.kind !== 'request') assert.fail('request must remain a request')
  /** Provider context already carries this exact immutable graph. */
  const payload = envelope.data.payload as object
  const options = createForwardOptions({ data: payload } as IRpcContext)
  assert.equal(isInboundNormalizedPayload(payload), true)
  assert.equal(isForwardedPayload(options, payload), true)
  assert.equal(isInboundNormalizedPayload({ ...payload }), false)
  assert.equal(isForwardedPayload(options, { ...payload }), false)
  assert.equal(
    Object.getOwnPropertySymbols(options).length,
    0,
    'payload provenance is not reflected'
  )
  assert.equal(
    isForwardedPayload({ ...options }, payload),
    false,
    'field copies cannot acquire provenance'
  )
  assert.equal(isForwardedPayload(retainForwardOptions(options, {}), payload), true)
})

it('[K284/A45] a custom normalizer is read once, retains its receiver and cannot mint canonical membership', () => {
  /** The custom getter deliberately changes on a second read. */
  let reads = 0
  let receiver: unknown
  const protocol: IRpcProtocol<IRpcEnvelope, string, number> = {
    id: 'k284-custom',
    version: 1,
    get normalize() {
      reads++
      return reads === 1
        ? function (value: unknown) {
            receiver = this
            return normalizeRpcEnvelope(value)
          }
        : normalizeRpcEnvelope
    }
  }
  const envelope = normalizeInboundRpcEnvelope(request(), protocol)
  if (envelope.kind !== 'request') assert.fail('request must remain a request')
  const payload = envelope.data.payload as object
  assert.equal(reads, 1)
  assert.equal(receiver, protocol)
  assert.equal(isInboundNormalizedPayload(payload), false)
  assert.equal(
    isForwardedPayload(createForwardOptions({ data: payload } as IRpcContext), payload),
    false
  )
})

it('[K284/A45] whole runtime group admission records its actual steps and every provider payload', async () => {
  /** The existing runtime grammar vector retains the complete group metadata. */
  const template = vectors.valid.find((value) => value.kind === 'runtime-group')!
  const envelope = await normalizeInboundRuntimeEnvelope({
    ...template,
    steps: [
      { method: 'echo', payload: { value: 42 } },
      { method: 'echo', payload: { value: 43 } }
    ]
  })
  if (envelope.kind !== 'runtime-group') assert.fail('group must remain a group')
  assert.equal(isInboundNormalizedPayload(envelope.steps), true)
  for (const step of envelope.steps)
    assert.equal(isInboundNormalizedPayload(step.payload as object), true)
  assert.equal(isInboundNormalizedPayload([...envelope.steps]), false)
})
