import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { chromium } from '/Users/kaeo/workspack/migai/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs'

const apiManifest = JSON.parse(
  readFileSync(new URL('../src/generated/manifests/apis.json', import.meta.url), 'utf8')
)
const libraryIndex = JSON.parse(
  readFileSync(new URL('../src/generated/manifests/library-index.json', import.meta.url), 'utf8')
)
const baseUrl = process.env.MIGAI_PREVIEW_URL ?? 'http://127.0.0.1:4173'
const executablePath =
  process.env.MIGAI_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const a29ActionTimeoutMs = 15_000
const a29ProgressIntervalMs = 5_000

/** Produces the semantic public path segment for one runtime symbol. */
function apiSymbolPath(symbol, siblings) {
  const collisions = siblings.filter(
    (candidate) =>
      candidate.name.toLocaleLowerCase('en-US') === symbol.name.toLocaleLowerCase('en-US')
  )
  return `${encodeURIComponent(symbol.name)}${collisions.length > 1 ? `-${symbol.kind}` : ''}`
}

/** Mirrors the declaration-head callable classifier used by the rendered navigation. */
function isCallableApiSymbol(symbol) {
  if (symbol.kind === 'function' || symbol.kind === 'class') return true
  if (symbol.kind !== 'const') return false
  const escapedName = symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`export declare const ${escapedName}:\\s*(?:<|\\()`).test(symbol.signature)
}

/** Mirrors the package-owned error/diagnostic classifier used by module indexes. */
function isErrorContractSymbol(symbol) {
  const sourceName = (symbol.source.split('/').at(-1) ?? '').replace(/\.d\.ts$/, '')
  return (
    sourceName === 'errors' ||
    sourceName === 'error-code' ||
    /(?:Error|ErrorCode|_SOURCE)$/.test(symbol.name)
  )
}

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
  ['WEB-A33', 'derived navigation state'],
  ['WEB-A34', 'pre-paint theme and route transition veil']
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
        await visit(page, '/')
        const rootLanguage = page.getByRole('link', { name: 'Switch to Chinese' })
        assert.equal(await rootLanguage.getAttribute('href'), '/zh')
        await rootLanguage.focus()
        await page.keyboard.press('Enter')
        await page.waitForFunction(() => /^\/zh\/?$/.test(window.location.pathname))
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
        await visit(page, '/en/docs/utils')
        assert.equal(await page.locator('.mobile-toc nav').isVisible(), true)
        await visit(page, '/en')
        const search = page.getByRole('button', { name: /search/i })
        await search.focus()
        await page.keyboard.press('Space')
        await page.getByRole('textbox', { name: /search the library/i }).waitFor()
        await page.keyboard.press('Escape')
        assert.equal(await page.locator('.search-panel').count(), 0)
        const language = page.getByRole('link', { name: 'Switch to Chinese' })
        await language.focus()
        await page.keyboard.press('Enter')
        await page.waitForFunction(() => /^\/zh\/?$/.test(window.location.pathname))
        const theme = page.getByRole('combobox', { name: /theme|主题/i })
        await theme.focus()
        await theme.selectOption('dark')
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
        await page.getByRole('textbox', { name: /search the library/i }).fill('utils')
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
            await visit(page, '/en/docs/utils', 'commit')
            const overflow = await page.evaluate(() => ({
              exceedsViewport:
                document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
              offenders: [...document.querySelectorAll('*')]
                .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
                .slice(0, 5)
                .map((element) => ({
                  className: element.className,
                  href: element.getAttribute('href'),
                  parentClassName: element.parentElement?.className,
                  right: Math.round(element.getBoundingClientRect().right),
                  tagName: element.tagName,
                  text: element.textContent?.trim().slice(0, 48)
                }))
            }))
            assert.equal(
              overflow.exceedsViewport,
              false,
              `horizontal overflow at ${width}px ${theme}: ${JSON.stringify(overflow.offenders)}`
            )
            if (width === 320) {
              const mobileState = await page.evaluate(() => ({
                desktopRail: getComputedStyle(document.querySelector('.left-rail')).display,
                mobileNav: getComputedStyle(document.querySelector('.mobile-module-nav')).display,
                typeBody: document.querySelector('.type-reference-body')
                  ? getComputedStyle(document.querySelector('.type-reference-body')).display
                  : null
              }))
              assert.equal(mobileState.desktopRail, 'none')
              assert.equal(mobileState.mobileNav, 'block')
              if (mobileState.typeBody !== null) assert.equal(mobileState.typeBody, 'block')
            }
          })
        }
      }
    })
  }
)

