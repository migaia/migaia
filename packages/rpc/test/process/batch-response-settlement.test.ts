import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { IProcessByteChannel } from '@migaia/rpc/process'
import { createProcessPeer } from '../../src/process/adapters/node-peer.js'
import {
  prepareRuntimePeerSourceContext,
  readRuntimePeerConnection
} from '../../src/remote/runtime-api/peer.js'
import {
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame
} from '../../src/contract/framing/stream.js'
import { RpcCapability, RpcBatchPhysical } from '../../src/contract/wire-constants.js'
import { deployment, peers } from './fixtures/conformance-business.js'

/** Only response fields needed to select the real trace envelopes are inspected by this fixture. */
type IControlledFrame = {
  readonly kind: string
  readonly id?: string
  readonly envelopes?: readonly IControlledFrame[]
  readonly data?: { readonly route?: { readonly method?: string } }
}

for (const borrowed of [true, false]) {
  it(`[R8-A2] two forced batched responses settle through process Peer (borrowed=${borrowed})`, async () => {
    /** The maintained TS peer uses production core; its implementation and scheduler are untouched. */
    const peer = peers.find((entry) => entry.language === 'node')!
    /** This test owns only its temporary listener process and private authentication file. */
    const directory = await mkdtemp(join(tmpdir(), 'rpc-r8-'))
    /** A fixture-only handshake token authenticates the listener without changing the protocol. */
    const token = randomUUID()
    /** Each test uses its own Unix rendezvous, owned solely by the fixture. */
    const address = join(directory, 'peer.sock')
    /** Native READY is proven by actual stderr before dialing the listener. */
    const output: Buffer[] = []
    /** Borrowed RPC ownership does not include the independently spawned fixture peer. */
    let child: ReturnType<typeof spawn> | undefined
    /** Cleanup waits for actual native child close rather than assuming signal completion. */
    let exited: Promise<unknown> | undefined
    /** Keep the constructed public Peer for terminal cleanup after RED or GREEN. */
    let active: Awaited<ReturnType<typeof createProcessPeer>> | undefined
    /** Capture the complete two-member physical batch delivered to the canonical byte decoder. */
    const batches: unknown[][] = []
    /** Only the trace responses after baseline preparation are controlled. */
    let armed = false
    /** Responses retain their original correlation IDs and canonical routes. */
    const held: IControlledFrame[] = []
    /** No diagnostic may disappear during an assertion failure. */
    const failures: unknown[] = []
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
            output.push(chunk)
            if (Buffer.concat(output).toString().includes('READY')) resolve()
          })
          child!.once('error', reject)
          child!.once('exit', () => reject(new Error('R8 fixture exited before READY')))
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
      const controlled = async (...args: Parameters<typeof establish>) => {
        const [raw, context] = args
        /** Only the native byte callback is controlled, while lifecycle methods remain original. */
        const byte = raw as IProcessByteChannel
        /** Decode once per physical channel, then preserve its ordinary subscriber fanout. */
        const listeners = new Set<(chunk: Uint8Array) => void>()
        /** The fixture holds one original subscription until the established channel closes. */
        let unsubscribe: (() => void) | undefined
        /** This emission is one complete native physical frame, shared with every observer. */
        const emit = (chunk: Uint8Array): void => {
          for (const listener of listeners) listener(chunk)
        }
        /** The canonical decoder preserves arbitrary input chunk boundaries and frame limits. */
        const decoder = createRpcStreamFrameDecoder({
          onFrame: (payload) => {
            /** The test inspects only the response selector needed to force physical grouping. */
            const frame = JSON.parse(new TextDecoder().decode(payload)) as IControlledFrame
            /** A peer may already group replies; inspect each genuine envelope exactly once. */
            const members = frame.kind === RpcBatchPhysical.kind ? frame.envelopes! : [frame]
            if (
              armed &&
              members.every(
                (member) =>
                  member.kind === 'response' && member.data?.route?.method === 'peer.trace'
              )
            ) {
              held.push(...members)
              if (held.length === 2) {
                batches.push([...held])
                emit(
                  encodeRpcStreamFrame(
                    new TextEncoder().encode(
                      JSON.stringify({ kind: RpcBatchPhysical.kind, envelopes: held })
                    )
                  )
                )
              }
            } else emit(encodeRpcStreamFrame(payload))
          },
          onError: (error) => failures.push(error)
        })
        /** Real establishment receives the same bytes and completes the original handshake. */
        const channel = await establish(
          {
            ...byte,
            onData: (listener) => {
              listeners.add(listener)
              unsubscribe ??= byte.onData((chunk) => decoder.push(chunk))
              return () => {
                listeners.delete(listener)
                if (listeners.size === 0) {
                  unsubscribe?.()
                  unsubscribe = undefined
                  decoder.close()
                }
              }
            }
          },
          context
        )
        expect(channel.agreement.capabilities).toContain(RpcCapability.batch)
        /**
         * A supported custom establisher returns a fresh transport identity without private
         * agreement.
         */
        return {
          ...channel,
          transport: {
            ...channel.transport,
            send: (
              frame: Parameters<typeof channel.transport.send>[0],
              options: Parameters<typeof channel.transport.send>[1]
            ) => channel.transport.send(frame, options),
            subscribe: (listener: Parameters<typeof channel.transport.subscribe>[0]) =>
              channel.transport.subscribe(listener)
          }
        }
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
      active = await createProcessPeer({
        self,
        ...(source.kind === 'connect' ? { connect: source } : { spawn: source }),
        report: (error) => {
          failures.push(error)
        }
      })
      /** Exercise the precise existing caller endpoint used by the public process Peer. */
      const endpoint = readRuntimePeerConnection(active).endpoint
      /** The peer's ordinary Host baseline succeeds before the missing batch-settlement assertion. */
      await endpoint.send(peer.id, 'migaia.remote.host.use', ['p', { local: 'value' }])
      /** Key results by their original call to reject swapped response correlation. */
      const values = new Map<string, unknown>()
      /** Observe cleanup rejection without turning a failed request into a successful value. */
      const errors: unknown[] = []
      armed = true
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
      await vi.waitFor(() => expect(batches).toHaveLength(1))
      expect(batches[0]).toHaveLength(2)
      expect(new Set((batches[0] as IControlledFrame[]).map((frame) => frame.id)).size).toBe(2)
      await vi.waitFor(() =>
        expect(Object.fromEntries(values), '[R8-A2] both native response IDs must settle').toEqual({
          'trace-one': 'trace-one',
          'trace-two': 'trace-two'
        })
      )
      await Promise.all(calls)
      expect(errors).toEqual([])
    } finally {
      if (active) {
        // The public Peer owns endpoint and source retirement; fixture must not dispose its endpoint first.
        await active.close()
      }
      if (child) {
        child.kill('SIGTERM')
        await exited
      }
      await rm(directory, { recursive: true, force: true })
    }
  }, 15000)
}
