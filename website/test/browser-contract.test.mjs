import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { chromium } from '/Users/kaeo/workspack/migai/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs'

const apiManifest = JSON.parse(
  readFileSync(new URL('../src/generated/manifests/apis.json', import.meta.url), 'utf8')
)
const baseUrl = process.env.MIGAI_PREVIEW_URL ?? 'http://127.0.0.1:4173'
const executablePath =
  process.env.MIGAI_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const a29ActionTimeoutMs = 15_000
const a29ProgressIntervalMs = 5_000

/** Declarative claim ledger; each row binds one acceptance claim to its exact oracle. */
const browserMatrix = [
  ['WEB-A06', 'keyboard controls and focus'],
  ['WEB-A09', 'lazy Pagefind demand'],
  ['WEB-A11', 'viewport and theme overflow'],
  ['WEB-A15', 'semantic style fixtures'],
  ['WEB-A17', 'four primary journeys'],
  ['WEB-A25', 'search empty states'],
  ['WEB-A27', 'anchor visibility'],
  ['WEB-A28', '72ch reading line'],
  ['WEB-A29', 'immutable fragment inventory'],
  ['WEB-A33', 'derived navigation state']
]

/** Returns a canonical trailing-slash URL for the static preview server. */
function pageUrl(path) {
  return `${baseUrl}${path === '/' ? '/' : `${path}/`}`
}

/** Launches the required stable Google Chrome and closes it after one target. */
async function withChrome(callback) {
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    return await callback(browser)
  } finally {
    await browser.close()
  }
}

/** Creates an isolated browser context/page for one acceptance member. */
async function withPage(browser, viewport, callback) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  try {
    return await callback(page)
  } finally {
    await context.close()
  }
}

/** Visits a static route and waits for its server-rendered main content. */
async function visit(page, path, waitUntil = 'domcontentloaded') {
  await page.goto(pageUrl(path), { waitUntil })
  if (waitUntil !== 'commit') await page.waitForLoadState('networkidle')
  await page.getByRole('main').waitFor()
}

/** Follows one rendered route link with the keyboard and checks its destination. */
async function followLink(page, href) {
  const link = page.locator(`a[href="${href}"],a[href="${href}/"]:visible`).first()
  await link.waitFor()
  await link.focus()
  await page.keyboard.press('Enter')
  const destination = new URL(href, page.url()).pathname
  await page.waitForFunction((path) => window.location.pathname === path, destination)
  await page.getByRole('main').waitFor()
}

/** Bounds one A29 browser operation and preserves a useful timeout label. */
async function boundedA29Action(label, action, progressFailure) {
  let timeout
  try {
    return await Promise.race([
      action(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`WEB-A29 action timed out: ${label}`)),
          a29ActionTimeoutMs
        )
      }),
      progressFailure
    ])
  } finally {
    clearTimeout(timeout)
  }
}

test(
  'WEB-A06 keyboard controls and focus remain independently operable',
  { timeout: 120_000 },
  async () => {
    await withChrome((browser) =>
      withPage(browser, { width: 320, height: 844 }, async (page) => {
        await visit(page, '/en')
        await page.keyboard.press('Tab')
        assert.equal(
          await page.locator('a.skip-link').evaluate((link) => document.activeElement === link),
          true
        )
        const menu = page.getByRole('button', { name: 'Menu' })
        await menu.focus()
        await page.keyboard.press('Space')
        assert.equal(await page.locator('#mobile-navigation').getAttribute('open'), '')
        await page.locator('#mobile-navigation').getByRole('button', { name: 'Close' }).focus()
        await page.keyboard.press('Escape')
        assert.equal(await page.locator('#mobile-navigation').count(), 0)
        await menu.focus()
        await page.keyboard.press('Enter')
        const mobileDocs = page.locator('#mobile-navigation').getByRole('link', { name: 'Docs' })
        await mobileDocs.focus()
        await page.keyboard.press('Enter')
        await page.waitForFunction(() => /^\/en\/docs\/?$/.test(window.location.pathname))
        assert.equal(await page.locator('#mobile-navigation').count(), 0)
        await visit(page, '/en/docs/utils/index')
        await page.locator('.mobile-toc summary').focus()
        await page.keyboard.press('Space')
        assert.equal(await page.locator('.mobile-toc[open]').count(), 1)
        await visit(page, '/en')
        const search = page.getByRole('button', { name: /search/i })
        await search.focus()
        await page.keyboard.press('Space')
        await page.getByRole('textbox', { name: /find a library/i }).waitFor()
        await page.keyboard.press('Escape')
        assert.equal(await page.locator('.search-panel').count(), 0)
        const language = page.getByRole('link', { name: 'Switch to zh' })
        await language.focus()
        await page.keyboard.press('Enter')
        await page.waitForFunction(() => /^\/zh\/?$/.test(window.location.pathname))
        const theme = page.getByRole('button', { name: /toggle theme/i })
        await theme.focus()
        await page.keyboard.press('Space')
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
      })
    )
  }
)

