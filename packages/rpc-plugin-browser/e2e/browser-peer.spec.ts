import { expect, test } from '@playwright/test'

test('Browser Peer forwards peer and original Window carrier events', async ({ page }) => {
  await page.goto('/browser-peer/index.html')
  /**
   * Original carrier identity distinguishes real raw-port forwarding from replacement MessagePort
   * events.
   */
  const result = await page.evaluate(() => globalThis.runBrowserPeerProbe())
  expect(result.echo).toBe('observed-window-peer')
  expect(result.lifecycle).toEqual(expect.arrayContaining(['handshake', 'ready', 'closing']))
  expect(result.carriers.length).toBeGreaterThan(0)
  expect(new Set(result.carriers)).toEqual(new Set(['window']))
  expect(result.directions).toEqual(expect.arrayContaining([0, 1]))
  expect(result.failures).toEqual([])
})

test('cross-origin Window Peer carries request, notify and stream and borrows its iframe', async ({
  page
}) => {
  await page.goto('/browser-peer/index.html')
  expect(await page.evaluate(() => globalThis.runBrowserPeerWindow())).toEqual({
    echo: 'window-peer',
    recorded: ['window-notify'],
    values: [5, 6],
    sameClose: true,
    borrowedAttached: true
  })
})

test('iframe unload settles pending request with the original Core deadline code', async ({
  page
}) => {
  await page.goto('/browser-peer/index.html')
  expect(await page.evaluate(() => globalThis.runBrowserPeerWindow(true))).toMatchObject({
    source: 'rpc.endpoint',
    code: 'DEADLINE_EXCEEDED',
    name: 'TimeoutError'
  })
})

test('one SharedWorker serves two page Peers and keeps the surviving page callable', async ({
  context
}) => {
  /** Real pages share one worker URL while owning independent native MessagePorts. */
  const pages = await Promise.all([context.newPage(), context.newPage()])
  /** Unexpected browser failures remain visible without weakening any transport assertion. */
  const errors: string[] = []
  for (const page of pages) page.on('pageerror', (error) => errors.push(error.message))
  await Promise.all(pages.map((page) => page.goto('/browser-peer/index.html')))
  await Promise.all(pages.map((page) => page.evaluate(() => globalThis.connectBrowserPeerShared())))
  /** Concurrent calls prove response and stream delivery stay with their own page ports. */
  const results = await Promise.all(
    pages.map((page, index) =>
      page.evaluate((label) => globalThis.runBrowserPeerShared(label), index === 0 ? 'A' : 'B')
    )
  )
  expect(results[0]).toMatchObject({ echo: 'A', values: [10, 11], sessions: 2 })
  expect(results[1]).toMatchObject({ echo: 'B', values: [20, 21], sessions: 2 })
  expect(results[0]!.recorded).toContain('notify-A')
  expect(results[1]!.recorded).toContain('notify-B')
  expect(await pages[0]!.evaluate(() => globalThis.closeBrowserPeerShared())).toEqual({
    portCloses: 0,
    sameClose: true
  })
  await pages[0]!.close()
  expect(await pages[1]!.evaluate(() => globalThis.runBrowserPeerShared('survivor'))).toMatchObject(
    { echo: 'survivor', values: [20, 21] }
  )
  expect(await pages[1]!.evaluate(() => globalThis.closeBrowserPeerShared(true))).toMatchObject({
    source: 'rpc.endpoint',
    code: 'DEADLINE_EXCEEDED',
    name: 'TimeoutError'
  })
  expect(errors).toEqual([])
})
