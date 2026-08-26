import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseD47VitestJson,
  validateD47Ledger,
  verifyD47CausalClosure,
  verifyD47GateOutput,
  verifyD47InverseDifferential
} from '../storage-v2-d47-audit.mjs'
import { verifyCompleteStorageInversePaths } from '../storage-v2-complete-inverse.mjs'

type ID47AssertionFixture = {
  readonly id: string
  readonly testFile: string
  readonly ancestorTitles: readonly string[]
  readonly title: string
  readonly failureMessageSha256: string
}

type ID47GateFixture = {
  readonly package: string
  readonly expectedSummary: {
    readonly failed: number
    readonly passed: number
    readonly total: number
  }
  readonly assertions: readonly ID47AssertionFixture[]
}

type ID47JsonAssertion = {
  readonly ancestorTitles: readonly string[]
  readonly title: string
  readonly status: 'passed' | 'failed'
  readonly failureMessages: readonly string[]
}

/** Repository root owns the D47 ledger and immutable D43 snapshot. */
const repositoryRoot = resolve(import.meta.dirname, '..', '..')

/** Fixture test identity remains inside the repository path boundary. */
const fixtureTestFile = 'scripts/test/storage-v2-d47.spec.ts'

/** Current D47 candidate ledger used for closed-schema and byte-identity validation. */
const ledger = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'scripts/storage-v2-d47-ledger.json'), 'utf8')
) as Record<string, unknown>

/** Computes fixture failure hashes with the same repository-root normalization as production. */
const hashFailure = (message: string): string =>
  createHash('sha256')
    .update(message.replaceAll(repositoryRoot, '<repository>').replaceAll('\r', ''))
    .digest('hex')

/** Exact failed assertion proves structured binding without transcript substring matching. */
const failedAssertion: ID47JsonAssertion = {
  ancestorTitles: ['fixture suite'],
  title: 'expected owner failure',
  status: 'failed',
  failureMessages: [`AssertionError: expected trace owner\n  at ${repositoryRoot}/fixture.ts:1:1`]
}

/** Minimal structured gate isolates assertion/count/failure-block classification. */
const gate: ID47GateFixture = {
  package: '@migaia/fixture',
  expectedSummary: { failed: 1, passed: 2, total: 3 },
  assertions: [
    {
      id: 'fixture-failure',
      testFile: fixtureTestFile,
      ancestorTitles: failedAssertion.ancestorTitles,
      title: failedAssertion.title,
      failureMessageSha256: hashFailure(failedAssertion.failureMessages[0]!)
    }
  ]
}

/** Produces one complete Vitest JSON report with controlled assertion-level facts. */
const report = (
  assertions: readonly ID47JsonAssertion[] = [
    failedAssertion,
    {
      ancestorTitles: ['fixture suite'],
      title: 'passing one',
      status: 'passed',
      failureMessages: []
    },
    {
      ancestorTitles: ['fixture suite'],
      title: 'passing two',
      status: 'passed',
      failureMessages: []
    }
  ],
  counts = { failed: 1, passed: 2, total: 3 },
  overrides: Readonly<Record<string, unknown>> = {}
): string =>
  JSON.stringify({
    numFailedTests: counts.failed,
    numPassedTests: counts.passed,
    numTotalTests: counts.total,
    success: false,
    testResults: [
      {
        name: resolve(repositoryRoot, fixtureTestFile),
        status: 'failed',
        assertionResults: assertions
      }
    ],
    ...overrides
  })

/** Deep clone keeps hostile ledger mutation independent across assertions. */
const cloneLedger = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(ledger)) as Record<string, unknown>

