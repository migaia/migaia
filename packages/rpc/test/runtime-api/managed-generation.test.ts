import * as portable from '../../src/contract/normalize.js'
import { readRuntimeCarrier } from '../../src/contract/runtime-api/carrier.js'
import { readRuntimeOutletConnection } from '../../src/remote/runtime-api/outlet.js'
import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import { runtimeTestHost } from './fixture.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { definePlugin, defineFeature } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createThreadPeer, createThreadPlugin } from '../../src/threads/index.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory,
  type INodeThreadHandle
} from '../../src/threads/adapters/node.js'
import type { IRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import type { IAbortSignal } from '@migaia/lifecycle'

/** Both public routes use the same genuine child fixture and original native owners. */
const entry = fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url))

for (const mode of ['peer', 'plugin'] as const) {
  it(`[A17][A35] owned ${mode} prepares the real replacement and permanently retires its old identity`, async () => {
    /** The original one-unit budget independently proves native resource liquidation. */
    const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
    /** Recording preserves the exact native launcher and supervisor launch request. */
    const native = createNodeThreadLauncher()
    /** Each element is a real Worker handle with its own actual exit Promise. */
    const handles: INodeThreadHandle[] = []
    /** Opening counts come from the actual channel owner rather than inferred supervisor state. */
    let opens = 0
    /** Original channel construction keeps its runtime offer and receive handoff. */
    const factory = createNodeThreadChannelFactory({ scheduler: systemScheduler })
    /** The true Host remains the only Feature/publication authority in Plugin mode. */
    const host = runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** Direct Peer mode owns the same native registration without a Host publication. */
    let peer: IRuntimePeer | undefined
    /** Ordinary local business is independently observable before any RED assertion. */
    const [parent] = await host.use(
      definePlugin({
        name: 'parent',
        features: { data: defineFeature(() => ({ echo: () => 42 })) },
        install: () => ({})
      })
    )
    assert.equal(parent.getFeature('data').echo(), 42)
    /** Existing complete native source grammar carries the actual bounded restart policy. */
    const spawn = {
      spec: { entry, name: 'managed-child' },
      budget,
      scheduler: systemScheduler,
      launcher: {
        ...native,
        launch: async (...args: Parameters<typeof native.launch>) => {
          const handle = await native.launch(...args)
          handles.push(handle)
          return handle
        }
      },
      channelFactory: {
        open: (handle: INodeThreadHandle, signal: Parameters<typeof factory.open>[1]) => {
          opens += 1
          return factory.open(handle, signal)
        }
      },
      supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 } },
      report: () => undefined
    }
    try {
      if (mode === 'peer')
        peer = await createThreadPeer<IRuntimeDynamicSurface>({
          spawn,
          provide: { parent: { echo: () => 42 } },
          report: () => undefined
        })
      else
        await host.use(
          createThreadPlugin({
            name: 'bridge',
            spawn,
            expose: ['parent'],
            report: () => undefined
          })
        )
      /** Both paths execute forward and reverse business over the actual first Worker. */
      const request = (value: string) =>
        mode === 'peer'
          ? peer!.request('probe', value)
          : host.thread!.request('bridge', 'probe', value)
      const first = (await request('ordinary')) as {
        value: string
        parent: number
        self: { instanceId: string }
      }
      assert.equal(first.value, 'ordinary')
      assert.equal(first.parent, 42)
      if (mode === 'plugin') {
        /** A fresh real Host Feature replaces the old output before the native generation leaves. */
        const replacement = await host.replace(
          'parent',
          definePlugin({
            name: 'parent',
            features: { data: defineFeature(() => ({ echo: () => 84 })) },
            install: () => ({})
          })
        )
        assert.equal(replacement.getFeature('data').echo(), 84)
        assert.equal(
          ((await request('current-output')) as { parent: number }).parent,
          84,
          '[A117] an already prepared connection follows the current same-name Feature'
        )
      }
      /** Genuine native departure is the sole authorization for the original supervisor restart. */
      handles[0]!.terminate()
      await handles[0]!.exited
      await vi.waitFor(() => assert.equal(handles.length, 2), { timeout: 3000 })
      /** Read the actual prepared directory/publication; native launch alone is not readiness. */
      await vi.waitFor(
        () => {
          assert.notEqual(
            mode === 'peer'
              ? readRuntimePeerConnection(peer!).peerId
              : readRuntimeOutletConnection(host.thread, 'bridge')!.instanceId,
            first.self.instanceId
          )
        },
        { timeout: 3000 }
      )
      assert.equal(
        opens,
        2,
        '[A17] the original current-generation owner opens the real replacement'
      )
      const second = (await request('replacement').catch((error: unknown) => error)) as typeof first
      assert.equal(
        second.parent,
        mode === 'plugin' ? 84 : 42,
        '[A117] a genuine replacement generation compiles the current original Feature output'
      )
      assert.equal(second.value, 'replacement')
      assert.notEqual(second.self.instanceId, first.self.instanceId)
      if (mode === 'plugin')
        assert.throws(
          () => host.thread!.request(first.self.instanceId, 'probe'),
          { code: 'TARGET_UNKNOWN' },
          '[A35] old physical identity cannot select a ready successor'
        )
    } finally {
      await peer?.close()
      await host.dispose()
      for (const handle of handles) handle.terminate()
      await Promise.all(handles.map((handle) => handle.exited))
    }
    assert.equal(budget.inUse, 0)
  })
}

