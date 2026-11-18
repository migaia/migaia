import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUN } from './run.ts'
import {
  CLI,
  copyPreviewApp,
  EventRecorder,
  launchBrowser,
  PreviewProcess,
  removeCopy,
  sleep,
  until,
  write
} from './preview-support.ts'

/** Fixture copy shared by this file. */
let dir = ''
/** Headless browser shared by this file. */
let browser: Browser

beforeAll(async () => {
  dir = copyPreviewApp()
  browser = await launchBrowser()
})

afterAll(async () => {
  await browser.close()
  removeCopy(dir)
})

/** Status code of a GET. */
async function status(url: string): Promise<number> {
  return (await fetch(url)).status
}

/** Runs the CLI synchronously in the fixture copy. */
function partomSync(args: readonly string[]): { readonly code: number; readonly stdout: string } {
  /** Child result. */
  const result = spawnSync(BUN, [CLI, ...args], { cwd: dir, encoding: 'utf8', timeout: 240000 })
  return { code: result.status ?? -1, stdout: result.stdout }
}

/** Listens on a loopback port; resolves with the server or undefined when it is taken. */
async function occupy(port: number): Promise<Server | undefined> {
  /** Server holding the port. */
  const server = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    return server
  } catch {
    // The port is already taken by someone else, which serves the test just as well.
    return undefined
  }
}