test(
  'WEB-A09 loads Pagefind only after independent search demand',
  { timeout: 90_000 },
  async () => {
    await withChrome((browser) =>
      withPage(browser, { width: 768, height: 900 }, async (page) => {
        await visit(page, '/en')
        const resourceNames = () =>
          page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name))
        assert.equal(
          (await resourceNames()).some((name) => /pagefind/i.test(name)),
          false
        )
        await page.getByRole('button', { name: /search/i }).click()
        await page.getByRole('textbox', { name: /find a library/i }).fill('utils')
        await page.waitForTimeout(250)
        assert.equal(
          (await resourceNames()).some((name) => /pagefind/i.test(name)),
          true
        )
      })
    )
  }
)

test(
  'WEB-A11 has no overflow across independent viewport/theme contexts',
  { timeout: 180_000 },
  async () => {
    await withChrome(async (browser) => {
      for (const width of [320, 768, 1280]) {
        for (const theme of ['light', 'dark']) {
          await withPage(browser, { width, height: width === 320 ? 844 : 900 }, async (page) => {
            await page.addInitScript((value) => {
              document.documentElement.dataset.theme = value
            }, theme)
            await visit(page, '/en/docs/utils/index', 'commit')
            const overflow = await page.evaluate(
              () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
            )
            assert.equal(overflow, false, `horizontal overflow at ${width}px ${theme}`)
          })
        }
      }
    })
  }
)

test(
  'WEB-A15 reproduces semantic style fixtures in independent contexts',
  { timeout: 120_000 },
  async () => {
    await withChrome(async (browser) => {
      for (const width of [320, 768, 1280]) {
        for (const theme of ['light', 'dark']) {
          await withPage(browser, { width, height: width === 320 ? 844 : 900 }, async (page) => {
            await page.addInitScript((value) => {
              document.documentElement.dataset.theme = value
            }, theme)
            await visit(page, '/en/docs')
            assert.equal(await page.locator('.library-item').count(), 27)
            assert.equal(
              await page
                .locator('.library-item')
                .evaluateAll((cards) =>
                  cards.every(
                    (card) => card.tagName === 'A' && card.classList.contains('library-item')
                  )
                ),
              true
            )
            assert.notEqual(
              await page.locator('body').evaluate((body) => getComputedStyle(body).fontFamily),
              ''
            )
          })
        }
      }
    })
  }
)

test(
  'WEB-A17 completes each primary journey in its own context',
  { timeout: 120_000 },
  async () => {
    const journeys = [
      ['/en/docs', '/en/docs/utils', '/en/docs/utils/index'],
      ['/en/guides', '/en/guides/utils', '/en/guides/utils/getting-started'],
      ['/en/docs', '/en/docs/utils', '/en/docs/utils/index'],
      ['/en/architecture', '/en/architecture/web-rpc', '/en/architecture/web-rpc/ownership']
    ]
    await withChrome(async (browser) => {
      for (const journey of journeys) {
        await withPage(browser, { width: 768, height: 900 }, async (page) => {
          await visit(page, '/en')
          for (const href of journey) await followLink(page, href)
          assert.ok((await page.locator('h1').first().innerText()).length > 0)
        })
      }
    })
  }
)

test(
  'WEB-A25 renders empty and unknown search states without errors',
  { timeout: 90_000 },
  async () => {
    await withChrome((browser) =>
      withPage(browser, { width: 768, height: 900 }, async (page) => {
        await visit(page, '/en')
        await page.getByRole('button', { name: /search/i }).click()
        const input = page.getByRole('textbox', { name: /find a library/i })
        await page.getByText(/type to search/i).waitFor()
        await input.fill('not-a-real-result')
        await page.getByText(/no matching result/i).waitFor()
        assert.equal(await page.locator('[role="alert"]').count(), 0)
      })
    )
  }
)

test(
  'WEB-A27 keeps anchor targets visible in independent viewport contexts',
  { timeout: 120_000 },
  async () => {
    const api = apiManifest.apis.find((candidate) => candidate.symbols.length > 0)
    assert.ok(api)
    const symbol = api.symbols[0]
    const path = `/en/docs/${api.library}/${api.module}`
    await withChrome(async (browser) => {
      for (const width of [320, 768, 1280]) {
        await withPage(browser, { width, height: width === 320 ? 844 : 900 }, async (page) => {
          await page.goto(`${pageUrl(path)}#${symbol.fragment}`, { waitUntil: 'commit' })
          await page.locator(`#${symbol.fragment}`).waitFor()
          const target = await page.locator(`#${symbol.fragment}`).evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return { top: rect.top, height: rect.height }
          })
          assert.ok(target.height > 0)
          assert.ok(
            target.top >= -1 && target.top < (width === 320 ? 844 : 900),
            `anchor target hidden at ${width}px`
          )
        })
      }
    })
  }
)

