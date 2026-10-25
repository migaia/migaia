/** Compile the public carrier boundary; native acquisition and execution remain outside Contract. */
import {
  createRpcMessageCarrier,
  createRpcByteCarrier,
  encodeRpcStreamFrame
} from '@migaia/rpc-host/sdk'
import type { IRpcMessageIO, IRpcByteIO } from '@migaia/rpc-host/sdk'
import type { IRpcCarrier } from '@migaia/rpc-contract/interfaces'
import { buildCapabilityTopology, type ITopologyNode } from '@migaia/capability/graph/topology'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'

/** Compile-only IO comes from the caller's actual native adapter. */
declare const messageIO: IRpcMessageIO
/** Whole bytes and their terminal disposer are supplied by an actual byte adapter. */
declare const byteIO: IRpcByteIO

/** Public SDK types correlate the medium's input and preserve the existing byte/identity algorithms. */
function verifyCarrierContracts(): void {
  /** Shared diagnostics are supplied by the application at acquisition. */
  const report = (_error: unknown): void => undefined
  /** Whole-message and byte carriers expose the same canonical semantic receiver contract. */
  const message: IRpcCarrier = createRpcMessageCarrier({
    id: 'packed-message',
    io: messageIO,
    report
  })
  /** The byte path owns its frame decoder rather than accepting a removed framer configuration. */
  const bytes: IRpcCarrier = createRpcByteCarrier({ id: 'packed-byte', io: byteIO, report })
  // @ts-expect-error A byte stream cannot masquerade as whole-message IO.
  createRpcMessageCarrier({ id: 'wrong-message', io: byteIO, report })
  // @ts-expect-error Whole-message IO cannot masquerade as a byte stream.
  createRpcByteCarrier({ id: 'wrong-byte', io: messageIO, report })
  /** The real frame encoder retains the original Uint8Array result contract. */
  const encoded: Uint8Array = encodeRpcStreamFrame(new Uint8Array([1]))
  // @ts-expect-error A textual payload is not a byte frame.
  encodeRpcStreamFrame('wrong')
  /** Identity codec generics retain the exact literal payload in the packed declaration graph. */
  const literal: { readonly packed: true } = identityCodec.encode({ packed: true } as const)
  /** Decoding returns that same concrete identity type, without an RPC adapter cast. */
  const decoded: { readonly packed: true } = identityCodec.decode(literal)
  /** Topology remains a genuine packed dependency with its original declaration. */
  const nodes: ITopologyNode[] = [{ id: 'packed-topology', dependencies: [], ordinal: 0 }]
  void buildCapabilityTopology(nodes, unreachable, unreachable, unreachable)
  void [message, bytes, encoded, decoded]
}
/** A valid singleton topology never enters any failure callback. */
function unreachable(): never {
  throw new Error('unexpected topology failure')
}
void verifyCarrierContracts
