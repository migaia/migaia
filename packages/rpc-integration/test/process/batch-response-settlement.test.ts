import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { IProcessByteChannel } from '../../../rpc-plugin-process/dist/process/types.js'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import type { IRuntimePeer } from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import type { IProcessPluginEstablish } from '../../../rpc-plugin-process/dist/process/plugin/types.js'
import {
  prepareRuntimePeerSourceContext,
  readRuntimePeerConnection
} from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import {
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame
} from '@migaia/rpc-contract/framing/stream'
import { RpcCapability, RpcBatchPhysical } from '@migaia/rpc-contract'
import { deployment, peers } from './fixtures/conformance-business.js'

/** Only response fields needed to select the real trace envelopes are inspected by this fixture. */
type IControlledFrame = {
  readonly kind: string
  readonly id?: string
  readonly envelopes?: readonly IControlledFrame[]
  readonly data?: { readonly route?: { readonly method?: string } }
}

/** Explicit observation state belongs to this case, independently of either real byte endpoint. */
type IControlledBatchContext = {
  armed: boolean
  batches: unknown[][]
  held: IControlledFrame[]
  failures: unknown[]
}

/** Own one controlled physical receive seam while production still owns framing and lifecycle. */
class ControlledBatchReception {
  /** The genuine byte channel retains write, close and authentication ownership. */
  #raw: IProcessByteChannel
  /** Only the test's original response selector and result collections are shared with the case. */
  #context: IControlledBatchContext
  /** Each established observer receives the same complete physical bytes. */
  #listeners = new Set<(chunk: Uint8Array) => void>()
  /** One original native subscription backs all current observers. */
  #unsubscribe: (() => void) | undefined
  /** Canonical framing preserves all genuine native input boundaries and size checks. */
  #decoder: ReturnType<typeof createRpcStreamFrameDecoder>
  /** Expose the genuine byte methods with only the documented physical callback controlled. */
  readonly value: IProcessByteChannel

  /** Prepare observation before the original establisher subscribes to the native byte input. */
  constructor(raw: IProcessByteChannel, context: IControlledBatchContext) {
    this.#raw = raw
    this.#context = context
    this.#decoder = createRpcStreamFrameDecoder({
      onFrame: (payload) => this.#onFrame(payload),
      onError: (error) => this.#context.failures.push(error)
    })
    this.value = { ...raw, onData: (listener) => this.#subscribe(listener) }
  }

  /** Subscribe once to native input and release its decoder when its final observer leaves. */
  #subscribe(listener: (chunk: Uint8Array) => void): () => void {
    this.#listeners.add(listener)
    this.#unsubscribe ??= this.#raw.onData((chunk) => this.#decoder.push(chunk))
    return () => {
      this.#listeners.delete(listener)
      if (this.#listeners.size !== 0) return
      this.#unsubscribe?.()
      this.#unsubscribe = undefined
      this.#decoder.close()
    }
  }

  /** Preserve delivery order for every genuine observer of the controlled complete frame. */
  #emit(chunk: Uint8Array): void {
    for (const listener of this.#listeners) listener(chunk)
  }

  /** Group only the original two selected responses; all other traffic passes unchanged. */
  #onFrame(payload: Uint8Array): void {
    /** Inspect the existing response fields without introducing another protocol decoder. */
    const frame = JSON.parse(new TextDecoder().decode(payload)) as IControlledFrame
    /** A genuine physical batch contributes its original members exactly once. */
    const members = frame.kind === RpcBatchPhysical.kind ? frame.envelopes! : [frame]
    if (
      this.#context.armed &&
      members.every(
        (member) => member.kind === 'response' && member.data?.route?.method === 'peer.trace'
      )
    ) {
      this.#context.held.push(...members)
      if (this.#context.held.length === 2) {
        this.#context.batches.push([...this.#context.held])
        this.#emit(
          encodeRpcStreamFrame(
            new TextEncoder().encode(
              JSON.stringify({
                kind: RpcBatchPhysical.kind,
                envelopes: this.#context.held
              })
            )
          )
        )
      }
    } else this.#emit(encodeRpcStreamFrame(payload))
  }
}