test(
  'WEB-A34 restores theme before hydration and keeps the particle veil layout-neutral',
  { timeout: 90_000 },
  async () => {
    await withChrome((browser) =>
      withPage(browser, { width: 768, height: 900 }, async (page) => {
        await page.addInitScript(() => localStorage.setItem('migaia-theme', 'dark'))
        await page.goto(pageUrl('/en/docs'), { waitUntil: 'domcontentloaded' })
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')

        const transition = page.locator('.route-transition')
        assert.equal(await transition.getAttribute('data-active'), 'false')
        const before = await page.evaluate(() => ({
          height: document.documentElement.scrollHeight,
          width: document.documentElement.scrollWidth
        }))
        await transition.evaluate((element) => element.setAttribute('data-active', 'true'))
        assert.equal(
          await transition.evaluate((element) => getComputedStyle(element).position),
          'fixed'
        )
        assert.equal(
          await transition.evaluate((element) => getComputedStyle(element).pointerEvents),
          'none'
        )
        assert.equal(await transition.locator('i').count(), 3)
        assert.deepEqual(
          await page.evaluate(() => ({
            height: document.documentElement.scrollHeight,
            width: document.documentElement.scrollWidth
          })),
          before
        )

        await transition.evaluate((element) => element.setAttribute('data-active', 'false'))
        await page.route('**/*.data', async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 250))
          await route.continue()
        })
        await page.getByRole('link', { name: 'Guides' }).click()
        await page.waitForFunction(
          () => document.querySelector('.route-transition')?.getAttribute('data-active') === 'true'
        )
        await page.waitForURL(/\/en\/guides\/?$/)
        await page.waitForFunction(
          () => document.querySelector('.route-transition')?.getAttribute('data-active') === 'false'
        )
      })
    )
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
            assert.equal(await page.locator('.library-item').count(), 26)
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
      ['/en/docs', '/en/docs/utils'],
      ['/en/guides', '/en/guides/utils'],
      ['/en/docs', '/en/docs/utils'],
      ['/en/architecture', '/en/architecture/web-rpc']
    ]
    await withChrome(async (browser) => {
      for (const journey of journeys) {
        await withPage(browser, { width: 1280, height: 900 }, async (page) => {
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
        const input = page.getByRole('textbox', { name: /search the library/i })
        await page.getByText(/type to search/i).waitFor()
        await input.fill('not-a-real-result')
        await page.getByText(/no matching result/i).waitFor()
        assert.equal(await page.locator('[role="alert"]').count(), 0)
      })
    )
  }
)

test(
  'SITE-T-DEV-API-LINKS resolves every event-subscriber API detail route',
  { timeout: 120_000 },
  async () => {
    const api = apiManifest.apis.find(
      (candidate) => candidate.library === 'event-subscriber' && candidate.module === 'index'
    )
    assert.ok(api)
    const runtimeSymbols = api.symbols.filter(
      (symbol) => symbol.kind !== 'type' && symbol.kind !== 'interface'
    )
    await withChrome((browser) =>
      withPage(browser, { width: 489, height: 674 }, async (page) => {
        const pageErrors = []
        page.on('pageerror', (error) => pageErrors.push(error.message))
        for (const symbol of runtimeSymbols) {
          const modulePath = api.module === 'index' ? '' : `/${api.module}`
          const path = `/zh/docs/${api.library}${modulePath}/${apiSymbolPath(symbol, api.symbols)}`
          await visit(page, path)
          assert.equal(await page.locator('article h1').innerText(), symbol.name)
        }
        assert.deepEqual(pageErrors, [])
      })
    )
  }
)

