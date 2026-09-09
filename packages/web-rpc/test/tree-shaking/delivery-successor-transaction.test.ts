import {
  mkdtempSync,
  existsSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

type IFixtureTuple = {
  moduleCount: number
  rawBytes: number
  gzipBytes: number
}

type IFixtureSubject = {
  fixture: string
  sequence: number
  digest: string
}

type IApprovalRecord = {
  payload: Record<string, unknown>
  [key: string]: unknown
}

type IFixtureApproval = {
  status: string
  approvalRecord: IApprovalRecord
}

type IFixtureAuthorization = {
  approval: IFixtureApproval
  authority: Record<string, unknown>
  oldTuple: IFixtureTuple
  newTuple: IFixtureTuple
  subject: IFixtureSubject
}

type IProtectedHash = {
  matches: boolean
  sha256: string
}

type ITransactionLedger = {
  writes: number
  renames: number
  unlinks: number
  rollbacks: number
  retries: number
}

type ITransactionResult = {
  status: string
  reason?: string
  noSecret?: boolean
  keyGeneration?: boolean
  protectedUnchanged?: boolean
  ledger: ITransactionLedger
  maxima: ITransactionLedger
  protectedAfter: Record<string, IProtectedHash>
}

type ITransactionOptions = {
  authorityBytes?: Buffer
  approvalBytes?: Buffer
  subject?: IFixtureSubject
  oldTuple?: IFixtureTuple
  newTuple?: IFixtureTuple
  expectedOldHashes?: Record<string, string>
  faultAt?: string | null
  shortWriteAt?: string | null
}

type ITransactionModule = {
  canonicalJson: (value: unknown) => string
  createFixtureAuthorization: (options?: {
    signingCanonicalizer?: (value: object) => string
    subjectBody?: Record<string, unknown>
    oldTuple?: IFixtureTuple
    newTuple?: IFixtureTuple
  }) => IFixtureAuthorization
  parseStructured: (bytes: Buffer) => Buffer
  readExpectedHashes: (protectedTargets: Record<string, string>) => Record<string, IProtectedHash>
  runBoundedTransaction: (root: string, options?: ITransactionOptions) => ITransactionResult
  runFixturePreflight: (
    root: string,
    protectedTargets: Record<string, string>,
    options?: ITransactionOptions
  ) => ITransactionResult
  runFixtureTransaction: (root: string, options?: ITransactionOptions) => ITransactionResult
  serializeStructured: (value: unknown) => Buffer
  sha256: (bytes: Buffer) => string
  validateAuthorization: (
    authorization: Record<string, unknown>,
    subject: IFixtureSubject,
    options?: {
      authority?: Record<string, unknown>
      oldTuple?: IFixtureTuple
      newTuple?: IFixtureTuple
    }
  ) => string | null
  verifyFixtureAuthorization: (fixture?: IFixtureAuthorization) => string | null
}

/** Load the frozen transaction helper through an explicit local runtime boundary. */
const transactionHelperModulePath = './delivery-successor-transaction.mjs'
const transactionModule = createRequire(import.meta.url)(
  transactionHelperModulePath
) as ITransactionModule
const {
  canonicalJson,
  createFixtureAuthorization,
  parseStructured,
  readExpectedHashes,
  runBoundedTransaction,
  runFixturePreflight,
  runFixtureTransaction,
  serializeStructured,
  sha256,
  validateAuthorization,
  verifyFixtureAuthorization
} = transactionModule

const targetNames = ['current-delivery-authority.json', 'current-delivery-approval.json']
const stageNames = [
  '.current-delivery-authority.v21.stage.json',
  '.current-delivery-approval.v21.stage.json'
]
/**
 * Captures exact installed pair bytes before fixture-only work; D4 may legitimately replace them
 * later.
 */
function readProtectedPair(): Readonly<Record<string, Buffer>> {
  return Object.fromEntries(
    targetNames.map((name) => {
      const path = resolve(import.meta.dirname, `../fixtures/tree-shaking/${name}`)
      return [path, readFileSync(path)]
    })
  )
}

/**
 * Derives current expected hashes from the observed installed pair rather than stale pre-D4
 * literals.
 */
function protectedTargetsFrom(pair: Readonly<Record<string, Buffer>>): Record<string, string> {
  return Object.fromEntries(Object.entries(pair).map(([path, bytes]) => [path, sha256(bytes)]))
}

/** Creates a fresh temporary root containing the exact old target pair. */
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rpcc-d28-'))
  const oldBytes = {
    [targetNames[0]]: Buffer.from('{"old":"authority"}\n'),
    [targetNames[1]]: Buffer.from('{"old":"approval"}\n')
  }
  for (const name of targetNames) writeFileSync(join(root, name), oldBytes[name])
  return {
    root,
    oldBytes,
    oldHashes: Object.fromEntries(targetNames.map((name) => [name, sha256(oldBytes[name])]))
  }
}

