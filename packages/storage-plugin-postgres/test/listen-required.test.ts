import { expect, it } from 'vitest'
import { createPostgresStore } from '../src/store.ts'

it('rejects a postgres driver without listen before probing or running DDL', async () => {
  let queries = 0
  const driver = {
    query: async () => {
      queries += 1
      return { rows: [] }
    },
    connect: async () => {
      throw new Error('connect must not run')
    }
  }
  await expect(
    createPostgresStore(
      { driver, server: 'postgres' } as never,
      {} as never,
      () => false,
      () => undefined,
      () => undefined
    )
  ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
  expect(queries).toBe(0)
})