describe('SWV2-D47 deferred external failure classification', () => {
  it('retains real closure intersections for the complete inverse differential', () => {
    expect(() => validateD47Ledger(ledger, repositoryRoot)).not.toThrow()
    const first = {
      package: '@migaia/fixture',
      path: fixtureTestFile,
      snapshotSha256: null,
      currentSha256: 'a'.repeat(64)
    }
    expect(verifyD47CausalClosure([first], [first], new Set([fixtureTestFile]))).toEqual([
      `@migaia/fixture\0${fixtureTestFile}`
    ])
  })

  it('accepts only the exact structured assertion, counts, and failure block', () => {
    expect(parseD47VitestJson(report(), repositoryRoot).summary).toEqual(gate.expectedSummary)
    expect(() => verifyD47GateOutput(gate, report(), repositoryRoot)).not.toThrow()
  })

  it('rejects cross-assertion and unrelated-log spoofing', () => {
    const spoofed = report([
      { ...failedAssertion, failureMessages: ['AssertionError: different owner failure'] },
      {
        ancestorTitles: ['fixture suite'],
        title: 'passing transcript bait',
        status: 'passed',
        failureMessages: [failedAssertion.failureMessages[0]!]
      },
      {
        ancestorTitles: ['fixture suite'],
        title: 'passing two',
        status: 'passed',
        failureMessages: []
      }
    ])
    expect(() => verifyD47GateOutput(gate, spoofed, repositoryRoot)).toThrow(
      'structured failure block drift'
    )
    expect(() => parseD47VitestJson(`setup log\n${report()}`, repositoryRoot)).toThrow(
      'Vitest JSON report is malformed'
    )
  })

  it('rejects missing, duplicate, and suite-level failures', () => {
    expect(() =>
      verifyD47GateOutput(gate, report([], { failed: 0, passed: 2, total: 2 }), repositoryRoot)
    ).toThrow()
    expect(() =>
      parseD47VitestJson(
        report([failedAssertion, failedAssertion], { failed: 2, passed: 0, total: 2 }),
        repositoryRoot
      )
    ).toThrow('failed assertion identities must be unique')
    expect(() =>
      parseD47VitestJson(
        report(
          [],
          { failed: 1, passed: 0, total: 1 },
          {
            testResults: [
              {
                name: resolve(repositoryRoot, fixtureTestFile),
                status: 'failed',
                assertionResults: []
              }
            ]
          }
        ),
        repositoryRoot
      )
    ).toThrow('suite-level failure is not deferrable')
  })

  it('rejects incomplete or injected closure rows without pruning real intersections', () => {
    const first = {
      package: '@migaia/fixture',
      path: fixtureTestFile,
      snapshotSha256: null,
      currentSha256: 'a'.repeat(64)
    }
    const second = { ...first, path: 'scripts/package.json' }
    expect(() => verifyD47CausalClosure([first], [first, second], new Set())).toThrow(
      'causal closure is incomplete'
    )
    expect(() => verifyD47CausalClosure([first, second], [first], new Set())).toThrow(
      'causal closure is incomplete'
    )
  })

  it('rejects a partial or duplicated complete-storage inverse path set', () => {
    expect(() => verifyCompleteStorageInversePaths(['a', 'b'], ['a'])).toThrow(
      'complete storage inverse path set mismatch'
    )
    expect(() => verifyCompleteStorageInversePaths(['a', 'b'], ['a', 'a'])).toThrow(
      'complete storage inverse paths must be unique'
    )
  })

  it('rejects omitted, changed-hash, and added inverse failures', () => {
    const current = parseD47VitestJson(report(), repositoryRoot)
    expect(() => verifyD47InverseDifferential(current, current, '@migaia/fixture')).not.toThrow()

    const omitted = { assertions: [], summary: { failed: 0, passed: 2, total: 2 } }
    expect(() => verifyD47InverseDifferential(current, omitted, '@migaia/fixture')).toThrow(
      'failure count drift'
    )

    const changedHash = {
      ...current,
      assertions: current.assertions.map((assertion) => ({
        ...assertion,
        failureMessageSha256: '0'.repeat(64)
      }))
    }
    expect(() => verifyD47InverseDifferential(current, changedHash, '@migaia/fixture')).toThrow(
      'failure hash drift'
    )

    const added = {
      assertions: [
        ...current.assertions,
        {
          testFile: fixtureTestFile,
          ancestorTitles: ['fixture suite'],
          title: 'added inverse failure',
          failureMessageSha256: '1'.repeat(64)
        }
      ],
      summary: { ...current.summary, failed: current.summary.failed + 1 }
    }
    expect(() => verifyD47InverseDifferential(current, added, '@migaia/fixture')).toThrow(
      'failure count drift'
    )
  })

  it('rejects green relabel, changed owner command, and duplicate assertion ID', () => {
    const greenLedger = cloneLedger() as {
      deferredCandidates: Array<{ status: string }>
    }
    greenLedger.deferredCandidates[0]!.status = 'verified'
    expect(() => validateD47Ledger(greenLedger, repositoryRoot)).toThrow(
      'cannot be classified green'
    )

    const commandLedger = cloneLedger() as {
      deferredCandidates: Array<{ gates: Array<{ expectedTestScript: string }> }>
    }
    commandLedger.deferredCandidates[0]!.gates[0]!.expectedTestScript = 'vitest run'
    expect(() => validateD47Ledger(commandLedger, repositoryRoot)).toThrow(
      'expectedTestScript drift'
    )

    const duplicateLedger = cloneLedger() as {
      deferredCandidates: Array<{
        gates: Array<{ assertions: Array<{ id: string }> }>
      }>
    }
    duplicateLedger.deferredCandidates[1]!.gates[0]!.assertions[0]!.id =
      duplicateLedger.deferredCandidates[0]!.gates[0]!.assertions[0]!.id
    expect(() => validateD47Ledger(duplicateLedger, repositoryRoot)).toThrow(
      'D47 assertion IDs must be unique'
    )
  })

  it('rejects a forged D43 assertion hash or deleted B00-B trigger', () => {
    const hashLedger = cloneLedger() as {
      deferredCandidates: Array<{
        gates: Array<{ assertions: Array<{ snapshotSha256: string }> }>
      }>
    }
    hashLedger.deferredCandidates[0]!.gates[0]!.assertions[0]!.snapshotSha256 = '0'.repeat(64)
    expect(() => validateD47Ledger(hashLedger, repositoryRoot)).toThrow(
      'D43 snapshot hash mismatch'
    )

    const triggerLedger = cloneLedger() as {
      deferredCandidates: Array<{ revalidateOn: string[] }>
    }
    triggerLedger.deferredCandidates[0]!.revalidateOn = ['owner changes']
    expect(() => validateD47Ledger(triggerLedger, repositoryRoot)).toThrow('lacks B00-B trigger')
  })
})
