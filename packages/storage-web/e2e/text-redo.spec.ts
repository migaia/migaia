import { expect, test } from '@playwright/test'

for (const kind of ['local', 'cookies'] as const) {
  test(`${kind} popup borrows the exact persistent opener WAL and recovers its failed native text draft`, async ({
    page
  }) => {
    await page.goto('/')
    const namespace = 'text-redo-' + kind + '-' + crypto.randomUUID()
    const dbName = namespace + '-carrier'
    const popupPromise = page.waitForEvent('popup')
    await page.evaluate(() => window.open('/', 'text-redo-peer'))
    const popup = await popupPromise
    await popup.waitForLoadState()
    try {
      expect(
        await page.evaluate(
          ({ namespace, dbName, kind }) => window.prepareTextRedoOwner(namespace, dbName, kind),
          { namespace, dbName, kind }
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
          ({ namespace, dbName, kind }) => window.prepareTextRedoOwner(namespace, dbName, kind),
          { namespace, dbName, kind }
        )
      ).toEqual({ pending: 0, lastSeq: 1 })
    } finally {
      await page.evaluate(() => window.closeTextRedoOwner())
      await popup.close()
    }
  })
}

test('session Storage recovers its failed native draft inside its original page', async ({
  page
}) => {
  await page.goto('/')
  const namespace = 'text-redo-session-' + crypto.randomUUID(),
    dbName = namespace + '-carrier'
  try {
    expect(
      await page.evaluate(
        ({ namespace, dbName }) => window.prepareTextRedoOwner(namespace, dbName, 'session'),
        { namespace, dbName }
      )
    ).toEqual({ pending: 0, lastSeq: 0 })
    expect(await page.evaluate(() => window.failTextRedoAssignment())).toEqual({
      code: 'JOURNAL_RECOVERY_FAILED',
      pending: 1,
      assignments: 2
    })
    expect(await page.evaluate(() => window.recoverTextRedoHere())).toEqual({
      values: ['first', 'second'],
      pending: 0
    })
    await page.evaluate(() => window.closeTextRedoOwner())
    expect(
      await page.evaluate(
        ({ namespace, dbName }) => window.prepareTextRedoOwner(namespace, dbName, 'session'),
        { namespace, dbName }
      )
    ).toEqual({ pending: 0, lastSeq: 1 })
    expect(await page.evaluate(() => window.recoverTextRedoHere())).toEqual({
      values: ['first', 'second'],
      pending: 0
    })
  } finally {
    await page.evaluate(() => window.closeTextRedoOwner())
  }
})
