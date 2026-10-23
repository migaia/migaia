import { RpcProbeStageName, RpcProbeOutcomeName } from '@migaia/rpc-host/probe'
import type { IRpcDevtoolsQuery } from '../contract/service.js'
import { RpcDevtoolsErrorCode } from '../error-code.js'
import { identifyDevtoolsError } from '../errors.js'
import { EventRing } from './ring.js'
import { CollectorLimit, CollectorText } from './text.js'

/** Reader compilation performs string membership setup once before scanning raw columns. */
export type ICollectorFilter = {
  stages: number
  outcomes: number
  methods: ReadonlySet<string> | undefined
  endpoints: ReadonlySet<string> | undefined
  trace: string | undefined
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

/** Reader filters retain string membership without interning query input. */
function namesFilter(input: readonly string[] | undefined): ReadonlySet<string> | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) invalid()
  for (const name of input) if (typeof name !== 'string') invalid()
  return new Set(input)
}

/** Compile filters once per cold query or watcher construction. */
export function compileQuery(input: IRpcDevtoolsQuery | undefined): ICollectorFilter {
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
  /** Outcomes share the canonical numeric vocabulary; an empty filter selects no rows. */
  let outcomes = (1 << RpcProbeOutcomeName.length) - 1
  if (input?.outcomes !== undefined) {
    if (!Array.isArray(input.outcomes)) invalid()
    outcomes = 0
    for (let i = 0; i < input.outcomes.length; i++) {
      /** Cold name lookup never interns query input or mutates retained records. */
      const outcome = RpcProbeOutcomeName.indexOf(
        input.outcomes[i] as (typeof RpcProbeOutcomeName)[number]
      )
      if (outcome < 0) invalid()
      outcomes |= 1 << outcome
    }
  }
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
    outcomes,
    after,
    limit,
    methods: namesFilter(input?.methods),
    endpoints: namesFilter(input?.endpointIds),
    trace: input?.trace
  }
}

/** One reader predicate composes masks and string filters during the ring's single pass. */
export function matchesSlot(ring: EventRing, slot: number, filter: ICollectorFilter): boolean {
  /** The view has already been consumed; only owned primitive columns are read here. */
  const c = ring.columns
  return (
    (filter.stages & (1 << c.stage[slot]!)) !== 0 &&
    (filter.outcomes & (1 << c.outcome[slot]!)) !== 0 &&
    c.seq[slot]! > filter.after &&
    (filter.methods === undefined || filter.methods.has(c.method[slot]!)) &&
    (filter.endpoints === undefined || filter.endpoints.has(c.endpoint[slot]!)) &&
    (filter.trace === undefined || filter.trace === c.trace[slot])
  )
}
