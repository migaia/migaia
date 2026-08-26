import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** One row from a normative Markdown inventory table. */
type ITableRow = { cells: string[]; line: number }

/** One exact executable test locator in the acceptance ledger. */
type ITestIndexEntry = {
  command?: string
  id: string
  kind: 'assertion' | 'gate'
  line?: number
  path: string
  title: string
}

/** One acceptance row; only rows with explicit direct test bindings may close. */
type ILedgerRow = {
  baselineLoc?: number | null
  candidate?: string
  category?: string
  context: string
  date: string | null
  disposition?: string
  evidence: unknown[]
  finalLoc?: number | null
  id: string
  implementation: string | null
  location?: string
  metric: string
  missingProof?: string
  owner: string[]
  removalOwner?: string
  revision: string
  state: string
  tests: string[]
}

/** One metric aggregate and its optional LOC measurement. */
type IMetric = {
  denominator: number | null
  id: string
  measurement?: ILocMeasurement
  numerator: number | null
  result: string
  rows: ILedgerRow[]
  state: string
  target: string
}

/** Reproducible MET-RED measurement fields retained from the existing ledger. */
type ILocMeasurement = {
  baselineCommit: string
  baselineFiles: number
  baselineLoc: number
  changedLoc: number
  currentFiles: number
  currentLoc: number
  measuredCandidates: number
  redundantLoc: number | null
  state: string
  unmeasuredCandidates: string[]
}

/** Complete fixture shape needed by the bounded validator and B13 gate check. */
type IAcceptanceLedger = {
  batches: Array<{
    directConsumers: string[]
    deletedDuplicate: string[]
    exitEvidence: string[]
    gates: Array<{
      availability: 'present' | 'absent'
      command: string | null
      id: string
      kind: 'package' | 'direct-consumer' | 'repository'
      result: string
      status: 'FAIL' | 'INCONCLUSIVE' | 'NOT_RUN' | 'PASS'
    }>
    id: string
    implementationDelta: string[]
    packageGates: string[]
    prerequisite: string[]
    redEvidence: string[]
    remainingOwner: string[]
    repositoryGates: string[]
    state: string
  }>
  contract: string
  metrics: IMetric[]
  schema: string
  sddRevision: string
  testIndex: ITestIndexEntry[]
  testIndexSummary: { indexed: number; normative: number; unresolved: string[] }
}

/** Human round, version, and SDD revision parsed from the active contract. */
type ICurrentContract = { humanRound: number; revision: string; round: string }

/** Parsed location for a frozen baseline span and its current owner/deletion fact. */
type IParsedLocation = {
  baselineEnd: number
  baselinePath: string
  baselineStart: number
  currentPaths: string[]
  role: 'canonical-reference' | 'deleted'
}

/** Mutable controller-event actor used by hostile admission mutations. */
type IControllerEventActor = {
  agent_id?: unknown
  capability_proof?: unknown
  dispatch_event_id?: unknown
  lease_id?: unknown
}

/** Mutable Run-2 event shape consumed by the bounded Sol-admission validator. */
type IControllerEvent = {
  actor?: IControllerEventActor
  contract_revision?: unknown
  event_hash?: unknown
  event_id?: unknown
  payload?: Record<string, unknown>
  previous_hash?: unknown
  role?: unknown
  sequence?: unknown
  type?: unknown
}

/** Mutable issued-lease shape used to bind one Sol event to controller authority. */
type IIssuedLease = {
  agent_id?: unknown
  contract_revision?: unknown
  dispatch_event_id?: unknown
  lease_id?: unknown
  role?: unknown
}

/** Mutable controller state required by Sol-admission checks. */
type IControllerState = {
  contract_revision?: unknown
  issued_leases: Record<string, IIssuedLease | undefined>
  last_role_events: { verification?: unknown }
  logical_round?: unknown
}

/** Injectable evidence bundle whose fields are independently mutated by negative controls. */
type ISolAdmissionInput = {
  controller: IControllerState
  eventId: string
  eventLogPath: string
  events: IControllerEvent[]
  loopStatePath: string
}

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')
const sddPath = resolve(
  repositoryRoot,
  'docs/web-rpc/endpoint-feature-composition-continuation-run2.sdd.md'
)
const ledgerPath = resolve(
  repositoryRoot,
  'packages/web-rpc/test/fixtures/continuation-acceptance.json'
)
const eventLogPath = `${sddPath}.events.jsonl`
/** Exact Run-2 controller state paired with the Run-2 event log. */
const loopStatePath = `${sddPath}.loop.json`
/** Frozen row-level verdicts authenticated by EVT-000109 and admitted without normalization. */
const expectedSolRowResults = Object.freeze({
  'MET-RED-016':
    'SUPPORTED; both success and failed-install locators pass, no EVT-000096 regression',
  'MET-RED-021':
    'SUPPORTED; exact surface and one Host/feature disposal pass, no EVT-000096 regression',
  'MET-RED-031': 'SUPPORTED by independent real public-hook probe',
  'MET-RED-033':
    'SUPPORTED; exact null-prototype non-Host projection and one disposal pass, no EVT-000096 regression'
} as const)
/** Rows newly admitted by the authenticated R2-v4 Sol verification. */
const solEventAdmittedRows = new Set(Object.keys(expectedSolRowResults))
/** Current R6 ledger identity; human SDD and controller remain the authority. */
const r6LedgerContract = { humanRound: 6, revision: 'SDD-v47', round: 'R6-v2' } as const
/** Stable R3 business clauses shared by every positive R3 contract subversion. */
const r3StableContractClauses = Object.freeze([
  'R3-v1 B12d owner-and-naming contract',
  '删除无生产消费者的legacy `WebRpcRuntime`聚合器',
  'internal/outbound-sender.ts',
  '不新增alias re-export、compatibility file',
  'fixture/ledger在fresh Sol前冻结'
] as const)
/** Stable detached-approval clauses required by every approved R4 contract subversion. */
const r4ApprovedContractClauses = Object.freeze([
  'R4-v4 detached-approval installation contract',
  'WRC-C-B11-decision-20260826-02',
  'Coordinator在单一进程内生成新的Ed25519 keypair',
  'Private key不得打印、持久化、进入event/SDD/worktree或交给Luna/Sol',
  '`tree-shaking-baseline.json`必须机械替换为fresh canonical',
  '`post-migration-candidate.json`改为`approved`',
  'focused tree-shaking全部green',
  'Packed/E2E/direct-consumer/repository metrics保留R5/B13'
] as const)
/** Stable B13 clauses required by every positive R5 contract subversion. */
const r5B13ContractClauses = Object.freeze([
  'Product outcome: 关闭B13',
  '现有business tests/test index',
  '禁止第二套parser、graph、lifecycle、signature、metric semantic engine或测试框架',
  'Luna只提交可复算证据',
  'fresh inventory → 复用已有业务assertion更新ledger候选',
  '真实业务缺陷先修业务再补回归；不得为了计数改测试'
] as const)
/** Stable six-metric closure clauses required by every positive R6 contract subversion. */
const r6MetricContractClauses = Object.freeze([
  'Product outcome: 关闭B13',
  'R/I/E/S/H admission',
  'Sol指出的26个gate-only行',
  '`T50`必须改绑现有hung/deadline/late-settlement具体assertion locator',
  '剩余25行必须分别绑定当前已有业务assertion',
  '禁止parser、AST、specimen、semantic engine、新fixture框架或production seam'
] as const)
/** Non-physical line separators that must remain data and invalidate contract fields. */
const hostileContractSeparators = Object.freeze([
  ['U+2028', '\u2028'],
  ['U+2029', '\u2029'],
  ['NEL', '\u0085']
] as const)
/**
 * Legacy B13 claim fragments that must never be presented as current evidence. These are
 * claim-level guards only; they do not inspect or infer source semantics.
 */
const staleB13ClaimPatterns: readonly RegExp[] = [
  /\bAST\b/i,
  /\bregex(?:es)?\b/i,
  /\bspecimens?\b/i,
  /alpha[- ]renamed/i,
  /independent\s+40\s+controls?/i,
  /\b40[- ]controls?/i,
  /implemented\s+closure/i,
  /MET-RED\s+closure/i,
  /semantic\s+(?:engine|oracle)/i,
  /All 40 MET-RED rows remain red with row-specific missing proof; no row closure is asserted\./i,
  /Reset gate: validator must report no closed MET-RED row and exactly 40 red rows\./i
]

