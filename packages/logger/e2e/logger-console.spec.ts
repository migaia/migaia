import { expect, test } from '@playwright/test'

test('renders logger entries through the browser console', async ({ page }) => {
  const consoleEntries: Array<{ type: string; text: string }> = []
  page.on('console', (message) => {
    consoleEntries.push({ type: message.type(), text: message.text() })
  })

  await page.goto('/')
  await page.evaluate(() => window.runLoggerScenario())

  expect(consoleEntries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'log', text: expect.stringContaining('browser info') }),
      expect.objectContaining({
        type: 'warning',
        text: expect.stringContaining('browser warning')
      }),
      expect.objectContaining({ type: 'error', text: expect.stringContaining('browser error') }),
      expect.objectContaining({ type: 'error', text: expect.stringContaining('browser fatal') }),
      expect.objectContaining({
        type: 'log',
        text: expect.stringContaining('debug after setLevel')
      }),
      expect.objectContaining({ type: 'log', text: expect.stringContaining('filter removed') }),
      expect.objectContaining({ type: 'log', text: expect.stringContaining('custom thinking') }),
      expect.objectContaining({ type: 'log', text: expect.stringContaining('step') }),
      expect.objectContaining({ type: 'log', text: expect.stringContaining('custom response') }),
      expect.objectContaining({ type: 'log', text: expect.stringContaining('answer') })
    ])
  )
  expect(consoleEntries.some(({ text }) => text.includes('filtered by level'))).toBe(false)
  expect(consoleEntries.some(({ text }) => text.includes('filtered by filter'))).toBe(false)
  expect(consoleEntries.some(({ text }) => text.includes('filtered dynamically'))).toBe(false)
  expect(consoleEntries.some(({ text }) => text.includes('debug after setLevel'))).toBe(true)
  expect(
    consoleEntries.some(({ text }) => text.includes('\u001b[') && text.includes('browser info'))
  ).toBe(true)

  const result = await page.evaluate(() => window.loggerScenarioResult)
  expect(result?.requests.length).toBeGreaterThan(0)
  expect(result?.requestHeaders.length).toBe(result?.requests.length)
  expect(
    result?.requestHeaders.every(
      (headers) =>
        headers.authorization === 'Bearer e2e-token' && headers['x-logger-e2e'] === 'enabled'
    )
  ).toBe(true)
  const entries = result?.requests.flatMap((body) => JSON.parse(body).entries) ?? []
  expect(entries.map((entry: { tag: string }) => entry.tag)).toEqual(
    expect.arrayContaining(['debug', 'info', 'warn', 'error', 'fatal', 'thinking', 'response'])
  )
  expect(
    entries.every((entry: { data: { uuid?: string } }) => typeof entry.data.uuid === 'string')
  ).toBe(true)
  expect(
    entries.every((entry: { data: { uuidDisplay?: boolean } }) => entry.data.uuidDisplay === true)
  ).toBe(true)
  expect(entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tag: 'thinking', message: 'step' }),
      expect.objectContaining({ tag: 'response', message: 'answer' })
    ])
  )
  expect(result?.requests.every((body) => JSON.parse(body).entries.length <= 2)).toBe(true)
  expect(entries).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ message: 'filtered by level' })])
  )
  expect(entries).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ message: 'filtered by filter' })])
  )
  expect(entries).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ message: 'filtered dynamically' })])
  )
  expect(entries).toEqual(
    expect.arrayContaining([expect.objectContaining({ message: 'filter removed' })])
  )
  expect(
    entries.every((entry: { data: { uuid?: string } }) => typeof entry.data.uuid === 'string')
  ).toBe(true)
})

test('flush deadline converges with a never-settling browser sink', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.runLoggerDeadlineScenario())
  const elapsed = await page.evaluate(() => window.loggerDeadlineElapsedMs)
  expect(elapsed).toBeGreaterThanOrEqual(2_900)
  expect(elapsed).toBeLessThan(4_500)
})