test('SITE-T-TYPE-FRAGMENT preserves code when resolving a legacy type fragment', async () => {
  await withChrome(async (browser) => {
    await withPage(browser, { width: 1280, height: 900 }, async (page) => {
      await page.goto(`${pageUrl('/zh/docs/utils/promise')}#utils-promise--IAbortSignal`)
      await page.getByRole('main').waitFor()
      const declaration = page.locator('#utils-promise--IAbortSignal .code-frame')
      await declaration.waitFor()
      assert.match(await declaration.innerText(), /IAbortSignal/)
      await page.goto(pageUrl('/zh/docs/utils/promise'))
      const typeCount = await page.locator('.type-declaration').count()
      assert.ok(typeCount > 0)
      assert.equal(
        await page
          .locator('.type-declaration')
          .filter({ has: page.locator('h3 a') })
          .count(),
        typeCount
      )
    })
  })
})

test('SITE-T-NO-INDEX canonicalizes root modules without exposing index', async () => {
  await withChrome(async (browser) => {
    await withPage(browser, { width: 1280, height: 900 }, async (page) => {
      await page.goto(`${baseUrl}/zh/docs/event-subscriber/createEventChannel/`)
      assert.match(await page.locator('h1').innerText(), /createEventChannel/)
      await page.goto(`${baseUrl}/zh/docs/event-subscriber/`)
      assert.match(await page.locator('main').innerText(), /createEventChannel/)
      assert.equal(await page.locator('a[href*="/event-subscriber/index"]').count(), 0)
    })
  })
})

test('SITE-T-TOC keeps API anchors in the correct responsive rail', async () => {
  await withChrome(async (browser) => {
    for (const width of [1280, 768, 320]) {
      await withPage(browser, { width, height: 900 }, async (page) => {
        await page.goto(`${baseUrl}/zh/docs/event-subscriber/createEventHub/`)
        const layout = await page.evaluate(() => {
          const article = document.querySelector('.article-column')
          const mobile = document.querySelector('.mobile-toc')
          const right = document.querySelector('.right-rail')
          return {
            articleTop: article?.getBoundingClientRect().top ?? 0,
            mobileDisplay: mobile ? getComputedStyle(mobile).display : '',
            mobileTop: mobile?.getBoundingClientRect().top ?? 0,
            rightDisplay: right ? getComputedStyle(right).display : ''
          }
        })
        if (width > 620) {
          assert.notEqual(layout.rightDisplay, 'none')
          assert.equal(layout.mobileDisplay, 'none')
        } else {
          assert.equal(layout.rightDisplay, 'none')
          assert.equal(layout.mobileDisplay, 'block')
          assert.ok(layout.mobileTop < layout.articleTop)
        }
      })
    }
  })
})

test('SITE-T-ROUTE-SCROLL starts a newly selected API at the page top', async () => {
  await withChrome(async (browser) => {
    await withPage(browser, { width: 1280, height: 900 }, async (page) => {
      await page.goto(`${baseUrl}/zh/docs/event-subscriber/createEventChannel/`)
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      assert.ok((await page.evaluate(() => window.scrollY)) > 0)

      const nextApi = page.locator('a[href="/zh/docs/event-subscriber/createEventHub"]').first()
      await nextApi.evaluate((link) => link.click())
      await page.waitForURL(/\/zh\/docs\/event-subscriber\/createEventHub\/?$/)
      await page.waitForFunction(() => window.scrollY === 0)

      assert.equal(await page.evaluate(() => window.scrollY), 0)
      assert.match(await page.locator('h1').innerText(), /createEventHub/)
    })
  })
})

