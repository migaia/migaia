import type { IRpcSerializedError } from '@migaia/rpc-contract/errors'

/** Service errors use Contract's canonical serialized graph, including stacks and original causes. */
export type IRpcWireError = IRpcSerializedError

/** String names appear only at query/export boundaries; the collector retains numeric columns. */
export type IRpcDevtoolsWireEvent = Readonly<{
  target?: string
  seq: number
  at: number
  endpointId: string
  stage: string
  direction: string
  kind?: string
  outcome?: string
  messageId?: string
  method?: string
  senderId?: string
  targetId?: string
  receiverId?: string
  peerId?: string
  trace?: string
  sizeBytes?: number
  chunk?: Readonly<{ index: number; count: number }>
  members?: number
  durationMs?: number
  rejection?: string
  lifecycle?: string
  error?: IRpcWireError
  carrier?: string
  detail?: Readonly<Record<string, string | number | boolean>>
  content?: unknown
}>
