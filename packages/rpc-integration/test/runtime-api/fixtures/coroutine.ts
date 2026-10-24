import type { IAbortSignal } from '@migaia/utils/promise'
import {
  defineFeature,
  defineHost,
  definePlugin,
  type IDefinedPluginConstraint
} from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import {
  coroutinePlugin,
  type ICoroutineTaskContext,
  type ICoroutineUserTask
} from '@migaia/rpc-plugin-coroutines'
import type { IRuntimeDynamicSurface, IRuntimePluginTyping } from '@migaia/rpc-host/plugin'
import type { IRpcContext } from '@migaia/rpc-host'
import type { IRuntimeTestRegistry } from '../../../../rpc-host/test/runtime-api/fixture.js'

/** Dynamic behavior fixtures retain the genuine Host and explicit coroutine metadata only. */
type ICoroutineRegistry = readonly [
  ...IRuntimeTestRegistry,
  IDefinedPluginConstraint &
    IRuntimePluginTyping<
      IRuntimeDynamicSurface,
      Record<never, never>,
      string,
      readonly [],
      'coroutine'
    >
]
/** Actual PluginHost construction keeps every install and disposal owner unchanged. */
export function coroutineTestHost(
  options: Parameters<typeof defineHost<Record<string, never>, never, ICoroutineRegistry>>[0] = {
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  }
) {
  return defineHost<Record<string, never>, never, ICoroutineRegistry>(options)
}

/** Cooperative work ends only after its original supervisor signal aborts. */
export async function coroutineAbort(signal: IAbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true })
  )
}

/** One family fixture owns actual child hosts and accepts explicit raw task completion. */
export function coroutineService(label: string, report: (error: unknown) => void, late = false) {
  return new CoroutineServiceFixture(label, report, late)
}
/** Owns observations for one genuine coroutine service without duplicating its supervisor. */
class CoroutineServiceFixture {
  /** Portable service label distinguishes replacement providers. */
  readonly #label: string
  /** Original report observer remains the child native diagnostic owner. */
  readonly #report: (error: unknown) => void
  /** Explicit late mode waits for raw task completion after canonical signal abort. */
  readonly #late: boolean
  /** Per-generation task contexts preserve the original supervisor signal identities. */
  readonly contexts: ICoroutineTaskContext[] = []
  /** Exact deferred task receipts permit deterministic crash and late completion. */
  readonly finishes: ReturnType<typeof deferred<void>>[] = []
  /** Every reverse call uses an actual committed child Host. */
  readonly hosts: ReturnType<typeof coroutineTestHost>[] = []
  /** Notify provider entry is observed independently of caller send completion. */
  readonly notices: unknown[] = []
  /** Provider context cancellation remains separate from task cancellation. */
  readonly cancellation = { waiting: 0, cancelled: 0 }
  /** One install completion is published only after the child Host commits. */
  readonly #installed = deferred<void>()
  /** Capture immutable service policy for every genuine generation task. */
  constructor(label: string, report: (error: unknown) => void, late: boolean) {
    this.#label = label
    this.#report = report
    this.#late = late
  }
  /** Public acceptance promise retains the original deferred identity. */
  get installed() {
    return this.#installed.promise
  }
  /** Actual coroutine task preserves native provider setup and child cleanup ordering. */
  readonly task: ICoroutineUserTask = async (context) => {
    /** A per-generation barrier lets acceptance settle this exact old task independently. */
    const finish = deferred<void>()
    void finish.promise.catch(() => undefined)
    this.contexts.push(context)
    this.finishes.push(finish)
    /** Provider installation precedes connection installation, matching the child-mode contract. */
    const child = coroutineTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    this.hosts.push(child)
    try {
      await child.use(
        definePlugin({
          name: 'service',
          features: {
            methods: defineFeature(() => ({
              /** Payload identity is portable and distinguishes replacement providers. */
              read: (payload: unknown) => [this.#label, payload],
              /** Notify completion belongs to the actual provider invocation. */
              notice: (payload: unknown) => {
                this.notices.push(payload)
              },
              /** Streaming yields the exact provider order without a fixture dispatcher. */
              *values() {
                yield 1
                yield 2
                yield 3
              },
              /** Provider cancellation observes the canonical call context, not the task signal. */
              wait: (_payload: unknown, context: IRpcContext) =>
                new Promise<void>((_resolve, reject) => {
                  this.cancellation.waiting += 1
                  /** Preserve the canonical provider reason while recording its actual abort. */
                  const cancel = () => {
                    this.cancellation.cancelled += 1
                    reject(context.signal.reason)
                  }
                  if (context.signal.aborted) cancel()
                  else
                    context.signal.addEventListener('abort', cancel, {
                      once: true
                    })
                }),
              /** Reverse calls traverse the child's committed coroutine outlet. */
              reverse: (payload: unknown) =>
                child.coroutine!.request('parent', 'parent.read', payload),
              /**
               * Native family integration reuses the parent's explicitly exposed forwarding
               * catalog.
               */
              forward: (payload: { path: string; value?: unknown }) =>
                child.coroutine!.request('parent', payload.path, payload.value)
            }))
          },
          install: () => ({})
        })
      )
      await child.use(
        coroutinePlugin({
          name: 'parent',
          connectToParent: context.connect,
          expose: ['service'],
          report: this.#report
        })
      )
      this.#installed.resolve()
      if (this.#late) await finish.promise
      else await Promise.race([finish.promise, coroutineAbort(context.signal)])
    } finally {
      await child.dispose()
    }
  }
}

/** Captured same-realm failures retain complete semantic evidence, including every original cause. */
export function coroutineFailure(error: unknown): unknown {
  if (error === null || typeof error !== 'object')
    return { name: null, source: null, code: null, reason: null, message: String(error), cause: [] }
  return {
    name: Reflect.get(error, 'name') ?? null,
    source: Reflect.get(error, 'source') ?? null,
    code: Reflect.get(error, 'code') ?? null,
    reason: Reflect.get(error, 'reason') ?? Reflect.get(error, 'detail')?.lastRejection ?? null,
    message: Reflect.get(error, 'message') ?? String(error),
    cause:
      Reflect.get(error, 'cause') === undefined
        ? []
        : [coroutineFailure(Reflect.get(error, 'cause'))]
  }
}