/** Candidate direct-test bindings; Sol admission is tracked separately below. */
const directTestBindings = new Map<string, readonly string[]>([
  [
    'MET-RED-003',
    [
      'packages/web-rpc/test/duplicate-owner-contract.test.ts::proves MET-RED-003/024/039/040 capability topology owns ordering and rejects conflicts before install effects'
    ]
  ],
  [
    'MET-RED-006',
    [
      'packages/web-rpc/test/transaction-contract.test.ts::proves one Host receives the complete kernel, middleware, feature, and activation batch'
    ]
  ],
  [
    'MET-RED-016',
    [
      'packages/web-rpc/test/transaction-contract.test.ts::proves transport subscription is deferred until the complete Host batch commits',
      'packages/web-rpc/test/transaction-contract.test.ts::proves failed install keeps transport unsubscribed and activation uncommitted'
    ]
  ],
  [
    'MET-RED-021',
    [
      'packages/web-rpc/test/transaction-contract.test.ts::proves a feature disposer stays Host-owned while only its admitted surface is public'
    ]
  ],
  [
    'MET-RED-022',
    [
      'packages/web-rpc/test/duplicate-owner-contract.test.ts::proves MET-RED-022/035 projection avoids last-write-wins merge and returns the exact Host Promise'
    ]
  ],
  [
    'MET-RED-024',
    [
      'packages/web-rpc/test/transaction-contract.test.ts::proves duplicate route, port, and public-key claims reject before Host or install effects'
    ]
  ],
  [
    'MET-RED-031',
    [
      'packages/web-rpc/test/construction-hooks.test.ts::delivers the exact late install error after factory rejection and Host rollback',
      'packages/web-rpc/test/construction-hooks.test.ts::isolates sync and async listener failures while preserving late delivery',
      'packages/web-rpc/test/construction-hooks.test.ts::does not report a pre-settlement primary install failure as a late diagnostic',
      'packages/web-rpc/test/transaction-contract.test.ts::proves a pending install abort settles before late rejection with one terminal path',
      'packages/web-rpc/test/transaction-contract.test.ts::does not report a pre-settlement primary install failure as a late diagnostic',
      'packages/web-rpc/test/transaction-contract.test.ts::isolates a throwing diagnostic hook from late rejection settlement and cleanup'
    ]
  ],
  [
    'MET-RED-033',
    [
      'packages/web-rpc/test/transaction-contract.test.ts::proves the endpoint is a projection and never the PluginHost object'
    ]
  ],
  [
    'MET-RED-034',
    [
      'packages/web-rpc/test/transaction-contract.test.ts::proves one endpoint invokes exactly one Host install batch'
    ]
  ],
  [
    'MET-RED-035',
    [
      'packages/web-rpc/test/plugin-host/projection.test.ts::delegates to a real WebRpcPluginHost Promise and preserves translated disposal errors'
    ]
  ],
  [
    'MET-RED-039',
    [
      'packages/web-rpc/test/duplicate-owner-contract.test.ts::proves MET-RED-003/024/039/040 capability topology owns ordering and rejects conflicts before install effects'
    ]
  ],
  [
    'MET-RED-040',
    [
      'packages/web-rpc/test/duplicate-owner-contract.test.ts::proves MET-RED-003/024/039/040 capability topology owns ordering and rejects conflicts before install effects'
    ]
  ]
])

directTestBindings.set('MET-RED-036', [
  'packages/web-rpc/test/continuation-sdd.test.ts::executes direct T65 and T68 process invariants'
])
directTestBindings.set('MET-RED-037', [
  'packages/web-rpc/test/continuation-sdd.test.ts::executes direct T65 and T68 process invariants'
])
directTestBindings.set('MET-RED-038', [
  'packages/web-rpc/test/architecture.test.ts::WRC-C-T72 requires canonical PluginHost and capability topology owners'
])

for (const [rowId, title] of Object.entries({
  'MET-RED-001': 'proves MET-RED-001 keeps one canonical endpoint root owner',
  'MET-RED-002': 'proves MET-RED-002 installs a feature without constructing a nested endpoint',
  'MET-RED-004': 'proves MET-RED-004 composes independent feature surfaces through one root',
  'MET-RED-005': 'proves MET-RED-005 uses the canonical transport and outbound sender',
  'MET-RED-007': 'proves MET-RED-007 delegates rollback ownership to one PluginHost',
  'MET-RED-008': 'proves MET-RED-008 leaves generic pipeline ownership in PluginHost',
  'MET-RED-009': 'proves MET-RED-009 invokes current middleware directly without a legacy adapter',
  'MET-RED-010': 'proves MET-RED-010 owns pending settlement in one construction control',
  'MET-RED-011': 'proves MET-RED-011 keeps replay admission in ReplayWindow',
  'MET-RED-012': 'proves MET-RED-012 keeps peer leases in PeerRegistry',
  'MET-RED-013': 'proves MET-RED-013 keeps provider admission in ProviderAdmissionRegistry',
  'MET-RED-014': 'proves MET-RED-014 keeps chunk assembly in ChunkAssembler',
  'MET-RED-015': 'proves MET-RED-015 installs dependencies before the requesting feature',
  'MET-RED-017': 'proves MET-RED-017 accepts only package-minted feature definitions',
  'MET-RED-018': 'proves MET-RED-018 rejects shadow public writes before install effects',
  'MET-RED-019': 'proves MET-RED-019 keeps shared ports endpoint-local and symbol-keyed',
  'MET-RED-020': 'proves MET-RED-020 exposes provider behavior without provider controllers',
  'MET-RED-023': 'proves MET-RED-023 uses one absolute construction deadline',
  'MET-RED-025': 'proves MET-RED-025 injects one canonical dependency owner without public leakage',
  'MET-RED-026': 'proves MET-RED-026 slim features use canonical lifecycle owners',
  'MET-RED-027': 'proves MET-RED-027 does not leak implicit dependency surfaces',
  'MET-RED-028': 'proves MET-RED-028 gives chunk expiry one injected timer owner',
  'MET-RED-029': 'proves MET-RED-029 returns the canonical root projection without a full wrapper',
  'MET-RED-030': 'proves MET-RED-030 uses canonical configuration error semantics',
  'MET-RED-032': 'proves MET-RED-032 keeps diagnostic cleanup at the Host disposal boundary'
}) as Array<[string, string]>)
  directTestBindings.set(rowId, [
    `packages/web-rpc/test/duplicate-owner-contract.test.ts::${title}`
  ])

/** Rows admitted by fresh Sol; direct tests alone must not increase this set. */
const priorSolAdmittedRows = new Set([
  'MET-RED-003',
  'MET-RED-006',
  'MET-RED-016',
  'MET-RED-021',
  'MET-RED-022',
  'MET-RED-024',
  'MET-RED-031',
  'MET-RED-033',
  'MET-RED-034',
  'MET-RED-035',
  'MET-RED-039',
  'MET-RED-040'
])

/**
 * R5 rows whose existing assertions directly prove the named candidate. Every other row stays red;
 * a shared test title or package-wide green result cannot add an ID to this set.
 */
const r6ImplementedRows = new Set(directTestBindings.keys())

/** Reads JSON without allowing fixture data to define validator rules. */
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

/** Clones fixture data so validator mutation controls cannot alter the baseline evidence. */
const cloneLedger = (ledger: IAcceptanceLedger): IAcceptanceLedger =>
  JSON.parse(JSON.stringify(ledger)) as IAcceptanceLedger

/** Clones authority evidence so each negative control mutates an isolated input. */
const cloneSolAdmissionInput = (input: ISolAdmissionInput): ISolAdmissionInput =>
  JSON.parse(JSON.stringify(input)) as ISolAdmissionInput

/** Clones one admission bundle and applies a bounded mutation to its selected event. */
const mutateSolAdmissionEvent = (
  input: ISolAdmissionInput,
  mutate: (event: IControllerEvent) => void
): ISolAdmissionInput => {
  const candidate = cloneSolAdmissionInput(input)
  const event = candidate.events.find((item) => item.event_id === candidate.eventId)
  expect(event, 'missing Sol admission event in mutation fixture').toBeDefined()
  mutate(event!)
  return candidate
}

/** Reads the exact Run-2 event and controller sidecars used for evidence admission. */
const readSolAdmissionInput = (): ISolAdmissionInput => ({
  controller: readJson<IControllerState>(loopStatePath),
  eventId: solAdmissionEventId,
  eventLogPath,
  events: readFileSync(eventLogPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as IControllerEvent),
  loopStatePath
})

/** Narrows controller identifiers without accepting empty authority fields. */
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

/** Returns the exact row-level evidence text required for one Sol-admitted row. */
const solAdmissionEvidence = (rowId: string): string =>
  `authenticated Run-2 Sol verification EVT-000109: row_results ${rowId} is SUPPORTED`

/** Produces distinct hostile edits that strict frozen-result equality must reject. */
const mutateFrozenSolResult = (value: string): readonly { label: string; value: string }[] => [
  { label: 'append', value: `${value}!` },
  { label: 'delete', value: value.slice(0, -1) },
  { label: 'replace', value: `X${value.slice(1)}` },
  { label: 'leading whitespace', value: ` ${value}` },
  { label: 'trailing whitespace', value: `${value} ` },
  { label: 'contradictory semicolon', value: 'SUPPORTED; NOT SUPPORTED' },
  { label: 'contradictory colon', value: 'SUPPORTED: UNSUPPORTED' }
]

/**
 * Validates one prior Sol verification against the exact Run-2 event chain and controller state. It
 * intentionally does not duplicate the controller's secret signature algorithm.
 */
