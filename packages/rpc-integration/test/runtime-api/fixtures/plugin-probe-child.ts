import { parentPort } from 'node:worker_threads'
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import { createProcessPlugin } from '../../../../rpc-plugin-process/test/protocol.ts'
import { threadProtocolDefinition as createThreadPlugin } from './thread-protocol.ts'
import { defineProbe, RpcProbeDirection, RpcProbeKind } from '@migaia/rpc-host/probe'
import type { IRpcContext } from '@migaia/rpc-host'
import type { IRuntimeTestRegistry } from '../../../../rpc-host/test/runtime-api/fixture.js'

/** Native fixture diagnostics retain every error layer rather than reducing cancellation to a code. */
function fixtureFailure(error: unknown): unknown {
  if (error === null || typeof error !== 'object')
    return { name: null, source: null, code: null, reason: null, message: String(error), cause: [] }
  return {
    name: Reflect.get(error, 'name') ?? null,
    source: Reflect.get(error, 'source') ?? null,
    code: Reflect.get(error, 'code') ?? null,
    reason: Reflect.get(error, 'reason') ?? Reflect.get(error, 'detail')?.lastRejection ?? null,
    message: Reflect.get(error, 'message') ?? String(error),
    cause:
      Reflect.get(error, 'cause') === undefined ? [] : [fixtureFailure(Reflect.get(error, 'cause'))]
  }
}

/** The native child owns one real Host and discovers its original bootstrap automatically. */
const host = defineHost<Record<string, never>, never, IRuntimeTestRegistry>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
/** Native Worker execution selects thread; a child process uses its byte bootstrap. */
const family = parentPort ? 'thread' : 'process'
/** Counts copy scalar fields because the public probe view is reused synchronously. */
const counts = new Map<string, { inbound: number; outbound: number }>()
/** Provider notify completion remains observable separately from caller send completion. */
const notices: unknown[] = []
/** These two counts distinguish provider entry from actual propagated cancellation. */
let waiting = 0
/** Cancellation count increments only from the original request's abort signal. */
let cancelled = 0
/** One public probe instruments this child connection through the Plugin factory. */
const probe = defineProbe({
  stages: ['message'],
  emit(view) {
    if (view.kind !== RpcProbeKind.request) return
    /** Business calls independently prove observation beyond bootstrap traffic. */
    const count = counts.get(view.endpointId) ?? { inbound: 0, outbound: 0 }
    if (view.direction === RpcProbeDirection.inbound) count.inbound += 1
    if (view.direction === RpcProbeDirection.outbound) count.outbound += 1
    counts.set(view.endpointId, count)
  }
})
/** Genuine provider methods are shared by the plugin probe and its native side. */
await host.use(
  definePlugin({
    name: 'service',
    features: {
      methods: defineFeature(() => ({
        /** Portable payload proves ordinary provider execution. */
        read: (payload: unknown) => payload,
        /** Notify records the actual invocation for the independent stats request. */
        notice: (payload: unknown) => {
          notices.push(payload)
        },
        /** Streaming exposes native provider order without an extra dispatcher. */
        *values() {
          yield 1
          yield 2
          yield 3
        },
        /** Waiting ends only when the canonical call context observes cancellation. */
        wait: (_payload: unknown, context: IRpcContext) =>
          new Promise<void>((_resolve, reject) => {
            waiting += 1
            /** The exact request abort reason remains the rejection cause. */
            const abort = () => {
              cancelled += 1
              reject(context.signal.reason)
            }
            if (context.signal.aborted) abort()
            else context.signal.addEventListener('abort', abort, { once: true })
          }),
        /** Reverse requests use the child's actual committed same-family outlet. */
        reverse: (payload: unknown) => host[family]!.request('bridge', 'parent.read', payload),
        /** Reverse notify enters the parent's exposed provider over the original connection. */
        reverseNotice: (payload: unknown) =>
          host[family]!.notify('bridge', 'parent.notice', payload),
        /** Reverse streaming keeps the parent's iterator and cancellation owner intact. */
        async *reverseValues() {
          for await (const value of host[family]!.stream('bridge', 'parent.values')) yield value
        },
        /** Reverse request cancellation forwards the original provider signal. */
        reverseWait: (payload: unknown, context: IRpcContext) =>
          host[family]!.request('bridge', 'parent.wait', payload, { signal: context.signal }),
        /** Stats serialize copied counters without exposing a probe handle or mutable views. */
        stats: () => ({
          counts: Object.fromEntries(counts),
          notices: [...notices],
          waiting,
          cancelled
        })
      }))
    },
    install: () => ({})
  })
)
/** Both native families share child input while their generic factory signatures stay distinct. */
const options = {
  name: 'bridge',
  expose: ['service'] as const,
  probe,
  report: (error: unknown) => process.stderr.write(`${JSON.stringify(fixtureFailure(error))}\n`)
}
if (family === 'thread') await host.use(createThreadPlugin(options))
else await host.use(createProcessPlugin(options))
/** Genuine child commit is complete; one immediate reverse call must succeed without retry. */
await host[family]!.request('bridge', 'parent.ready')
