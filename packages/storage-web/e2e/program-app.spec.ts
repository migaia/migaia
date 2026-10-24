import { test, expect } from '@playwright/test'

test('runs the unchanged program application with native IndexedDB and binlog', async ({
  page
}) => {
  await page.goto('/')
  expect(await page.evaluate(() => window.runStorageProgramApplication())).toEqual({
    application: {
      rows: [
        { id: 'a', score: 3 },
        { id: 'b', score: 2 }
      ],
      persisted: { version: 1, state: { count: 3 } },
      status: 'committed'
    },
    logged: true,
    observations: { getMany: [1, 1, 1, 0], setMany: [2, 2, 1, 1], removeMany: [1, 1, 1, 0] },
    batch: {
      ordered: ['b', 'a', undefined, 'a'],
      removed: 1,
      failed: true,
      unchanged: true,
      record: { id: 'occupied', score: 0 }
    },
    organizations: { before: ['default', 'one', 'two'], after: ['default', null, 'two'] }
  })
})
