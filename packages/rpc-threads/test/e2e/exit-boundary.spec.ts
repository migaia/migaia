import { expect, test } from '@playwright/test'

test('owned DedicatedWorker reports its unobservable exit without waiting for reap timeout', async ({
  page,
  browser,
  browserName
}) => {
  /** Browser exceptions remain independently visible even when the diagnostic receipt succeeds. */
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')
  await page.waitForFunction(() => typeof globalThis.runOwnedThreadExitBoundary === 'function')
  /** The real browser executes the public API fixture, including the native Worker request. */
  const receipt = await page.evaluate(() => globalThis.runOwnedThreadExitBoundary())
  console.log(
    `BROWSER_EXIT_BOUNDARY ${JSON.stringify({ browserName, version: browser.version(), ...receipt })}`
  )
  expect(receipt.value).toBe(42)
  expect(receipt.exitObservation).toBe('unsupported')
  expect(receipt.admission).toEqual([
    expect.objectContaining({ source: '@migaia/supervision', code: 'CAPABILITY_UNSUPPORTED' })
  ])
  expect(receipt.closing).toEqual([
    expect.objectContaining({
      source: '@migaia/supervision',
      code: 'EXIT_UNOBSERVABLE',
      name: 'Error',
      detail: expect.objectContaining({
        kind: 'thread',
        generation: 1,
        capability: 'exit-observation'
      }),
      message: expect.stringMatching(/\S/)
    })
  ])
  expect(receipt.closing.some(({ code }) => code === 'REAP_TIMEOUT')).toBe(false)
  expect(receipt.closing.some(({ code }) => code === 'DISPOSE_STEP_TIMEOUT')).toBe(false)
  expect(receipt.closeElapsedMs).toBeLessThan(receipt.reapTimeoutMs / 2)
  expect(receipt.sameClose).toBe(true)
  expect(pageErrors).toEqual([])
})