const solAdmissionDefects = (input: ISolAdmissionInput): string[] => {
  const defects: string[] = []
  if (input.eventLogPath !== eventLogPath) defects.push('sol-admission:event-sidecar')
  if (input.loopStatePath !== loopStatePath) defects.push('sol-admission:loop-sidecar')
  if (input.eventId !== solAdmissionEventId) defects.push('sol-admission:event-id')

  const eventIndex = input.events.findIndex((event) => event.event_id === input.eventId)
  const event = input.events[eventIndex]
  if (!event) return [...defects, 'sol-admission:event-missing']
  if (event.role !== 'sol') defects.push('sol-admission:role')
  if (event.type !== 'verification') defects.push('sol-admission:type')
  if (event.contract_revision !== 'SDD-v24') defects.push('sol-admission:revision')
  if (event.payload?.result !== 'PASS') defects.push('sol-admission:result')

  const rowResults = event.payload?.row_results
  for (const rowId of solEventAdmittedRows) {
    const result =
      rowResults && typeof rowResults === 'object'
        ? (rowResults as Record<string, unknown>)[rowId]
        : undefined
    const expectedResult = expectedSolRowResults[rowId as keyof typeof expectedSolRowResults]
    if (result !== expectedResult) defects.push(`${rowId}:sol-admission-support`)
  }

  const actor = event.actor
  if (!isNonEmptyString(actor?.agent_id)) defects.push('sol-admission:actor-agent')
  if (!isNonEmptyString(actor?.lease_id)) defects.push('sol-admission:actor-lease')
  if (!isNonEmptyString(actor?.dispatch_event_id)) defects.push('sol-admission:actor-dispatch')
  if (!isNonEmptyString(actor?.capability_proof)) defects.push('sol-admission:capability-proof')

  const lease = isNonEmptyString(actor?.lease_id)
    ? input.controller.issued_leases[actor.lease_id]
    : undefined
  if (!lease) {
    defects.push('sol-admission:issued-lease')
  } else {
    if (lease.agent_id !== actor?.agent_id) defects.push('sol-admission:lease-agent')
    if (lease.lease_id !== actor?.lease_id) defects.push('sol-admission:lease-id')
    if (lease.dispatch_event_id !== actor?.dispatch_event_id)
      defects.push('sol-admission:lease-dispatch')
    if (lease.role !== 'sol') defects.push('sol-admission:lease-role')
    if (lease.contract_revision !== 'SDD-v24') defects.push('sol-admission:lease-revision')
  }
  if (!Number.isInteger(event.sequence)) defects.push('sol-admission:sequence')
  if (!isNonEmptyString(event.event_hash)) defects.push('sol-admission:event-hash')
  if (!isNonEmptyString(event.previous_hash)) defects.push('sol-admission:previous-hash')
  const previousEvent = input.events[eventIndex - 1]
  if (
    !previousEvent ||
    !Number.isInteger(previousEvent.sequence) ||
    previousEvent.sequence !== (event.sequence as number) - 1 ||
    !isNonEmptyString(previousEvent.event_hash) ||
    previousEvent.event_hash !== event.previous_hash
  )
    defects.push('sol-admission:hash-link')
  const nextEvent = input.events[eventIndex + 1]
  if (
    !nextEvent ||
    !Number.isInteger(nextEvent.sequence) ||
    nextEvent.sequence !== (event.sequence as number) + 1 ||
    !isNonEmptyString(nextEvent.previous_hash) ||
    nextEvent.previous_hash !== event.event_hash
  )
    defects.push('sol-admission:successor-hash-link')
  return defects
}

/** Returns the active human contract section without interpreting Unicode separators as lines. */
const activeContractBlock = (source: string): string => {
  const contractStart = source.indexOf('## Current Round Contract')
  const leaseStart = source.indexOf('## Agent Execution Lease', contractStart)
  expect(contractStart, 'missing Current Round Contract heading').toBeGreaterThanOrEqual(0)
  expect(leaseStart, 'missing Agent Execution Lease heading').toBeGreaterThan(contractStart)
  return source.slice(contractStart, leaseStart)
}

/** Collects one named field from LF/CRLF-delimited physical lines only. */
const physicalContractFieldLines = (
  activeContract: string,
  field: 'Round' | 'Version'
): string[] => {
  const prefix = `- ${field}:`
  return activeContract.split(/\r\n|\n/).filter((line) => line.startsWith(prefix))
}

/** Parses one complete physical Round line without trimming non-horizontal whitespace. */
const parseHumanRoundLine = (line: string): string | undefined =>
  /^- Round:[ \t]*([1-9][0-9]*)(?:（.*）)?(?![^])/.exec(line)?.[1]

/** Parses one complete physical Version line without multiline end-of-line semantics. */
const parseVersionLine = (line: string): string | undefined =>
  /^- Version:[ \t]*(R[1-9][0-9]*-v[1-9][0-9]*)(?![^])/.exec(line)?.[1]

/** Reads the active SDD contract identity. */
const currentContract = (source: string): ICurrentContract => {
  const block = /<!-- luna-sol-contract:start -->\s*```json\s*([\s\S]*?)\s*```/.exec(source)
  expect(block, 'missing luna-sol contract block').toBeTruthy()
  const revision = (JSON.parse(block![1]!) as { revision?: unknown }).revision
  const activeContract = activeContractBlock(source)
  const humanRounds = physicalContractFieldLines(activeContract, 'Round')
  const versions = physicalContractFieldLines(activeContract, 'Version')
  expect(revision).toMatch(/^SDD-v\d+$/)
  expect(humanRounds, 'human Round field must be unique').toHaveLength(1)
  expect(versions, 'human Version field must be unique').toHaveLength(1)
  const humanRound = parseHumanRoundLine(humanRounds[0] ?? '')
  const version = parseVersionLine(versions[0] ?? '')
  expect(humanRound, 'human Round field must be a positive integer').toBeDefined()
  expect(version, 'human Version field must use a positive Rn-vN identity').toBeDefined()
  return {
    humanRound: Number(humanRound),
    revision: revision as string,
    round: version!
  }
}

/** Binds the parsed SDD identity to the authenticated Run-2 controller without version literals. */
const currentContractAuthorityDefects = (
  contract: ICurrentContract,
  controller: IControllerState
): string[] => {
  const defects: string[] = []
  if (
    !isNonEmptyString(controller.contract_revision) ||
    contract.revision !== controller.contract_revision
  )
    defects.push('current-contract:revision')
  const round = /^R([1-9][0-9]*)-v([1-9][0-9]*)$/.exec(contract.round)
  if (!round) {
    defects.push('current-contract:round-format')
  }
  if (!Number.isInteger(controller.logical_round) || (controller.logical_round as number) <= 0) {
    defects.push('current-contract:controller-logical-round')
  } else {
    if (contract.humanRound !== controller.logical_round)
      defects.push('current-contract:human-logical-round')
    if (round && Number(round[1]) !== controller.logical_round)
      defects.push('current-contract:version-logical-round')
  }
  if (round && Number(round[1]) !== contract.humanRound)
    defects.push('current-contract:human-version-round')
  return defects
}

/** Parses only the requested active Markdown table section. */
const parseTableSection = (
  source: string,
  startHeading: string,
  endHeading: string,
  includeNonIdRows = false
): ITableRow[] => {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === startHeading)
  const end = lines.findIndex((line, index) => index > start && line.trim() === endHeading)
  expect(start, startHeading).toBeGreaterThanOrEqual(0)
  expect(end, endHeading).toBeGreaterThan(start)
  return lines.slice(start + 1, end).flatMap((line, offset) => {
    if (!line.trim().startsWith('|')) return []
    const cells = line
      .trim()
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    const first = cells[0] ?? ''
    if (first === 'Candidate' || /^-+$/.test(first)) return []
    if (!includeNonIdRows && !/^WRC-C-[RIE SHT]\d+$/.test(first)) return []
    return [{ cells, line: start + offset + 2 }]
  })
}

/** Extracts IDs from one normative table. */
const metricIds = (rows: ITableRow[]): string[] =>
  rows.map((row) => row.cells[0]).filter((id): id is string => id !== undefined)

/** Executes a read-only query against the frozen baseline commit. */
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' })

/** Reads one frozen baseline path for span validation. */
const baselineSource = (path: string): string => git('show', `${baselineCommit}:${path}`)

/** Parses the only accepted code-row location forms. */
const parseLocation = (location: string): IParsedLocation | undefined => {
  const match =
    /^(baseline|baseline-reference):(.+):(\d+)-(\d+);(current-absent|current-owners):(.+)$/.exec(
      location
    )
  if (!match) return undefined
  return {
    baselinePath: match[2]!,
    baselineStart: Number(match[3]),
    baselineEnd: Number(match[4]),
    currentPaths: match[6]!.split(',').filter(Boolean),
    role: match[1] === 'baseline' ? 'deleted' : 'canonical-reference'
  }
}