describe('partom preview startup and routes', () => {
  it('serves the blueprint list, pages, 404s and stops on SIGINT', async () => {
    const preview = new PreviewProcess(dir, [])
    expect(await preview.ready()).toBeUndefined()
    expect(preview.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    const list = (await (await fetch(`${preview.base}api/blueprints`)).json()) as {
      blueprints: { id: string }[]
    }
    expect(list.blueprints.map((entry) => entry.id).sort()).toEqual(['plain', 'shell'])
    const page = await browser.newPage()
    await page.goto(preview.base)
    await page.waitForSelector('a[href="/b/shell"]')
    expect(await page.locator('a[href="/b/plain"]').count()).toBe(1)
    await page.close()
    for (const path of ['b/missing', 'x', 'assets/0/entry.js'])
      expect(await status(`${preview.base}${path}`)).toBe(404)
    expect(await status(`${preview.base}assets/1/entry.js`)).toBe(200)

    const port = new URL(preview.base).port
    expect(await preview.stop()).toBe(0)
    expect(await fetch(preview.base).catch(() => 'refused')).toBe('refused')
    expect(port).not.toBe('')
  })

  it('prints the target URL by id or file and rejects unknown targets', async () => {
    for (const target of ['shell', 'shell.blueprint.json']) {
      const preview = new PreviewProcess(dir, [target])
      expect(await preview.ready(2)).toBeUndefined()
      expect(preview.urls[1]).toBe(`${preview.base}b/shell`)
      expect(await preview.stop()).toBe(0)
    }
    for (const target of ['missing', 'nope.json']) {
      const preview = new PreviewProcess(dir, [target])
      expect(await preview.ready()).toBe(2)
      expect(preview.errorCode()).toBe('BLUEPRINT_NOT_FOUND')
    }
  })

  it('adds the blueprint list to doctor JSON without changing the other fields', () => {
    const plainRun = partomSync(['doctor', '--json'])
    const listed = partomSync(['doctor', '--json', '--blueprints'])
    expect(listed.code).toBe(plainRun.code)
    const plainResult = JSON.parse(plainRun.stdout) as Record<string, unknown>
    const listedResult = JSON.parse(listed.stdout) as Record<string, unknown>
    expect(listedResult.issues).toEqual(plainResult.issues)
    expect(listedResult.rendered).toEqual(plainResult.rendered)
    expect(listedResult.blueprints).toHaveLength(2)
    expect('blueprints' in plainResult).toBe(false)
  })

  it('exits with PORT_IN_USE when every port is taken', async () => {
    const servers: Server[] = []
    for (let port = 4400; port <= 4419; port += 1) {
      const server = await occupy(port)
      if (server !== undefined) servers.push(server)
    }
    try {
      const preview = new PreviewProcess(dir, [])
      expect(await preview.ready()).toBe(2)
      expect(preview.errorCode()).toBe('PORT_IN_USE')
    } finally {
      for (const server of servers) server.close()
    }
  })
})

describe('partom preview rebuilds', () => {
  it('merges changes into serial rebuilds with increasing generations', async () => {
    const preview = new PreviewProcess(dir, [])
    expect(await preview.ready()).toBeUndefined()
    const events = new EventRecorder()
    await events.open(preview.base)
    try {
      const shell = readFileSync(join(dir, 'shell.blueprint.json'), 'utf8')
      write(dir, 'shell.blueprint.json', shell.replace('"Body"', '"Body 2"'))
      expect(await until(() => events.named('reload').length === 1, 2000)).toBe(true)
      await sleep(1500)
      expect(events.named('reload')).toHaveLength(1)

      for (const label of ['A', 'B', 'C'])
        write(dir, 'shell.blueprint.json', shell.replace('"Body"', `"${label}"`))
      expect(await until(() => events.named('reload').length === 2, 4000)).toBe(true)
      await sleep(1500)
      expect(events.named('reload')).toHaveLength(2)
    } finally {
      events.close()
      await preview.stop()
    }
  })

  it('runs one more rebuild for changes made while a rebuild runs', async () => {
    const preview = new PreviewProcess(dir, [], undefined, { PARTOM_FIXTURE_SLOW_MS: '1500' })
    expect(await preview.ready()).toBeUndefined()
    const events = new EventRecorder()
    await events.open(preview.base)
    const shell = readFileSync(join(dir, 'shell.blueprint.json'), 'utf8')
    try {
      write(dir, 'shell.blueprint.json', shell.replace('"Body"', '"D"'))
      await sleep(500)
      write(dir, 'shell.blueprint.json', shell.replace('"Body"', '"E"'))
      await sleep(300)
      write(dir, 'shell.blueprint.json', shell.replace('"Body"', '"F"'))
      expect(await until(() => events.named('reload').length === 2, 12000)).toBe(true)
      await sleep(2500)
      expect(events.named('reload')).toHaveLength(2)
      const generations = events.named('reload').map((entry) => entry.data.generation as number)
      expect(generations).toEqual([...generations].sort((a, b) => a - b))
      expect(new Set(generations).size).toBe(generations.length)
    } finally {
      events.close()
      await preview.stop()
    }
  })

  it('reloads the config, reports build errors and ignores node_modules', async () => {
    const preview = new PreviewProcess(dir, [])
    expect(await preview.ready()).toBeUndefined()
    const events = new EventRecorder()
    await events.open(preview.base)
    const config = readFileSync(join(dir, 'partom.config.ts'), 'utf8')
    const panel = readFileSync(join(dir, 'panel.tsx'), 'utf8')
    try {
      write(dir, 'partom.config.ts', config.replace('fixturePlugin, appPlugin', 'appPlugin'))
      expect(await until(() => events.named('reload').length === 1, 8000)).toBe(true)
      const detail = (await (await fetch(`${preview.base}api/blueprints/shell`)).json()) as {
        issues: { rule: string }[]
      }
      expect(detail.issues.map((issue) => issue.rule)).toContain('catalog.id-exists')
      write(dir, 'partom.config.ts', config)
      expect(await until(() => events.named('reload').length === 2, 8000)).toBe(true)

      write(dir, 'panel.tsx', `${panel}\nexport const broken = (\n`)
      expect(await until(() => events.named('build-error').length === 1, 8000)).toBe(true)
      expect(events.named('reload')).toHaveLength(2)
      write(dir, 'panel.tsx', panel)
      expect(await until(() => events.named('reload').length === 3, 8000)).toBe(true)

      mkdirSync(join(dir, 'node_modules'), { recursive: true })
      write(dir, 'node_modules/touched.txt', 'x')
      await sleep(1500)
      expect(events.events).toHaveLength(4)

      const live = (await (await fetch(`${preview.base}api/blueprints`)).json()) as {
        generation: number
      }
      expect(partomSync(['doctor', '--rendered']).code).toBe(0)
      expect(await status(`${preview.base}assets/${live.generation}/entry.js`)).toBe(200)
    } finally {
      write(dir, 'partom.config.ts', config)
      write(dir, 'panel.tsx', panel)
      events.close()
      await preview.stop()
    }
  })
})

describe('partom preview issue overlay', () => {
  it('skips mounting on static errors and highlights warnings', async () => {
    write(
      dir,
      'bad.blueprint.json',
      JSON.stringify({
        id: 'bad',
        version: 1,
        root: {
          tag: 'page@1',
          id: 'p',
          children: [{ tag: 'trigger@1', id: 't', facets: { attrs: { tabindex: 3 } } }]
        }
      })
    )
    write(
      dir,
      'warn.blueprint.json',
      JSON.stringify({
        id: 'warn',
        version: 1,
        root: {
          tag: 'single@1',
          id: 'warn',
          facets: {
            slots: {
              content: [
                {
                  tag: 'panel@1',
                  id: 'panel',
                  facets: {
                    props: { label: 'Panel' },
                    events: { 'app:expand': { handler: 'noop@1', modifiers: ['prevent@1'] } }
                  }
                }
              ]
            }
          }
        }
      })
    )
    const preview = new PreviewProcess(dir, [])
    expect(await preview.ready()).toBeUndefined()
    const page = await browser.newPage()
    try {
      await page.goto(`${preview.base}b/bad`)
      const overlay = page.locator('partom-overlay')
      await overlay.waitFor()
      expect(await overlay.locator('button').allTextContents()).toEqual([
        expect.stringContaining('behavior.tabindex')
      ])
      expect(await overlay.locator('section').textContent()).toContain('static errors')
      expect(await page.locator('#partom-root').innerHTML()).toBe('')

      await page.goto(`${preview.base}b/warn`)
      await page.locator('[data-part-address="warn/slot.content/panel"]').waitFor()
      const issue = page.locator('partom-overlay button')
      expect(await issue.allTextContents()).toEqual([
        expect.stringContaining('event.prevent-cancelable')
      ])
      await issue.click()
      expect(
        await page
          .locator('[data-part-address="warn/slot.content/panel"]')
          .getAttribute('data-partom-highlight')
      ).toBe('')

      await page.reload()
      await page.locator('[data-part-address="warn/slot.content/panel"]').waitFor()
      await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() => document.activeElement?.hasAttribute('data-part-skip'))
      ).toBe(true)
      await page.keyboard.press('F6')
      await page.keyboard.press('F6')
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('PARTOM-OVERLAY')
    } finally {
      await page.close()
      await preview.stop()
    }
  })
})
