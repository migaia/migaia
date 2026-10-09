import type { IRemoteChannel } from '../../src/remote/types.js'
import { serializeRpcError } from '../../dist/contract/index.js'
import { createThreadPeer } from '../../dist/threads/index.js'
import type { IRuntimeDynamicSurface } from '../../dist/remote/runtime-api/typing.js'
import { RUNTIME_API_CAPABILITIES } from '../../dist/remote/runtime-api/constants.js'
import { RpcCapability } from '../../dist/contract/wire-constants.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IThreadChannelFactory } from '../../dist/threads/types.js'
import type {
  IWebThreadHandle,
  IWebThreadLauncherOptions
} from '../../dist/threads/adapters/web.js'
import type { IThreadLauncher } from '@migaia/supervision/threads'
import { webBinaryEndpoint } from './fixtures/web-binary-endpoint.js'

/** Each configured built endpoint really implements the complete profile on its native carrier. */
const capabilities = [
  ...new Set([...RUNTIME_API_CAPABILITIES, RpcCapability.nativeBinary, RpcCapability.transfer])
]

/** Exercise identical business operations through the original Bun/Web launcher and channel owner. */
export async function runWebBinaryQualification(
  createLauncher: (options: IWebThreadLauncherOptions) => IThreadLauncher<IWebThreadHandle>,
  createChannels: (options: {
    scheduler: typeof systemScheduler
    capabilities: readonly string[]
  }) => IThreadChannelFactory<IWebThreadHandle>,
  beforeClose?: () => Promise<void>
) {
  /** Native lifecycle remains explicitly unsupported where the real adapter says so. */
  let handle: IWebThreadHandle | undefined
  /** Only classified native/core failures enter this test receipt. */
  const failures: unknown[] = []
  /**
   * Closing reports remain visible but cannot retroactively change the already judged business
   * interval.
   */
  const closing: unknown[] = []
  /** Only native Peer teardown changes the phase; no diagnostic is swallowed. */
  let phase: 'business' | 'closing' = 'business'
  /** Set only after all six actual business operations, before entering the original close. */
  let businessComplete = false
  /**
   * Record close identity/completion without allowing a finally assertion to replace a primary
   * failure.
   */
  const closure = { samePromise: false, completed: false }
  const report = (error: unknown): void => {
    /** Existing package wire formatter preserves complete native class and cause metadata. */
    const wire = serializeRpcError(error, { report: () => undefined })
    /** A package-specific reason is retained when present; absent reason is explicitly unavailable. */
    const reason =
      typeof error === 'object' && error !== null
        ? (Reflect.get(error, 'reason') ?? Reflect.get(error, 'detail')?.reason ?? null)
        : null
    ;(phase === 'business' ? failures : closing).push({
      ...wire,
      phase,
      reason,
      businessComplete,
      cause: wire.cause ?? null
    })
  }
  /** Every operation uses the public built Thread Peer with its actual configured auth assembly. */
  const peer = await createThreadPeer<IRuntimeDynamicSurface>({
    self: { name: 'binary-web-parent', instanceId: 'binary-web-parent' },
    report,
    spawn: async () => {
      const launcher = createLauncher({ report })
      handle = await launcher.launch(
        {
          entry: new URL('./fixtures/web-binary-worker.ts', import.meta.url).href,
          data: { parentId: 'binary-web-parent', capabilities }
        },
        { signal: new AbortController().signal }
      )
      return createChannels({ scheduler: systemScheduler, capabilities }).open(
        handle,
        new AbortController().signal
      )
    },
    endpointFactory: (channel) =>
      webBinaryEndpoint(channel as IRemoteChannel, 'binary-web-parent', report)
  })
  try {
    /** Same backing and two views make full-byte protection and alias restoration observable. */
    const backing = new Uint8Array([9, 1, 2, 8]).buffer
    const first = new Uint8Array(backing, 1, 2)
    const second = new Uint8Array(backing, 2, 1)
    const copied = (await peer.request('echo', { backing, first, second })) as {
      backing: ArrayBuffer
      first: Uint8Array
      second: Uint8Array
    }
    const copy = {
      senderLength: backing.byteLength,
      buffer: copied.backing instanceof ArrayBuffer,
      view: copied.first instanceof Uint8Array,
      alias: copied.first.buffer === copied.second.buffer,
      offset: copied.first.byteOffset,
      bytes: [...new Uint8Array(copied.backing)]
    }
    const moved = (await peer.request(
      'echo',
      { backing, first, second },
      { transfer: [backing] }
    )) as typeof copied
    const transfer = {
      senderLength: backing.byteLength,
      firstLength: first.byteLength,
      secondLength: second.byteLength,
      alias: moved.first.buffer === moved.backing && moved.second.buffer === moved.backing,
      bytes: [...new Uint8Array(moved.backing)]
    }
    const streamBacking = new Uint8Array([3, 4]).buffer
    const stream = peer.stream('values', streamBacking, { transfer: [streamBacking] })
    const beforeNext = streamBacking.byteLength
    const item = await stream.next()
    const streamed = {
      beforeNext,
      senderLength: streamBacking.byteLength,
      buffer: item.value instanceof ArrayBuffer,
      bytes: [...new Uint8Array(item.value as ArrayBuffer)]
    }
    await stream.return!(undefined)
    const groupBacking = new Uint8Array([5, 6]).buffer
    const group = await peer.group(
      [
        { method: 'echo', payload: groupBacking },
        { method: 'echo', payload: new Uint8Array(groupBacking, 1, 1) }
      ],
      {
        transfer: [groupBacking]
      }
    )
    const grouped = {
      senderLength: groupBacking.byteLength,
      state: group[0]!.state,
      buffer: group[0]!.state === 'success' && group[0]!.result instanceof ArrayBuffer,
      alias:
        group[0]!.state === 'success' &&
        group[1]!.state === 'success' &&
        group[1]!.result instanceof Uint8Array &&
        group[1]!.result.buffer === group[0]!.result
    }
    const notifyBacking = new Uint8Array([7]).buffer
    await peer.notify('echo', notifyBacking, {
      transfer: [notifyBacking],
      orderKey: 'native-notify'
    })
    /** The original ordered provider barrier observes notify business after its physical completion. */
    const count = await peer.request('count', undefined, { orderKey: 'native-notify' })
    /** Optional test inspection reads actual Worker sources after business and before cleanup. */
    await beforeClose?.()
    businessComplete = true
    return {
      copy,
      transfer,
      streamed,
      grouped,
      notify: { senderLength: notifyBacking.byteLength },
      count,
      failures,
      closing,
      closure,
      carrier: (await peer.describe()).connections[0]!.carrier
    }
  } finally {
    phase = 'closing'
    try {
      /**
       * Repeated close must retain the original public closure Promise; no exit capability is
       * invented.
       */
      const closingPromise = peer.close()
      closure.samePromise = peer.close() === closingPromise
      await closingPromise
      closure.completed = true
    } finally {
      handle?.terminate()
    }
  }
}
