import { chromium, type Browser, type FrameLocator, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freePort, Platform } from './support.ts'

/** Platform under test. */
const platform = new Platform()
/** Browser. */
let browser: Browser

beforeAll(async () => {
  await platform.start(await freePort(), await freePort())
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
  await platform.stop()
})

/** Notify module that keeps a top-level `let` (rejected by `remote.module-state`). */
const STATEFUL = `import { defineEffect } from '@migaia/part-host'
let count = 0
export default defineEffect({
  id: 'notify@1',
  run: (_event, ctx) => {
    ctx.state.write('page.notice' as never, 'Order noted v2' as never)
  }
})
`

/** Corrected notify module writing the new notice. */
const FIXED = `// Remote effect of the "Create order" button: shows the new notice.
import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'notify@1',
  run: (_event, ctx) => {
    ctx.state.write('page.notice' as never, 'Order noted v2' as never)
  }
})
`

/** Text of the element whose part address ends with `id` in the preview. */
function previewText(frame: FrameLocator, id: string): Promise<string | null> {
  return frame.locator(`[data-part-address$="${id}"]`).first().textContent()
}

/** Address of a node in the editor tree. */
async function address(page: Page, id: string): Promise<string> {
  return (await page.locator(`[data-node$="${id}"]`).first().getAttribute('data-node')) as string
}

describe('preview, hot replacement and module editing', () => {
  it('updates the preview in place, rejects and accepts module saves, loads new modules and shows devtools', async () => {
    /** Editor page. */
    const page = await browser.newPage()
    /** Console lines of every frame. */
    const consoleLines: string[] = []
    page.on('console', (message) => void consoleLines.push(message.text()))
    await page.goto(platform.editorUrl)
    await page.locator('[data-token]').fill(platform.token)
    await page.locator('[data-project]').fill('orders')
    await page.locator('[data-login] button').click()
    await page.locator('[data-blueprint="orders-page"]').click()
    /** Preview frame. */
    const frame = page.frameLocator('[data-preview]')
    await expect.poll(() => previewText(frame, 'button-0'), { timeout: 60000 }).toBe('Create order')
    /** Preview frame object. */
    const previewFrame = page.frames().find((item) => item !== page.mainFrame())
    /** Frame URL before the updates. */
    const url = previewFrame?.url()

    /** Button address. */
    const button = await address(page, 'button-0')
    await page.locator(`[data-node="${button}"]`).click()
    await page.locator(`[data-panel="${button}"] [data-field="children"]`).fill('Order now')
    await expect.poll(() => previewText(frame, 'button-0')).toBe('Order now')

    await page.locator('[data-module="effects/notify.ts"]').click()
    await page.locator('[data-module-source]').fill(STATEFUL)
    await page.locator('[data-save]').click()
    /** Module issue of the top-level `let`. */
    const issue = page.locator('[data-module-issue="remote.module-state"]')
    await expect.poll(() => issue.count(), { timeout: 60000 }).toBe(1)
    expect(await issue.getAttribute('data-line')).toBe('2')

    await page.locator('[data-module-source]').fill(FIXED)
    await page.locator('[data-new-module]').fill('effects/extra.ts')
    await page.locator('[data-create-module]').click()
    await page.locator('[data-save]').click()
    await expect
      .poll(() => page.locator('[data-result="effects/extra.ts"]').textContent(), {
        timeout: 60000
      })
      .toContain('accepted')
    expect(await page.locator('[data-result="effects/notify.ts"]').textContent()).toContain(
      'accepted'
    )

    /** Notice paragraph address. */
    const notice = await address(page, 'notice')
    await page.locator(`[data-node="${notice}"]`).click()
    await page.locator(`[data-panel="${notice}"] [data-event="click"]`).selectOption('extra@1')
    await expect
      .poll(
        async () => {
          await frame.locator('[data-part-address$="button-0"]').first().click()
          return previewText(frame, 'notice')
        },
        { timeout: 60000 }
      )
      .toBe('Order noted v2')
    await frame.locator('[data-part-address$="log-button"]').first().click()
    await expect.poll(() => previewText(frame, 'log-line')).toBe('logged')
    await frame.locator('[data-part-address$="notice"]').first().click()
    await expect.poll(() => previewText(frame, 'notice')).toBe('done')
    expect(consoleLines.join('\n')).not.toContain('CATALOG_CONFLICT')
    expect(previewFrame?.url()).toBe(url)
    expect(await previewFrame?.evaluate(() => sessionStorage.getItem('partom.preview.loads'))).toBe(
      '1'
    )

    await frame.locator('body').press('Alt+Shift+KeyD')
    await frame.locator('[data-part="pick"]').click()
    await frame.locator('[data-part-address$="button-0"]').first().click()
    await expect
      .poll(() => frame.locator('[data-part="steps"]').textContent())
      .toContain('authored')
    await page.close()
  })
})
