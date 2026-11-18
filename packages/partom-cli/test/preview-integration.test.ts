import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUN } from './run.ts'
import {
  copyPreviewApp,
  launchBrowser,
  PreviewProcess,
  removeCopy,
  write
} from './preview-support.ts'

/** Package root. */
const ROOT = join(import.meta.dirname, '..')
/** Fixture copy. */
let dir = ''
/** Headless browser. */
let browser: Browser

beforeAll(async () => {
  /** Build of the doctor runner, page runtime and executable. */
  const build = spawnSync(BUN, ['run', 'build:exe'], { cwd: ROOT, encoding: 'utf8' })
  expect(build.status).toBe(0)
  dir = copyPreviewApp()
  browser = await launchBrowser()
})

afterAll(async () => {
  await browser.close()
  removeCopy(dir)
})

/** Region name of the element holding focus, or the active element's tag. */
function focusedRegion(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.activeElement?.closest('[data-part-region]')?.getAttribute('data-part-region') ??
      document.activeElement?.tagName ??
      null
  )
}

/** Rendered width of a region. */
function regionWidth(page: Page, region: string): Promise<number> {
  return page.evaluate(
    (name) =>
      Math.round(
        document.querySelector(`[data-part-region="${name}"]`)?.getBoundingClientRect().width ?? 0
      ),
    region
  )
}

describe('stage-2 integration with the compiled executable', () => {
  it('previews layouts with landmarks, F6, resizing, collapse and live reload', async () => {
    const preview = new PreviewProcess(dir, [], [join(ROOT, 'dist', 'partom')])
    expect(await preview.ready()).toBeUndefined()
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    try {
      await page.goto(preview.base)
      await page.waitForSelector('a[href="/b/shell"]')
      expect(await page.locator('a[href="/b/plain"]').count()).toBe(1)

      await page.goto(`${preview.base}b/shell`)
      await page.locator('main').waitFor()
      const labels = await page
        .locator('nav')
        .evaluateAll((navs) => navs.map((nav) => nav.getAttribute('aria-label')))
      expect(new Set(labels).size).toBe(2)
      expect(await page.locator('main').count()).toBe(1)
      const visited: (string | null)[] = []
      for (let press = 0; press < 3; press += 1) {
        await page.keyboard.press('F6')
        visited.push(await focusedRegion(page))
      }
      expect(visited).toEqual(['nav', 'tree', 'content'])

      await page.reload()
      await page.locator('main').waitFor()
      await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() => document.activeElement?.hasAttribute('data-part-skip'))
      ).toBe(true)

      const before = await regionWidth(page, 'tree')
      await page.locator('[data-part-separator="tree"]').focus()
      for (let press = 0; press < 5; press += 1) await page.keyboard.press('ArrowRight')
      expect(await regionWidth(page, 'tree')).toBe(before + 50)
      await page.reload()
      await page.locator('main').waitFor()
      expect(await regionWidth(page, 'tree')).toBe(before + 50)

      await page.setViewportSize({ width: 700, height: 800 })
      await page.waitForFunction(
        () => document.querySelectorAll('[data-collapsed="true"]').length === 2
      )
      const toggle = page.locator('[data-part-toggle="tree"]')
      expect(await toggle.isVisible()).toBe(true)
      expect(await page.locator('[data-part-toggle="nav"]').isVisible()).toBe(true)
      await toggle.click()
      await page.waitForFunction(
        () => document.querySelector('[data-part-region="tree"]')?.matches(':popover-open') === true
      )
      await page.keyboard.press('Escape')
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('data-part-toggle') === 'tree'
      )

      const shell = readFileSync(join(dir, 'shell.blueprint.json'), 'utf8')
      const started = Date.now()
      write(dir, 'shell.blueprint.json', shell.replace('"Body"', '"Body updated"'))
      await page.waitForFunction(
        () => document.querySelector('main')?.textContent?.includes('Body updated') === true,
        undefined,
        { timeout: 2000 }
      )
      expect(Date.now() - started).toBeLessThan(2000)

      write(
        dir,
        'shell.blueprint.json',
        shell.replace('"label": "Body" }', '"label": "Body" }, "attrs": { "tabindex": 3 }')
      )
      await page.locator('partom-overlay button').waitFor({ timeout: 5000 })
      expect(await page.locator('partom-overlay button').allTextContents()).toEqual([
        expect.stringContaining('behavior.tabindex')
      ])
    } finally {
      await page.close()
      expect(await preview.stop()).toBe(0)
    }
  })
})