describe('delivery successor bounded preparation', () => {
  it('authenticates the public fixture and preserves protected bytes', () => {
    const { root, oldHashes } = makeRoot()
    const result = runFixturePreflight(root, protectedTargetsFrom(readProtectedPair()), {
      expectedOldHashes: oldHashes
    })
    expect(verifyFixtureAuthorization()).toBeNull()
    expect(result).toMatchObject({
      status: 'PASS',
      noSecret: true,
      keyGeneration: false,
      protectedUnchanged: true
    })
    expect(result.ledger).toEqual({ writes: 2, renames: 2, unlinks: 0, rollbacks: 0, retries: 0 })
    expect(result.ledger.writes).toBeLessThanOrEqual(result.maxima.writes)
    expect(result.ledger.renames).toBeLessThanOrEqual(result.maxima.renames)
    expect(result.ledger.unlinks).toBe(result.maxima.unlinks)
    expect(readdirSync(root).filter((name) => stageNames.includes(name))).toEqual([])
    expect(Object.values(result.protectedAfter).every((entry) => entry.matches)).toBe(true)
  })

  it('uses real LF bytes and rejects escaped or non-exact authorization payloads', () => {
    const bytes = serializeStructured({ status: 'approved' })
    expect(bytes.at(-1)).toBe(0x0a)
    expect(() => parseStructured(Buffer.from('{"status":"approved"}\\n'))).toThrow()
    expect(JSON.stringify({ status: 'approved' })).not.toBe(canonicalJson({ status: 'approved' }))
    expect(
      verifyFixtureAuthorization(
        createFixtureAuthorization({ signingCanonicalizer: JSON.stringify })
      )
    ).toBe('approval signature invalid')

    const fixture = createFixtureAuthorization()
    const nestedExtra = {
      ...fixture.approval,
      approvalRecord: {
        ...fixture.approval.approvalRecord,
        payload: { ...fixture.approval.approvalRecord.payload, extra: true }
      }
    }
    expect(
      validateAuthorization(nestedExtra, fixture.subject, {
        authority: fixture.authority,
        oldTuple: fixture.oldTuple,
        newTuple: fixture.newTuple
      })
    ).toBe('decision payload mismatch')
  })

  it('rejects pending authorization before any stage write', () => {
    const { root, oldHashes } = makeRoot()
    const fixture = createFixtureAuthorization()
    const pendingAuthorization = { status: 'pending', approvalRecord: null }
    const result = runBoundedTransaction(root, {
      authorityBytes: serializeStructured(pendingAuthorization),
      approvalBytes: serializeStructured(pendingAuthorization),
      subject: fixture.subject,
      oldTuple: fixture.oldTuple,
      newTuple: fixture.newTuple,
      expectedOldHashes: oldHashes
    })
    expect(result).toMatchObject({
      status: 'STOP',
      reason: 'authorization input invalid',
      ledger: { writes: 0, renames: 0, unlinks: 0, rollbacks: 0, retries: 0 }
    })
    expect(readdirSync(root).sort()).toEqual([...targetNames].sort())
    expect(targetNames.map((name) => sha256(readFileSync(join(root, name))))).toEqual(
      targetNames.map((name) => oldHashes[name])
    )
  })

  it.each([
    ['after first write', { faultAt: 'after-first-write' }, 1, 0],
    ['short second write', { shortWriteAt: 'second' }, 2, 0],
    ['after first rename', { faultAt: 'after-first-rename' }, 2, 1]
  ])('%s stops without cleanup, rollback, or retry', (_label, options, writes, renames) => {
    const { root, oldBytes, oldHashes } = makeRoot()
    const before = Object.fromEntries(
      targetNames.map((name) => [name, readFileSync(join(root, name))])
    )
    const result = runFixtureTransaction(root, { expectedOldHashes: oldHashes, ...options })
    expect(result).toMatchObject({
      status: 'STOP',
      ledger: { writes, renames, unlinks: 0, rollbacks: 0, retries: 0 }
    })
    expect(targetNames.map((name) => readFileSync(join(root, name)))).toEqual(
      targetNames.map((name) =>
        renames === 1
          ? name === targetNames[0]
            ? serializeStructured(createFixtureAuthorization().authority)
            : before[name]
          : before[name]
      )
    )
    expect(result.maxima).toEqual({ writes: 2, renames: 2, unlinks: 0, rollbacks: 0, retries: 0 })
    expect(oldBytes[targetNames[0]]).toEqual(before[targetNames[0]])
  })

  it('stops before all mutation on prehash drift or an existing stage', () => {
    const drift = makeRoot()
    writeFileSync(join(drift.root, targetNames[0]), Buffer.from('drifted'))
    const driftBefore = readdirSync(drift.root).sort()
    const driftResult = runFixtureTransaction(drift.root, { expectedOldHashes: drift.oldHashes })
    expect(driftResult).toMatchObject({
      status: 'STOP',
      reason: 'prehash drift',
      ledger: { writes: 0, renames: 0 }
    })
    expect(readdirSync(drift.root).sort()).toEqual(driftBefore)

    for (const stageName of stageNames) {
      const staged = makeRoot()
      writeFileSync(join(staged.root, stageName), Buffer.from('existing'))
      const stagedBefore = Object.fromEntries(
        readdirSync(staged.root).map((name) => [name, readFileSync(join(staged.root, name))])
      )
      const stagedResult = runFixtureTransaction(staged.root, {
        expectedOldHashes: staged.oldHashes
      })
      expect(stagedResult).toMatchObject({
        status: 'STOP',
        reason: 'existing stage',
        ledger: { writes: 0, renames: 0 }
      })
      expect(
        Object.fromEntries(
          readdirSync(staged.root).map((name) => [name, readFileSync(join(staged.root, name))])
        )
      ).toEqual(stagedBefore)
    }
  })

  it('uses the same owner for an alternate signed subject and tuple', () => {
    const { root, oldHashes } = makeRoot()
    const fixture = createFixtureAuthorization({
      subjectBody: { fixture: 'alternate-rpcc', sequence: 9 },
      oldTuple: { moduleCount: 7, rawBytes: 8, gzipBytes: 9 },
      newTuple: { moduleCount: 10, rawBytes: 11, gzipBytes: 12 }
    })
    const result = runBoundedTransaction(root, {
      authorityBytes: serializeStructured(fixture.authority),
      approvalBytes: serializeStructured(fixture.approval),
      subject: fixture.subject,
      oldTuple: fixture.oldTuple,
      newTuple: fixture.newTuple,
      expectedOldHashes: oldHashes
    })
    expect(result.status).toBe('PASS')
    expect(result.ledger).toMatchObject({ writes: 2, renames: 2, unlinks: 0 })
  })

  it.each([
    [
      'wrong subject',
      (fixture: IFixtureAuthorization) => ({ ...fixture.subject, digest: '0'.repeat(64) }),
      (fixture: IFixtureAuthorization) => fixture.newTuple,
      (fixture: IFixtureAuthorization) => fixture.authority
    ],
    [
      'wrong schema',
      (fixture: IFixtureAuthorization) => fixture.subject,
      (fixture: IFixtureAuthorization) => fixture.newTuple,
      (fixture: IFixtureAuthorization) => ({ ...fixture.authority, schema: 'wrong-schema' })
    ],
    [
      'wrong field tuple',
      (fixture: IFixtureAuthorization) => fixture.subject,
      (fixture: IFixtureAuthorization) => ({ ...fixture.newTuple, rawBytes: 99 }),
      (fixture: IFixtureAuthorization) => fixture.authority
    ]
  ])('rejects %s before any stage write', (_label, subjectFor, tupleFor, authorityFor) => {
    const { root, oldHashes } = makeRoot()
    const fixture = createFixtureAuthorization()
    const result = runBoundedTransaction(root, {
      authorityBytes: serializeStructured(authorityFor(fixture)),
      approvalBytes: serializeStructured(fixture.approval),
      subject: subjectFor(fixture),
      oldTuple: fixture.oldTuple,
      newTuple: tupleFor(fixture),
      expectedOldHashes: oldHashes
    })
    expect(result).toMatchObject({
      status: 'STOP',
      reason: 'authorization input invalid',
      ledger: { writes: 0, renames: 0, unlinks: 0, rollbacks: 0, retries: 0 }
    })
    expect(readdirSync(root).sort()).toEqual([...targetNames].sort())
  })

  it('rejects absent, symlink, and invalid-root paths before creating transaction state', () => {
    const absent = makeRoot()
    unlinkSync(join(absent.root, targetNames[0]))
    const absentResult = runFixtureTransaction(absent.root, { expectedOldHashes: absent.oldHashes })
    expect(absentResult).toMatchObject({
      status: 'STOP',
      reason: 'target path is missing or not a regular non-symlink file',
      ledger: { writes: 0, renames: 0 }
    })
    expect(readdirSync(absent.root).sort()).toEqual([targetNames[1]])

    const linked = makeRoot()
    const realPath = join(linked.root, 'real-authority.json')
    writeFileSync(realPath, linked.oldBytes[targetNames[0]])
    unlinkSync(join(linked.root, targetNames[0]))
    symlinkSync(realPath, join(linked.root, targetNames[0]))
    const linkedResult = runFixtureTransaction(linked.root, { expectedOldHashes: linked.oldHashes })
    expect(linkedResult).toMatchObject({
      status: 'STOP',
      reason: 'target path is missing or not a regular non-symlink file',
      ledger: { writes: 0, renames: 0 }
    })
    expect(readdirSync(linked.root).sort()).toEqual([
      'current-delivery-approval.json',
      'current-delivery-authority.json',
      'real-authority.json'
    ])

    const missingRoot = join(tmpdir(), `rpcc-d28-missing-${process.pid}-${Date.now()}`)
    const fixture = createFixtureAuthorization()
    const missingResult = runBoundedTransaction(missingRoot, {
      authorityBytes: serializeStructured(fixture.authority),
      approvalBytes: serializeStructured(fixture.approval),
      subject: fixture.subject,
      oldTuple: fixture.oldTuple,
      newTuple: fixture.newTuple,
      expectedOldHashes: absent.oldHashes
    })
    expect(missingResult).toMatchObject({ status: 'STOP', reason: 'invalid root path' })
    expect(existsSync(missingRoot)).toBe(false)
  })

  it.each(stageNames)('rejects a dangling %s stage before any write', (stageName) => {
    const { root, oldHashes } = makeRoot()
    const linkedPath = join(root, `${stageName}.target`)
    symlinkSync(linkedPath, join(root, stageName))
    const result = runFixtureTransaction(root, { expectedOldHashes: oldHashes })
    expect(result).toMatchObject({
      status: 'STOP',
      reason: 'existing stage',
      ledger: { writes: 0, renames: 0, unlinks: 0, rollbacks: 0, retries: 0 }
    })
    expect(readdirSync(root).sort()).toEqual([...targetNames, stageName].sort())
  })

  it('binds real protected hashes before and after the fixture-only run', () => {
    const pair = readProtectedPair()
    const protectedTargets = protectedTargetsFrom(pair)
    const before = readExpectedHashes(protectedTargets)
    expect(Object.values(before).every((entry) => entry.matches)).toBe(true)
    const { root, oldHashes } = makeRoot()
    const result = runFixturePreflight(root, protectedTargets, { expectedOldHashes: oldHashes })
    const after = readExpectedHashes(protectedTargets)
    expect(result.protectedUnchanged).toBe(true)
    expect(Object.values(after).every((entry) => entry.matches)).toBe(true)
    for (const [path, bytes] of Object.entries(pair)) expect(readFileSync(path)).toEqual(bytes)
  })
})
