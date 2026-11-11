import type { Pool } from 'pg'
import { expect, it, vi } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { pgDriver } from '../src/pg.ts'
import { PostgresErrorCode, STORAGE_POSTGRES_ERROR_SOURCE } from '../src/index.ts'

/** Pool double whose borrowed client fails only in its release callback. */
function failingReleasePool(failure: Error): Pool {
  return {
    connect: async () => ({
      release: () => {
        throw failure
      }
    })
  } as unknown as Pool
}

/** Explicit dispose surfaces a failed PoolClient.release() as SQL_FAILED with the original cause. */
async function explicitDispose(): Promise<void> {
  /** The exact release failure that must stay reachable. */
  const original = new Error('borrowed release failed')
  /** Borrowed connection whose release callback throws. */
  const connection = await pgDriver(failingReleasePool(original)).connect()
  /** Settled explicit disposal outcome. */
  const primary = connection.dispose()
  expect(connection.dispose()).toBe(primary)
  /** Rejection of the explicit disposal Promise. */
  const failure = await primary.then(
    () => undefined,
    (cause: unknown) => cause
  )
  expect(failure).toMatchObject({
    source: STORAGE_POSTGRES_ERROR_SOURCE,
    code: PostgresErrorCode.sqlFailed
  })
  expect(walkErrorCauses(failure)).toContain(original)
}

/** Symbolic dispose only reports the same release failure and resolves. */
async function symbolicDispose(): Promise<void> {
  /** The exact release failure that must reach the reporter. */
  const original = new Error('borrowed release failed')
  /** Errors handed to the default backend reporter. */
  const reports: unknown[] = []
  /** Default reporter sink of storage operations. */
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    reports.push(args.at(-1))
  })
  try {
    /** Borrowed connection whose release callback throws. */
    const connection = await pgDriver(failingReleasePool(original)).connect()
    await expect(connection[Symbol.asyncDispose]()).resolves.toBeUndefined()
    expect(reports).toHaveLength(1)
    expect(walkErrorCauses(reports[0])).toContain(original)
  } finally {
    spy.mockRestore()
  }
}

it(
  'surfaces a failed borrowed release on explicit dispose with the original cause',
  explicitDispose
)
it('reports a failed borrowed release once on symbolic dispose and resolves', symbolicDispose)