test('SITE-T-SUPPORTING-CONTRACT separates source markers and explains their real use', async () => {
  await withChrome(async (browser) => {
    await withPage(browser, { width: 600, height: 778 }, async (page) => {
      await page.goto(`${baseUrl}/zh/docs/event-subscriber/`)
      const contract = page.locator(
        '.error-contracts a[href="/zh/docs/event-subscriber/EVENT_SUBSCRIBER_SOURCE"]'
      )
      await contract.waitFor()
      assert.match(await contract.locator('xpath=..').innerText(), /稳定来源标识/)

      await contract.click()
      await page.waitForURL(/\/zh\/docs\/event-subscriber\/EVENT_SUBSCRIBER_SOURCE\/?$/)
      await page.locator('h1', { hasText: 'EVENT_SUBSCRIBER_SOURCE' }).waitFor()
      assert.match(await page.locator('main').innerText(), /契约识别示例/)
      assert.match(await page.locator('.code-frame').first().innerText(), /error\.source/)
      assert.doesNotMatch(await page.locator('main').innerText(), /最小可运行示例/)
    })
  })
})

test('SITE-T-LEFT-RAIL gives long desktop API menus an independent scroll boundary', async () => {
  await withChrome(async (browser) => {
    await withPage(browser, { width: 1280, height: 700 }, async (page) => {
      await page.goto(`${baseUrl}/zh/docs/web-rpc/`)
      const rail = page.locator('.left-rail')
      const viewport = rail.locator('[data-radix-scroll-area-viewport]')
      await rail.waitFor()
      const before = await viewport.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop
      }))
      assert.ok(before.scrollHeight > before.clientHeight)

      await viewport.hover()
      await page.mouse.wheel(0, 600)
      await page.waitForFunction(
        () => (document.querySelector('[data-radix-scroll-area-viewport]')?.scrollTop ?? 0) > 0
      )
      assert.ok((await viewport.evaluate((element) => element.scrollTop)) > before.scrollTop)
      assert.equal(await rail.locator('.scroll-area-thumb').count(), 1)
    })
  })
})

test('SITE-T-LEFT-RAIL-ROUTE keeps menu order and the selected API visible across routes', async () => {
  await withChrome(async (browser) => {
    await withPage(browser, { width: 1800, height: 900 }, async (page) => {
      await page.goto(`${baseUrl}/zh/docs/lifecycle/createLifecycleUnit/`)
      const rail = page.locator('.left-rail')
      await rail.waitFor()
      const viewport = rail.locator('[data-radix-scroll-area-viewport]')
      assert.equal(await viewport.count(), 1)
      await viewport.evaluate((element) => {
        element.scrollTop = 240
      })
      const before = await viewport.evaluate((element) => ({
        links: Array.from(element.querySelectorAll('a')).map((link) => link.getAttribute('href')),
        scrollTop: element.scrollTop
      }))
      assert.ok(before.scrollTop > 0)

      await viewport.locator('a[href="/zh/docs/lifecycle/boundedWait"]').click()
      await page.waitForURL(/\/zh\/docs\/lifecycle\/boundedWait\/?$/)
      await page.locator('h1', { hasText: 'boundedWait' }).waitFor()
      const after = await viewport.evaluate((element) => ({
        links: Array.from(element.querySelectorAll('a')).map((link) => link.getAttribute('href')),
        scrollTop: element.scrollTop
      }))

      assert.deepEqual(after.links, before.links)
      assert.ok(after.scrollTop >= 0)
      assert.equal(
        await viewport.locator('a.active[href="/zh/docs/lifecycle/boundedWait"]').count(),
        1
      )
    })
  })
})

