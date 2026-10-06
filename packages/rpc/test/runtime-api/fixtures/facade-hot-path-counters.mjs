import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { RuntimeBench } from '../../../bench/text.mjs'

/** Only the known caller facade sites are counted; the original production bodies still execute. */
const counters = {
  payloadValue: 0,
  requestClosure: 0,
  runtimeEnvelope: 0,
  binaryPrepare: 0,
  materialize: 0
}
/** Actual transformed module bytes distinguish an observed zero from an unloaded counter. */
const loaded = []
globalThis.__rpcFacadeCounters = counters
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (!url.startsWith('file:') || result.source == null) return result
    /** Source replacement is diagnostic-only and confined to the two actual delivered facades. */
    let source = Buffer.from(result.source).toString()
    if (url.endsWith('/rpc/dist/remote/runtime-api/peer.js'))
      source = source.replace(
        'function payloadValue(payload, binary = false) {',
        'function payloadValue(payload, binary = false) { globalThis.__rpcFacadeCounters.payloadValue++;'
      )
    if (url.endsWith('/rpc/dist/remote/runtime-api/managed-peer.js'))
      if (source.includes('binding.trackRequest(() => registration.invokeRequest'))
        source = source.replace(
          'binding.trackRequest(() => registration.invokeRequest(method, payload, callTimeout(callOptions)))',
          '(globalThis.__rpcFacadeCounters.requestClosure++, binding.trackRequest(() => registration.invokeRequest(method, payload, callTimeout(callOptions))))'
        )
      else
        assert.ok(
          source.includes(
            'binding.trackRequest(request, method, payload, callTimeout(callOptions))'
          ),
          'managed request must load the original cold dispatcher'
        )
    if (url.endsWith('/rpc/dist/contract/runtime-api/normalize.js'))
      source = source.replace(
        'export function normalizeRuntimeEnvelope(value, portable = normalizeRuntimePortable) {',
        'export function normalizeRuntimeEnvelope(value, portable = normalizeRuntimePortable) { globalThis.__rpcFacadeCounters.runtimeEnvelope++;'
      )
    if (url.endsWith('/rpc/dist/contract/runtime-api/binary.js')) {
      /** Wrap the real preparation declaration; an absent site fails before business starts. */
      const pattern = /(export )?async function prepareRpcBinary\(/
      assert.ok(pattern.test(source), 'binary preparation declaration required')
      source = source.replace(
        pattern,
        'export function prepareRpcBinary(...args) { globalThis.__rpcFacadeCounters.binaryPrepare++; return countedPrepareRpcBinary(...args) }\nasync function countedPrepareRpcBinary('
      )
    }
    if (url.endsWith('/rpc/dist/core/internal/outbound-envelope.js')) {
      /** Count the delivered materialization owner without adding any production diagnostic API. */
      const pattern = /export function materializeOutboundJson\(/
      assert.ok(pattern.test(source), 'materialization declaration required')
      source = source.replace(
        pattern,
        'export function materializeOutboundJson(...args) { globalThis.__rpcFacadeCounters.materialize++; return countedMaterializeOutboundJson(...args) }\nfunction countedMaterializeOutboundJson('
      )
    }
    if (url.includes('/dist/')) {
      /** Hash the exact original and transformed bytes the real loader receives. */
      const original = readFileSync(new URL(url))
      loaded.push({
        url,
        diskSHA256: createHash('sha256').update(original).digest('hex'),
        loadedSHA256: createHash('sha256').update(source).digest('hex'),
        diagnosticOverlay: source !== original.toString()
      })
    }
    return { ...result, source }
  }
})

/** Native ownership/negotiation follows the same public Peer route as the formal benchmark. */
const { createIpcSession } = await import('../../../bench/ipc-session.mjs')
const carrier = process.argv[2]
const session = await createIpcSession({ carrier, side: 'rpc', payload: 'x'.repeat(64) })
try {
  await session.ready()
  assert.ok(session.facade)
  counters.payloadValue = 0
  counters.requestClosure = 0
  counters.runtimeEnvelope = 0
  counters.binaryPrepare = 0
  counters.materialize = 0
  for (let index = 0; index < 20; index++)
    assert.equal(await session.facade.request(RuntimeBench.echo, 'x'.repeat(64)), 'x'.repeat(64))
  console.log(JSON.stringify({ carrier, requests: 20, ...counters, loaded }))
} finally {
  await session.close()
}
