/** Own the mutable send/receive record shapes and one-read error snapshots; no traversal or policy. */
import type { IErrorChainData, ISerializedErrorChain } from '../error-chain-types.ts'

/** Fields read once from an object before deciding whether it is error-like. */
export type IErrorSnapshot = Readonly<{
  fields: Readonly<Record<string, unknown>>
  failed: ReadonlySet<string>
  truncated: boolean
}>

/** Mutable output while allocating a bounded wire tree; frozen before return. */
export type IWireNode = Record<string, unknown> & {
  source: string
  code: string
  name: string
  message: string
  stack: string
  cause?: ISerializedErrorChain
  errors?: readonly ISerializedErrorChain[]
  data?: IErrorChainData
  truncated?: true
}

/** Snapshot classification is retained while text budgeting and descendant projection run. */
export type IErrorNodeProjection = {
  readonly node: IWireNode
  readonly source: IErrorSnapshot | undefined
  readonly errorLike: boolean
  readonly summaryOnly: boolean
}