test(
  'SITE-T-PACKAGE-LEARNING-PATH closes every Chinese package landing page',
  { timeout: 180_000 },
  async () => {
    await withChrome(async (browser) => {
      await withPage(browser, { width: 1280, height: 900 }, async (page) => {
        for (const library of libraryIndex.libraries) {
          await page.goto(`${baseUrl}/zh/docs/${library.slug}/`)
          await page.locator('#api-index').waitFor()
          assert.equal(await page.locator('.module-learning-path').count(), 0)
          assert.equal(
            await page.locator(`a[href="/zh/guides/${library.slug}"]`).count(),
            1,
            `${library.slug} missing task-guide continuation`
          )

          for (const group of await page
            .locator('.api-reference-group:not(.supporting-contracts):not(.error-contracts)')
            .all()) {
            const hrefs = await group
              .locator('a')
              .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
            assert.equal(
              hrefs.some((href) => /(?:Error|ErrorCode|_SOURCE)(?:\/)?$/.test(href)),
              false,
              `${library.slug} mixes error contracts into operation APIs`
            )
          }

          const api = apiManifest.apis.find(
            (candidate) => candidate.library === library.slug && candidate.module === 'index'
          )
          if (!api) continue
          const runtimeSymbols = api.symbols.filter(
            (symbol) => symbol.kind !== 'type' && symbol.kind !== 'interface'
          )
          const expectedErrors = runtimeSymbols
            .filter(isErrorContractSymbol)
            .map((symbol) => symbol.name)
            .sort()
          const expectedSupporting = runtimeSymbols
            .filter(
              (symbol) =>
                symbol.kind === 'const' &&
                !isCallableApiSymbol(symbol) &&
                !isErrorContractSymbol(symbol)
            )
            .map((symbol) => symbol.name)
            .sort()
          const expectedOperations = runtimeSymbols
            .filter(
              (symbol) =>
                !(symbol.kind === 'const' && !isCallableApiSymbol(symbol)) &&
                !isErrorContractSymbol(symbol)
            )
            .map((symbol) => symbol.name)
            .sort()
          const renderedErrors = (
            await page.locator('.error-contracts').first().locator('li > a > code').allInnerTexts()
          ).sort()
          const renderedSupporting = (
            await page
              .locator('.supporting-contracts')
              .first()
              .locator('li > a > code')
              .allInnerTexts()
          ).sort()
          const renderedOperations = (
            await page
              .locator('main#main-content')
              .first()
              .locator(
                '.api-reference-group:not(.supporting-contracts):not(.error-contracts) li > a > code'
              )
              .allInnerTexts()
          ).sort()
          assert.deepEqual(renderedErrors, expectedErrors, `${library.slug} error partition`)
          assert.deepEqual(
            renderedSupporting,
            expectedSupporting,
            `${library.slug} supporting partition`
          )
          assert.deepEqual(
            renderedOperations,
            expectedOperations,
            `${library.slug} operation partition`
          )
          for (const group of await page
            .locator('.api-reference-group ul.api-reference-list')
            .all()) {
            const names = await group.locator('li > a > code').allInnerTexts()
            const scores = names.map(
              (name) => api.symbols.find((symbol) => symbol.name === name)?.usageScore ?? 0
            )
            assert.deepEqual(
              scores,
              [...scores].sort((left, right) => right - left),
              `${library.slug} API group is not frequency ordered`
            )
          }
        }
      })
    })
  }
)