test(
  'WEB-A28 keeps each prose recipe within the 72ch line bound',
  { timeout: 120_000 },
  async () => {
    const routes = [
      '/en',
      '/en/docs',
      '/en/docs/utils/index',
      '/en/guides/utils/getting-started',
      '/en/architecture/utils/ownership'
    ]
    await withChrome(async (browser) => {
      for (const path of routes) {
        await withPage(browser, { width: 1280, height: 900 }, async (page) => {
          await visit(page, path)
          const prose = await page.locator('main p:not(.eyebrow)').evaluateAll((paragraphs) =>
            paragraphs.map((paragraph) => {
              const style = getComputedStyle(paragraph)
              return {
                width: paragraph.getBoundingClientRect().width,
                fontSize: Number.parseFloat(style.fontSize)
              }
            })
          )
          assert.ok(prose.length > 0)
          assert.equal(
            prose.every(({ width, fontSize }) => width <= fontSize * 72 + 1),
            true,
            path
          )
        })
      }
    })
  }
)

test(
  'WEB-A29 checks every immutable fragment inventory member independently',
  { timeout: 300_000 },
  async () => {
    const fragmentInventory = Object.freeze(
      ['en', 'zh'].flatMap((locale) =>
        apiManifest.apis.flatMap((api) =>
          api.symbols.map((symbol) =>
            Object.freeze({
              locale,
              library: api.library,
              module: api.module,
              fragment: symbol.fragment
            })
          )
        )
      )
    )
    const inventoryHash = createHash('sha256')
      .update(JSON.stringify(fragmentInventory))
      .digest('hex')
    assert.equal(inventoryHash.length, 64)
    assert.equal(
      fragmentInventory.length,
      apiManifest.apis.reduce((count, api) => count + api.symbols.length, 0) * 2
    )
    const routeMap = new Map(
      ['en', 'zh'].flatMap((locale) =>
        apiManifest.apis.map((api) => {
          const routeKey = `${locale}/${api.library}/${api.module}`
          return [routeKey, { locale, library: api.library, module: api.module, members: [] }]
        })
      )
    )
    for (const member of fragmentInventory) {
      const routeKey = `${member.locale}/${member.library}/${member.module}`
      routeMap.get(routeKey).members.push(member)
    }
    const routeInventory = Object.freeze(
      Array.from(routeMap.values()).map((route) =>
        Object.freeze({ ...route, members: Object.freeze([...route.members]) })
      )
    )
    assert.equal(routeInventory.length, 212)
    assert.equal(
      routeInventory.reduce((count, route) => count + route.members.length, 0),
      fragmentInventory.length
    )
    await withChrome(async (browser) => {
      let nextRoute = 0
      const failures = []
      const progress = {
        completedRoutes: 0,
        completedMembers: 0,
        failures: 0,
        elapsedMs: 0
      }
      const startedAt = Date.now()
      let lastLedgerAt = startedAt
      let activeRoutes = 0
      let rejectProgressFailure
      const progressFailure = new Promise((_, reject) => {
        rejectProgressFailure = reject
      })
      const reportProgress = (event) => {
        progress.elapsedMs = Date.now() - startedAt
        lastLedgerAt = Date.now()
        console.log(`[WEB-A29] ${JSON.stringify({ event, ...progress })}`)
      }
      const heartbeat = setInterval(() => {
        if (activeRoutes > 0) {
          if (Date.now() - lastLedgerAt >= a29ProgressIntervalMs * 2) {
            rejectProgressFailure(
              new Error('WEB-A29 progress ledger missed its 10-second interval')
            )
          } else {
            reportProgress('heartbeat')
          }
        }
      }, a29ProgressIntervalMs)
      const worker = async () => {
        while (nextRoute < routeInventory.length) {
          const route = routeInventory[nextRoute]
          nextRoute += 1
          activeRoutes += 1
          const path = `/${route.locale}/docs/${route.library}/${route.module}`
          try {
            await withPage(browser, { width: 320, height: 844 }, async (page) => {
              for (const member of route.members) {
                try {
                  const fragmentUrl = `${pageUrl(path)}#${member.fragment}`
                  await boundedA29Action(
                    'goto fragment',
                    () => page.goto(fragmentUrl, { waitUntil: 'commit' }),
                    progressFailure
                  )
                  await boundedA29Action(
                    'wait for fragment hash',
                    () =>
                      page.waitForFunction(
                        (hash) => window.location.hash === hash,
                        `#${member.fragment}`
                      ),
                    progressFailure
                  )
                  const target = page.locator(`[id="${member.fragment}"]`)
                  await boundedA29Action(
                    'wait for fragment target',
                    () => target.waitFor(),
                    progressFailure
                  )
                  assert.equal(await target.count(), 1)
                  await boundedA29Action(
                    'reload fragment',
                    () => page.reload({ waitUntil: 'commit' }),
                    progressFailure
                  )
                  await boundedA29Action(
                    'wait after reload',
                    () => target.waitFor(),
                    progressFailure
                  )
                  assert.equal(new URL(page.url()).hash, `#${member.fragment}`)
                  await boundedA29Action(
                    'replace fragment history',
                    () =>
                      page.evaluate((hash) => {
                        window.history.replaceState({}, '', window.location.pathname)
                        window.location.hash = hash
                      }, `#${member.fragment}`),
                    progressFailure
                  )
                  await boundedA29Action(
                    'wait after fragment history',
                    () =>
                      page.waitForFunction(
                        (hash) => window.location.hash === hash,
                        `#${member.fragment}`
                      ),
                    progressFailure
                  )
                  await boundedA29Action(
                    'fragment back navigation',
                    () => page.goBack({ waitUntil: 'commit' }),
                    progressFailure
                  )
                  assert.equal(new URL(page.url()).hash, '')
                  await boundedA29Action(
                    'fragment forward navigation',
                    () => page.goForward({ waitUntil: 'commit' }),
                    progressFailure
                  )
                  await boundedA29Action(
                    'wait after fragment forward',
                    () =>
                      page.waitForFunction(
                        (hash) => window.location.hash === hash,
                        `#${member.fragment}`
                      ),
                    progressFailure
                  )
                  assert.equal(new URL(page.url()).hash, `#${member.fragment}`)
                  progress.completedMembers += 1
                  reportProgress('member')
                } catch (error) {
                  failures.push({
                    locale: route.locale,
                    library: route.library,
                    module: route.module,
                    fragment: member.fragment,
                    message: error instanceof Error ? error.message : String(error)
                  })
                  progress.failures = failures.length
                  reportProgress('member-failure')
                }
              }
            })
          } catch (error) {
            failures.push({
              locale: route.locale,
              library: route.library,
              module: route.module,
              fragment: '<route-context>',
              message: error instanceof Error ? error.message : String(error)
            })
            progress.failures = failures.length
            reportProgress('route-failure')
          } finally {
            activeRoutes -= 1
            progress.completedRoutes += 1
            progress.failures = failures.length
            reportProgress('route')
          }
        }
      }
      try {
        await Promise.all(Array.from({ length: 8 }, () => worker()))
      } finally {
        clearInterval(heartbeat)
      }
      assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 10)))
    })
  }
)

