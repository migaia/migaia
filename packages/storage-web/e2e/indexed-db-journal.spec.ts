import { expect, test } from '@playwright/test'

test('native Web Locks protect a persistent journal index across pages and hand it off after disposal', async ({
  context,
  page
}) => {
  const peer = await context.newPage()
  const dbName = 'native-journal-' + crypto.randomUUID()
  await page.goto('/')
  await peer.goto('/')
  try {
    expect(await page.evaluate((name) => window.openIndexedDbJournal(name), dbName)).toBe(0)
    expect(await peer.evaluate((name) => window.openIndexedDbJournal(name, true), dbName)).toBe(
      'LOCK_REJECTED'
    )
    expect(await page.evaluate(() => window.appendIndexedDbJournal())).toEqual({
      appended: [1],
      lastSeq: 1
    })
    await page.evaluate(() => window.closeIndexedDbJournal())
    expect(await peer.evaluate((name) => window.openIndexedDbJournal(name, true), dbName)).toBe(1)
    expect(await peer.evaluate(() => window.appendIndexedDbJournal())).toEqual({
      appended: [2],
      lastSeq: 2
    })
  } finally {
    await page.evaluate(() => window.closeIndexedDbJournal())
    await peer.evaluate(() => window.closeIndexedDbJournal())
    await peer.close()
  }
})

test('native business changes, logs and undo share the actual IndexedDB terminal in a fixed org', async ({
  page
}) => {
  await page.goto('/')
  expect(
    await page.evaluate(
      (name) => window.runIndexedDbGlobalJournal(name),
      'native-global-' + crypto.randomUUID()
    )
  ).toEqual({
    changes: [
      ['text', 'text'],
      ['bytes', 'bytes'],
      ['text', 'text'],
      ['record', 'record']
    ],
    rollback: true,
    restored: true,
    commits: 2,
    isolated: true
  })
})
