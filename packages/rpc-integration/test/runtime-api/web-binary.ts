import { serializeRpcError } from '@migaia/rpc-contract'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { webBinaryAuthentication } from './fixtures/web-binary-endpoint.js'
import { threadProtocolDefinition } from './fixtures/thread-protocol.js'
import { type IThreadChannelFactory } from '../../../rpc-plugin-thread/dist/threads/types.js'
import {
  type IWebThreadHandle,
  type IWebThreadLauncherOptions
} from '../../../rpc-plugin-thread/dist/threads/web-launcher.js'
import { RUNTIME_API_CAPABILITIES } from '../../../rpc-host/dist/remote/runtime-api/constants.js'
import { RpcCapability } from '@migaia/rpc-contract'
import type { IRpcRuntimeStepOutcome } from '@migaia/rpc-contract/runtime'
import { systemScheduler } from '@migaia/utils/scheduler'

import type { IThreadLauncher } from '@migaia/supervision/threads'

/** Each configured built endpoint really implements the complete profile on its native carrier. */
const capabilities = [
  ...new Set([...RUNTIME_API_CAPABILITIES, RpcCapability.nativeBinary, RpcCapability.transfer])
]

/** The original launcher factory selects the native platform without wrapping its lifetime. */
type IWebBinaryLauncherFactory = (
  options: IWebThreadLauncherOptions
) => IThreadLauncher<IWebThreadHandle>
/** Channel construction retains the exact original scheduler and capability proposal. */
type IWebBinaryChannelFactory = (options: {
  scheduler: typeof systemScheduler
  capabilities: readonly string[]
}) => IThreadChannelFactory<IWebThreadHandle>

/** The single actual Worker implements these original scalar and lazy binary stream operations. */
type IWebBinaryRemote = {
  echo(payload: unknown): unknown
  count(): number
  values(payload: ArrayBuffer): AsyncIterableIterator<ArrayBuffer>
}

/** Exercise identical business operations through the original Bun/Web launcher and channel owner. */
export function runWebBinaryQualification(
  createLauncher: IWebBinaryLauncherFactory,
  createChannels: IWebBinaryChannelFactory,
  beforeClose?: () => Promise<void>
) {
  return new WebBinaryQualification(createLauncher, createChannels, beforeClose).run()
}

/** Own only qualification observations; the actual public Host keeps native lifecycle authority. */
class WebBinaryQualification {
  /** The physical handle is retained until its actual Host close completes. */
  #handle: IWebThreadHandle | undefined
  /** Business failure classification is fixed before cleanup begins. */
  #failures: unknown[] = []
  /** Teardown reports remain independent from the already judged business interval. */
  #closing: unknown[] = []
  /** The original close boundary alone advances this observation phase. */
  #phase: 'business' | 'closing' = 'business'
  /** Complete only after every original business operation and optional source inspection. */
  #businessComplete = false
  /** Exact public close Promise identity and completion are separate retained observations. */
  #closure = { samePromise: false, completed: false }
  /** Original factory constructs the real platform launcher with its authenticated context. */
  #createLauncher: IWebBinaryLauncherFactory
  /** Original factory opens the same physical handle under the original capability profile. */
  #createChannels: IWebBinaryChannelFactory
  /** Optional inspection occurs after business and before the original close operation. */
  #beforeClose: (() => Promise<void>) | undefined

  /** Capture only platform construction and inspection operations before acquiring resources. */
  constructor(
    createLauncher: IWebBinaryLauncherFactory,
    createChannels: IWebBinaryChannelFactory,
    beforeClose?: () => Promise<void>
  ) {
    this.#createLauncher = createLauncher
    this.#createChannels = createChannels
    this.#beforeClose = beforeClose
  }

  /** Classify complete native metadata without allowing teardown to rewrite business evidence. */
  #report = (error: unknown): void => {
    const wire = serializeRpcError(error, { report: () => undefined })
    const reason =
      typeof error === 'object' && error !== null
        ? (Reflect.get(error, 'reason') ?? Reflect.get(error, 'detail')?.reason ?? null)
        : null
    ;(this.#phase === 'business' ? this.#failures : this.#closing).push({
      ...wire,
      phase: this.#phase,
      reason,
      businessComplete: this.#businessComplete,
      cause: wire.cause ?? null
    })
  }

  /** Prepare the real public Host with the same authenticated native Worker source. */
  async #prepare() {
    /** One explicit identity is shared by Host composition and the original source bootstrap. */
    const self = { name: 'binary-web-parent', instanceId: 'binary-web-parent' }
    return createRpcHost<IWebBinaryRemote>({
      self,
      authentication: webBinaryAuthentication,
      report: this.#report,
      plugins: [
        threadProtocolDefinition({
          name: 'binary-web-worker',
          self,
          authentication: webBinaryAuthentication,
          report: this.#report,
          spawn: async (context) => {
            const launcher = this.#createLauncher({
              report: this.#report,
              runtimeApi: { ...context, capabilities }
            })
            this.#handle = await launcher.launch(
              {
                entry: new URL('./fixtures/web-binary-worker.ts', import.meta.url).href,
                data: { parentId: 'binary-web-parent', capabilities }
              },
              { signal: new AbortController().signal }
            )
            return this.#createChannels({ scheduler: systemScheduler, capabilities }).open(
              this.#handle,
              new AbortController().signal
            )
          }
        })
      ]
    })
  }

  /** Retain the business transaction and close through the actual Host/session lifecycle owner. */
  async run() {
    /** This public handle retires its sessions before closing their physical sources. */
    const host = await this.#prepare()
    try {
      return await this.#business(host)
    } finally {
      this.#phase = 'closing'
      try {
        const closingPromise = host.close()
        this.#closure.samePromise = host.close() === closingPromise
        await closingPromise
        this.#closure.completed = true
      } finally {
        this.#handle?.terminate()
      }
    }
  }

  /** Run copy, transfer, stream, group and ordered notify on this Host's one actual accepted Worker. */
  async #business(peer: IRpcHost<IWebBinaryRemote>) {
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
    const stream = peer.stream('values', streamBacking, {
      transfer: [streamBacking]
    }) as AsyncIterableIterator<ArrayBuffer>
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
    const group = (await peer.group(
      [
        { method: 'echo', payload: groupBacking },
        { method: 'echo', payload: new Uint8Array(groupBacking, 1, 1) }
      ],
      {
        transfer: [groupBacking]
      }
    )) as readonly IRpcRuntimeStepOutcome[]
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
    await this.#beforeClose?.()
    this.#businessComplete = true
    return {
      copy,
      transfer,
      streamed,
      grouped,
      notify: { senderLength: notifyBacking.byteLength },
      count,
      failures: this.#failures,
      closing: this.#closing,
      closure: this.#closure,
      carrier: (await peer.describe()).connections[0]!.carrier
    }
  }
}