test(
  'WEB-A33 derives consistent navigation state per independent route position',
  { timeout: 120_000 },
  async () => {
    await withChrome(async (browser) => {
      for (const locale of ['en', 'zh']) {
        for (const api of apiManifest.apis.filter((candidate) => candidate.symbols.length > 0)) {
          const path = `/${locale}/docs/${api.library}/${api.module}`
          const fragment = `${api.symbols[0].fragment}--advanced-usage`
          await withPage(browser, { width: 768, height: 900 }, async (page) => {
            await page.goto(`${pageUrl(path)}#${fragment}`, { waitUntil: 'commit' })
            await page.locator('.right-rail a.active').waitFor({ state: 'attached' })
            const state = await page.evaluate(() => ({
              activeTree: document.querySelector('.left-rail a.active')?.getAttribute('href'),
              activeAnchor: document.querySelector('.right-rail a.active')?.getAttribute('href'),
              breadcrumb: document.querySelector('.breadcrumb')?.textContent ?? ''
            }))
            assert.equal(state.activeTree, path)
            assert.equal(state.activeAnchor, `#${fragment}`)
            assert.match(state.breadcrumb, new RegExp(api.library))
          })
        }
      }
    })
  }
)

test('WEB-SUC-PKT-BROWSER keeps the ten-target claim ledger closed', () => {
  assert.deepEqual(
    browserMatrix.map(([acceptanceId]) => acceptanceId),
    [
      'WEB-A06',
      'WEB-A09',
      'WEB-A11',
      'WEB-A15',
      'WEB-A17',
      'WEB-A25',
      'WEB-A27',
      'WEB-A28',
      'WEB-A29',
      'WEB-A33'
    ]
  )
})
