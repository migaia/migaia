import { test, expect } from '@playwright/test'

test('reads six native IndexedDB candidates through the automatic entity equality index', async ({
  page
}) => {
  await page.goto('/')
  expect(await page.evaluate(() => window.runStorageProgramAutomaticIndex())).toEqual({
    ids: ['1', '11', '3', '5', '7', '9'],
    groups: ['one', 'one', 'one', 'one', 'one', 'one'],
    readsAfterExplain: [],
    readsAfterQuery: [6],
    selectedIndex: 'byGroup',
    fullScan: true,
    secondaryIndexes: true
  })
})

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