/** Checks that only the active round section can provide current instructions. */
const activeClauseIsExclusive = (source: string, contract: ICurrentContract): boolean => {
  const start = source.indexOf('## Current Round Contract')
  const end = source.indexOf('## Agent Execution Lease', start)
  const historyStart = source.indexOf('### 4.11 Supersession')
  if (start < 0 || end <= start || historyStart < 0) return false
  const active = source.slice(start, end)
  const history = source.slice(historyStart, start)
  const versionLines = physicalContractFieldLines(active, 'Version')
  const roundMatches =
    versionLines.length === 1 && parseVersionLine(versionLines[0] ?? '') === contract.round
  /** Selects only stable clauses owned by the authenticated active round. */
  const currentRoundRules =
    contract.round === 'R2-v1'
      ? active.includes('atomic construction transaction') &&
        active.includes('每行必须有独立可失败runtime binding') &&
        active.includes('不得新增regex/AST/specimen语义引擎')
      : contract.round === 'R2-v2'
        ? active.includes('一个endpoint只能通过一个WebRpcPluginHost batch完成构造') &&
          active.includes('package gate状态独立于scope-external分类') &&
          active.includes('不得新增regex/AST/specimen语义引擎')
        : contract.round === 'R2-v3'
          ? active.includes(
              '唯一production修改是把`runConstructionInstall`已有`report`入口连接到`IWebRpcPluginCore.hooks`既有诊断流'
            ) &&
            active.includes('package gate状态独立于scope-external分类') &&
            active.includes('不得新增public callback')
          : contract.round === 'R2-v4'
            ? active.includes('late rejection必须到达真实configured hook listener') &&
              active.includes('package-internal immutable construction reporter') &&
              active.includes('不新增public API/export')
            : contract.round === 'R2-v9'
              ? active.includes('R2-v9 chain-adjacency override') &&
                active.includes('同时证明前驱邻接与后继邻接') &&
                active.includes('不得重实现controller签名/hash算法') &&
                active.includes('本slice仍只允许`packages/web-rpc/test/continuation-sdd.test.ts`')
              : contract.round === 'R2-v8'
                ? active.includes('R2-v8 historical-evidence authority override') &&
                  active.includes('last_role_events.verification') &&
                  active.includes('不是历史证据的撤销位') &&
                  active.includes('本slice仅允许`packages/web-rpc/test/continuation-sdd.test.ts`')
                : contract.round === 'R2-v7'
                  ? active.includes('R2-v7 fail-closed override') &&
                    active.includes('exact identity/equality校验') &&
                    active.includes(
                      '不得trim、case-fold、substring、prefix或negative-token heuristic'
                    ) &&
                    active.includes('本slice只允许validator与其mutation controls修正')
                  : contract.round === 'R2-v6'
                    ? active.includes('R2-v6 challenge-resolution override') &&
                      active.includes(
                        'endpoint-feature-composition-continuation-run2.sdd.md.events.jsonl'
                      ) &&
                      active.includes('last_role_events.verification=EVT-000109') &&
                      active.includes('12/40')
                    : /^R[67]-v[1-9][0-9]*$/.test(contract.round)
                      ? (contract.round.startsWith('R7-')
                          ? r7FinalContractClauses
                          : r6MetricContractClauses
                        ).every((clause) => active.includes(clause))
                      : /^R5-v[1-9][0-9]*$/.test(contract.round)
                        ? r5B13ContractClauses.every((clause) => active.includes(clause))
                        : /^R4-v(?:[4-9]|[1-9][0-9]+)$/.test(contract.round)
                          ? r4ApprovedContractClauses.every((clause) => active.includes(clause))
                          : /^R3-v[1-9][0-9]*$/.test(contract.round)
                            ? r3StableContractClauses.every((clause) => active.includes(clause))
                            : active.includes('candidate-specific ownership/effect invariant') &&
                              active.includes(
                                'MET-RED恰好40行；code rows只有在candidate-specific executable invariant'
                              ) &&
                              active.includes('不得用通用regex/AST语义等价检测器')
  return (
    roundMatches && currentRoundRules && history.includes('| Superseded instruction/evidence |')
  )
}

/** Checks the explicit material-delta rule used by T68. */
const hasDeclaredMaterialDelta = (payload: Readonly<Record<string, unknown>>): boolean =>
  payload.progress === 'material' &&
  Array.isArray(payload.material_delta) &&
  payload.material_delta.length > 0

/** Reads one controller event payload for the direct T68 audit. */
const eventPayload = (eventId: string): Readonly<Record<string, unknown>> => {
  const event = readFileSync(eventLogPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as { event_id: string; payload?: Record<string, unknown> })
    .find((candidate) => candidate.event_id === eventId)
  return event?.payload ?? {}
}

/** Returns stale legacy claims from B13 evidence fields. */
const b13StaleClaimDefects = (batch: IAcceptanceLedger['batches'][number]): string[] => {
  const defects: string[] = []
  for (const field of ['redEvidence', 'implementationDelta', 'exitEvidence'] as const) {
    for (const [index, claim] of batch[field].entries()) {
      if (staleB13ClaimPatterns.some((pattern) => pattern.test(claim)))
        defects.push(`${field}[${index}]`)
    }
  }
  return defects
}

/** Exact current package-test tuple; B11 frozen mismatches remain separately classified. */
const packageGateExpectedResult = '83 files / 947 tests; 947 passed, 0 failed'
/** Actual R6-v2 package tuple before the two post-format locator corrections. */
const packageGatePreFixResult = '83 files / 947 tests; 946 passed, 1 failed'

/** Rejects stale or internally contradictory package-test claims before B13 can pass. */
const packageGateDefects = (batch: IAcceptanceLedger['batches'][number]): string[] => {
  const gate = batch.gates.find((candidate) => candidate.id === 'package-test')
  if (!gate) return ['package-test:missing']
  const defects: string[] = []
  if (gate.status === 'PASS' && /\b[1-9][0-9]* failed\b/i.test(gate.result))
    defects.push('package-test:pass-with-failure')
  if (gate.status === 'PASS' && /\bexit\s+[1-9]\b/i.test(gate.result))
    defects.push('package-test:pass-with-nonzero')
  if (gate.status === 'PASS') {
    if (gate.result !== packageGateExpectedResult) defects.push('package-test:count-tuple')
  } else if (gate.status === 'FAIL') {
    if (gate.result !== packageGatePreFixResult) defects.push('package-test:count-tuple')
  } else {
    defects.push('package-test:status')
  }
  return defects
}

/** Finds forbidden semantic-oracle fields if an old row shape is reintroduced. */
const semanticOracleFields = (row: ILedgerRow): string[] =>
  Object.keys(row).filter((key) => /semantic|oracle/i.test(key))

