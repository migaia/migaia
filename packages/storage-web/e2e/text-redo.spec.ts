import { expect, test } from '@playwright/test'

test('popup borrows the exact persistent opener WAL and recovers its failed native text draft', async ({
  page
}) => {
  await page.goto('/')
  const namespace = 'text-redo-' + crypto.randomUUID()
  const dbName = namespace + '-carrier'
  const popupPromise = page.waitForEvent('popup')
  await page.evaluate(() => window.open('/', 'text-redo-peer'))
  const popup = await popupPromise
  await popup.waitForLoadState()
  try {
    expect(
      await page.evaluate(
        ({ namespace, dbName }) => window.prepareTextRedoOwner(namespace, dbName),
        { namespace, dbName }
      )
    ).toEqual({ pending: 0, lastSeq: 0 })
    expect(await page.evaluate(() => window.failTextRedoAssignment())).toEqual({
      code: 'JOURNAL_RECOVERY_FAILED',
      pending: 1,
      assignments: 2
    })
    expect(await popup.evaluate(() => window.recoverTextRedoFromOpener())).toEqual({
      sameLogger: true,
      sameWal: true,
      values: ['first', 'second'],
      pending: 0
    })
    await page.evaluate(() => window.closeTextRedoOwner())
    expect(
      await page.evaluate(
        ({ namespace, dbName }) => window.prepareTextRedoOwner(namespace, dbName),
        { namespace, dbName }
      )
    ).toEqual({ pending: 0, lastSeq: 1 })
  } finally {
    await page.evaluate(() => window.closeTextRedoOwner())
    await popup.close()
  }
})
