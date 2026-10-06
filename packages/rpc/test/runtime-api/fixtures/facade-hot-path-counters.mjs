import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { RuntimeBench } from '../../../bench/text.mjs'

/** Only the known caller facade sites are counted; the original production bodies still execute. */
const counters = { payloadValue: 0, requestClosure: 0, runtimeEnvelope: 0 }
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
      source = source.replace(
        'binding.trackRequest(() => registration.invokeRequest(method, payload, callTimeout(callOptions)))',
        '(globalThis.__rpcFacadeCounters.requestClosure++, binding.trackRequest(() => registration.invokeRequest(method, payload, callTimeout(callOptions))))'
      )
    if (url.endsWith('/rpc/dist/contract/runtime-api/normalize.js'))
      source = source.replace(
        'export function normalizeRuntimeEnvelope(value, portable = normalizeRuntimePortable) {',
        'export function normalizeRuntimeEnvelope(value, portable = normalizeRuntimePortable) { globalThis.__rpcFacadeCounters.runtimeEnvelope++;'
      )
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
  for (let index = 0; index < 20; index++)
    assert.equal(await session.facade.request(RuntimeBench.echo, 'x'.repeat(64)), 'x'.repeat(64))
  console.log(JSON.stringify({ carrier, requests: 20, ...counters }))
} finally {
  await session.close()
}
