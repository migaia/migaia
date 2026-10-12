import { RpcProbeStageName } from '@migaia/rpc-core/probe'
import type { IRpcDevtoolsQuery } from '../contract/service.js'
import { RpcDevtoolsErrorCode } from '../error-code.js'
import { identifyDevtoolsError } from '../errors.js'
import { NameTable } from './intern.js'
import { EventRing } from './ring.js'
import { CollectorLimit, CollectorText } from './text.js'

/** Query compilation performs all string work once before scanning the numeric columns. */
export type ICollectorFilter = {
  stages: number
  methods: Uint8Array | undefined
  endpoints: Uint8Array | undefined
  trace: number | undefined
  after: number
  limit: number
}

/** Reject reachable invalid query values with the package's existing option identity. */
function invalid(): never {
  throw identifyDevtoolsError(
    new TypeError(CollectorText.invalidOption),
    RpcDevtoolsErrorCode.invalidOption
  )
}

/** Cold string filters compile to dense integer lookups without changing the intern table. */
function namesFilter(
  input: readonly string[] | undefined,
  names: NameTable
): Uint8Array | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) invalid()
  /** Representation conversion permits this indexed filter allocation (SC9b). */
  const result = new Uint8Array(names.size)
  for (let i = 0; i < input.length; i++) {
    if (typeof input[i] !== 'string') invalid()
    /** Unknown filter strings never consume the bounded name table. */
    const id = names.find(input[i]!)
    if (id !== undefined) result[id] = 1
  }
  return result
}

/** Compile filters once per cold query or watcher construction. */
export function compileQuery(
  input: IRpcDevtoolsQuery | undefined,
  names: NameTable
): ICollectorFilter {
  if (input !== undefined && (typeof input !== 'object' || input === null)) invalid()
  /** The public cursor is a collector sequence, never a physical ring offset. */
  const after = input?.afterSeq ?? 0
  /** A service page has the frozen maximum of one thousand rows. */
  const limit = input?.limit ?? CollectorLimit.query
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > CollectorLimit.query
  )
    invalid()
  if (input?.trace !== undefined && typeof input.trace !== 'string') invalid()
  /** Empty stage selection intentionally matches no observations. */
  let stages = 127
  if (input?.stages !== undefined) {
    if (!Array.isArray(input.stages)) invalid()
    stages = 0
    for (let i = 0; i < input.stages.length; i++) {
      /** Public string stage names become one precomputed mask. */
      const stage = RpcProbeStageName.indexOf(input.stages[i] as (typeof RpcProbeStageName)[number])
      if (stage < 0) invalid()
      stages |= 1 << stage
    }
  }
  return {
    stages,
    after,
    limit,
    methods: namesFilter(input?.methods, names),
    endpoints: namesFilter(input?.endpointIds, names),
    trace: input?.trace === undefined ? undefined : (names.find(input.trace) ?? -1)
  }
}

/** One numeric predicate composes all filters during the ring's single pass. */
export function matchesSlot(ring: EventRing, slot: number, filter: ICollectorFilter): boolean {
  /** The view has already been consumed; only owned primitive columns are read here. */
  const c = ring.columns
  return (
    (filter.stages & (1 << c.stage[slot]!)) !== 0 &&
    c.seq[slot]! > filter.after &&
    (filter.methods === undefined || filter.methods[c.method[slot]!] === 1) &&
    (filter.endpoints === undefined || filter.endpoints[c.endpoint[slot]!] === 1) &&
    (filter.trace === undefined || filter.trace === c.trace[slot])
  )
}