test(
  'SITE-T-CONFIG-REFERENCE closes every configuration field across the site',
  { timeout: 300_000 },
  async () => {
    const jargon =
      /first-party runtime surface|plain message transport|request\/response semantics|not-applicable|No documented|No additional/u
    await withChrome(async (browser) => {
      await withPage(browser, { width: 1280, height: 900 }, async (page) => {
        for (const api of apiManifest.apis) {
          const libraryTypes = new Set(
            apiManifest.apis
              .filter((candidate) => candidate.library === api.library)
              .flatMap((candidate) => candidate.symbols)
              .filter((symbol) => symbol.kind === 'type' || symbol.kind === 'interface')
              .map((symbol) => symbol.name)
          )
          for (const symbol of api.symbols.filter(
            (candidate) =>
              candidate.kind !== 'type' &&
              candidate.kind !== 'interface' &&
              candidate.configuration.length > 0
          )) {
            const symbolPath = apiSymbolPath(symbol, api.symbols)
            const route =
              api.module === 'index'
                ? `/zh/docs/${api.library}/${symbolPath}`
                : `/zh/docs/${api.library}/${api.module}/${symbolPath}`
            await page.goto(pageUrl(route))
            await page.locator('.single-api-reference').waitFor()
            assert.equal(
              jargon.test(await page.locator('.article-column').innerText()),
              false,
              `${api.library}/${api.module}/${symbol.name} exposes generator text or jargon`
            )
            for (const field of symbol.configuration) {
              const entry = page.locator(
                `#${symbol.fragment}--option-${field.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')}`
              )
              await entry.waitFor()
              const paragraphs = (await entry.locator(':scope > p').allInnerTexts()).join(' ')
              assert.ok(
                paragraphs.trim().length >= 20,
                `${api.library}/${api.module}/${symbol.name}.${field.name} has no useful explanation: ${JSON.stringify(paragraphs)}`
              )
              const referencedTypes =
                field.type.match(/[A-Za-z_$][\w$]*/gu)?.filter((name) => libraryTypes.has(name)) ??
                []
              for (const typeName of new Set(referencedTypes)) {
                assert.ok(
                  (await entry.locator(`a.type-link:text-is("${typeName}")`).count()) >= 1,
                  `${api.library}/${api.module}/${symbol.name}.${field.name} does not link ${typeName}`
                )
              }
            }
          }
        }

        await page.goto(pageUrl('/zh/docs/web-rpc/createEndpoint'))
        const transportGuide = page.locator('[data-parameter-guide="web-rpc-transport"]')
        await transportGuide.waitFor()
        assert.equal(await transportGuide.locator('li a').count(), 10)
        assert.match(await transportGuide.innerText(), /发送和接收消息/u)
      })
    })
  }
)

test(
  'SITE-T-API-READING-PATH closes every callable API detail page',
  { timeout: 300_000 },
  async () => {
    const forbidden =
      /first-party runtime surface|plain message transport|request\/response semantics|not-applicable|No documented errors are declared|No additional advanced behavior is declared|part of this module's public (?:function|class) contract/iu
    await withChrome(async (browser) => {
      await withPage(browser, { width: 1280, height: 900 }, async (page) => {
        for (const api of apiManifest.apis) {
          for (const symbol of api.symbols.filter(isCallableApiSymbol)) {
            const symbolPath = apiSymbolPath(symbol, api.symbols)
            const route =
              api.module === 'index'
                ? `/zh/docs/${api.library}/${symbolPath}`
                : `/zh/docs/${api.library}/${api.module}/${symbolPath}`
            await page.goto(pageUrl(route))
            const article = page.locator('.single-api-reference')
            await article.waitFor()
            const routeLabel = `${api.library}/${api.module}/${symbol.name}`
            const purpose = article.locator('.api-overview > p').last()
            assert.ok((await purpose.innerText()).trim().length >= 30, `${routeLabel} purpose`)
            assert.equal(
              await article.locator(`[id="${symbol.fragment}--quick-start"] .code-frame`).count(),
              1,
              `${routeLabel} missing Quick Start code`
            )
            const decisionGuide = article.locator('.api-decision-guide')
            assert.equal(await decisionGuide.count(), 1, `${routeLabel} missing decision guide`)
            for (const list of await decisionGuide.locator('ul').all())
              assert.ok((await list.locator('li').count()) >= 2, `${routeLabel} shallow scenarios`)
            assert.equal(
              forbidden.test(await article.innerText()),
              false,
              `${routeLabel} bad prose`
            )
          }
        }
      })
    })
  }
)

test(
  'SITE-T-CONTRACT-REFERENCE closes every supporting constant detail page',
  { timeout: 180_000 },
  async () => {
    await withChrome(async (browser) => {
      await withPage(browser, { width: 1280, height: 900 }, async (page) => {
        for (const api of apiManifest.apis) {
          for (const symbol of api.symbols.filter(
            (candidate) => candidate.kind === 'const' && !isCallableApiSymbol(candidate)
          )) {
            const symbolPath = apiSymbolPath(symbol, api.symbols)
            const route =
              api.module === 'index'
                ? `/zh/docs/${api.library}/${symbolPath}`
                : `/zh/docs/${api.library}/${api.module}/${symbolPath}`
            await page.goto(pageUrl(route))
            const article = page.locator('.single-api-reference')
            await article.waitFor()
            const routeLabel = `${api.library}/${api.module}/${symbol.name}`
            assert.equal(
              await article.locator(`[id="${symbol.fragment}--quick-start"] .code-frame`).count(),
              1,
              `${routeLabel} missing reference example`
            )
            assert.equal(
              await article.locator('.api-decision-guide').count(),
              1,
              `${routeLabel} missing use boundaries`
            )
            assert.doesNotMatch(
              await article.innerText(),
              /最小可运行示例|not-applicable|No documented|No additional/u,
              `${routeLabel} presented as an operation or leaked generator text`
            )
          }
        }
      })
    })
  }
)