for (const borrowed of [true, false]) {
  it(`two forced batched responses settle through process Peer (borrowed=${borrowed})`, async () => {
    /** The maintained TS peer uses production core; its implementation and scheduler are untouched. */
    const peer = peers.find((entry) => entry.language === 'node')!
    /** This test owns only its temporary listener process and private authentication file. */
    const directory = await mkdtemp(join(tmpdir(), 'rpc-r8-'))
    /** A fixture-only handshake token authenticates the listener without changing the protocol. */
    const token = randomUUID()
    /** Each test uses its own Unix rendezvous, owned solely by the fixture. */
    const address = join(directory, 'peer.sock')
    /** Native READY is proven by actual stderr before dialing the listener. */
    let output = ''
    /** Borrowed RPC ownership does not include the independently spawned fixture peer. */
    let child: ReturnType<typeof spawn> | undefined
    /** Cleanup waits for actual native child close rather than assuming signal completion. */
    let exited: Promise<unknown> | undefined
    /** Keep the constructed public Peer for terminal cleanup after RED or GREEN. */
    let active: IRuntimePeer | undefined
    /** The ordinary native Host owns this exact controlled connection and its teardown. */
    const host = runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** Capture the complete two-member physical batch delivered to the canonical byte decoder. */
    const observation: IControlledBatchContext = {
      armed: false,
      batches: [],
      held: [],
      failures: []
    }
    /** Only the trace responses after baseline preparation are controlled. */
    /** Responses retain their original correlation IDs and canonical routes. */
    /** No diagnostic may disappear during an assertion failure. */
    try {
      if (borrowed) {
        /** The peer reads the synthetic handshake credential from its maintained FD contract. */
        const authPath = join(directory, 'auth')
        writeFileSync(authPath, token, { mode: 0o600 })
        /** Pass only this private file to the fixture peer's authentication descriptor. */
        const fd = openSync(authPath, 'r')
        child = spawn(
          peer.command,
          [...peer.args, '--listen-unix', address, '--auth-fd', '3', '--host'],
          { stdio: ['ignore', 'pipe', 'pipe', fd] }
        )
        closeSync(fd)
        exited = once(child, 'close')
        await new Promise<void>((resolve, reject) => {
          child!.stderr!.on('data', (chunk: Buffer) => {
            const pending = output + chunk.toString()
            if (pending.includes('READY')) resolve()
            // READY is five fixed ASCII bytes; retain only its possible split boundary.
            output = pending.slice(-4)
          })
          child!.once('error', reject)
          child!.once('exit', () => reject(new Error('batch fixture exited before READY')))
        })
      }
      /** Use the same public source specification, byte carrier and establishment as conformance. */
      const fixture = deployment(peer, true, token, borrowed ? address : undefined)
      /** Preserve the complete native source grammar used by existing conformance. */
      const selected = fixture.selected
      /** Delegate real framing, authentication and negotiation to the original establisher. */
      const establish = selected.establish
      /**
       * The public byte callback is the controlled physical-frame input; requests are never
       * retried.
       */
      const controlled: IProcessPluginEstablish = async (raw, context) => {
        /** Only the physical callback is controlled; establishment and all policy stay original. */
        const reception = new ControlledBatchReception(raw as IProcessByteChannel, observation)
        /** The original native establisher keeps its own channel, gate and negotiation receipts. */
        const channel = await establish(reception.value, context)
        expect(channel.agreement.capabilities).toContain(RpcCapability.batch)
        return channel
      }
      /** The same caller identity is offered and used by the factory's source owner. */
      const self = { name: 'caller', instanceId: 'caller' }
      /** The fixture varies reception grouping, never the offered application capabilities. */
      const source = {
        ...selected,
        // Borrowed connections support the documented default native wire as well.
        wire: borrowed ? undefined : selected.wire,
        establish: controlled,
        offer: {
          ...selected.offer!,
          capabilities: prepareRuntimePeerSourceContext(self).capabilities
        }
      }
      await host.use(
        processPlugin({
          name: 'controlled',
          self,
          ...(source.kind === 'connect' ? { connect: { target: source } } : { spawn: source }),
          report: (error) => observation.failures.push(error)
        })
      )
      active = readRuntimeOutletConnection(host.process!, 'controlled')!.peer
      /** Exercise the precise existing caller endpoint used by the public process Peer. */
      const endpoint = readRuntimePeerConnection(active).endpoint
      /** The peer's ordinary Host baseline succeeds before the missing batch-settlement assertion. */
      await endpoint.send(peer.id, 'migaia.remote.host.use', ['p', { local: 'value' }])
      /** Key results by their original call to reject swapped response correlation. */
      const values = new Map<string, unknown>()
      /** Observe cleanup rejection without turning a failed request into a successful value. */
      const errors: unknown[] = []
      observation.armed = true
      /** These two requests keep their ordinary deadlines and are never resent. */
      const calls = ['trace-one', 'trace-two'].map((trace) =>
        endpoint.send(peer.id, 'peer.trace', [], { trace }).then(
          (value) => {
            values.set(trace, value)
          },
          (error: unknown) => {
            errors.push(error)
          }
        )
      )
      await vi.waitFor(() => expect(observation.batches).toHaveLength(1))
      expect(observation.batches[0]).toHaveLength(2)
      expect(
        new Set((observation.batches[0] as IControlledFrame[]).map((frame) => frame.id)).size
      ).toBe(2)
      await vi.waitFor(() =>
        expect(Object.fromEntries(values), 'both native response IDs must settle').toEqual({
          'trace-one': 'trace-one',
          'trace-two': 'trace-two'
        })
      )
      await Promise.all(calls)
      expect(errors).toEqual([])
    } finally {
      if (active) {
        // The public Peer owns endpoint and source retirement; fixture must not dispose its endpoint first.
        await host.dispose()
      }
      if (child) {
        child.kill('SIGTERM')
        await exited
      }
      await rm(directory, { recursive: true, force: true })
    }
  }, 15000)
}