/** Validates known paths, spans, classifications, owner facts, and fail-closed red rows. */
const boundedInventoryDefects = (
  ledger: IAcceptanceLedger,
  candidateRows: ITableRow[],
  contract: ICurrentContract,
  bindings: ReadonlyMap<string, readonly string[]> = directTestBindings,
  admittedRows: ReadonlySet<string> = r6ImplementedRows,
  admission: ISolAdmissionInput = readSolAdmissionInput()
): string[] => {
  const defects: string[] = []
  if ([...solEventAdmittedRows].some((rowId) => admittedRows.has(rowId)))
    defects.push(...solAdmissionDefects(admission))
  const rows = ledger.metrics.find((metric) => metric.id === 'MET-RED')?.rows ?? []
  const expectedCandidates = candidateRows.map((row) => row.cells[0])
  if (rows.length !== 40) defects.push('red-row-count')
  for (const [position, row] of rows.entries()) {
    const expectedId = `MET-RED-${String(position + 1).padStart(3, '0')}`
    if (
      row.id !== expectedId ||
      row.metric !== 'MET-RED' ||
      row.candidate !== expectedCandidates[position]
    )
      defects.push(`${row.id}:candidate-binding`)
    if (row.owner.length === 0 || JSON.stringify(row.owner) !== JSON.stringify(['@migaia/web-rpc']))
      defects.push(`${row.id}:owner`)
    const directlyTested = bindings.has(row.id)
    const implemented = admittedRows.has(row.id)
    if (implemented) {
      if (row.state !== 'implemented') defects.push(`${row.id}:not-implemented`)
      if (!row.implementation || row.tests.length === 0 || row.evidence.length === 0)
        defects.push(`${row.id}:missing-direct-proof`)
      if (row.missingProof !== undefined) defects.push(`${row.id}:stale-missing-proof`)
      if (solEventAdmittedRows.has(row.id) && !row.evidence.includes(solAdmissionEvidence(row.id)))
        defects.push(`${row.id}:missing-sol-admission-evidence`)
    } else {
      if (row.state !== 'red') defects.push(`${row.id}:not-red`)
      if (!row.missingProof || !row.missingProof.includes(row.id))
        defects.push(`${row.id}:missing-specific-proof`)
      if (!directlyTested) {
        if (row.implementation !== null) defects.push(`${row.id}:implementation-claim`)
        if (row.evidence.length !== 0) defects.push(`${row.id}:evidence-claim`)
        if (row.tests.length !== 0) defects.push(`${row.id}:closure-test-binding`)
      } else if (!row.implementation || row.tests.length === 0 || row.evidence.length === 0) {
        defects.push(`${row.id}:missing-pending-proof`)
      }
    }
    if (directlyTested) {
      const rowBindings = bindings.get(row.id) ?? []
      if (rowBindings.length === 0) defects.push(`${row.id}:no-direct-binding`)
      for (const binding of rowBindings) {
        const separator = binding.indexOf('::')
        const path = separator < 0 ? binding : binding.slice(0, separator)
        const title = separator < 0 ? '' : binding.slice(separator + 2)
        if (!row.tests.includes(binding)) defects.push(`${row.id}:binding-not-ledger`)
        const absolutePath = resolve(repositoryRoot, path)
        if (!existsSync(absolutePath)) defects.push(`${row.id}:binding-file`)
        else if (title && !readFileSync(absolutePath, 'utf8').includes(title))
          defects.push(`${row.id}:binding-title`)
      }
    }
    if (semanticOracleFields(row).length !== 0) defects.push(`${row.id}:semantic-oracle-field`)
    if (
      !row.context.startsWith(`${contract.round} / ${contract.revision};`) ||
      row.revision !== contract.revision
    )
      defects.push(`${row.id}:stale-contract`)

    if (row.category === 'process-evidence') {
      if (!row.location?.startsWith('process:') || row.baselineLoc !== 0 || row.finalLoc !== 0)
        defects.push(`${row.id}:process-location`)
      const expectedLocation = {
        'MET-RED-036': 'process:WRC-C-D66/WRC-C-T65',
        'MET-RED-037': 'process:WRC-C-D67/WRC-C-T68',
        'MET-RED-038': 'process:WRC-C-D73/WRC-C-T72'
      }[row.id]
      if (row.location !== expectedLocation) defects.push(`${row.id}:process-binding`)
      continue
    }
    if (row.category !== 'code-span' || !row.location) {
      defects.push(`${row.id}:classification`)
      continue
    }
    const location = parseLocation(row.location)
    if (!location) {
      defects.push(`${row.id}:location`)
      continue
    }
    let source = ''
    try {
      source = baselineSource(location.baselinePath)
    } catch {
      defects.push(`${row.id}:missing-baseline`)
      continue
    }
    const lineCount = source.split(/\r?\n/).length - 1
    if (
      location.baselineStart < 1 ||
      location.baselineEnd < location.baselineStart ||
      location.baselineEnd > lineCount
    )
      defects.push(`${row.id}:baseline-span`)
    const expectedLoc =
      location.role === 'canonical-reference'
        ? 0
        : location.baselineEnd - location.baselineStart + 1
    if (row.baselineLoc !== expectedLoc || row.finalLoc !== 0)
      defects.push(`${row.id}:loc-measurement`)
    if (location.role === 'deleted') {
      if (
        location.currentPaths.length !== 1 ||
        existsSync(resolve(repositoryRoot, location.currentPaths[0]!))
      )
        defects.push(`${row.id}:deleted-path-present`)
    } else if (location.currentPaths.some((path) => !existsSync(resolve(repositoryRoot, path)))) {
      defects.push(`${row.id}:canonical-owner-missing`)
    }
  }
  return defects
}

/** Validates the current test index without treating suite membership as row-level admission. */
const metricEvidenceDefects = (ledger: IAcceptanceLedger, contract: ICurrentContract): string[] => {
  const defects: string[] = []
  const index = new Map<string, ITestIndexEntry[]>()
  for (const entry of ledger.testIndex) {
    const entries = index.get(entry.id) ?? []
    entries.push(entry)
    index.set(entry.id, entries)
    const absolutePath = resolve(repositoryRoot, entry.path)
    if (!existsSync(absolutePath)) {
      defects.push(`${entry.id}:locator-file`)
      continue
    }
    if (entry.kind === 'assertion') {
      if (!Number.isInteger(entry.line) || (entry.line as number) <= 0) {
        defects.push(`${entry.id}:locator-line`)
        continue
      }
      const line = readFileSync(absolutePath, 'utf8').split(/\r?\n/)[(entry.line as number) - 1]
      if (!line?.includes(entry.title)) defects.push(`${entry.id}:stale-locator`)
    } else if (!isNonEmptyString(entry.command)) {
      defects.push(`${entry.id}:gate-command`)
    }
  }

  if (ledger.testIndexSummary.normative !== 280) defects.push('test-index:normative')
  if (ledger.testIndexSummary.indexed !== index.size) defects.push('test-index:indexed')
  if (ledger.testIndexSummary.unresolved.length !== 0) defects.push('test-index:unresolved')

  let assertionBearingRows = 0
  let gateOnlyRows = 0
  for (const metric of ledger.metrics.filter((candidate) => candidate.id !== 'MET-RED')) {
    if (metric.state !== 'implemented') defects.push(`${metric.id}:state`)
    if (metric.numerator !== metric.rows.length || metric.denominator !== metric.rows.length)
      defects.push(`${metric.id}:formula`)
    if (metric.result !== '100%') defects.push(`${metric.id}:result`)
    for (const row of metric.rows) {
      if (row.state !== 'implemented') defects.push(`${row.id}:state`)
      if (!isNonEmptyString(row.implementation) || !row.implementation.includes('current-owner:'))
        defects.push(`${row.id}:implementation`)
      if (row.owner.length === 0) defects.push(`${row.id}:owner`)
      if (row.tests.length === 0) defects.push(`${row.id}:tests`)
      if (row.date !== '2026-08-26') defects.push(`${row.id}:date`)
      if (row.context !== `${contract.round} / ${contract.revision}; fresh dirty-worktree evidence`)
        defects.push(`${row.id}:context`)
      let hasAssertion = false
      for (const testId of row.tests) {
        const entries = index.get(testId)
        if (!entries || entries.length === 0) {
          defects.push(`${row.id}:${testId}:locator`)
          continue
        }
        if (entries.some((entry) => entry.kind === 'assertion')) hasAssertion = true
        if (
          !row.evidence.some(
            (entry) => typeof entry === 'string' && entry.startsWith(`fresh-pass:${testId}:`)
          )
        )
          defects.push(`${row.id}:${testId}:fresh-evidence`)
      }
      if (hasAssertion) assertionBearingRows += 1
      else gateOnlyRows += 1
    }
  }
  if (assertionBearingRows !== 243) defects.push('metric-rows:assertion-bearing')
  if (gateOnlyRows !== 26) defects.push('metric-rows:gate-only')
  return defects
}