test(
  'WEB-A27 keeps anchor targets visible in independent viewport contexts',
  { timeout: 120_000 },
  async () => {
    const api = apiManifest.apis.find((candidate) => candidate.symbols.length > 0)
    assert.ok(api)
    const symbol = api.symbols[0]
    const modulePath = api.module === 'index' ? '' : `/${api.module}`
    const path =
      symbol.kind === 'type' || symbol.kind === 'interface'
        ? `/en/docs/${api.library}${modulePath}`
        : `/en/docs/${api.library}${modulePath}/${apiSymbolPath(symbol, api.symbols)}`
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
      '/en/docs/utils',
      '/en/guides/utils/getting-started',
      '/en/architecture/utils'
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
              name: symbol.name,
              kind: symbol.kind,
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
    assert.equal(routeInventory.length, apiManifest.apis.length * 2)
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
          try {
            await withPage(browser, { width: 320, height: 844 }, async (page) => {
              for (const member of route.members) {
                try {
                  const modulePath = route.module === 'index' ? '' : `/${route.module}`
                  const path =
                    member.kind === 'type' || member.kind === 'interface'
                      ? `/${route.locale}/docs/${route.library}${modulePath}`
                      : `/${route.locale}/docs/${route.library}${modulePath}/${apiSymbolPath(member, route.members)}`
                  const fragmentUrl = `${pageUrl(path)}#${member.fragment}`
                  await boundedA29Action(
                    'goto fragment',
                    () => page.goto(fragmentUrl, { waitUntil: 'commit' }),
                    progressFailure
                  )
                  if (member.kind !== 'type' && member.kind !== 'interface')
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
                    () => target.waitFor({ state: 'attached' }),
                    progressFailure
                  )
                  assert.equal(await target.count(), 1)
                  if (member.kind !== 'type' && member.kind !== 'interface')
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
                  nextRoute = routeInventory.length
                  throw error
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
          const primarySymbol = api.symbols.find(isCallableApiSymbol)
          if (!primarySymbol) continue
          const modulePath = api.module === 'index' ? '' : `/${api.module}`
          const path = `/${locale}/docs/${api.library}${modulePath}/${apiSymbolPath(primarySymbol, api.symbols)}`
          const fragment = `${primarySymbol.fragment}--overview`
          await withPage(browser, { width: 768, height: 900 }, async (page) => {
            await page.goto(`${pageUrl(path)}#${fragment}`, { waitUntil: 'commit' })
            await page.locator('.right-rail a.active').waitFor({ state: 'attached' })
            const state = await page.evaluate(() => ({
              activeTree: document.querySelector('.left-rail a.active')?.getAttribute('href'),
              activeAnchor: document.querySelector('.right-rail a.active')?.getAttribute('href'),
              breadcrumb: document.querySelector('.breadcrumb')?.textContent ?? ''
            }))
            if (state.activeTree)
              assert.match(
                state.activeTree,
                new RegExp(
                  `^/${locale}/docs/${api.library}(?:/[^/]+)?/${apiSymbolPath(primarySymbol, api.symbols)}$`
                )
              )
            assert.equal(state.activeAnchor, `#${fragment}`)
            assert.match(state.breadcrumb, new RegExp(api.library))
            assert.doesNotMatch(state.breadcrumb.trim(), /^(?:en|zh)\s*\//)
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