it('[A3][A34] Host startup cancellation reaches the original owned source before publication', async () => {
  /** The original Host operation timeout supplies the actual cancellation reason. */
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: 1000, pipelineDrainTimeoutMs: false } }
  })
  /** The independent lease records resource ownership while endpoint preparation is pending. */
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
  /** Native construction remains unchanged; the wrapper records its actual handle only. */
  const native = createNodeThreadLauncher()
  /** Genuine Worker exit is observable independently from the aborted Host install. */
  let handle: INodeThreadHandle | undefined
  /** This is the signal actually delivered to the original channel opening operation. */
  let openingSignal: IAbortSignal | undefined
  /** Fixture cleanup releases the pending open even if production omitted its cancellation. */
  let releaseOpen: (() => void) | undefined
  /** Original native channel construction proves that physical acquisition has already happened. */
  const factory = createNodeThreadChannelFactory({ scheduler: systemScheduler })
  /** Only fixture cleanup uses this exact local reason; no production error text is introduced. */
  const cleanupReason = new Error()
  try {
    const [parent] = await host.use(
      definePlugin({
        name: 'parent',
        features: { data: defineFeature(() => ({ echo: () => 42 })) },
        install: () => ({})
      })
    )
    assert.equal(parent.getFeature('data').echo(), 42)
    const result = await host
      .use(
        createThreadPlugin({
          name: 'pending',
          expose: ['parent'],
          report: () => undefined,
          spawn: {
            spec: { entry, name: 'pending-child' },
            budget,
            scheduler: systemScheduler,
            launcher: {
              ...native,
              launch: async (...args: Parameters<typeof native.launch>) =>
                (handle = await native.launch(...args))
            },
            channelFactory: {
              open: async (unit, signal) => {
                openingSignal = signal
                const channel = await factory.open(unit as INodeThreadHandle, signal)
                try {
                  await new Promise<void>((_resolve, reject) => {
                    releaseOpen = () => reject(cleanupReason)
                    if (signal.aborted) reject(signal.reason)
                    else
                      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
                  })
                  return channel
                } catch (primary) {
                  await channel.close()
                  throw primary
                }
              }
            },
            report: () => undefined
          }
        })
      )
      .then(
        () => undefined,
        (error: unknown) => error
      )
    assert.ok(result instanceof Error)
    assert.ok(handle, 'the genuine native launcher completed before cancellation')
    assert.equal(
      openingSignal?.aborted,
      true,
      '[A3] source preparation consumes the original Host operation signal'
    )
    await vi.waitFor(() => assert.equal(budget.inUse, 0), { timeout: 3000 })
    assert.equal(
      host.thread,
      undefined,
      '[A34] aborted preparation publishes no connection or facade'
    )
  } finally {
    releaseOpen?.()
    await host.dispose()
    handle?.terminate()
    await handle?.exited
  }
})