describe('current continuation acceptance ledger', () => {
  it('derives metric inventories and validates the bounded forty-row ledger', () => {
    const source = readFileSync(sddPath, 'utf8')
    const contract = currentContract(source)
    expect(
      readFileSync(
        resolve(repositoryRoot, 'packages/web-rpc/src/internal/endpoint-modules.ts'),
        'utf8'
      )
    ).not.toContain('LegacyEndpointModuleKeys')
    const ledger = readJson<IAcceptanceLedger>(ledgerPath)
    const requirementRows = parseTableSection(
      source,
      '### 1.1 需求',
      '### 1.2 Ownership、边界与依赖方向'
    )
    const interactionRows = parseTableSection(
      source,
      '### 7.2 Interaction inventory（MET-INT）',
      '### 7.3 Exception inventory（MET-ERR）'
    )
    const exceptionRows = parseTableSection(
      source,
      '### 7.3 Exception inventory（MET-ERR）',
      '### 7.4 Redundancy inventory（MET-RED）'
    )
    const candidateRows = parseTableSection(
      source,
      '### 7.4 Redundancy inventory（MET-RED）',
      '### 7.5 Security inventory（MET-SEC）',
      true
    ).filter((row) => row.cells.length >= 2)
    const securityRows = parseTableSection(
      source,
      '### 7.5 Security inventory（MET-SEC）',
      '### 7.6 High-impact inventory（MET-HIGH）'
    )
    const highRows = parseTableSection(
      source,
      '### 7.6 High-impact inventory（MET-HIGH）',
      '### 7.7 Metric summary（R3-v9 MET-RED-003 slice，2026-08-26）'
    )
    const testRows = parseTableSection(
      source,
      '### 7.1 Test cases',
      '### 7.2 Interaction inventory（MET-INT）'
    )
    const expected = new Map([
      ['MET-REQ', metricIds(requirementRows)],
      ['MET-INT', metricIds(interactionRows)],
      ['MET-ERR', metricIds(exceptionRows)],
      ['MET-SEC', metricIds(securityRows)],
      ['MET-HIGH', metricIds(highRows)]
    ])
    const normativeTestIds = new Set(metricIds(testRows))
    const controller = readJson<IControllerState>(loopStatePath)
    expect(candidateRows).toHaveLength(40)
    expect(normativeTestIds.size).toBe(280)
    expect(r6ImplementedRows.size).toBe(40)
    expect(ledger.testIndex.filter((entry) => entry.id === 'WRC-C-T50')).toEqual([
      {
        id: 'WRC-C-T50',
        kind: 'gate',
        path: 'packages/web-rpc/test/internal/web-rpc-plugin-host.test.ts',
        title: 'construction deadline, never-settling, and late-ownership assertions',
        command:
          "CI=true pnpm --filter @migaia/web-rpc exec vitest run test/internal/web-rpc-plugin-host.test.ts -t 'closes late ownership at the construction deadline and observes late rejection|uses one absolute budget across sequential installs and never-settling work|closes externally disposed construction scopes before late resolve and ownership'"
      }
    ])
    expect(ledger.schema).toBe('WRC-C-D77/v2')
    expect(currentContractAuthorityDefects(contract, controller)).toEqual([])
    expect(ledger.contract).toBe(r6LedgerContract.round)
    expect(ledger.sddRevision).toBe(r6LedgerContract.revision)
    for (const [metricId, ids] of expected) {
      const metric = ledger.metrics.find((candidate) => candidate.id === metricId)
      expect(metric, metricId).toBeDefined()
      expect(metric?.rows.map((row) => row.id).sort()).toEqual([...ids].sort())
      expect(metric?.denominator).toBe(ids.length)
      expect(metric?.numerator).toBe(ids.length)
      expect(metric?.state).toBe('implemented')
      expect(metric?.result).toBe('100%')
    }
    const redMetric = ledger.metrics.find((metric) => metric.id === 'MET-RED')
    expect(redMetric?.rows).toHaveLength(40)
    expect(redMetric?.state).toBe('implemented')
    expect(redMetric?.denominator).toBe(redMetric?.measurement?.changedLoc)
    expect(redMetric?.numerator).toBe(0)
    expect(redMetric?.result).toBe('0%')
    expect(redMetric?.rows.filter((row) => row.state === 'red')).toHaveLength(0)
    expect(redMetric?.rows.filter((row) => row.state === 'implemented')).toHaveLength(40)
    expect(redMetric?.measurement?.measuredCandidates).toBe(40)
    expect(redMetric?.measurement?.unmeasuredCandidates).toEqual([])
    expect(redMetric?.measurement?.redundantLoc).toBe(0)
    expect([...priorSolAdmittedRows].every((rowId) => r6ImplementedRows.has(rowId))).toBe(true)
    expect(metricEvidenceDefects(ledger, r6LedgerContract)).toEqual([])
    expect(boundedInventoryDefects(ledger, candidateRows, r6LedgerContract)).toEqual([])
    const batch = ledger.batches.find((candidate) => candidate.id === 'B13')
    expect(batch).toBeDefined()
    expect(b13StaleClaimDefects(batch!)).toEqual([])
  })

  it('executes direct T65 and T68 process invariants', () => {
    const source = readFileSync(sddPath, 'utf8')
    const contract = currentContract(source)
    const controller = readJson<IControllerState>(loopStatePath)
    expect(currentContractAuthorityDefects(contract, controller)).toEqual([])
    expect(
      currentContractAuthorityDefects(contract, {
        ...controller,
        contract_revision: 'SDD-v999'
      })
    ).toContain('current-contract:revision')
    expect(activeClauseIsExclusive(source, contract), 'T65 active-clause invariant').toBe(true)
    const activeStart = source.indexOf('## Current Round Contract')
    const activeEnd = source.indexOf('## Agent Execution Lease', activeStart)
    const active = source.slice(activeStart, activeEnd)
    for (const version of ['R7-v2', 'R7-v999']) {
      const candidateSource =
        source.slice(0, activeStart) +
        active.replace(/^- Version:[ \t]*R\d+-v\d+$/m, `- Version: ${version}`) +
        source.slice(activeEnd)
      const candidateContract = currentContract(candidateSource)
      expect(currentContractAuthorityDefects(candidateContract, controller), version).toEqual([])
      expect(activeClauseIsExclusive(candidateSource, candidateContract), version).toBe(true)
    }
    const wrongRoundSource =
      source.slice(0, activeStart) +
      active.replace(/^- Version:[ \t]*R\d+-v\d+$/m, '- Version: R4-v999') +
      source.slice(activeEnd)
    const wrongRoundContract = currentContract(wrongRoundSource)
    expect(currentContractAuthorityDefects(wrongRoundContract, controller)).toEqual(
      expect.arrayContaining([
        'current-contract:version-logical-round',
        'current-contract:human-version-round'
      ])
    )
    expect(activeClauseIsExclusive(wrongRoundSource, wrongRoundContract), 'R4-v999').toBe(true)
    for (const version of ['R7-v0', 'R7-v-1', 'R7-v1.5', 'R7-v01']) {
      expect(
        currentContractAuthorityDefects({ ...contract, round: version }, controller),
        version
      ).toContain('current-contract:round-format')
    }
    expect(currentContractAuthorityDefects({ ...contract, round: 'R4-v5' }, controller)).toEqual(
      expect.arrayContaining([
        'current-contract:version-logical-round',
        'current-contract:human-version-round'
      ])
    )
    expect(currentContractAuthorityDefects({ ...contract, humanRound: 3 }, controller)).toEqual(
      expect.arrayContaining([
        'current-contract:human-logical-round',
        'current-contract:human-version-round'
      ])
    )
    const duplicateHumanRound =
      source.slice(0, activeStart) +
      active.replace(/^- Round:.*$/m, (line) => `${line}\n${line}`) +
      source.slice(activeEnd)
    expect(() => currentContract(duplicateHumanRound)).toThrow()
    const missingHumanRound =
      source.slice(0, activeStart) + active.replace(/^- Round:.*$/m, '') + source.slice(activeEnd)
    expect(() => currentContract(missingHumanRound)).toThrow()
    for (const [label, replacement] of [
      ['Round LF split', `- Round:\n${contract.humanRound}`],
      ['Round CRLF split', `- Round:\r\n${contract.humanRound}`],
      ['Round empty', '- Round:']
    ] as const) {
      const malformedHumanRound =
        source.slice(0, activeStart) +
        active.replace(/^- Round:.*$/m, replacement) +
        source.slice(activeEnd)
      expect(() => currentContract(malformedHumanRound), label).toThrow()
    }
    for (const [separatorLabel, separator] of hostileContractSeparators) {
      for (const [position, value] of [
        ['leading', `${separator}${contract.humanRound}`],
        ['trailing', `${contract.humanRound}${separator}`]
      ] as const) {
        const malformedHumanRound =
          source.slice(0, activeStart) +
          active.replace(/^- Round:.*$/m, `- Round: ${value}`) +
          source.slice(activeEnd)
        expect(
          () => currentContract(malformedHumanRound),
          `Round ${position} ${separatorLabel}`
        ).toThrow()
      }
    }
    for (const duplicateVersion of [contract.round, 'R7-v999']) {
      const duplicateHumanVersion =
        source.slice(0, activeStart) +
        active.replace(/^- Version:.*$/m, (line) => `${line}\n- Version: ${duplicateVersion}`) +
        source.slice(activeEnd)
      expect(() => currentContract(duplicateHumanVersion), duplicateVersion).toThrow()
    }
    const missingHumanVersion =
      source.slice(0, activeStart) + active.replace(/^- Version:.*$/m, '') + source.slice(activeEnd)
    expect(() => currentContract(missingHumanVersion)).toThrow()
    for (const [label, replacement] of [
      ['Version LF split', `- Version:\n${contract.round}`],
      ['Version CRLF split', `- Version:\r\n${contract.round}`],
      ['Version empty', '- Version:']
    ] as const) {
      const malformedHumanVersion =
        source.slice(0, activeStart) +
        active.replace(/^- Version:.*$/m, replacement) +
        source.slice(activeEnd)
      expect(() => currentContract(malformedHumanVersion), label).toThrow()
    }
    for (const [separatorLabel, separator] of hostileContractSeparators) {
      for (const [position, value] of [
        ['leading', `${separator}${contract.round}`],
        ['trailing', `${contract.round}${separator}`]
      ] as const) {
        const malformedHumanVersion =
          source.slice(0, activeStart) +
          active.replace(/^- Version:.*$/m, `- Version: ${value}`) +
          source.slice(activeEnd)
        expect(
          () => currentContract(malformedHumanVersion),
          `Version ${position} ${separatorLabel}`
        ).toThrow()
      }
    }
    for (const clause of r7FinalContractClauses) {
      expect(active, clause).toContain(clause)
      const withoutClause =
        source.slice(0, activeStart) +
        active.split(clause).join('[removed R7 final clause]') +
        source.slice(activeEnd)
      expect(activeClauseIsExclusive(withoutClause, contract), clause).toBe(false)
    }
    const materialAttempt = eventPayload('EVT-000188')
    expect(hasDeclaredMaterialDelta(materialAttempt), 'T68 material-delta invariant').toBe(false)
    expect(
      hasDeclaredMaterialDelta({ progress: 'material', material_delta: ['owner delta'] }),
      'T68 material-delta positive control'
    ).toBe(true)
  })

  it('requires candidate-specific owner evidence for every promoted row', () => {
    const ledger = readJson<IAcceptanceLedger>(ledgerPath)
    const allRows = ledger.metrics.flatMap((metric) => metric.rows)
    expect(allRows).toHaveLength(309)
    for (const row of allRows) {
      expect(row.state, row.id).toBe('implemented')
      expect(semanticOracleFields(row), row.id).toEqual([])
    }
    expect(
      allRows
        .filter((row) => row.metric === 'MET-RED' && row.state === 'implemented')
        .map((row) => row.id)
    ).toEqual([...r6ImplementedRows.keys()].sort())
    expect(
      ledger.metrics
        .filter((metric) => metric.id !== 'MET-RED')
        .every((metric) => metric.state === 'implemented')
    ).toBe(true)

    const source = readFileSync(sddPath, 'utf8')
    const contract = currentContract(source)
    const suiteOnlyPromotion = cloneLedger(ledger)
    suiteOnlyPromotion.metrics[0]!.rows[0]!.implementation = 'suite passed'
    suiteOnlyPromotion.metrics[0]!.rows[0]!.evidence = ['suite passed']
    expect(metricEvidenceDefects(suiteOnlyPromotion, contract)).toEqual(
      expect.arrayContaining(['WRC-C-R01:implementation', 'WRC-C-R01:WRC-C-T01:fresh-evidence'])
    )
    const staleLocator = cloneLedger(ledger)
    const assertion = staleLocator.testIndex.find((entry) => entry.kind === 'assertion')!
    assertion.line = 1
    expect(metricEvidenceDefects(staleLocator, contract)).toContain(`${assertion.id}:stale-locator`)

    const wrongOwner = cloneLedger(ledger)
    wrongOwner.metrics[0]!.rows[0]!.owner = []
    expect(metricEvidenceDefects(wrongOwner, contract)).toContain('WRC-C-R01:owner')

    const wrongFormula = cloneLedger(ledger)
    wrongFormula.metrics[0]!.numerator = wrongFormula.metrics[0]!.rows.length - 1
    expect(metricEvidenceDefects(wrongFormula, contract)).toContain('MET-REQ:formula')

    const sharedGroupPromotion = cloneLedger(ledger)
    const unsupportedRow = sharedGroupPromotion.metrics
      .find((metric) => metric.id === 'MET-RED')!
      .rows.find((row) => row.id === 'MET-RED-007')!
    unsupportedRow.implementation = 'shared grouped test passed'
    unsupportedRow.tests = [
      'packages/web-rpc/test/duplicate-owner-contract.test.ts::proves one PluginHost batch, one activation subscription, and stable endpoint disposal'
    ]
    unsupportedRow.evidence = ['shared grouped test passed']
    delete unsupportedRow.missingProof
    expect(
      boundedInventoryDefects(
        sharedGroupPromotion,
        parseTableSection(
          source,
          '### 7.4 Redundancy inventory（MET-RED）',
          '### 7.5 Security inventory（MET-SEC）',
          true
        ).filter((row) => row.cells.length >= 2),
        r6LedgerContract
      )
    ).toEqual(expect.arrayContaining(['MET-RED-007:binding-not-ledger']))
  })

  it('separates direct evidence from Sol admission and fails closed under ledger mutations', () => {
    const source = readFileSync(sddPath, 'utf8')
    const candidateRows = parseTableSection(
      source,
      '### 7.4 Redundancy inventory（MET-RED）',
      '### 7.5 Security inventory（MET-SEC）',
      true
    ).filter((row) => row.cells.length >= 2)
    const ledger = readJson<IAcceptanceLedger>(ledgerPath)
    const admission = readSolAdmissionInput()
    expect(solAdmissionDefects(admission)).toEqual([])
    const latestVerificationId = admission.controller.last_role_events.verification
    expect(isNonEmptyString(latestVerificationId)).toBe(true)
    expect(latestVerificationId).not.toBe(solAdmissionEventId)
    const latestVerificationEvent = admission.events.find(
      (event) => event.event_id === latestVerificationId
    )
    const admittedVerificationEvent = admission.events.find(
      (event) => event.event_id === solAdmissionEventId
    )
    expect(latestVerificationEvent?.role).toBe('sol')
    expect(latestVerificationEvent?.type).toBe('verification')
    const latestVerificationActor = latestVerificationEvent?.actor
    expect(isNonEmptyString(latestVerificationActor?.agent_id)).toBe(true)
    expect(isNonEmptyString(latestVerificationActor?.lease_id)).toBe(true)
    expect(isNonEmptyString(latestVerificationActor?.dispatch_event_id)).toBe(true)
    expect(isNonEmptyString(latestVerificationActor?.capability_proof)).toBe(true)
    const latestVerificationLease = isNonEmptyString(latestVerificationActor?.lease_id)
      ? admission.controller.issued_leases[latestVerificationActor.lease_id]
      : undefined
    expect(latestVerificationLease).toMatchObject({
      agent_id: latestVerificationActor?.agent_id,
      contract_revision: latestVerificationEvent?.contract_revision,
      dispatch_event_id: latestVerificationActor?.dispatch_event_id,
      lease_id: latestVerificationActor?.lease_id,
      role: 'sol'
    })
    expect(latestVerificationEvent?.sequence).toEqual(expect.any(Number))
    expect(admittedVerificationEvent?.sequence).toEqual(expect.any(Number))
    expect(latestVerificationEvent!.sequence as number).toBeGreaterThan(
      admittedVerificationEvent!.sequence as number
    )

    const directOnlyRows = new Set(r6ImplementedRows)
    directOnlyRows.delete('MET-RED-031')
    expect(
      boundedInventoryDefects(
        ledger,
        candidateRows,
        r6LedgerContract,
        directTestBindings,
        directOnlyRows,
        admission
      )
    ).toContain('MET-RED-031:not-red')

    const missingLedgerBinding = cloneLedger(ledger)
    const bindingRow = missingLedgerBinding.metrics
      .find((metric) => metric.id === 'MET-RED')!
      .rows.find((row) => row.id === 'MET-RED-031')!
    bindingRow.tests = bindingRow.tests.slice(1)
    expect(
      boundedInventoryDefects(
        missingLedgerBinding,
        candidateRows,
        r6LedgerContract,
        undefined,
        undefined,
        admission
      )
    ).toContain('MET-RED-031:binding-not-ledger')

    const missingAdmissionEvidence = cloneLedger(ledger)
    const evidenceRow = missingAdmissionEvidence.metrics
      .find((metric) => metric.id === 'MET-RED')!
      .rows.find((row) => row.id === 'MET-RED-031')!
    evidenceRow.evidence = evidenceRow.evidence.filter(
      (entry) => entry !== solAdmissionEvidence('MET-RED-031')
    )
    expect(
      boundedInventoryDefects(
        missingAdmissionEvidence,
        candidateRows,
        r6LedgerContract,
        undefined,
        undefined,
        admission
      )
    ).toContain('MET-RED-031:missing-sol-admission-evidence')

    const admittedRowRemainsStrict = cloneLedger(ledger)
    const admittedRow = admittedRowRemainsStrict.metrics
      .find((metric) => metric.id === 'MET-RED')!
      .rows.find((row) => row.id === 'MET-RED-003')!
    admittedRow.missingProof = 'unexpected stale proof'
    expect(
      boundedInventoryDefects(
        admittedRowRemainsStrict,
        candidateRows,
        r6LedgerContract,
        undefined,
        undefined,
        admission
      )
    ).toContain('MET-RED-003:stale-missing-proof')

    const wrongSidecar = cloneSolAdmissionInput(admission)
    wrongSidecar.eventLogPath = resolve(
      repositoryRoot,
      'docs/web-rpc/endpoint-feature-composition-continuation.sdd.md.events.jsonl'
    )
    wrongSidecar.loopStatePath = resolve(
      repositoryRoot,
      'docs/web-rpc/endpoint-feature-composition-continuation.sdd.md.loop.json'
    )
    expect(solAdmissionDefects(wrongSidecar)).toEqual(
      expect.arrayContaining(['sol-admission:event-sidecar', 'sol-admission:loop-sidecar'])
    )

    const wrongEventId = cloneSolAdmissionInput(admission)
    wrongEventId.eventId = 'EVT-000104'
    expect(solAdmissionDefects(wrongEventId)).toContain('sol-admission:event-id')
    const missingEvent = cloneSolAdmissionInput(admission)
    missingEvent.events = missingEvent.events.filter(
      (event) => event.event_id !== solAdmissionEventId
    )
    expect(solAdmissionDefects(missingEvent)).toContain('sol-admission:event-missing')
    expect(
      solAdmissionDefects(
        mutateSolAdmissionEvent(admission, (event) => {
          event.role = 'luna'
        })
      )
    ).toContain('sol-admission:role')
    expect(
      solAdmissionDefects(
        mutateSolAdmissionEvent(admission, (event) => {
          event.type = 'implementation'
        })
      )
    ).toContain('sol-admission:type')
    expect(
      solAdmissionDefects(
        mutateSolAdmissionEvent(admission, (event) => {
          event.contract_revision = 'SDD-v23'
        })
      )
    ).toContain('sol-admission:revision')
    expect(
      solAdmissionDefects(
        mutateSolAdmissionEvent(admission, (event) => {
          event.payload = { ...event.payload, result: 'FAIL' }
        })
      )
    ).toContain('sol-admission:result')
    expect(
      solAdmissionDefects(
        mutateSolAdmissionEvent(admission, (event) => {
          const rowResults = {
            ...(event.payload?.row_results as Record<string, unknown>)
          }
          delete rowResults['MET-RED-031']
          event.payload = { ...event.payload, row_results: rowResults }
        })
      )
    ).toContain('MET-RED-031:sol-admission-support')
    expect(Object.isFrozen(expectedSolRowResults)).toBe(true)
    for (const [rowId, expectedResult] of Object.entries(expectedSolRowResults)) {
      const admittedEvent = admission.events.find((event) => event.event_id === admission.eventId)
      const admittedRowResults = admittedEvent?.payload?.row_results
      const actualResult =
        admittedRowResults && typeof admittedRowResults === 'object'
          ? (admittedRowResults as Record<string, unknown>)[rowId]
          : undefined
      expect(actualResult, `${rowId}: frozen EVT-000109 result`).toBe(expectedResult)
      for (const mutation of mutateFrozenSolResult(expectedResult)) {
        expect(
          solAdmissionDefects(
            mutateSolAdmissionEvent(admission, (event) => {
              const rowResults = {
                ...(event.payload?.row_results as Record<string, unknown>),
                [rowId]: mutation.value
              }
              event.payload = { ...event.payload, row_results: rowResults }
            })
          ),
          `${rowId}: ${mutation.label}`
        ).toContain(`${rowId}:sol-admission-support`)
      }
    }
    expect(
      solAdmissionDefects(
        mutateSolAdmissionEvent(admission, (event) => {
          event.actor = { ...event.actor, agent_id: 'wrong-sol-agent' }
        })
      )
    ).toContain('sol-admission:lease-agent')
    expect(
      solAdmissionDefects(
        mutateSolAdmissionEvent(admission, (event) => {
          event.actor = { ...event.actor, lease_id: 'LEASE-wrong' }
        })
      )
    ).toContain('sol-admission:issued-lease')
    expect(
      solAdmissionDefects(
        mutateSolAdmissionEvent(admission, (event) => {
          event.actor = { ...event.actor, dispatch_event_id: 'EVT-wrong' }
        })
      )
    ).toContain('sol-admission:lease-dispatch')
    expect(
      solAdmissionDefects(
        mutateSolAdmissionEvent(admission, (event) => {
          event.actor = { ...event.actor, capability_proof: '' }
        })
      )
    ).toContain('sol-admission:capability-proof')

    expect(
      solAdmissionDefects(
        mutateSolAdmissionEvent(admission, (event) => {
          event.previous_hash = 'broken-previous-hash'
        })
      )
    ).toContain('sol-admission:hash-link')
    expect(
      solAdmissionDefects(
        mutateSolAdmissionEvent(admission, (event) => {
          event.event_hash = 'wrong-nonempty-event-hash'
        })
      )
    ).toContain('sol-admission:successor-hash-link')
    const brokenSuccessorSequence = cloneSolAdmissionInput(admission)
    const admittedEventIndex = brokenSuccessorSequence.events.findIndex(
      (event) => event.event_id === solAdmissionEventId
    )
    const admittedEvent = brokenSuccessorSequence.events[admittedEventIndex]
    const successorEvent = brokenSuccessorSequence.events[admittedEventIndex + 1]
    expect(admittedEvent).toBeDefined()
    expect(successorEvent).toBeDefined()
    successorEvent!.sequence = (admittedEvent!.sequence as number) + 2
    expect(solAdmissionDefects(brokenSuccessorSequence)).toContain(
      'sol-admission:successor-hash-link'
    )
  })

  it('retains the B13 ordered package, consumer, repository, and validator gates', () => {
    const ledger = readJson<IAcceptanceLedger>(ledgerPath)
    const batch = ledger.batches.find((candidate) => candidate.id === 'B13')
    expect(batch).toBeDefined()
    expect(b13StaleClaimDefects(batch!)).toEqual([])
    const staleBatch = {
      ...batch!,
      redEvidence: [
        ...batch!.redEvidence,
        'legacy AST closure claim',
        'All 40 MET-RED rows remain red with row-specific missing proof; no row closure is asserted.'
      ],
      exitEvidence: [
        ...batch!.exitEvidence,
        'Reset gate: validator must report no closed MET-RED row and exactly 40 red rows.'
      ]
    }
    expect(b13StaleClaimDefects(staleBatch)).toContain(`redEvidence[${batch!.redEvidence.length}]`)
    expect(b13StaleClaimDefects(staleBatch)).toContain(
      `redEvidence[${batch!.redEvidence.length + 1}]`
    )
    expect(b13StaleClaimDefects(staleBatch)).toContain(
      `exitEvidence[${batch!.exitEvidence.length}]`
    )
    expect(batch?.prerequisite).toEqual(['B11f'])
    expect(batch?.state).toBe('implemented')
    expect(batch?.redEvidence).toEqual([])
    expect(batch?.implementationDelta.length).toBeGreaterThan(0)
    expect(batch?.deletedDuplicate).toEqual([])
    expect(batch?.exitEvidence.length).toBeGreaterThan(0)
    expect(batch?.remainingOwner.length).toBeGreaterThan(0)
    expect(batch?.packageGates.length).toBeGreaterThan(0)
    expect(batch?.repositoryGates.length).toBeGreaterThan(0)
    expect(batch?.directConsumers).toEqual([
      '@migaia/store-worker: runtime direct consumer',
      '@migaia/storage-web: dev/test integration consumer',
      '@migaia/serialize: negative dependency-direction gate'
    ])
    expect(packageGateDefects(batch!)).toEqual([])
    const passWithFailure = {
      ...batch!,
      gates: batch!.gates.map((gate) =>
        gate.id === 'package-test'
          ? {
              ...gate,
              status: 'PASS' as const,
              result: '83 files / 947 tests; 946 passed, 1 failed'
            }
          : gate
      )
    }
    expect(packageGateDefects(passWithFailure)).toContain('package-test:pass-with-failure')
    const passWithNonzero = {
      ...batch!,
      gates: batch!.gates.map((gate) =>
        gate.id === 'package-test'
          ? { ...gate, status: 'PASS' as const, result: `${gate.result}; exit 1` }
          : gate
      )
    }
    expect(packageGateDefects(passWithNonzero)).toContain('package-test:pass-with-nonzero')
    const staleTuple = {
      ...batch!,
      gates: batch!.gates.map((gate) =>
        gate.id === 'package-test'
          ? { ...gate, result: '81 files / 901 tests; 897 passed, 4 failed' }
          : gate
      )
    }
    expect(packageGateDefects(staleTuple)).toContain('package-test:count-tuple')
    expect(
      batch?.gates.find((gate) => gate.id === 'repository-retained-inventory')?.result
    ).toContain('66 modules, 455256 raw bytes, 107623 gzip bytes')
    const metricValidator = batch?.gates.find((gate) => gate.id === 'repository-metric-validator')
    expect(
      metricValidator?.status === 'NOT_RUN'
        ? metricValidator.result === 'pending post-ledger focused validator'
        : metricValidator?.status === 'PASS' && metricValidator.result === 'PASS: 1 file / 5 tests'
    ).toBe(true)
    const duplicateZero = batch?.gates.find((gate) => gate.id === 'repository-duplicate-zero')
    expect(duplicateZero?.command).toBe(
      'CI=true rtk pnpm --filter @migaia/web-rpc exec vitest run test/duplicate-owner-contract.test.ts test/architecture.test.ts test/topology-rollback.test.ts test/plugin-host/topology-adapter.test.ts test/continuation-sdd.test.ts --coverage=false'
    )
    expect(
      duplicateZero?.status === 'NOT_RUN'
        ? duplicateZero.result === 'pending post-ledger duplicate-owner validator'
        : duplicateZero?.status === 'PASS' && duplicateZero.result === 'PASS: 5 files / 57 tests'
    ).toBe(true)
    expect(batch?.gates.find((gate) => gate.id === 'repository-provenance')?.status).toBe('PASS')
  })
})

/** The sole prior Sol verification authorized for R2-v6 evidence admission. */
const solAdmissionEventId = 'EVT-000109'
/** Frozen repository commit used to validate deleted-source spans. */
const baselineCommit = '2466ef833173e3b22a5b3d09aa824ea91503759'
/** Stable final-acceptance clauses required by every positive R7 contract subversion. */
const r7FinalContractClauses = Object.freeze([
  'R7-v1 final acceptance and SHIP contract',
  'Final candidate freeze',
  'Final ordered matrix',
  'Fresh final Sol',
  'Requirement closure',
  'R7-v2 current-contract validator correction',
  '`continuation-acceptance.json`继续以`R6-v2 / SDD-v47`证明六指标',
  '`r6LedgerContract`仍是其唯一校验上下文'
] as const)
