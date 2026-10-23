import type { IRpcSerializedError } from '@migaia/rpc-contract/errors'

/** Service errors use Contract's canonical serialized graph, including stacks and original causes. */
export type IRpcWireError = IRpcSerializedError

/** String names appear only at query/export boundaries; the collector retains numeric columns. */
export type IRpcDevtoolsWireEvent = Readonly<{
  /** Optional externally supplied target label, not native source authority. */
  target?: string
  /** Collector sequence used by query cursors and same-target deduplication. */
  seq: number
  /** Collector-domain sequence of the originating inbound carrier event, when retained. */
  carrierSeq?: number
  /** Source monotonic milliseconds before hub alignment, not epoch time. */
  at: number
  /** Observed endpoint identity, distinct from a hub target name. */
  endpointId: string
  /** Core observation stage name; physical stages require explicit subscription. */
  stage: string
  /** Readable source direction, without inferring an unobserved counterpart. */
  direction: string
  /** Optional logical kind supplied by the observed stage. */
  kind?: string
  /** Readable observation outcome, separate from thrown error codes. */
  outcome?: string
  /** Original message identity used with senderId for correlation. */
  messageId?: string
  /** Optional method path; physical events can have none. */
  method?: string
  /** Original variation route name retained by message/envelope events and offline records. */
  variation?: string
  /** Observed sender used alongside messageId for interaction identity. */
  senderId?: string
  /** Logical destination when known by the source. */
  targetId?: string
  /** Logical receiver when known by the source. */
  receiverId?: string
  /** Peer lifecycle identity when available. */
  peerId?: string
  /** Explicit application trace; no trace is synthesized. */
  trace?: string
  /** Known bytes or the source's unknown-size sentinel for opaque values. */
  sizeBytes?: number
  /** Optional chunk index/count, without reconstructing missing chunks. */
  chunk?: Readonly<{ index: number; count: number }>
  /** Optional member count of the observed aggregate/frame. */
  members?: number
  /** Elapsed milliseconds; only eligible terminal message events update statistics. */
  durationMs?: number
  /** Admission reason preserving distinctions that share one error code. */
  rejection?: string
  /** Peer lifecycle state when supplied, not an error code. */
  lifecycle?: string
  /** Canonical serialized error graph for service transfer. */
  error?: IRpcWireError
  /** Physical carrier name when provided by the source. */
  carrier?: string
  /** Stage-specific scalar metadata, retained by reference rather than deep-cloned. */
  detail?: Readonly<Record<string, string | number | boolean>>
  /** Stage-specific content; offline v1 codecs additionally apply JSON and reserved byte-tag syntax. */
  content?: unknown
}>
