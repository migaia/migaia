import { defineTransportPlugin, type IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import type { IRpcLocalSourceFacts } from '@migaia/rpc-contract/interfaces'
import type { MessagePort } from 'node:worker_threads'
import { createNodeThreadCarrier } from '../../../dist/threads/channel.js'

/** Exact native recipe facts are supplied by the caller's original physical source. */
type IBorrowedThreadSource = Readonly<{
  port: MessagePort
  id: string
  facts?: IRpcLocalSourceFacts | (() => IRpcLocalSourceFacts | undefined)
  opened?(context: IRpcTransportSetupContext): void
}>

/** This genuine SDK source borrows the caller's real port; Session alone owns protocol startup. */
class BorrowedThreadSource {
  /** Native ownership and optional actual launch facts stay with this fixture's caller. */
  readonly #input: IBorrowedThreadSource
  /** Capture a cold physical recipe without subscribing, parsing, or synthesizing protocol frames. */
  constructor(input: IBorrowedThreadSource) {
    this.#input = input
  }
  /** Attach the actual native carrier and release only its Session and borrowed listeners. */
  readonly open = async (context: IRpcTransportSetupContext) => {
    this.#input.opened?.(context)
    /** The canonical Thread owner performs original postMessage and native subscription operations. */
    /** Native initial metadata is admitted before retaining any physical listener. */
    const facts = typeof this.#input.facts === 'function' ? this.#input.facts() : this.#input.facts
    const carrier = createNodeThreadCarrier(this.#input.port, this.#input.id, context.report)
    /** No second handshake, peer facade, or business pending table exists in this test source. */
    const session = context.attach(carrier, facts)
    await session.ready
    return { dispose: () => context.detach(session) }
  }
}

/** Build one ordinary SDK transport definition around an independently owned native MessagePort. */
export function borrowedThreadPlugin(
  port: MessagePort,
  id: string,
  facts?: IRpcLocalSourceFacts | (() => IRpcLocalSourceFacts | undefined),
  opened?: (context: IRpcTransportSetupContext) => void
) {
  /** The named source retains exact physical receiver and launch facts throughout installation. */
  const source = new BorrowedThreadSource({ port, id, facts, opened })
  return defineTransportPlugin({ name: 'borrowed-thread', namespace: 'thread', open: source.open })
}