for (const catalogSize of [4, 32])
  for (const idempotent of [false, true]) {
    it(`[R14-A30][A35][A36] catalog ${catalogSize} original retry owner settles a sent ${idempotent ? 'idempotent' : 'non-idempotent'} native request`, async () => {
      /** Count only the two-level business root on the actual parent admission owner. */
      const normalize = vi.spyOn(portable, 'normalizePortable')
      /** Ready-directory and parent control traffic cannot satisfy this private-input count. */
      const walks = () =>
        normalize.mock.calls.filter(
          ([value]) =>
            typeof value === 'object' &&
            value !== null &&
            Reflect.get(value, 'marker') === 'r14-retry'
        ).length
      /** Actual one-unit admission proves that replay never spawns a parallel owned execution. */
      const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
      /** Every recorded handle remains the native launcher result with its original identity. */
      const handles: INodeThreadHandle[] = []
      /** The native messages independently record physical send count and exact replay key. */
      const frames: any[] = []
      /** The original caller-selected launcher is reused for both real generations. */
      const native = createNodeThreadLauncher()
      /** Generation fixture data is supplied by the actual launch sequence, never provider claims. */
      let sequence = 0
      /** Independent logical calls use fresh keys; replacement sends retain the same logical key. */
      let keys = 0
      /** The child reports actual provider start through the independently exposed parent method. */
      let started!: () => void
      /** Only real started business permits departure; queued/unsent work is not mislabeled. */
      const entered = new Promise<void>((resolve) => {
        started = resolve
      })
      /** Cleanup closes the canonical generation holder and actual native unit. */
      let peer: IRuntimePeer | undefined
      try {
        peer = await createThreadPeer<IRuntimeDynamicSurface>({
          self: { name: 'retry-parent', instanceId: 'retry-parent' },
          provide: { parent: { echo: () => 42, started: () => started() } },
          report: () => undefined,
          spawn: {
            spec: {
              entry,
              name: 'retry-child',
              data: { advanced: idempotent, crash: idempotent, catalogSize }
            },
            budget,
            scheduler: systemScheduler,
            launcher: {
              ...native,
              launch: async (spec, context) => {
                const handle = await native.launch(
                  {
                    ...spec,
                    data: { ...(spec.data as object), sequence: ++sequence }
                  },
                  context
                )
                const send = handle.port.postMessage
                handle.port.postMessage = (message, transfer) => {
                  frames.push(message)
                  Reflect.apply(send, handle.port, [message, transfer])
                }
                handles.push(handle)
                return handle
              }
            },
            channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
            supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 } },
            keyFactory: () => `native-original-key-${++keys}`,
            report: () => undefined
          }
        })
        if (!idempotent)
          assert.equal(((await peer.request('probe', 'ordinary')) as { parent: number }).parent, 42)
        assert.equal(await peer.request('service.data.read', 'ordinary'), 'ordinary')
        if (idempotent)
          assert.equal(
            readRuntimePeerConnection(peer).description!.methods.find(
              (method) => method.name === 'service.data.read'
            )!.idempotent,
            true,
            '[A36] optional advanced declaration retains the original idempotency authorization'
          )
        assert.equal(
          readRuntimePeerConnection(peer).description!.methods.filter((entry) =>
            entry.name.startsWith('service.data.')
          ).length,
          idempotent ? catalogSize : catalogSize + 2,
          '[R14-A30] actual accepted catalog dimension'
        )
        normalize.mockClear()
        const method = idempotent ? 'service.data.read' : 'hold'
        const result = peer
          .request(
            method,
            { marker: 'r14-retry', nested: { value: catalogSize } },
            { timeoutMs: 3000 }
          )
          .catch((error: unknown) => error)
        await entered
        if (!idempotent) handles[0]!.terminate()
        await handles[0]!.exited
        const outcome = await result
        assert.equal(
          walks(),
          idempotent ? 2 : 1,
          '[R14-A30] genuine native retry reuses original private input without another portable walk'
        )
        if (idempotent) {
          assert.deepEqual(
            outcome,
            Object.assign(Object.create(null), {
              marker: 'r14-retry',
              nested: Object.assign(Object.create(null), { value: catalogSize })
            }),
            '[A36] one original logical dispatch replays on the actual ready replacement'
          )
          const sends = frames
            .filter((frame) => {
              const carrier = readRuntimeCarrier(frame)
              return carrier
                ? (carrier.frame as { task?: { method?: string } }).task?.method === method
                : frame.method === method
            })
            .slice(1)
          assert.equal(sends.length, 2)
          assert.deepEqual(
            sends.map((frame) => {
              const carrier = readRuntimeCarrier(frame)
              return carrier
                ? (carrier.frame as { options: { idempotencyKey: string } }).options.idempotencyKey
                : frame.data.route.idempotencyKey
            }),
            ['native-original-key-2', 'native-original-key-2']
          )
        } else {
          assert.equal(
            (outcome as { code?: string }).code,
            'REMOTE_RESULT_UNKNOWN',
            '[A35] sent non-idempotent work is never silently retargeted'
          )
          assert.equal(
            frames.filter((frame) => {
              const carrier = readRuntimeCarrier(frame)
              return carrier
                ? (carrier.frame as { task?: { method?: string } }).task?.method === method
                : frame.method === method
            }).length,
            1
          )
        }
      } finally {
        normalize.mockRestore()
        await peer?.close()
        for (const handle of handles) handle.terminate()
        await Promise.all(handles.map((handle) => handle.exited))
      }
      await vi.waitFor(() => assert.equal(budget.inUse, 0), { timeout: 3000 })
    })
  }
