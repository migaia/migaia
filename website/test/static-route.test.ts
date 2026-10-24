import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyFor } from '../app/copy.js'
import { findGuideJourney, listGuideJourneys } from '../app/guide-journeys.js'
import { LIBRARY_INDEX } from '../app/library-descriptions.js'
import { findApiGuide } from '../app/api-guides.js'

const websiteRoot = fileURLToPath(new URL('../', import.meta.url))
const buildRoot = join(websiteRoot, 'build/client')
const routeConfig = readFileSync(join(websiteRoot, 'react-router.config.ts'), 'utf8')
const rootSource = readFileSync(join(websiteRoot, 'app/root.tsx'), 'utf8')
const homeSource = readFileSync(join(websiteRoot, 'app/routes/home.tsx'), 'utf8')
const languageSource = readFileSync(join(websiteRoot, 'app/routes/language.tsx'), 'utf8')
const copySource = readFileSync(join(websiteRoot, 'app/copy.ts'), 'utf8')
const docsSource = readFileSync(join(websiteRoot, 'app/routes/docs.tsx'), 'utf8')
const styleSource = readFileSync(join(websiteRoot, 'app/app.css'), 'utf8')
const guideSource = readFileSync(join(websiteRoot, 'app/guide-journeys.ts'), 'utf8')
const routeManifest = JSON.parse(
  readFileSync(join(websiteRoot, 'src/generated/manifests/routes.json'), 'utf8')
) as {
  readonly entries: readonly { readonly locale: string; readonly path: string }[]
}
const apiManifest = JSON.parse(
  readFileSync(join(websiteRoot, 'src/generated/manifests/apis.json'), 'utf8')
) as {
  readonly apis: readonly {
    readonly library: string
    readonly module: string
    readonly sections: readonly string[]
    readonly symbols: readonly {
      readonly name: string
      readonly fragment: string
      readonly kind: string
      readonly routeSlug?: string
      readonly sections: readonly { readonly id: string; readonly content: string }[]
    }[]
  }[]
}

/** Maps a canonical URL to the React Router static output artifact. */
function artifactPath(path: string): string {
  return path === '/' ? 'index.html' : `${path.slice(1)}/index.html`
}

/**
 * Retired docs-index URLs and their targets. The docs index merged into the language home on
 * 2026-10-16; these paths stay prerendered only as redirects so old links keep working.
 */
const LEGACY_DOCS_INDEX_REDIRECTS = new Map([
  ['/en/docs', '/en'],
  ['/zh/docs', '/zh']
])

/**
 * Retired `/<locale>/<library>` URLs. They are prerendered only as redirects to the library page
 * under `/<locale>/docs`, so they carry no page content or description.
 */
const LEGACY_LIBRARY_REDIRECT_PATHS = ['en', 'zh'].flatMap((locale) =>
  LIBRARY_INDEX.map((entry) => `/${locale}/${entry.slug}`)
)

/** True when an emitted HTML file is one of the legacy redirect pages. */
function isLegacyRedirectArtifact(file: string): boolean {
  return [...LEGACY_DOCS_INDEX_REDIRECTS.keys(), ...LEGACY_LIBRARY_REDIRECT_PATHS].some((path) =>
    file.endsWith(`/${artifactPath(path)}`)
  )
}

/** Builds the public module URL while hiding the repository root export name. */
function publicModulePath(locale: string, library: string, moduleName: string): string {
  return `/${locale}/docs/${library}/api${moduleName === 'index' ? '' : `/${moduleName}`}`
}

/** Reduces prerendered markup to reader-visible text so syntax spans do not affect assertions. */
function renderedText(html: string): string {
  return html
    .replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

/** Collects prose sentences while excluding code, navigation, headings, and metadata values. */
function mainProseSentences(html: string): readonly string[] {
  /** Main content owns the page prose; header and rails are shared navigation. */
  const main = html.match(/<main(?:\s[^>]*)?>([\s\S]*?)<\/main>/i)?.[1]
  assert.ok(main, 'missing main content')
  /** Block boundaries preserve separate descriptions without losing inline API names. */
  const prose = main
    .replace(/<dl class="option-meta[^"]*"[^>]*>[\s\S]*?<\/dl>/gi, '')
    .replace(
      /<span class="library-reference-popover"[^>]*><strong>[\s\S]*?<\/strong><span>[\s\S]*?<\/span><b>[\s\S]*?<\/b><\/span>/gi,
      ''
    )
    .replace(/<(pre|figure|nav|aside|script|style|button|h[1-6])(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:dt|th)(?:\s[^>]*)?>[\s\S]*?<\/(?:dt|th)>/gi, '')
    .replace(/<(dd|td)(?:\s[^>]*)?>\s*<code[^>]*>[\s\S]*?<\/code>\s*<\/\1>/gi, '')
    .replace(/<\/?(?:article|blockquote|div|dd|li|p|section|td|tr)(?:\s[^>]*)?>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')

  return renderedText(prose)
    .split('\n')
    .flatMap((block) =>
      block
        .replace(/\s+/gu, ' ')
        .trim()
        .split(/(?<=[。！？])|(?<=[.!?])(?=\s|$)/u)
        .map((sentence) => sentence.trim())
    )
    .filter((sentence) => Array.from(sentence).length >= 12 && /[。！？.!?]$/.test(sentence))
}

/** Extracts the navigation tree while ignoring the route-specific active marker. */
function stableLeftRail(html: string): string {
  const rail = html.match(/<aside class="left-rail-content"[^>]*>([\s\S]*?)<\/aside>/)?.[1]
  assert.ok(rail, 'missing desktop left rail')
  return rail.replace(/ class="(?:active)?"/g, '')
}

/** Produces the semantic public path segment for one runtime symbol. */
function apiSymbolPath(
  symbol: { readonly kind: string; readonly name: string; readonly routeSlug?: string },
  siblings: readonly { readonly kind: string; readonly name: string }[]
): string {
  if (symbol.routeSlug) return symbol.routeSlug
  const collisions = siblings.filter(
    (candidate) =>
      candidate.name.toLocaleLowerCase('en-US') === symbol.name.toLocaleLowerCase('en-US')
  )
  return `${encodeURIComponent(symbol.name)}${collisions.length > 1 ? `-${symbol.kind}` : ''}`
}

/** Recursively returns emitted client files for closed-world output scans. */
function emittedFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? emittedFiles(path) : [path]
  })
}

test('uses the header language control and explains the documentation paths', () => {
  assert.doesNotMatch(homeSource, />\s*English\s*</)
  assert.doesNotMatch(homeSource, />\s*中文\s*</)
  assert.match(homeSource, /API reference/)
  assert.match(homeSource, /Task guides/)
  assert.match(homeSource, /Architecture/)
  assert.match(styleSource, /\.button:not\(\.button-primary\):hover/)
  assert.match(
    styleSource,
    /\.button\.button-primary:hover \{[\s\S]*?background: var\(--accent-strong\);[\s\S]*?color: var\(--accent-contrast\);/
  )
})

// The scenario and combination landing page merged into the docs home on 2026-10-16.
test('serves the docs home at the language root and redirects the old index', () => {
  assert.match(languageSource, /function DocsIndex\(/)
  assert.doesNotMatch(languageSource, /HeroShader|homeScenarios/)
  assert.doesNotMatch(
    copySource,
    /^\s+(?:homeEyebrow|homeTitle|homeScenarios|readQuickstart|traySupervision):/m,
    'retired landing-page copy remains'
  )
  for (const locale of ['en', 'zh'] as const) {
    /** The language root is now the single docs home. */
    const html = readFileSync(join(buildRoot, artifactPath(`/${locale}`)), 'utf8')
    assert.ok(
      renderedText(html).includes(copyFor(locale).domainTitle.docs),
      `/${locale} misses the docs home title`
    )
    assert.match(html, /class="docs-hero-search"/)
    assert.match(html, /class="journey-grid"/)
    assert.match(html, /class="architecture-stack"/)
    for (const library of ['utils', 'lifecycle', 'rpc-host', 'tray'])
      assert.ok(
        html.includes(`href="/${locale}/docs/${library}"`),
        `/${locale} misses ${library} link`
      )
    /** The header no longer carries a separate docs link; this is a docs site. */
    assert.doesNotMatch(html, new RegExp(`href="/${locale}/docs"[^>]*>(?:Docs|文档)</a>`))
    /** The retired index URL is a static redirect back to the language root. */
    const redirect = readFileSync(join(buildRoot, artifactPath(`/${locale}/docs`)), 'utf8')
    assert.match(redirect, new RegExp(`http-equiv="refresh" content="\\d+;url=/${locale}"`))
    assert.match(redirect, /name="robots" content="noindex"/)
  }
})

test('classifies public symbols by developer-facing role', () => {
  for (const label of [
    '根包 API',
    '端点 API',
    '功能插件',
    '中间件插件',
    '协议与数据规范',
    'Hooks 与生命周期',
    '宿主与传输适配器'
  ])
    assert.match(docsSource, new RegExp(label))
  assert.doesNotMatch(docsSource, /核心 API|Core API/)
  assert.match(docsSource, /moduleGroupLabel\(locale, groupName\)/)
  assert.match(docsSource, /runtimeSymbolGroupKey\(symbol\)/)
  assert.doesNotMatch(docsSource, /promotedEntryNames/)
  assert.match(docsSource, /apiLinks\.some\(\(link\) => link\.module === candidate\.module\)/)
  assert.match(
    docsSource,
    /apiLinks[\s\S]*?filter\(\(link\) => link\.module === candidate\.module\)/
  )
  assert.match(docsSource, /featurePluginLinks[\s\S]*link\.module\.startsWith\('features\/'\)/)
  assert.match(docsSource, /featurePluginLinks[\s\S]*link\.name\.endsWith\('Feature'\)/)
  assert.match(docsSource, /featurePluginLinks\.map/)
  for (const feature of [
    'authFeature',
    'chunkFeature',
    'retryFeature',
    'timeoutFeature',
    'typegenFeature'
  ])
    assert.ok(
      apiManifest.apis.some(
        (api) =>
          api.library === 'rpc-host' &&
          api.module === `features/${feature.replace('Feature', '')}` &&
          api.symbols.some((symbol) => symbol.name === feature)
      ),
      feature
    )
  assert.doesNotMatch(docsSource, /candidate === api\s*\? apiLinks/)
})

test('groups APIs by caller task instead of export module', () => {
  for (const label of [
    '存储后端',
    '实体、Schema 与序列化',
    '宿主创建与运行',
    'Feature 定义与拓扑',
    '插件定义与命名',
    'Backend 插件',
    '响应式适配插件',
    '错误与基础契约'
  ])
    assert.match(docsSource, new RegExp(label))
  assert.match(docsSource, /groupStorageWebApiLinks\(apiLinks, locale\)/)
  assert.match(docsSource, /librarySlug !== 'storage-web'\s*&&\s*rootApis\.map/)
  assert.match(docsSource, /librarySlug !== 'storage-web'\s*&&\s*nestedGroups\.map/)
})

test('keeps the expanded API navigation visible below the sticky header', () => {
  assert.match(
    styleSource,
    /\.left-rail-sticky \{[\s\S]*?align-self: start;[\s\S]*?height: calc\(100dvh - var\(--header-height\) - var\(--space-8\)\);[\s\S]*?position: sticky;[\s\S]*?top: calc\(var\(--header-height\) \+ var\(--space-6\)\);/
  )
  for (const locale of ['zh', 'en']) {
    for (const route of [
      'docs/tray',
      'docs/tray/api/createTray',
      'docs/rpc-host/getting-started'
    ]) {
      /** Every rendered reading shell has one desktop category sidebar. */
      const html = readFileSync(join(buildRoot, artifactPath(`/${locale}/${route}`)), 'utf8')
      assert.match(html, /class="left-rail-sticky"[\s\S]*class="left-rail-content"/)
      assert.equal(html.match(/<aside[^>]*class="left-rail-content"/g)?.length, 1)
      assert.ok(stableLeftRail(html).includes(`/${locale}/docs/`))
    }
  }
})

test('presents a purpose, example, option table, related APIs, then collapsed types', () => {
  for (const locale of ['zh', 'en']) {
    /** A maintained callable with configuration exercises the complete reference layout. */
    const html = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/tray/api/createTray`)),
      'utf8'
    )
    /** Section anchors expose the reading order independently of translated headings. */
    const sections = ['overview', 'quick-start', 'configuration', 'related-apis', 'signature']
    /** Every required section must follow its predecessor. */
    let previous = -1
    for (const section of sections) {
      /** Existing fragment suffixes identify the selected API sections. */
      const position = html.indexOf(`--${section}"`)
      assert.ok(position > previous, `${locale} createTray section order: ${section}`)
      previous = position
    }
    /** Configuration reads as one comparison table rather than repeated description cards. */
    const optionTable = html.match(/<table class="option-reference">([\s\S]*?)<\/table>/)?.[1]
    assert.ok(optionTable, `${locale} createTray missing options table`)
    for (const header of locale === 'zh' ? ['名称', '类型', '行为'] : ['Name', 'Type', 'Behavior'])
      assert.match(optionTable, new RegExp(`<th>${header}</th>`))
    assert.doesNotMatch(html, /class="api-decision-guide"|class="api-scenario-examples"/)
  }
})

test('documents contract use across host boundaries', () => {
  for (const scenario of [
    'windowPlugin',
    'dedicatedWorkerPlugin',
    'broadcastChannelPlugin',
    'serviceWorkerPlugin'
  ])
    for (const locale of ['zh', 'en'] as const) {
      const guide = findApiGuide('rpc-plugin-browser', 'index', scenario, locale)
      assert.ok(guide?.quickStart, `${locale} ${scenario}`)
      assert.match(guide.quickStart, /createRpcHost/)
      assert.match(guide.quickStart, /\.request\(|\.notify\(|\.stream\(/)
      assert.match(guide.quickStart, /\.close\(\)/)
    }
})

test('applies real-host examples to every public feature guide', () => {
  for (const feature of ['auth', 'chunk', 'retry', 'timeout', 'typegen'])
    for (const locale of ['zh', 'en'] as const) {
      const guide = findApiGuide('rpc-host', `features/${feature}`, `${feature}Feature`, locale)
      assert.ok(guide?.quickStart, `${locale} ${feature}`)
      assert.match(guide.quickStart, /createRpcHost/)
      assert.match(guide.quickStart, /plugins:/)
      assert.match(guide.quickStart, /finally/)
      assert.match(guide.quickStart, /\.close\(\)/)
    }
})

test('documents connection readiness and call deadlines through their public owners', () => {
  for (const locale of ['zh', 'en'] as const) {
    const transport = findApiGuide('rpc-plugin-process', 'index', 'processPlugin', locale)
    const timeout = findApiGuide('rpc-host', 'features/timeout', 'timeoutFeature', locale)
    assert.match(transport?.quickStart ?? '', /connect:.*timeoutMs:/)
    assert.match(transport?.quickStart ?? '', /await createRpcHost/)
    assert.match(timeout?.quickStart ?? '', /timeoutFeature/)
    assert.match(timeout?.quickStart ?? '', /\.request\(/)
    assert.match(timeout?.quickStart ?? '', /\.close\(\)/)
  }
})

test('emits the admitted nested static route set', () => {
  const routePaths = [
    'index.html',
    'en/index.html',
    'zh/index.html',
    'en/docs/utils/api/index.html'
  ]

  for (const routePath of routePaths) {
    assert.ok(existsSync(join(buildRoot, routePath)), `missing artifact: ${routePath}`)
  }
})

test('keeps repository entry names out of public docs routes', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  assert.ok(routes.has('/zh/docs/event-subscriber'))
  assert.ok(routes.has('/zh/docs/event-subscriber/api/createEventChannel'))
  assert.ok(routes.has('/zh/docs/utils/api/function/assimilateCapturedThen'))
  for (const route of routes) assert.doesNotMatch(route, /^\/(?:en|zh)\/docs\/[^/]+\/index(?:\/|$)/)
  const html = readFileSync(join(buildRoot, 'zh/docs/event-subscriber/api/index.html'), 'utf8')
  assert.match(html, /createEventChannel/)
  assert.doesNotMatch(html, /href=\x22\/zh\/docs\/event-subscriber\/api\/index(?:\/|\x22)/)

  for (const api of apiManifest.apis.filter((candidate) => candidate.module === 'index')) {
    const rootHtml = readFileSync(
      join(buildRoot, artifactPath(publicModulePath('zh', api.library, api.module))),
      'utf8'
    )
    assert.doesNotMatch(rootHtml, />index 模块解决什么问题/)
    assert.doesNotMatch(rootHtml, /<h3>Index<\/h3>/)
    assert.doesNotMatch(rootHtml, /模块与 API[^<]*·[^<]*index/)
  }
})

test('renders only right-rail anchors backed by real page sections', () => {
  const docsArtifacts = emittedFiles(buildRoot).filter(
    (path) => path.endsWith('index.html') && path.includes('/docs/')
  )
  for (const path of docsArtifacts) {
    const html = readFileSync(path, 'utf8')
    const rail = html.match(/<aside class="right-rail"[^>]*>([\s\S]*?)<\/aside>/)?.[1]
    if (!rail) continue
    for (const match of rail.matchAll(/href="#([^"]+)"/g))
      assert.match(html, new RegExp(`id="${match[1]}"`), `${path}: missing #${match[1]}`)
  }

  const libraryRoot = join(buildRoot, 'zh/docs')
  for (const entry of readdirSync(libraryRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(libraryRoot, entry.name, 'index.html')
    if (!existsSync(path)) continue
    const html = readFileSync(path, 'utf8')
    if (!html.includes('id="learning-advanced"')) continue
    const rail = html.match(/<aside class="right-rail"[^>]*>([\s\S]*?)<\/aside>/)?.[1]
    assert.ok(rail, `${entry.name}: missing right rail`)
    assert.match(rail, /href="#learning-advanced"[^>]*>高级用法</, `${entry.name}: advanced link`)
    assert.match(html, /id="learning-advanced"/, `${entry.name}: advanced section`)
    assert.match(html, /高阶用法教程/, `${entry.name}: advanced tutorial heading`)
    assert.match(
      html,
      /id="learning-advanced"[\s\S]*?<figure class="code-frame"/,
      `${entry.name}: advanced tutorial code`
    )
  }
})

test('keeps API links stable, readable, and collision-safe', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  assert.ok(routes.has('/zh/docs/event-subscriber/api/createEventChannel'))
  assert.equal(
    routeManifest.entries.some((entry) => /\/[A-Za-z_$][\w$]*-[a-f0-9]{10}$/.test(entry.path)),
    false
  )
  /** API audit 87ed84be removed lowercase factories, so ObservableArray has no name collision. */
  assert.ok(routes.has('/en/docs/store-indexed/api/ObservableArray'))
  assert.equal(routes.has('/en/docs/store-indexed/api/observableArray-function'), false)
  assert.equal(routes.has('/en/docs/store-indexed/api/ObservableArray-class'), false)
  for (const path of [
    '/en/docs/store-shared/api/sharedInt32Array-const',
    '/en/docs/store-shared/api/SharedInt32Array-class'
  ])
    assert.ok(routes.has(path), `missing semantic collision route: ${path}`)

  const moduleHtml = readFileSync(
    join(buildRoot, 'zh/docs/event-subscriber/api/index.html'),
    'utf8'
  )
  assert.match(moduleHtml, /href="\/zh\/docs\/event-subscriber\/api\/createEventChannel"/)
  assert.doesNotMatch(moduleHtml, /href="[^"]+-[a-f0-9]{10}"/)
})

test('preserves export hierarchy in routes and navigation', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  /** Every nested export must retain its slash-delimited module identity. */
  const nestedApis = apiManifest.apis.filter((api) => api.module.includes('/'))
  assert.ok(nestedApis.length > 0, 'expected nested public modules')
  for (const api of nestedApis) {
    const canonicalPath = publicModulePath('zh', api.library, api.module)
    const flattenedPath = publicModulePath('zh', api.library, api.module.replaceAll('/', '-'))
    assert.ok(routes.has(canonicalPath), `missing nested module route: ${canonicalPath}`)
    assert.equal(routes.has(flattenedPath), false, `redundant flattened route: ${flattenedPath}`)
  }

  /** Current RPC features come from package exports rather than a hard-coded plugin inventory. */
  const webRpcFeatures = nestedApis.filter(
    (api) => api.library === 'rpc-host' && api.module.startsWith('features/')
  )
  assert.ok(webRpcFeatures.length > 0, 'expected RPC feature modules')
  const webRpcFeatureHtml = readFileSync(
    join(buildRoot, artifactPath(publicModulePath('zh', 'rpc-host', webRpcFeatures[0].module))),
    'utf8'
  )
  const featureRail = stableLeftRail(webRpcFeatureHtml)
  assert.match(featureRail, />功能插件</)
  assert.doesNotMatch(featureRail, />features</)
  for (const feature of webRpcFeatures)
    assert.match(
      featureRail,
      new RegExp(`href="${publicModulePath('zh', 'rpc-host', feature.module)}"`)
    )
  assert.doesNotMatch(featureRail, /rpc-host\/features-[^/"]+/)
})

test('keeps every module tree stable across all API routes', () => {
  for (const api of apiManifest.apis) {
    const modulePath = publicModulePath('zh', api.library, api.module)
    const baseline = stableLeftRail(readFileSync(join(buildRoot, artifactPath(modulePath)), 'utf8'))
    for (const symbol of api.symbols) {
      if (symbol.kind === 'type' || symbol.kind === 'interface') continue
      const route = `${modulePath}/${apiSymbolPath(symbol, api.symbols)}`
      const detail = stableLeftRail(readFileSync(join(buildRoot, artifactPath(route)), 'utf8'))
      assert.equal(detail, baseline, `left rail changed on ${route}`)
    }
  }
})

test('keeps Chinese navigation and introductions localized', () => {
  const chineseHome = readFileSync(join(buildRoot, 'zh/index.html'), 'utf8')

  assert.match(chineseHome, /<html[^>]+lang="zh"/)
  assert.match(chineseHome, /找到你需要的 API</)
  assert.match(chineseHome, /你现在想完成什么？/)
  assert.match(chineseHome, /类库索引/)
  assert.doesNotMatch(chineseHome, /href="\/zh\/docs"[^>]*>文档<\/a>/)
  assert.doesNotMatch(chineseHome, /href="\/zh\/(?:guides|architecture)/)
  assert.match(chineseHome, /aria-label="配色: (浅色|深色|跟随系统)"/)
  assert.doesNotMatch(chineseHome, /跟随时间/)
  assert.doesNotMatch(
    chineseHome,
    /Choose the shortest useful path|Make one small result|开始查 Docs|浏览 Guides|用清晰、可组合的 library|沿着真实的 library、module/
  )
  assert.doesNotMatch(chineseHome, /Find the API you need|Library index/)
})

test('uses the canonical Migaia name on every rendered page', () => {
  const home = readFileSync(join(buildRoot, 'en/index.html'), 'utf8')
  assert.match(home, /Migaia library home|>migaia</)
  for (const file of emittedFiles(buildRoot).filter((candidate) => candidate.endsWith('.html'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\bMigai\b/i, `legacy brand name: ${file}`)
  }
})

test('exposes persistent light, dark, and system color modes', () => {
  /** Theme state and persistence now belong to the shared UI owner. */
  const uiStateSource = readFileSync(new URL('../app/ui-state.ts', import.meta.url), 'utf8')
  assert.match(uiStateSource, /type IThemeChoice = 'light' \| 'dark' \| 'system'/)
  assert.match(uiStateSource, /handle = persist\(store, \{/)
  /** The boot script resolves `system` before paint and maps retired time-theme values to it. */
  assert.match(rootSource, /if\(c!=='light'&&c!=='dark'\)c='system'/)
  assert.match(rootSource + uiStateSource, /prefers-color-scheme: dark/)
  assert.match(styleSource, /:root\[data-theme='dark'\] \{/)
  for (const retired of ['sunrise', 'sunset', 'midnight', 'data-time-phase', 'refreshPhase'])
    assert.doesNotMatch(rootSource + styleSource, new RegExp(retired))
})

test('embeds route content before JavaScript', () => {
  const ownerApi = apiManifest.apis.find((api) => api.symbols.length > 0)
  assert.ok(ownerApi)
  const ownerRoute = artifactPath(publicModulePath('en', ownerApi.library, ownerApi.module))
  const moduleHtml = readFileSync(join(buildRoot, ownerRoute), 'utf8')
  assert.match(moduleHtml, /Choose an entry/)
  const ownerSymbol = ownerApi.symbols.find(
    (symbol) => symbol.kind !== 'type' && symbol.kind !== 'interface'
  )
  assert.ok(ownerSymbol)
  const apiRoute = artifactPath(
    `${publicModulePath('en', ownerApi.library, ownerApi.module)}/${apiSymbolPath(ownerSymbol, ownerApi.symbols)}`
  )
  assert.match(
    readFileSync(join(buildRoot, apiRoute), 'utf8'),
    /class="api-overview"[\s\S]*?<p class="lede">/
  )
})

test('emits semantic symbol lists and labelled code surfaces', () => {
  const symbol = apiManifest.apis
    .find((api) => api.library === 'event-subscriber' && api.module === 'index')
    ?.symbols.find((candidate) => candidate.name === 'createEventChannel')
  assert.ok(symbol)
  const html = readFileSync(
    join(
      buildRoot,
      `en/docs/event-subscriber/api/${apiSymbolPath(symbol, apiManifest.apis.find((api) => api.library === 'event-subscriber' && api.module === 'index')!.symbols)}/index.html`
    ),
    'utf8'
  )

  assert.match(
    html,
    /<div class="explained-code(?: annotated)?"[^>]*data-code-kind="example"[^>]*>\s*<figure class="code-frame">/
  )
  assert.match(html, /<summary>Public type signature<\/summary>/)
  assert.match(
    html,
    /<div class="explained-code(?: annotated)?"[^>]*data-code-kind="signature"[^>]*>\s*<figure class="code-frame">/
  )
  assert.match(html, /<pre class="code-block"><code>/)
  assert.match(html, /class="syntax-keyword">export<\/span>/)
  assert.match(html, /class="syntax-type">IEventApiStyle<\/span>/)
  assert.match(html, /export<\/span> <span class="syntax-keyword">declare<\/span>[\s\S]*?\n/)
  assert.doesNotMatch(html, /Declared shape:/)
  assert.match(html, /class="api-overview"[\s\S]*?<p class="lede">/)
  assert.doesNotMatch(html, /<h4>介绍<\/h4>/)
  assert.doesNotMatch(html, /when its public contract matches the result you need/)
  assert.doesNotMatch(html, /start with the smallest valid input/i)
  assert.doesNotMatch(html, / · [a-f0-9]{8}\./)
})

test('renders maintained constructor fields omitted by declaration expansion', () => {
  const resourceHtml = readFileSync(
    join(buildRoot, 'zh/docs/resource/api/Resource/index.html'),
    'utf8'
  )
  const resourceFragment = apiManifest.apis
    .find((api) => api.library === 'resource' && api.module === 'index')
    ?.symbols.find((symbol) => symbol.name === 'Resource')?.fragment
  assert.ok(resourceFragment)
  assert.match(resourceHtml, /<h2>选项<\/h2>/)
  for (const option of [
    'debugName',
    'ttl',
    'autoStart',
    'staleWhileRevalidate',
    'retry',
    'retryDelay',
    'keepAlive',
    'initialSnapshot',
    'scheduler'
  ]) {
    assert.match(resourceHtml, new RegExp(`id="${resourceFragment}--option-${option}"`))
  }
  assert.match(renderedText(resourceHtml), /IResourceCacheSnapshot<T>/)
  assert.match(resourceHtml, /systemScheduler/)
})

test('keeps concrete learning content without the generated reading checklist', () => {
  const html = readFileSync(join(buildRoot, 'zh/docs/resource/api/index.html'), 'utf8')
  const text = renderedText(html)

  assert.doesNotMatch(
    text,
    /从场景到生产组合|理解适用场景|完成 Quick Start|组合核心能力|确认高阶边界|按频率选择 API/
  )
  /** 92fadb3d replaces generated lesson selections with the maintained module reference. */
  assert.match(text, /跟踪其在第一个 await 之前读取的响应式值/)
  assert.match(text, /这些值变化时自动重新请求/)
  assert.match(text, /支持有效期缓存、失败重试与快照/)
  assert.match(text, /new Resource/)
  assert.match(text, /const id = userId\.value/)
  assert.match(text, /const state = user\.state/)
  assert.ok(text.indexOf('响应式、可取消的异步数据') < text.indexOf('选择一个入口'))
  /** Detailed generation and composition lessons stay on the package's maintained README route. */
  const readme = renderedText(
    readFileSync(join(buildRoot, 'zh/docs/resource/readme/index.html'), 'utf8')
  )
  assert.match(
    readme,
    /关键词一变 Resource 就发起新请求.*?旧请求即使跑完，也写不进 state.*?执行时读取 results\.state.*?请求状态变化会让它再次执行并更新页面/s
  )
  assert.match(
    readme,
    /每次请求一个世代编号，只有最新一代的结果会写入 state.*?旧请求即使跑完，也写不进 state/s
  )
})

test('explains request generations, observation, and terminal cleanup', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/resource/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(
    text,
    /构造选项 autoStart 默认为 true：没有仍有效的 initialSnapshot 时，构造函数立即发起第一代请求/
  )
  assert.match(text, /把 state 保存到普通变量只得到当时的状态快照/)
  assert.match(
    text,
    /view 是一个 Effect（响应式副作用），执行时读取 results\.state.*?应在 Effect 或 UI 框架的状态订阅中读取它/s
  )
  assert.match(
    text,
    /refetch\(\) 总是发起新请求.*?每次刷新会创建新的一代，并中止仍在途的上一代的 signal/s
  )
  assert.match(text, /只有当前一代能把结果写入状态/)
  assert.match(
    text,
    /cancel\(\) \/ dispose\(\)\s*停掉这一次请求、资源还能用 \/ 停掉请求并释放整个资源/
  )
  assert.match(text, /dispose\(\) 不会释放传入的 runtime/)
  assert.match(text, /RESOURCE_DISPOSED/)
  assert.match(text, /需要暂时停止当前请求、稍后继续使用同一个资源时调用 cancel\(\)/)
})

test('shows the complete invalidation and render chain', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/resource/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /new Resource\(\(\) => search\(keyword\.value\), runtime\)/)
  assert.match(text, /const view = runtime\.effect/)
  assert.match(text, /const state = results\.state/)
  assert.match(
    text,
    /关键词一变 Resource 就发起新请求.*?旧请求即使跑完，也写不进 state.*?执行时读取 results\.state.*?请求状态变化会让它再次执行并更新页面/s
  )
  assert.match(text, /同一轮里的多次修改默认在下一个微任务合并成一次请求/)
  assert.match(text, /依赖变化何时刷新由传入的 runtime 调度决定，默认在微任务中处理/)
  assert.match(text, /每次刷新会创建新的一代，并中止仍在途的上一代的 signal/)
  assert.match(text, /只有最新一代的结果会写入 state.*?旧请求即使跑完，也写不进 state/s)
  assert.match(text, /请求函数在返回 Promise 前同步读取了 keyword\.value/)
  assert.match(text, /先释放 view，再释放 results，最后释放输入 keyword/)
  assert.ok(
    text.indexOf('view.dispose()') < text.indexOf('results.dispose()') &&
      text.indexOf('results.dispose()') < text.indexOf('keyword.dispose()')
  )
})

test('keeps use cases and direct-await tradeoffs above the example', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/resource/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /当异步结果依赖 Signal 或 Computed/)
  assert.match(text, /可观察、可复用的状态.*?直接 await 一个 Promise 更简单/s)
  assert.match(text, /只加载一次、没有这些需求的请求，直接 await 一个 Promise 更简单/)
  assert.match(text, /你可能遇到过/)
  assert.match(text, /为什么选它/)
  assert.match(text, /从这里开始/)
  assert.match(text, /旧请求的结果写不进来，即使底层接口不能取消/)
  assert.match(text, /按 Suspense 的方式读取（成功返回值、加载中抛 Promise、失败抛错误）/)
  assert.match(
    text,
    /有效期（ttl）.*?成功的数据多久后过期.*?刷新时不清空内容\s*staleWhileRevalidate: true/s
  )
  assert.match(
    text,
    /服务端快照带的是剩余有效期.*?调用方可传输或保存 dehydrate\(\) 导出的数据和剩余有效期，再用 initialSnapshot 恢复/s
  )

  const decisionIndex = text.indexOf('直接 await 一个 Promise 更简单')
  const exampleIndex = text.indexOf('从这里开始')
  assert.ok(decisionIndex >= 0 && decisionIndex < exampleIndex)
})

test('renders the process-wide layer contract and every host capability', () => {
  const loggerHtml = readFileSync(
    join(buildRoot, 'zh/docs/logger/api/setLoggerRuntimeManager/index.html'),
    'utf8'
  )
  assert.match(
    renderedText(loggerHtml),
    /为之后创建的 logger 设置默认运行时管理器（已存在的 logger 保持原样）/
  )
  assert.match(renderedText(loggerHtml), /恢复时按后进先出撤销/)
  /** The manager is a positional argument, so its fields belong to its own type reference. */
  const managerHtml = readFileSync(
    join(buildRoot, 'zh/docs/logger/api/ILoggerRuntimeManager/index.html'),
    'utf8'
  )
  assert.match(loggerHtml, /finally/)
  assert.match(loggerHtml, /restore\(\)/)
  for (const option of [
    'process',
    'createAbortController',
    'randomUUID',
    'defer',
    'write',
    'console',
    'fs',
    'fetch'
  ]) {
    assert.match(managerHtml, new RegExp(`--member-${option}-[0-9]+"`))
  }
})

test('explains stable codes, original causes, and retained diagnostic detail', () => {
  const errorHtml = readFileSync(
    join(buildRoot, 'zh/docs/plugin-host/api/PluginHostError/index.html'),
    'utf8'
  )
  /** The example proves failure identity without relying on the old constructor prose. */
  const text = renderedText(errorHtml)
  assert.match(text, /error\.code === PluginHostErrorCode\.pluginInstallFailed/)
  assert.match(text, /error\.cause === unavailable/)
  assert.match(text, /保留触发当前错误的原始失败对象/)
  assert.match(text, /错误创建方提供的结构化诊断信息，与原始错误 cause 分开保存/)
  assert.match(text, /error\.detail === detail/)
  /** Constructor arguments stay in the parameter contract; ErrorOptions fields have option rows. */
  assert.match(text, /code: IPluginHostErrorCode — 从本包错误码表选择/)
  assert.match(text, /message: string — 调用方编写/)
  for (const option of ['cause', 'detail']) {
    assert.match(errorHtml, new RegExp(`--option-${option}"`))
  }
})

test('render distinct static and dynamic ownership paths', () => {
  const staticHtml = readFileSync(
    join(buildRoot, 'zh/docs/tray/api/createTrayGraph/index.html'),
    'utf8'
  )
  const hostHtml = readFileSync(
    join(buildRoot, 'zh/docs/tray/api/host/createHost/index.html'),
    'utf8'
  )
  /** The fixed graph path starts declared dependencies, consumes a service, and releases the graph. */
  const staticText = renderedText(staticHtml)
  assert.match(staticText, /接纳一个完整、固定的条目数组/)
  assert.match(staticText, /requires: \[configKey\]/)
  assert.match(staticText, /await graph\.ready\(\)/)
  assert.match(staticText, /graph\.get<\{ baseUrl: string \}>\(apiKey\)\.baseUrl/)
  assert.match(staticText, /await graph\.dispose\(\)/)
  /** 92fadb3d documents the entries array as a positional parameter, not an options bag. */
  assert.match(
    staticText,
    /entries: readonly ITrayEntryDefinition<unknown>\[\] — 条目定义数组；key 必须是唯一且非空的 ITrayKey/
  )
  assert.match(renderedText(hostHtml), /构建托管宿主所拥有的唯一 PluginHost/)
  assert.match(hostHtml, /physicalCompletion/)
  assert.match(hostHtml, /--option-mutationAdmissionMs"/)
  assert.match(hostHtml, /--option-shutdown-mode"/)
})

test('render distinct ownership and mutation paths', () => {
  const hostHtml = readFileSync(
    join(buildRoot, 'zh/docs/capability/api/createCapabilityHost/index.html'),
    'utf8'
  )
  const readinessHtml = readFileSync(
    join(buildRoot, 'zh/docs/capability/api/snapshotGraphReadiness/index.html'),
    'utf8'
  )
  const staticHtml = readFileSync(
    join(buildRoot, 'zh/docs/capability/api/graph/createCapabilityGraph/index.html'),
    'utf8'
  )
  const dynamicHtml = readFileSync(
    join(buildRoot, 'zh/docs/capability/api/graph/dynamic/createDynamicCapabilityGraph/index.html'),
    'utf8'
  )
  const topologyHtml = readFileSync(
    join(buildRoot, 'zh/docs/capability/api/graph/topology/buildCapabilityTopology/index.html'),
    'utf8'
  )
  assert.match(hostHtml, /只有 activate 内执行动态 import/)
  assert.match(hostHtml, /--option-flags"/)
  assert.match(readinessHtml, /不是实时订阅/)
  assert.match(staticHtml, /封闭的静态 required-edge Graph/)
  assert.match(dynamicHtml, /精确 binding-generation lease/)
  assert.match(dynamicHtml, /--option-mutationAdmissionMs"/)
  assert.match(dynamicHtml, /--option-releaseBatch"/)
  assert.match(topologyHtml, /不拥有节点启动、状态、回滚或释放/)
})

test('render each control algebra and supported adapter', () => {
  /** Reads one maintained middleware API page. */
  const readMiddleware = (symbol: string): string =>
    readFileSync(join(buildRoot, `zh/docs/middleware-pipeline/api/${symbol}/index.html`), 'utf8')
  /** Four execution algebras and stage lifting belong to the single public constructor. */
  const text = renderedText(readMiddleware('createPipeline'))
  for (const mode of ['sync', 'async', 'generator', 'async-generator']) {
    assert.ok(text.includes(mode), `createPipeline must explain ${mode}`)
  }
  for (const operation of [
    'lift',
    'pipeline.run(',
    'onViolation',
    'combineStageAndDownstreamError'
  ]) {
    assert.ok(text.includes(operation), `createPipeline must explain ${operation}`)
  }
  assert.match(text, /创建某一种执行模式下可复用、无状态的中间件执行器/)
  assert.match(text, /选项只读取一次并冻结/)
  assert.match(text, /把为其它模式编写的步骤转换为当前 pipeline 的模式，只允许无损方向/)
  assert.match(text, /取消/)
})

test('render exact memory and conversion ownership', () => {
  /** Reads one maintained WASM API page. */
  const readWasm = (symbol: string): string =>
    readFileSync(join(buildRoot, `zh/docs/wasm/api/${symbol}/index.html`), 'utf8')
  assert.match(readWasm('initSync'), /不会发起 fetch/)
  assert.match(readWasm('alloc_bytes'), /稳定非零 allocation id/)
  assert.match(readWasm('ptr_of'), /稳定的是 id/)
  assert.match(readWasm('byte_len_of'), /capacity 不是逻辑 payload 长度/)
  assert.match(readWasm('dealloc_bytes'), /二次释放或未知 id 返回 false/)
  assert.match(readWasm('ConversionResult'), /各有独立 cleanup 义务/)
  assert.match(readWasm('json_to_msgpack'), /绝不释放输入/)
  assert.match(readWasm('msgpack_to_json'), /尾随字节或第二个文档会失败/)
})

test('render ABI, synchronization, and error identity', () => {
  /** Reads one maintained Store Shared API page. */
  const readShared = (routeSegment: string): string =>
    readFileSync(join(buildRoot, `zh/docs/store-shared/api/${routeSegment}/index.html`), 'utf8')
  /** Shared scalar observation and positional argument contract. */
  const signal = renderedText(readShared('sharedInt32'))
  assert.match(signal, /reader\.sync\(\)/)
  assert.match(signal, /把当前共享版本拉入本地游标，仅所属运行时尚未观察该版本时通知/)
  assert.match(signal, /initialValue\?: number — 可选有符号三十二位初值，默认零，提供缓冲区时忽略/)
  assert.match(
    renderedText(readShared('SharedInt32Signal')),
    /销毁仅断开当前运行时，其他共享同一缓冲区的包装仍存活/
  )
  assert.match(
    renderedText(readShared('sharedInt32Array-const')),
    /运行时追踪内仅实例化或复用当前下标源，其他情况直接读取/
  )
  assert.match(readShared('sharedInt32Array-const'), /--option-initialValues"/)
  assert.match(
    renderedText(readShared('SharedInt32Array-class')),
    /不执行公开下标、活动检查或图追踪的低层一致值版本读取/
  )
  assert.match(
    renderedText(readShared('createStoreSharedError')),
    /由原生错误原因属性按身份保留的调用者原始失败/
  )
  assert.match(
    renderedText(readShared('createStoreSharedRangeError')),
    /原生 RangeError，保留运行时类型、堆栈及可选原始原因/
  )
})

test('render compute, streaming, and ownership boundaries', () => {
  /** Reads one maintained Store Worker API page. */
  const readWorker = (moduleName: string, symbol: string): string =>
    readFileSync(
      join(
        buildRoot,
        artifactPath(`${publicModulePath('zh', 'store-worker', moduleName)}/${symbol}`)
      ),
      'utf8'
    )
  /** The client owns endpoint cleanup; requests copy bytes and accept cooperative cancellation. */
  const adapter = renderedText(readWorker('index', 'WorkerAdapter'))
  assert.match(adapter, /关闭适配器、等待就绪并关闭端点，不终止借用线程；重复调用返回同一 Promise/)
  assert.match(adapter, /signal.*undefined/)
  assert.match(adapter, /复制.*不.*detach|不.*分离/)
  assert.match(
    renderedText(readWorker('index', 'createWorkerHandler')),
    /计算失败转回复，初始化或投递失败可使回调拒绝/
  )
  assert.match(
    renderedText(readWorker('index', 'workerComputed')),
    /提供状态、刷新、Promise、取消、缓存导出恢复及销毁；请求代次与重试遵循资源包契约/
  )
  /** API audit a384c4d3 removes serialize aliases and the public transferables helper. */
  assert.match(
    renderedText(readWorker('serialize/worker', 'workerParser')),
    /接值及上下文返回异步块流的编码/
  )
  assert.doesNotMatch(readWorker('serialize/worker', 'workerParser'), /--option-ownership"/)
  assert.match(
    renderedText(readWorker('serialize/worker', 'workerPlugin')),
    /不额外检测格式、协商或取得线程所有权/
  )
  assert.match(
    renderedText(readWorker('serialize/worker', 'createSerializeWorkerHandler')),
    /编码初始两份额度并等待确认/
  )
  assert.match(
    renderedText(readWorker('serialize/worker', 'workerParser')),
    /复制.*不.*detach|不.*分离/
  )
  assert.match(
    renderedText(readWorker('index', 'createStoreWorkerAggregateError')),
    /按调用者顺序保留在聚合子项中的原始失败/
  )
})

test('render readiness, field layout, and cleanup', () => {
  /** Reads one maintained Store WASM API page. */
  const readStoreWasm = (symbol: string): string =>
    readFileSync(join(buildRoot, 'zh/docs/store-wasm/api/' + symbol + '/index.html'), 'utf8')
  assert.match(renderedText(readStoreWasm('ensureWasm')), /等待中及成功后复用同一个 Promise/)
  assert.match(renderedText(readStoreWasm('number')), /八字节小端浮点数字段/)
  assert.match(renderedText(readStoreWasm('boolean')), /单字节布尔字段/)
  assert.match(renderedText(readStoreWasm('string')), /四字节长度头/)
  /** MaxBytes and granularity are positional parameters in the current public signatures. */
  assert.match(
    renderedText(readStoreWasm('string')),
    /maxBytes\?: number — UTF-8 字节容量默认 256，须为 0 至 4294967291 的安全整数/
  )
  assert.match(renderedText(readStoreWasm('array')), /失败尝试回滚内存/)
  assert.match(
    renderedText(readStoreWasm('array')),
    /granularity\?: number — 每桶下标数须为正安全整数，默认 64；设为 1 时逐下标追踪/
  )
  assert.match(
    renderedText(readStoreWasm('record')),
    /销毁方法及状态键在创建字段时以保留字段名错误拒绝/
  )
  assert.match(
    renderedText(readStoreWasm('createStoreWasmTypeError')),
    /非未定义的原始失败保留为原因/
  )
  assert.match(
    renderedText(readStoreWasm('createStoreWasmAggregateError')),
    /以原始身份及顺序保留在聚合子项/
  )
})

test('renders maintained guidance without architecture trampoline routes', () => {
  assert.equal(
    routeManifest.entries.some((entry) =>
      /^\/(?:en|zh)\/architecture\/[^/]+\/(?:index|overview|ownership)$/.test(entry.path)
    ),
    false
  )
  const architecture = readFileSync(
    join(buildRoot, 'zh/docs/event-subscriber/readme/index.html'),
    'utf8'
  )
  const api = readFileSync(join(buildRoot, 'zh/docs/event-subscriber/api/index.html'), 'utf8')
  const symbol = apiManifest.apis
    .find((candidate) => candidate.library === 'event-subscriber' && candidate.module === 'index')
    ?.symbols.find((candidate) => candidate.name === 'createEventChannel')
  assert.ok(symbol)
  const apiDetail = readFileSync(
    join(
      buildRoot,
      `zh/docs/event-subscriber/api/${apiSymbolPath(symbol, apiManifest.apis.find((api) => api.library === 'event-subscriber' && api.module === 'index')!.symbols)}/index.html`
    ),
    'utf8'
  )
  assert.match(architecture, /典型场景/)
  assert.match(
    renderedText(architecture),
    /用于进程内的一对多事件通知[\s\S]*事件是瞬时通知，不提供当前值、重放/
  )
  /** The package introduction reuses its real purpose instead of a generator instruction. */
  const packagePurpose = api.match(/<meta name="description" content="([^"]+)"/)?.[1]
  assert.ok(packagePurpose)
  assert.equal(
    renderedText(api.match(/<p class="lede">([\s\S]*?)<\/p>/)?.[1] ?? '').trim(),
    renderedText(packagePurpose).trim()
  )
  assert.doesNotMatch(api, /何时使用，以及可选择的公开 API/)
  assert.match(api, /选择一个入口/)
  assert.match(
    api,
    new RegExp(
      `href="/zh/docs/event-subscriber/api/${apiSymbolPath(symbol, apiManifest.apis.find((candidate) => candidate.library === 'event-subscriber' && candidate.module === 'index')!.symbols)}"`
    )
  )
  assert.match(apiDetail, /真实场景与组合|签名/)
  for (const option of [
    'report',
    'terminalReport',
    'dispatchPolicy',
    'removalPolicy',
    'publishBudget',
    'style',
    'valueConfig'
  ]) {
    assert.match(apiDetail, new RegExp(`id="${symbol.fragment}--option-${option}"`))
  }
  assert.match(apiDetail, /<h2>选项<\/h2>/)
  assert.match(apiDetail, /<h2>最小示例<\/h2>/)
  assert.match(renderedText(apiDetail), /channel\.subscribe/)
  assert.match(renderedText(apiDetail), /updates\.publish\(1\)/)
  assert.match(apiDetail, /style 不改变顺序、调度、错误或生命周期语义/)
  assert.match(apiDetail, /subscribe-publish/)
  assert.match(apiDetail, /defineEventApiStyle/)
  assert.doesNotMatch(apiDetail, /配置与任务指南/)
  assert.match(apiDetail, /<h2>完整类型签名<\/h2>/)
  assert.ok(apiDetail.indexOf('最小示例') < apiDetail.indexOf('<h2>选项</h2>'))
  assert.ok(apiDetail.indexOf('<h2>选项</h2>') < apiDetail.indexOf('类型签名'))
  assert.match(
    apiDetail,
    /<div class="explained-code(?: annotated)?"[^>]*data-code-kind="example"[^>]*>\s*<figure class="code-frame">/
  )
  assert.doesNotMatch(architecture + api, /本节说明|场景 1|打开完整|This section records/)

  for (const [name, expectations] of [
    [
      'createEventHub',
      ['每个事件名在第一次使用时才创建自己的 channel', "alias: 'orderId'", "readPath: 'data\\.id'"]
    ],
    /** E3a98b85 removes defineEventApiStyle; custom names use this public type and satisfies. */
    [
      'IEventApiStyleNames',
      [
        '自定义别名表',
        'as const satisfies IEventApiStyleNames',
        "subscribe: 'observe'",
        "publish: 'dispatch'",
        "unsubscribe: 'dispose'"
      ]
    ]
  ] as const) {
    const candidate = apiManifest.apis
      .find((entry) => entry.library === 'event-subscriber' && entry.module === 'index')
      ?.symbols.find((entry) => entry.name === name)
    assert.ok(candidate)
    const candidateHtml = readFileSync(
      join(
        buildRoot,
        `zh/docs/event-subscriber/api/${apiSymbolPath(candidate, apiManifest.apis.find((entry) => entry.library === 'event-subscriber' && entry.module === 'index')!.symbols)}/index.html`
      ),
      'utf8'
    )
    for (const expectation of expectations)
      assert.match(renderedText(candidateHtml), new RegExp(expectation))
    if (name === 'createEventHub') {
      /** The field's authored snippet proves the style projection independently of its caption. */
      const styleOption = candidateHtml.match(
        new RegExp(
          `<tr class="option-entry" id="${candidate.fragment}--option-style">([\\s\\S]*?)</tr>`
        )
      )?.[1]
      assert.ok(styleOption, 'createEventHub must retain its style option')
      assert.match(
        styleOption,
        /<div class="explained-code(?: annotated)?"[^>]*data-code-kind="example"[^>]*>\s*<figure class="code-frame">/
      )
      for (const behavior of [
        /style: 'on-emit'/,
        /notifications\.on\(/,
        /notifications\.emit\('Order shipped'\)/,
        /stop\.off\(/
      ])
        assert.match(renderedText(styleOption), behavior)
      assert.match(renderedText(candidateHtml), /events\.on\('changed'/)
      assert.match(
        renderedText(candidateHtml),
        /events\.emit\('changed', \{ data: \{ id: 'order-7' \} \}\)/
      )
    }
    assert.doesNotMatch(candidateHtml, /配置与任务指南|Declaration:| · [a-f0-9]{8}/)
  }
})

test('makes maintained cross-library references explainable and navigable', () => {
  const capability = readFileSync(join(buildRoot, 'zh/docs/capability/readme/index.html'), 'utf8')
  assert.match(capability, /class="library-reference"[^>]*href="\/zh\/docs\/plugin-host"/)
  assert.match(renderedText(capability), /安装和卸载插件.*配置共享能力与处理步骤.*安装失败时回滚/s)
  assert.match(capability, /class="library-reference"[^>]*href="\/zh\/docs\/storage-web"/)

  for (const path of emittedFiles(buildRoot).filter((file) => file.endsWith('.html'))) {
    const route = path.match(/\/(?:docs|guides|architecture)\/([^/]+)\//)
    if (!route) continue
    const currentLibrary = route[1]
    const visibleProse = readFileSync(path, 'utf8')
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<figure class="code-frame"[\s\S]*?<\/figure>/g, '')
      .replace(/<code[\s\S]*?<\/code>/g, '')
      .replace(/<a[^>]*class="library-reference"[\s\S]*?<\/a>/g, '')
    for (const reference of visibleProse.matchAll(/@migai(?:a)?\/([a-z0-9-]+)/g))
      assert.equal(
        reference[1],
        currentLibrary,
        `${path}: unexplained cross-library reference ${reference[0]}`
      )
  }
})

test('keeps example guidance plain and label-free', () => {
  const capabilityArchitecture = readFileSync(
    join(buildRoot, 'zh/docs/capability/index.html'),
    'utf8'
  )

  assert.doesNotMatch(capabilityArchitecture, /代码旁白/)
  assert.doesNotMatch(capabilityArchitecture, /最后执行这一项操作/)
  assert.doesNotMatch(capabilityArchitecture, /finally、组件卸载或任务结束时调用 dispose\(\)/)
})

test('separates signatures, fields, validation, and neighboring APIs', () => {
  const capabilityArchitecture = readFileSync(
    join(buildRoot, 'zh/docs/capability/readme/index.html'),
    'utf8'
  )

  /** Maintained Markdown separates creation, fields and validation without the retired card CSS. */
  const capabilityText = renderedText(capabilityArchitecture)
  assert.match(
    capabilityText,
    /createCapabilityHost\(context, options\?\) 返回 ICapabilityHost<Context>/
  )
  assert.match(
    capabilityArchitecture,
    /<table[\s\S]*?<th[^>]*>成员<\/th>[\s\S]*?<th[^>]*>行为与边界<\/th>/
  )
  assert.match(
    capabilityArchitecture,
    /<tr><td>register\(definition\)<\/td><td>同步登记，不激活；Host 终态或重入窗口内拒绝。<\/td><\/tr>/
  )
  assert.match(capabilityArchitecture, /class="contract-validation"/)
  assert.match(
    capabilityArchitecture,
    /<h3>Host 创建与输入快照<\/h3>[\s\S]*class="contract-validation"[\s\S]*<h3>Host 类型与完整操作<\/h3>[\s\S]*<table class="prose-table">/
  )

  const storeLightArchitecture = readFileSync(
    join(buildRoot, artifactPath('/zh/docs/store-light/readme')),
    'utf8'
  )
  assert.match(
    renderedText(storeLightArchitecture),
    /createStore.*shape.*IStoreDefinition<S>.*options\?: ICreateStoreOptions.*返回 IReactiveStore<S>/s
  )
  assert.match(
    renderedText(storeLightArchitecture),
    /只接受同步字段.*异步字段应改用 createAsyncStore/s
  )
  assert.doesNotMatch(storeLightArchitecture, /<div class="contract-signature">[\s\S]{0,500}签名：/)
})

test('shows when to enable, consume, disable, and dispose', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/capability/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(
    text,
    /ICapabilityHandle 的唯一约束是 dispose\(\): void 或 PromiseLike<void>；业务方法由具体能力扩展/
  )
  assert.match(text, /host\.register\(\{/)
  assert.match(text, /\(await host\.enable\('export'\)\)\.status/)
  assert.match(
    text,
    /handle<Handle>\(name\)\s*返回 activate 创建的同一个业务句柄；未启用返回 undefined/
  )
  assert.match(text, /等待 enable 结果，只有 enabled 时读取业务 handle/)
  assert.match(text, /disable\(name\)\s*等待该能力全部在途激活和释放排空/)
  assert.match(text, /await host\.dispose\(\)/)
  assert.match(text, /enable\(name\)\s*返回结构化结果/)
  assert.match(text, /离开页面等待 disable/)
  assert.match(
    text,
    /setFlag\(name, enabled\)\s*只有严格 true 放行；false 同步作废在途激活、撤下已有句柄并开始释放；true 不自动激活/
  )
})

test('explains composition terms in reader language', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/plugin-host/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(
    text,
    /普通应用使用根入口的 Host、插件、Feature、句柄和错误工具；composition 是单一组合 owner 的窄协议/
  )
  assert.match(
    text,
    /prepareAdmissions\(\[\{ admission, slot \}\]\).*setup 可在准备期执行，但 extension、config、Feature、stage 暂不公开.*commitPreparedAdmissions 同步发布/s
  )
  assert.match(text, /revision 是 Host 已提交修改的版本号，不是尝试操作的次数/)
  assert.match(text, /registration token 精确指向那次安装，不按名称误删新代/)
  assert.match(
    text,
    /createDataOrderSlot\(name\) 保留 opaque 排序槽.*createDataOrderSlot 调用即保留顺序；禁用、恢复和 replace 沿用 slot/s
  )
  assert.match(
    text,
    /commitPreparedUnUseBatch\(prepared, \{ beforeCleanup\? \}\) 先逻辑撤销，再等待 fence 和该代 pipeline lease/
  )
  assert.match(text, /cleanupComplete false 不代表资源已释放/)
  assert.match(text, /确认物理释放前，应等待全部 physicalCompletion 延续完成/)
})

test('uses definePlugin and consumes the committed view', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/plugin-host/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /import \{ defineHost, definePlugin \} from '@migaia\/plugin-host'/)
  assert.match(
    text,
    /const greeting = definePlugin\(\{.*name: 'greeting'.*install: \(\) => \(\{ greet: \(\) => '你好' \}\)/s
  )
  assert.match(text, /const \[registration\] = await host\.use\(greeting\)/)
  assert.match(text, /registration\.extensions\.greet\(\)/)
  assert.match(text, /await host\.unUse\('greeting'\)/)
  assert.match(text, /definePlugin\(name, descriptorFactory, features\?\) 只捕获定义/)
  assert.match(text, /对象形 definePlugin\(definition\)/)
  assert.match(
    text,
    /name、install\(core, setupOutput\?\).*config.*update\(next, core\).*dispose\(context\?\)/s
  )
  assert.match(text, /只捕获定义。真正安装时同步创建一次 descriptor，再调用其 install\(\)/)
  assert.match(text, /不在定义时执行安装或 Feature 工厂/)
  assert.match(text, /use\(\.\.\.plugins\).*按依赖拓扑安装，按原输入顺序返回句柄/s)
})

test('explains the control signal and transition', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/plugin-host/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /这三个唯一 symbol 从 middleware-pipeline 直接导入/)
  assert.match(text, /这三个 symbol 作为 stage 返回值时，它们是控制信号，不是业务数据/)
  assert.match(text, /GENERATOR_CONTINUE.*最后一次 yield 的值进入第二步/s)
  assert.match(text, /GENERATOR_CONTINUE 采用最后 yield（零 yield 用输入）/)
  assert.match(text, /textHost\.runPipeline\('migaia', \(value\) => console\.log\(value\)\)/)
  assert.match(text, /yield value\.toUpperCase\(\)/)
  assert.match(text, /输出 \[MIGAIA\]：第二个 stage 收到 MIGAIA，完成回调收到加上方括号后的结果/)
  assert.match(text, /先耗尽当前 stage，普通返回值交给下一步/)
  assert.match(text, /隐式 undefined 或 GENERATOR_HALT 终止/)
  assert.match(text, /GENERATOR_UNDEFINED 才把业务 undefined 继续交付，类型必须允许它/)
})

/**
 * The rounded floating header was replaced on 2026-10-16 when the visual system adopted a
 * full-width sticky bar.
 */
test('keeps a sticky translucent header that draws its rule only after scroll', () => {
  assert.match(
    styleSource,
    /\.site-header \{[\s\S]*?backdrop-filter:[\s\S]*?border-bottom: 1px solid transparent;[\s\S]*?height: var\(--header-height\);[\s\S]*?position: sticky;/
  )
  assert.match(
    styleSource,
    /\.site-header\[data-scrolled='true'\] \{[\s\S]*?border-bottom-color: var\(--border-default\);/
  )
  assert.match(rootSource, /className="site-header" data-scrolled=/)
})

test('sends the unprefixed landing page to Chinese', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/')), 'utf8')

  assert.match(html, /aria-label="Switch to Chinese"[^>]+href="\/zh"/)
  assert.doesNotMatch(html, /aria-label="Switch to Chinese"[^>]+href="\/"/)
})

test('uses one static React Router pipeline without legacy framework leftovers', () => {
  assert.match(routeConfig, /ssr: false/)
  assert.match(routeConfig, /routeManifest\.entries\.map/)
  const legacyFramework = String.fromCharCode(97, 115, 116, 114, 111)
  const legacyName = [legacyFramework, 'config', 'mjs'].join('.')
  const legacyExtension = '.' + legacyFramework
  assert.ok(!existsSync(join(websiteRoot, legacyName)))
  assert.ok(!existsSync(join(websiteRoot, 'src/pages/[lang]/[...slug]' + legacyExtension)))
  assert.ok(!existsSync(join(websiteRoot, '.' + legacyName.slice(0, -7))))
})

test('closes every generated route and API body artifact', () => {
  const seen = new Set<string>()
  for (const entry of routeManifest.entries) {
    assert.ok(!seen.has(entry.path), `duplicate canonical route: ${entry.path}`)
    seen.add(entry.path)
    const output = join(buildRoot, artifactPath(entry.path))
    assert.ok(existsSync(output), `missing static artifact: ${entry.path}`)
    /** Retired docs-index URLs are redirect pages, not content pages. */
    if (LEGACY_DOCS_INDEX_REDIRECTS.has(entry.path)) {
      assert.match(readFileSync(output, 'utf8'), /http-equiv="refresh"/)
      continue
    }
    assert.match(readFileSync(output, 'utf8'), /<main(?:\s|>)/)
  }
  for (const api of apiManifest.apis) {
    for (const locale of ['en', 'zh']) {
      const modulePath = publicModulePath(locale, api.library, api.module)
      const output = join(buildRoot, artifactPath(modulePath))
      const html = readFileSync(output, 'utf8')
      if (api.symbols.length === 0) {
        if (api.library === 'rpc-contract' && api.module === 'schema/wire-error') {
          assert.match(html, /JSON Schema/)
          assert.ok(
            renderedText(html).includes(
              "import wireErrorSchema from '@migaia/rpc-contract/schema/wire-error' with { type: 'json' }"
            )
          )
        } else assert.match(html, locale === 'zh' ? /重新导出的符号/ : /Re-exported symbols/)
        continue
      }
      for (const symbol of api.symbols) {
        if (symbol.kind === 'type' || symbol.kind === 'interface') {
          assert.match(html, new RegExp(`id="${symbol.fragment}"`))
          continue
        }
        const detail = readFileSync(
          join(buildRoot, artifactPath(`${modulePath}/${apiSymbolPath(symbol, api.symbols)}`)),
          'utf8'
        )
        let previous = -1
        for (const section of ['overview', 'signature']) {
          const position = detail.indexOf(`--${section}"`)
          assert.ok(
            position > previous,
            `API section order drift: ${api.library}/${api.module}/${symbol.name}`
          )
          previous = position
        }
        assert.match(detail, new RegExp(`id="${symbol.fragment}--overview"`))
      }
      assert.match(html, /class="next-actions"/)
    }
  }
})

test('closes emitted chunk and terminology boundaries', () => {
  const files = emittedFiles(join(buildRoot, 'assets'))
  assert.ok(files.length > 0)
  const assetText = files.map((file) => readFileSync(file, 'utf8')).join('\n')
  assert.doesNotMatch(assetText, /(?:^|[\\/])search\.(?:[cm]?js)/i)
  assert.doesNotMatch(rootSource, /from ['"]\.\/content\.js['"]/, 'shell imports content data')
  for (const locale of ['en', 'zh']) {
    const home = readFileSync(join(buildRoot, artifactPath(`/${locale}`)), 'utf8')
    assert.doesNotMatch(home, /\/assets\/content-[^"']+\.js/, `${locale} home preloads API data`)
  }
  for (const file of emittedFiles(buildRoot).filter((candidate) => candidate.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8')
    const proseHtml = html.replace(/<pre(?:\s[^>]*)?>[\s\S]*?<\/pre>/gi, '')
    // A published package is a valid API concept; only repository paths and stale locales leak internals.
    // Intl identifiers such as zh-CN are API data; obsolete site paths use /zh-cn.
    assert.doesNotMatch(
      renderedText(proseHtml),
      /\/zh-cn\b|\.\.[\\/]packages\b|\bpackages[\\/][a-z0-9-]+/i,
      `repository path or stale locale in page prose: ${file}`
    )
    assert.doesNotMatch(
      html,
      /not-applicable:|No additional advanced behavior is declared|source-backed (?:advanced semantics|signature)|Declared shape:|(?:function|type) signature export (?:declare|type)/i
    )
    assert.doesNotMatch(html, /<p>[^<]*Declaration:\s*\.|<p>[^<]*\.d\.ts:\d+/i)
    for (const paragraph of html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)) {
      const readableText = paragraph[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&[^;]+;/g, ' ')
        .trim()
      assert.ok(readableText.length <= 500, `oversized prose paragraph: ${file}`)
    }
  }
})

test('keeps route code separate from generated library data', () => {
  const assets = emittedFiles(join(buildRoot, 'assets'))
  const docsChunk = assets.find((file) => /\/docs-[^/]+\.js$/.test(file))
  assert.ok(docsChunk, 'missing Docs route chunk')
  assert.ok(statSync(docsChunk).size < 500_000, `Docs route chunk exceeds 500 KB: ${docsChunk}`)
  assert.equal(
    assets.some((file) => /\/libraries?-[^/]+\.(?:js|json)$/.test(file)),
    false,
    'generated library payload emitted into client assets'
  )
  for (const api of apiManifest.apis) {
    for (const symbol of api.symbols.filter(
      (candidate) => candidate.kind !== 'type' && candidate.kind !== 'interface'
    )) {
      const detailPath = artifactPath(
        `${publicModulePath('en', api.library, api.module)}/${apiSymbolPath(symbol, api.symbols)}`
      )
      const detailFile = join(buildRoot, detailPath)
      assert.ok(
        statSync(detailFile).size < 250_000,
        `API detail payload exceeds 250 KB: ${detailFile}`
      )
    }
  }
  for (const artifact of emittedFiles(buildRoot).filter(
    (file) => file.endsWith('.html') || file.endsWith('.data')
  )) {
    assert.ok(
      statSync(artifact).size < 250_000,
      `prerendered route payload exceeds 250 KB: ${artifact}`
    )
  }
})

test('closes API ordering and exposes a meaningful next action for every page', () => {
  for (const entry of routeManifest.entries) {
    if (LEGACY_DOCS_INDEX_REDIRECTS.has(entry.path)) continue
    const html = readFileSync(join(buildRoot, artifactPath(entry.path)), 'utf8')
    assert.match(html, /class="next-actions"|class="actions"|class="architecture-stack"/)
  }
  for (const api of apiManifest.apis) {
    assert.ok(api.sections.indexOf('core-usage') < api.sections.indexOf('advanced-usage'))
  }
})

test('groups every library by family on the docs home', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh')), 'utf8')

  assert.match(html, /class="architecture-stack"/)
  assert.doesNotMatch(html, /阅读架构时先回答三个问题/)
})

test('uses concrete responsibilities instead of slogans', () => {
  const docsIndex = readFileSync(join(buildRoot, artifactPath('/zh')), 'utf8')
  const utilsArchitecture = readFileSync(
    join(buildRoot, artifactPath('/zh/docs/utils/readme')),
    'utf8'
  )
  /** English library descriptions appear on the docs home library index. */
  const loggerEnglish = readFileSync(join(buildRoot, artifactPath('/en')), 'utf8')

  assert.match(renderedText(docsIndex), /utils.*添加超时、取消与错误追踪.*数据转换和对象更新/s)
  assert.match(utilsArchitecture, /多个包共同需要、且不应绑定 Store、DOM 或具体运行时/)
  assert.match(utilsArchitecture, /不是无边界的杂物箱/)
  assert.match(
    renderedText(loggerEnglish),
    /Send logs to a console or service.*filter and format.*asynchronous output/s
  )
  for (const html of [docsIndex, utilsArchitecture, loggerEnglish]) {
    assert.doesNotMatch(html, /归属与边界模型/)
    assert.doesNotMatch(html, /源码契约、能力边界与使用入口/)
    assert.doesNotMatch(html, /Source-backed entry with maintained boundary facts/)
    assert.doesNotMatch(html, /owns this capability boundary and its public contracts/)
  }
})

test('explain capability, pain, and design on every README page', () => {
  const packageHomes = routeManifest.entries.filter(
    (entry) => entry.locale === 'zh' && /^\/zh\/docs\/[^/]+\/readme$/.test(entry.path)
  )

  assert.ok(packageHomes.length > 20)
  for (const entry of packageHomes) {
    const html = readFileSync(join(buildRoot, artifactPath(entry.path)), 'utf8')
    /** The README page uses the maintained positioning paragraph as its lede. */
    const lede = renderedText(html.match(/<p class="lede">([\s\S]*?)<\/p>/)?.[1] ?? '')
    assert.ok(lede.length >= 70, `package positioning is too thin: ${entry.path}`)
    assert.doesNotMatch(lede, /归属与边界模型|源码契约|使用入口/)
    assert.match(
      lede,
      /用于|当|核心设计|解决|相比|避免|统一|提供/,
      `package positioning lacks reader-facing capability context: ${entry.path}`
    )
  }

  const lifecycle = readFileSync(join(buildRoot, artifactPath('/zh/docs/lifecycle/readme')), 'utf8')
  assert.match(lifecycle, /按登记的相反顺序释放，一项失败不影响其余资源/)
  assert.match(lifecycle, /新请求开始时旧请求自动失效/)
  assert.match(lifecycle, /不负责事件分发、业务排队或依赖图/)

  const tray = readFileSync(join(buildRoot, artifactPath('/zh/docs/tray/readme')), 'utf8')
  /** Tray supports both fixed startup entries and managed runtime Host instances. */
  const trayText = renderedText(tray)
  assert.match(trayText, /createTrayGraph.*ready\(\).*dispose\(\).*按依赖逆序释放/s)
  assert.match(trayText, /defineTrayHost.*createTray\(\{ hosts \}\)/s)
  assert.match(trayText, /coroutine、Node Worker 或子进程/)
  assert.match(trayText, /复用 RPC.*和 supervision/s)
  assert.match(trayText, /跨机器发现、browser Worker 与持久消息不在当前范围/)
})

test('shares one library sidebar between guides and API pages', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils')), 'utf8')
  const apiHtml = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/api')), 'utf8')

  assert.match(html, /class="left-rail-content"/)
  assert.match(html, /<span>场景指南<\/span>/)
  assert.match(html, />API 参考<\/a>/)
  assert.equal(stableLeftRail(html), stableLeftRail(apiHtml))
  assert.match(html, /href="\/zh\/docs\/utils\/api\/function\/onceAsync"/)
})

test('renders authored code without synthesized walkthrough prose', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')

  assert.match(html, /<figure class="code-frame">/)
  assert.doesNotMatch(html, /class="code-walkthrough(?:-notes)?"/)
})

test('gives inline and block code a consistent themed hierarchy', () => {
  assert.match(styleSource, /--inline-code-background:/)
  assert.match(styleSource, /--inline-code-border:/)
  assert.match(styleSource, /--inline-code-text:/)
  assert.match(
    styleSource,
    /:not\(pre\) > code \{[\s\S]*?background: var\(--inline-code-background\);[\s\S]*?border: 1px solid var\(--inline-code-border\);[\s\S]*?color: var\(--inline-code-text\);/
  )
  assert.match(styleSource, /:not\(pre\) > code::selection/)
  assert.match(styleSource, /\.code-frame \{[\s\S]*?border-radius: var\(--radius-md\);/)
  assert.match(styleSource, /\.code-block \{[\s\S]*?scrollbar-color: var\(--code-border\)/)
  assert.match(
    styleSource,
    /\.option-heading h3 code,[\s\S]*?\.type-declaration > h3 code \{[\s\S]*?box-shadow: none;/
  )
})

test('renders symbols as plain navigation text', () => {
  /** The unified left rail replaced the guide API menu; a guide page exercises it. */
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/lifecycle')), 'utf8')
  const rail = html.match(/<aside class="left-rail-content"[\s\S]*?<\/aside>/)?.[0]
  assert.ok(rail, 'missing left rail')
  /** Symbol links carry their declaration kind; their label must be bare text, not a code chip. */
  const symbolLinks = [...rail.matchAll(/<a[^>]*data-kind="[a-z]+"[^>]*>([\s\S]*?)<\/a>/g)]
  assert.ok(symbolLinks.length > 0, 'missing symbol links')
  for (const [, label] of symbolLinks) assert.doesNotMatch(label!, /<code/)
  assert.match(
    styleSource,
    /\.left-rail-content a\[data-kind\] \{[\s\S]*?font-family: var\(--font-mono\);/
  )
  assert.match(
    styleSource,
    /\.left-rail-content a\[data-kind\]::before \{[\s\S]*?background: var\(--marker-color/
  )
})

test('renders API and re-export entries as responsive cards', () => {
  assert.match(
    styleSource,
    /\.api-reference-list,[\s\S]*?\.reexport-list ul \{[\s\S]*?grid-template-columns: repeat\(auto-fit,[\s\S]*?list-style: none;/
  )
  assert.match(
    styleSource,
    /\.api-reference-list li,[\s\S]*?\.reexport-list li \{[\s\S]*?border-radius: var\(--radius-md\);[\s\S]*?transition:/
  )
  assert.match(styleSource, /\.reexport-list li:hover \{[\s\S]*?transform: translateY\(-1px\);/)
})

test('keeps catalogue introductions compact', () => {
  assert.match(languageSource, /className="page-shell content-page domain-index-page"/)
  assert.match(
    styleSource,
    /\.domain-index-page \{[\s\S]*?padding-block: var\(--space-6\) var\(--space-16\);/
  )
  assert.match(
    styleSource,
    /\.domain-index-page > \.section-block \{[\s\S]*?margin-top: var\(--space-12\);/
  )
})

test('rejects generated filler and repeated prose on every rendered page', () => {
  /** Synthesized commentary must never become reader-facing copy or example comments. */
  const forbidden = [
    '先从示例标出的公开路径引入',
    '这里先把下一步要用的值放进变量',
    '最后执行这一项操作',
    '这里真正发起读写或调用',
    '创建本场景拥有的实例',
    'Import only the capabilities used by this example',
    'Prepare values or configuration required by the next stage',
    'Complete the final step and retain its result',
    'Perform the section’s core read, write, or call',
    'Create the scenario-owned instance',
    '的公开契约与所需结果匹配时使用',
    'when its public contract matches the result you need',
    '提供该模块的公开运行时能力',
    "is part of this module's public type contract",
    "is part of this module's public function contract",
    "is part of this module's public const contract",
    "is part of this module's public class contract",
    '本例对应的生产场景是',
    '没有创建可供后续复用的实例',
    '返回的本次实例',
    'The production situation shown here is:',
    'without creating a reusable instance',
    '输出用于确认上一操作的结果。',
    'Logs the result of the preceding operation.',
    '签名、参数、例子和相关类型只在对应页面展开',
    '先按目标选择 API',
    '这些符号用于配置、状态比较或错误识别',
    '用于核对泛型、重载与返回类型',
    '日常使用应先阅读上面的场景、示例和配置语义',
    '从场景到生产组合',
    '理解适用场景',
    '完成 Quick Start',
    '组合核心能力',
    '确认高阶边界',
    '按频率选择 API',
    'Choose by outcome first.',
    'Each group is ordered by use frequency in maintained documentation.',
    'Signatures, examples, and related types expand on the API page.',
    'These symbols support configuration, state comparison, or error identification',
    'Use this to inspect generics, overloads, and return types after reading the scenarios',
    'From use case to production composition',
    'Understand the use case',
    'Complete the Quick Start',
    'Compose core capabilities',
    'Check advanced boundaries',
    'Choose APIs by frequency'
  ]
  /** Closed-world output scan covers every route in both locales, including the landing page. */
  const htmlFiles = emittedFiles(buildRoot).filter((path) => path.endsWith('.html'))
  assert.ok(htmlFiles.length > 0, 'expected prerendered pages')

  for (const path of htmlFiles) {
    if (isLegacyRedirectArtifact(path)) continue
    /** Prerendered document is the evidence for reader-facing output. */
    const html = readFileSync(path, 'utf8')
    /** Decode syntax spans so prose and authored comments remain searchable. */
    const text = renderedText(html)
    for (const phrase of forbidden)
      assert.ok(!text.includes(phrase), `generated filler remains in ${path}: ${phrase}`)
    /** Router's loading shell has metadata but no page body; prose belongs to resolved routes. */
    if (path.endsWith('/__spa-fallback.html')) continue
    assert.doesNotMatch(
      text,
      /\b[\w$]+ holds this [\w$.]+\(\) result/,
      `synthesized retained-instance prose remains: ${path}`
    )
    assert.doesNotMatch(
      text,
      /每组依据[^。]*真实使用频率/,
      `generated sorting prose remains: ${path}`
    )
    assert.doesNotMatch(
      text,
      /何时使用：|When to use:/,
      `duplicate option guidance remains: ${path}`
    )
    /** Prose may appear once; navigation and repeatable code fragments do not count as sentences. */
    const seen = new Set<string>()
    for (const sentence of mainProseSentences(html)) {
      assert.ok(!seen.has(sentence), `repeated main-content sentence in ${path}: ${sentence}`)
      seen.add(sentence)
    }
  }
})

test('gives every rendered page a nonempty title and purpose description', () => {
  for (const path of emittedFiles(buildRoot).filter((entry) => entry.endsWith('.html'))) {
    if (isLegacyRedirectArtifact(path)) continue
    /** Metadata must exist in static HTML before the client starts. */
    const html = readFileSync(path, 'utf8')
    /** Title names the current page rather than relying on browser navigation state. */
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
    assert.ok(title && renderedText(title).trim(), `empty or missing title: ${path}`)
    /** Description carries the existing page purpose for search and previews. */
    const description = html.match(
      /<meta\b(?=[^>]*\bname="description")(?=[^>]*\bcontent="([^"]*)")[^>]*>/i
    )?.[1]
    assert.ok(
      description && renderedText(description).trim(),
      `empty or missing meta description: ${path}`
    )
  }
})

test('keeps examples without synthesized walkthroughs', () => {
  for (const locale of ['zh', 'en']) {
    for (const path of emittedFiles(join(buildRoot, `${locale}/docs`)).filter((entry) =>
      entry.endsWith('index.html')
    )) {
      /** Primary examples retain their copyable authored code. */
      const html = readFileSync(path, 'utf8')
      for (const section of html.matchAll(
        /<section[^>]*data-primary-api-example="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g
      )) {
        assert.match(section[2], /<figure class="code-frame">/, `missing example code: ${path}`)
        assert.doesNotMatch(
          section[2],
          /class="code-walkthrough"|data-comment-count="[1-9]\d*"/,
          `synthesized example walkthrough remains: ${path}`
        )
      }
    }
  }
})

test('collapses complete declarations without synthesized walkthroughs', () => {
  for (const locale of ['zh', 'en']) {
    for (const path of emittedFiles(join(buildRoot, `${locale}/docs`)).filter((entry) =>
      entry.endsWith('index.html')
    )) {
      /** Signature sections must stay present but closed until a reader expands them. */
      const html = readFileSync(path, 'utf8')
      /** Section navigation follows the article and starts collapsed. */
      const pageNavigation = html.match(/<details[^>]*class="page-toc"[^>]*>/g) ?? []
      for (const navigation of pageNavigation) {
        assert.ok(
          html.indexOf(navigation) > html.lastIndexOf('</article>'),
          `section navigation precedes the article: ${path}`
        )
        assert.doesNotMatch(navigation, /\bopen(?:=|\s|>)/, `expanded section navigation: ${path}`)
      }
      for (const section of html.matchAll(
        /<section class="api-signature"[^>]*>([\s\S]*?)<\/section>/g
      )) {
        assert.match(section[1], /<details(?:\s[^>]*)?>/, `missing signature disclosure: ${path}`)
        assert.doesNotMatch(section[1], /<details[^>]*\bopen(?:=|\s|>)/, `open signature: ${path}`)
        assert.doesNotMatch(
          section[1],
          /class="code-walkthrough"|data-comment-count="[1-9]\d*"/,
          `synthesized signature walkthrough remains: ${path}`
        )
      }
    }
  }
})

test('explains its complete production lifecycle', () => {
  const html = readFileSync(
    join(buildRoot, 'zh/docs/capability/api/createCapabilityHost/index.html'),
    'utf8'
  )
  const text = renderedText(html)

  assert.match(text, /flags: \{ persistence: true \}/)
  assert.match(text, /undefined（未配置错误接收回调）/)
  assert.doesNotMatch(text, /诊断 sink/)
  assert.match(text, /host\.register\(/)
  assert.match(text, /result\.status === CapabilityEnableStatus\.enabled/)
  assert.match(text, /await host\.handle<IPersistence>\('persistence'\)\?\.sync\(\)/)
  assert.match(text, /finally \{\s*await host\.dispose\(\)/)
  assert.doesNotMatch(text, /class="code-walkthrough"|输出用于确认上一操作的结果/)
})

test('explains the exact subscription, delivery, and removal behavior', () => {
  const html = readFileSync(
    join(buildRoot, artifactPath('/zh/docs/event-subscriber/readme')),
    'utf8'
  )
  const text = renderedText(html)

  assert.match(text, /channel\.on\(listener\) 登记监听器并返回本次订阅的句柄/)
  assert.match(
    text,
    /默认采用同步 recursive 派发[\s\S]*channel\.emit\(value\) 按所选派发策略把 value 交给当前快照中的监听器/
  )
  assert.match(text, /默认 handle 取消策略下，句柄的 off\(\) 只移除它拥有的登记/)
  assert.match(text, /on、emit、off 分别与 subscribe、publish、unsubscribe 指向同一函数/)
  assert.doesNotMatch(text, /最后执行这一项操作/)
})

test('uses its subpath and states the style boundary precisely', () => {
  const html = readFileSync(
    join(buildRoot, artifactPath('/zh/docs/event-subscriber/readme')),
    'utf8'
  )
  const text = renderedText(html)

  assert.match(
    text,
    /从 @migaia\/event-subscriber\/subscriber 导入的 subscribeOnce、subscribeUntil、subscribeSubscriber/
  )
  assert.match(text, /可以接收仍保留该方法的 styled channel/)
  assert.match(text, /只通过 channel\.subscribe\(listener, options\?\) 工作，不读取 style 配置/)
  assert.match(text, /返回值固定为普通 IUnsubscribe，即同步、幂等的取消函数/)
  assert.match(text, /不带 off、dispose、unlisten 或订阅链方法/)
})

test('explains why the legacy class event name was removed', () => {
  const html = readFileSync(
    join(buildRoot, artifactPath('/zh/docs/event-subscriber/readme')),
    'utf8'
  )
  const text = renderedText(html)

  assert.match(
    text,
    /const updates = createEventChannel<number>\(\{ dispatchPolicy: EventDispatchPolicy\.queued \}\)/
  )
  assert.match(text, /旧草案中的抽象类 EventSubscriber/)
  assert.match(text, /静态 EVENT_NAME/)
  assert.match(text, /onCall\(\) 不属于当前公开契约/)
  assert.match(text, /对象订阅者只需实现 IEventSubscriber<T, R> 的 handle\(event\)/)
  assert.match(text, /事件来源由 subscribeSubscriber\(channel, subscriber\) 中的 channel 决定/)
  assert.match(text, /多事件名称由 Hub 的 subscribe\(key, listener\) 中的 key 决定/)
})

test('defines the channel, registration, payload, and settled result', () => {
  const html = readFileSync(
    join(buildRoot, artifactPath('/zh/docs/event-subscriber/readme')),
    'utf8'
  )
  const text = renderedText(html)

  assert.match(text, /createEventChannel<T, R>\(\).*T 是发布载荷类型，R 是监听器结果类型/)
  assert.match(text, /taskId 是调用方给本次登记起的标签/)
  assert.match(
    text,
    /const updates = createEventChannel<\{ id: number \}>\(\)[\s\S]*updates\.publish\(\{ id: 1 \}\)/
  )
  assert.match(text, /指定结果类型不会改变 channel 的订阅模型，也不会创建全局任务表/)
  assert.match(text, /保留事件上下文，原始载荷放在 event\.value/)
  assert.match(
    text,
    /\{ status: 'fulfilled', value \} 的 value 是监听器兑现后的返回值；\{ status: 'rejected', reason \} 的 reason 是监听器原始的抛错或拒绝原因/
  )
})

test('import the primary API from its public owner', () => {
  const host = readFileSync(
    join(buildRoot, 'zh/docs/capability/api/createCapabilityHost/index.html'),
    'utf8'
  )
  const timeout = readFileSync(
    join(buildRoot, 'zh/docs/utils/api/promise/withTimeout/index.html'),
    'utf8'
  )

  assert.match(
    renderedText(host),
    /import\s+\{[^}]*\bcreateCapabilityHost\b[^}]*\}\s+from\s+['"]@migaia\/capability['"]/
  )
  assert.match(
    renderedText(timeout),
    /import\s+\{[^}]*\bwithTimeout\b[^}]*\}\s+from\s+['"]@migaia\/utils\/promise['"]/
  )
})

test('gives every function detail page a copyable example', () => {
  const detailPages = emittedFiles(join(buildRoot, 'zh/docs')).filter((path) =>
    path.endsWith('index.html')
  )

  for (const path of detailPages) {
    const html = readFileSync(path, 'utf8')
    const callable = html.match(
      /class="single-api-reference" data-api-kind="function" data-api-name="([^"]+)"/
    )
    if (!callable) continue
    const apiName = callable[1]
    const text = renderedText(html)
    assert.match(html, new RegExp(`data-primary-api-example="${apiName}"`), path)
    assert.match(
      text,
      new RegExp(`import\\s+\\{[^}]*\\b${apiName}\\b[^}]*\\}\\s+from\\s+['"]@migaia/`),
      `copyable example for ${apiName} does not import its primary API: ${path}`
    )
  }
})

test('gives every class detail page a maintained example', () => {
  const detailPages = emittedFiles(join(buildRoot, 'zh/docs')).filter((path) =>
    path.endsWith('index.html')
  )

  for (const path of detailPages) {
    const html = readFileSync(path, 'utf8')
    const classPage = html.match(
      /class="single-api-reference" data-api-kind="class" data-api-name="([^"]+)"/
    )
    if (!classPage) continue
    assert.match(html, new RegExp(`data-primary-api-example="${classPage[1]}"`), path)
  }
})

test('recommends the native Promise.withResolvers API first', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')

  assert.match(html, /优先使用原生 API/)
  assert.match(html, /Promise\.withResolvers/)
  assert.match(html, /兼容旧运行时/)
})

test('explains execution timing and identity tradeoffs', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')

  assert.match(html, /当前调用栈立即执行/)
  assert.match(html, /下一次 microtask/)
  assert.match(html, /同一个 Promise/)
  assert.match(html, /新的链式 Promise/)
})

test('marks repository-only test infrastructure', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')

  assert.match(html, /本仓测试专用/)
  assert.match(html, /不面向外部业务代码/)
  assert.match(html, /测试框架提供的 fake timers/)
})

test('distinguishes the injectable clock from Date.now', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /systemScheduler.*performance\.now\(\).*单调不递减/s)
  assert.match(text, /now\(\).*单调不递减.*不是 Unix 时间戳/s)
  assert.match(text, /systemWallClock\.timestamp\(\).*Date\.now\(\)/s)
  assert.match(text, /scheduler\.now\(\).*scheduler\.schedule\(\)/s)
  assert.match(text, /不要把它与 now\(\) 混用或参与截止时间比较/)
  assert.doesNotMatch(text, /数值与 Date\.now\(\) 相同|Unix 时间戳，数值与精度没有区别/)
})

test('renders every code as a described list item', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(html, /<li><code>invalidArgument<\/code>/)
  assert.match(html, /<li><code>numberFormatInvalid<\/code>/)
  assert.match(text, /ERROR_IDENTITY_CONFLICT.*保留原错误身份/s)
  assert.match(text, /DEADLINE_EXCEEDED.*scope.*timeoutMs/s)
  assert.match(text, /NUMBER_FORMAT_INVALID.*Intl\.NumberFormat/s)
})

test('explains ArrayBuffer storage and Uint8Array views', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /ArrayBuffer.*原始连续内存.*不能按下标读写/s)
  assert.match(text, /Uint8Array.*8 位无符号整数视图.*0～255/s)
  assert.match(text, /byteOffset.*不会复制数据.*同一底层 ArrayBuffer/s)
  assert.match(text, /独立副本.*slice\(\).*共享窗口.*subarray\(\)/s)
  assert.match(text, /SharedArrayBuffer.*并发语义不同/s)
})

test('shows its input object and all result branches', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /const user = \{.*name: 'Ada'.*get profile\(\): never/s)
  assert.match(text, /switch \(result.kind\).*case 'value'.*case 'missing'.*case 'failed'/s)
  assert.match(text, /readLabel\(user, 'name'\).*读取成功，消费 value/s)
  assert.match(text, /readLabel\(user, 'email'\).*字段不存在，走业务默认值/s)
  assert.match(text, /readLabel\(user, 'profile'\).*getter 异常被显式上报/s)
  assert.match(text, /profileReads.*1.*没有为了判断结果而重复触发 getter/s)
  assert.match(text, /probeProperty\(value, key\) 的第一个参数 value.*普通对象、class 实例/s)
  assert.match(text, /字段不存在.*读取字段失败.*分开/s)
})

test('explains structured clone mechanics and limits', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /globalThis\.structuredClone\(\).*不经过 JSON 字符串/s)
  assert.match(text, /循环引用.*共享关系.*Date.*Map.*Set.*ArrayBuffer.*TypedArray/s)
  assert.match(text, /不会保留自定义 class 的原型方法.*getter\/setter.*属性描述符/s)
  assert.match(text, /没有传 transfer list.*ArrayBuffer.*复制.*不会.*detached/s)
  assert.match(text, /不调用 Object\.freeze\(\).*返回对象本身仍可修改/s)
  assert.match(text, /copy\.primary === copy\.alias.*true.*共享引用关系被保留/s)
})

test('contrasts strict and best-effort cloning', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /原生 structuredClone\(value\).*全有或全无/s)
  assert.match(text, /immutableSnapshot\(value\).*ENV_UNSUPPORTED.*CLONE_UNSUPPORTED/s)
  assert.match(text, /diagnosticSnapshot\(value\).*不先克隆整张对象图.*保留原引用/s)
  assert.match(text, /structuredDiagnosticSnapshot\(value\).*先尝试原生 structuredClone.*退回/s)
  assert.match(text, /value\.callback === callback.*true.*不支持的函数保留原引用/s)
  assert.match(text, /diagnostics 非空.*不能把返回值宣称为完全隔离快照/s)
})

test('documents its only meaningful policy use', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /identitySnapshot.*单独调用它没有运行时收益/s)
  assert.match(text, /可配置 snapshot policy.*零拷贝.*接受共享引用/s)
  assert.match(text, /liveConfig\.retry = 3.*retained\.retry.*3.*同一对象/s)
  assert.match(text, /可信进程内.*身份敏感或不可克隆对象.*共享所有权/s)
  assert.match(text, /外部输入.*历史状态.*跨边界传输.*immutableSnapshot/s)
})

test('explains immutable updates and structural sharing precisely', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /set\(\).*值真正变化时才返回新根/s)
  assert.match(text, /next\.user !== data\.user.*路径上的对象被浅拷贝/s)
  assert.match(text, /next\.settings === data\.settings.*未修改分支继续共享引用/s)
  assert.match(text, /immutable.*更新方式.*不会深拷贝整棵树.*不会调用 Object\.freeze/s)
  assert.match(text, /Object\.is\(\).*相等.*直接返回原根对象/s)
})

test('demonstrates admission, isolation, and managed successors', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /ownConfig.*接收外部配置的边界.*独立、可验证所有权/s)
  assert.match(text, /callerOptions\.retry\.attempts = 99.*config\.retry\.attempts.*2/s)
  assert.match(text, /Set 也已复制/s)
  assert.match(text, /WeakMap.*profile 与 limits/s)
  assert.match(
    text,
    /readonlyConfig.*公开读取用它，更新用 patchConfig\(\) 生成下一份受管理配置.*readConfigPath/s
  )
  assert.match(text, /返回对象没有被冻结.*运行时配置.*不应当作可序列化数据/s)
})

test('shows both inputs, merged output, and an explicit diff', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /const defaults = ownConfig\(\{\s*retries: 1/)
  assert.match(text, /const override = ownConfig\(\{\s*retries: 3/)
  assert.match(text, /strategies: \{ record: 'merge', array: 'concat' \}/)
  assert.match(text, /transport: \{ timeoutMs: 2500, keepAlive: true \}/)
  assert.match(text, /const diff = \{/)
  assert.match(text, /before: defaults\.retries, after: merged\.retries/)
  assert.match(text, /diff 只是把结果变化写明，不是 combineConfig 的额外返回值/)
})

test('explains module scope, singleton limits, and Proxy responsibility', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /export const getRuntime = once/)
  assert.match(text, /console\.log\(first === second\) \/\/ true/)
  assert.match(text, /每调用一次 once\(fn\) 都会创建一份独立缓存/)
  assert.match(text, /iframe、Worker、Node vm 等不同 realm/)
  assert.match(text, /globalThis\[Symbol\.for\('your-app\/runtime'\)\]/)
  assert.match(text, /Proxy 可以把首次属性访问转成惰性初始化/)
  assert.match(text, /它不会自动保证全局唯一/)
  assert.match(text, /不适合需要重试、重置、热更新或按请求隔离的初始化/)
})

test('explains concrete use cases and shared-failure boundaries', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')

  assert.match(html, /export const loadAppConfig = onceAsync/)
  assert.match(html, /加载不会刷新的启动配置/)
  assert.match(html, /初始化一个共享 SDK 客户端/)
  assert.match(html, /动态导入并编译同一份 WASM 模块/)
  assert.match(html, /首次失败会一直缓存/)
  assert.match(html, /按租户或请求隔离/)
  assert.match(html, /其他等待者也会受影响/)
  assert.match(html, /模块重复实例化或跨 iframe、Worker、Node <code>vm<\/code> 时不会共享/)
})

test('explains read-only behavior in plain language', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/utils/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /readonlyConfig.*给已有配置套上只读保护/s)
  assert.match(text, /正常读取.*没有复制第二份配置/s)
  assert.match(text, /不允许调用方.*修改任何层级/s)
  assert.match(text, /Map\.set\(\).*Set\.add\(\).*Date\.setFullYear\(\).*都会报错/s)
  assert.match(text, /patchConfig\(\).*生成下一份.*不是写 view/s)
  assert.doesNotMatch(text, /门面/)
})

test('keeps runtime APIs primary and typing subordinate', () => {
  for (const api of apiManifest.apis) {
    const html = readFileSync(
      join(buildRoot, artifactPath(publicModulePath('en', api.library, api.module))),
      'utf8'
    )
    for (const symbol of api.symbols) {
      const escapedFragment = symbol.fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (symbol.kind === 'type' || symbol.kind === 'interface') {
        assert.match(
          html,
          new RegExp(`class="type-declaration" id="${escapedFragment}"`),
          `typing is not subordinate: ${api.library}/${api.module}#${symbol.fragment}`
        )
        assert.doesNotMatch(
          html,
          new RegExp(`class="symbol-list"[\\s\\S]*?href="#${escapedFragment}"`),
          `typing leaked into API list: ${api.library}/${api.module}#${symbol.fragment}`
        )
      } else {
        assert.match(html, new RegExp(`href="[^"]+/${apiSymbolPath(symbol, api.symbols)}"`))
        assert.doesNotMatch(html, new RegExp(`class="symbol-section" id="${escapedFragment}"`))
      }
    }
  }
})

test('renders legacy type paths inside the subordinate module disclosure', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  assert.ok(routes.has('/zh/docs/utils/api/promise/IAbortSignal'))
  assert.match(docsSource, /const selectedType = selectedApi\?\.symbols\.find/)
  assert.match(docsSource, /selectedTypeFragment: selectedType\?\.fragment/)
  assert.match(
    docsSource,
    /docsModulePath\([\s\S]*alias\.ownerModule,[\s\S]*symbolSlug\(ownerSymbol, ownerApi\.symbols\)/
  )
  assert.match(docsSource, /navigate\([\s\S]*symbolSlug\(selectedSymbol, owner\.symbols\)/)
  assert.match(docsSource, /target\.scrollIntoView\(\{ block: 'start' }\)/)
})

test('keeps prose visible while complete signatures stay subordinate', () => {
  /** Approved inventory links must resolve to a real generated API route. */
  const apiRoutes = new Set(
    routeManifest.entries
      .map((entry) => entry.path)
      .filter((path) => /^\/(?:en|zh)\/docs\/[^/]+\/api(?:\/|$)/.test(path))
  )
  for (const file of emittedFiles(buildRoot).filter((candidate) => candidate.endsWith('.html'))) {
    /** Signature declarations and the trailing page navigation may start collapsed. */
    const html = readFileSync(file, 'utf8')
    /** The audited sidebar keeps the full API inventory below its essential entry links. */
    const leftRail = html.match(/<aside class="left-rail-content"[^>]*>([\s\S]*?)<\/aside>/)?.[1]
    /**
     * Body prose stays visible; only signatures and the two defined navigation disclosures may
     * fold.
     */
    const visibleProse = html
      .replace(/<section class="api-signature"[^>]*>[\s\S]*?<\/details>\s*<\/section>/g, '')
      .replace(/<details class="left-rail-inventory"[^>]*>[\s\S]*?<\/details>/g, (inventory) => {
        assert.ok(
          leftRail?.includes(inventory),
          `${file}: inventory must belong to library navigation`
        )
        assert.doesNotMatch(
          inventory.match(/^<details[^>]*>/)?.[0] ?? '',
          /\bopen(?:=|\s|>)/,
          `${file}: inventory starts closed for stable navigation`
        )
        assert.match(inventory, /<summary>[\s\S]*?<small>\d+<\/small><\/summary>/, file)
        /** Each inventory link uses a canonical module or symbol URL from the route manifest. */
        const links = [
          ...inventory.matchAll(/<a[^>]+href="(\/(?:en|zh)\/docs\/[^/]+\/api(?:\/[^"#]*)?)"/g)
        ]
        assert.ok(links.length > 0, `${file}: inventory must contain API links`)
        for (const [, path] of links)
          assert.ok(apiRoutes.has(path!), `${file}: inventory link must resolve: ${path}`)
        return ''
      })
      .replace(/<details class="page-toc"[^>]*>[\s\S]*?<\/details>/g, (navigation) => {
        assert.ok(html.indexOf(navigation) > html.lastIndexOf('</article>'), file)
        assert.doesNotMatch(
          navigation.match(/^<details[^>]*>/)?.[0] ?? '',
          /\bopen(?:=|\s|>)/,
          file
        )
        return ''
      })
    assert.doesNotMatch(visibleProse, /<details(?:\s|>)|<summary(?:\s|>)/, file)
  }
})

test('keeps every module type declaration visible with its code', () => {
  for (const api of apiManifest.apis) {
    const types = api.symbols.filter(
      (symbol) => symbol.kind === 'type' || symbol.kind === 'interface'
    )
    if (types.length === 0) continue
    for (const symbol of types) {
      const html = readFileSync(
        join(
          buildRoot,
          artifactPath(
            `${publicModulePath('en', api.library, api.module)}/${apiSymbolPath(symbol, api.symbols)}`
          )
        ),
        'utf8'
      )
      const start = html.indexOf(`id="${symbol.fragment}"`)
      assert.notEqual(start, -1, `${api.library}/${api.module} omits ${symbol.name}`)
      const next = html.indexOf('class="type-declaration"', start + 1)
      const declaration = html.slice(start, next === -1 ? undefined : next)
      assert.match(
        declaration,
        /<div class="explained-code(?: annotated)?"[^>]*data-code-kind="signature"[^>]*>\s*<figure class="code-frame">/,
        `${api.library}/${api.module} hides code for ${symbol.name}`
      )
    }
  }
})

test('gives primary tasks independent bilingual pages', () => {
  const expectations = [
    ['/zh/docs/store-react', '把响应式状态接入 React', '为什么选它'],
    ['/en/docs/store-react', 'Connect reactive state to React', 'Why choose it'],
    ['/zh/docs/store-react/getting-started', '渲染一个计数按钮', 'Provider 与 Registry 的创建参数'],
    [
      '/en/docs/store-react/getting-started',
      'Render a counter button',
      'Provider and Registry creation parameters'
    ],
    [
      '/zh/docs/store-react/provider-ownership-and-readiness',
      '关闭订单页面并释放所属 Store',
      '安排启动等待与后续渲染'
    ],
    [
      '/en/docs/store-react/provider-ownership-and-readiness',
      'Release the owned Store when closing an order page',
      'Arrange startup readiness and later rendering'
    ],
    [
      '/zh/docs/store-react/selectors-and-concurrent-tracking',
      '选择组件真正需要的值',
      '让读取保持稳定'
    ],
    [
      '/en/docs/store-react/selectors-and-concurrent-tracking',
      'Select the values a component needs',
      'Keep reads stable'
    ],
    [
      '/zh/docs/store-react/atoms-and-definitions',
      '读取 Provider 内的 Atom 定义',
      '定义和写入由 store-keyed 管理'
    ],
    [
      '/en/docs/store-react/atoms-and-definitions',
      'Read Atom definitions inside a Provider',
      'Definitions and writes belong to store-keyed'
    ],
    [
      '/zh/docs/store-react/resources-and-suspense',
      '在用户资料加载时显示占位内容',
      '管理实例并区分服务端与客户端'
    ],
    [
      '/en/docs/store-react/resources-and-suspense',
      'Show a fallback while a profile loads',
      'Manage instances and distinguish server/client behavior'
    ],
    [
      '/zh/docs/store-react/registry-and-dependency-injection',
      '按 token 注入订单 Store',
      '区分单项清理与范围关闭'
    ],
    [
      '/en/docs/store-react/registry-and-dependency-injection',
      'Inject an order Store by token',
      'Distinguish entry cleanup from scope closure'
    ],
    [
      '/zh/docs/store-react/features-and-config',
      '为收据组件启用所需功能',
      '给等待缓存选择稳定范围'
    ],
    [
      '/en/docs/store-react/features-and-config',
      'Enable the feature required by a receipt component',
      'Choose a stable scope for readiness caching'
    ],
    [
      '/zh/docs/store-react/ssr-strict-mode-and-shutdown',
      '隔离服务器请求并收取关闭结果',
      '按九个公开错误码定位调用'
    ],
    [
      '/en/docs/store-react/ssr-strict-mode-and-shutdown',
      'Isolate server requests and collect cleanup results',
      'Locate calls using the nine public error codes'
    ],
    ['/zh/docs/store-worker', '把计算和编解码接到 Worker', '为什么选它'],
    ['/en/docs/store-worker', 'Connect computation and codecs to a Worker', 'Why choose it'],
    [
      '/zh/docs/store-worker/getting-started',
      '在真实 Worker 中计算购物总价',
      '构造与首个请求的参数'
    ],
    [
      '/en/docs/store-worker/getting-started',
      'Calculate a shopping total in a real Worker',
      'Constructor and first-request parameters'
    ],
    [
      '/zh/docs/store-worker/choose-an-offload-path',
      '选择一次计算或序列化任务',
      '继续配置结果和字节'
    ],
    [
      '/en/docs/store-worker/choose-an-offload-path',
      'Choose computation or serialization',
      'Configure results and bytes next'
    ],
    [
      '/zh/docs/store-worker/adapter-requests-and-cancellation',
      '取消请求并停止连接',
      '关闭与释放的返回值'
    ],
    [
      '/en/docs/store-worker/adapter-requests-and-cancellation',
      'Cancel requests and stop a connection',
      'Results of closing and disposal'
    ],
    [
      '/zh/docs/store-worker/worker-handlers-and-lifecycle',
      '接收 Worker 消息并完成关闭',
      '消息函数附带的方法与属性'
    ],
    [
      '/en/docs/store-worker/worker-handlers-and-lifecycle',
      'Receive Worker messages and complete shutdown',
      'Methods and properties attached to the message function'
    ],
    [
      '/zh/docs/store-worker/resource-computed-and-cache',
      'Worker 计算与缓存',
      '选择缓存与重试行为'
    ],
    [
      '/en/docs/store-worker/resource-computed-and-cache',
      'Worker computations and cache',
      'Choose cache and retry behavior'
    ],
    [
      '/zh/docs/store-worker/serialization-worker-pipeline',
      '序列化 Worker 流程',
      '区分标签工具与流传送'
    ],
    [
      '/en/docs/store-worker/serialization-worker-pipeline',
      'Serialization worker pipeline',
      'Separate chunk tagging from streaming'
    ],
    [
      '/zh/docs/store-worker/byte-copy-and-transfer-ownership',
      '复制 Worker 字节并保留输入',
      '统一复制路径与调用者内存'
    ],
    [
      '/en/docs/store-worker/byte-copy-and-transfer-ownership',
      'Copy Worker bytes while retaining input',
      'One copy path and retained caller memory'
    ],
    ['/zh/docs/store-worker/errors-timeouts-and-cleanup', '错误、超时与清理', '保留错误的真实来源'],
    [
      '/en/docs/store-worker/errors-timeouts-and-cleanup',
      'Errors, timeouts, and cleanup',
      'Preserve the actual error source'
    ],
    [
      '/zh/docs/store-worker/performance-and-shutdown-order',
      '工作选择与关闭顺序',
      '从工作内容决定是否卸载'
    ],
    [
      '/en/docs/store-worker/performance-and-shutdown-order',
      'Workload choices and shutdown order',
      'Choose offloading from the work itself'
    ],
    ['/zh/docs/store-wasm', '让固定类型状态存入 WASM 内存', '为什么选它'],
    ['/en/docs/store-wasm', 'Keep fixed-layout state in WASM memory', 'Why choose it'],
    ['/zh/docs/store-wasm/getting-started', '创建并释放温度字段', '继续选择字段'],
    [
      '/en/docs/store-wasm/getting-started',
      'Create and release a temperature field',
      'Choose the next field'
    ],
    [
      '/zh/docs/store-wasm/initialization-and-provider-readiness',
      '先加载模块，再同步创建字段',
      '在 React 子树显示前等待'
    ],
    [
      '/en/docs/store-wasm/initialization-and-provider-readiness',
      'Load the module before creating fields',
      'Wait before rendering a React subtree'
    ],
    [
      '/zh/docs/store-wasm/choose-a-field-layout',
      '按数值、文字和集合选择字段',
      '容量是输入限制，不是分配保证'
    ],
    [
      '/en/docs/store-wasm/choose-a-field-layout',
      'Choose fields for numbers, text, and collections',
      'Capacity limits do not guarantee allocation'
    ],
    [
      '/zh/docs/store-wasm/number-boolean-and-string-fields',
      '读写数字、开关和定长文字',
      '相同值和失败写入怎样处理'
    ],
    [
      '/en/docs/store-wasm/number-boolean-and-string-fields',
      'Read and write numbers, toggles, and bounded text',
      'Equal values and failed writes'
    ],
    [
      '/zh/docs/store-wasm/array-granularity-and-bulk-writes',
      '数组粒度与批量写入',
      '批量写入前先检查输入'
    ],
    [
      '/en/docs/store-wasm/array-granularity-and-bulk-writes',
      'Array granularity and bulk writes',
      'Validate inputs before bulk writes'
    ],
    [
      '/zh/docs/store-wasm/record-layout-and-field-tracking',
      '记录布局与逐字段追踪',
      '固定记录的字段限制'
    ],
    [
      '/en/docs/store-wasm/record-layout-and-field-tracking',
      'Record layout and field tracking',
      'Limits of fixed records'
    ],
    [
      '/zh/docs/store-wasm/memory-safety-views-and-capacity',
      '内存视图与容量',
      '按业务限制固定容量'
    ],
    [
      '/en/docs/store-wasm/memory-safety-views-and-capacity',
      'Memory views and capacity',
      'Choose fixed capacities from product needs'
    ],
    ['/zh/docs/store-wasm/errors-rollback-and-disposal', '错误、回滚与释放', '错误与字段模式工具'],
    [
      '/en/docs/store-wasm/errors-rollback-and-disposal',
      'Errors, rollback, and disposal',
      'Error and field-mode tools'
    ],
    [
      '/zh/docs/store-wasm/performance-and-when-not-to-use',
      '何时保留普通 Store 字段',
      '根据布局需要选择'
    ],
    [
      '/en/docs/store-wasm/performance-and-when-not-to-use',
      'When ordinary store fields remain useful',
      'Choose from layout needs'
    ],
    ['/zh/docs/store-shared', 'Store Shared：共享整数，各自同步', '为什么选它'],
    [
      '/en/docs/store-shared',
      'Store Shared: shared integers, independent readers',
      'Why choose it'
    ],
    ['/zh/docs/store-shared/getting-started', '创建一个响应式库存视图', '观察者和共享内存分别管理'],
    [
      '/en/docs/store-shared/getting-started',
      'Create a reactive stock view',
      'Manage observers separately from shared memory'
    ],
    [
      '/zh/docs/store-shared/environment-and-buffer-handoff',
      '把共享库存传给 Worker',
      '每个线程持有自己的对象'
    ],
    [
      '/en/docs/store-shared/environment-and-buffer-handoff',
      'Pass shared stock to a Worker',
      'Each thread owns its local object'
    ],
    [
      '/zh/docs/store-shared/shared-signal-and-sync',
      '把远端写入带进本地视图',
      '争用处理来自底层读写'
    ],
    [
      '/en/docs/store-shared/shared-signal-and-sync',
      'Bring remote writes into a local view',
      'Contention handling belongs to the underlying reads and writes'
    ],
    [
      '/zh/docs/store-shared/shared-array-and-reactive-cells',
      '只追踪订单需要的共享数组下标',
      '读写与复制数组数据'
    ],
    [
      '/en/docs/store-shared/shared-array-and-reactive-cells',
      'Track the shared array index needed by an order',
      'Read, write, and copy array data'
    ],
    [
      '/zh/docs/store-shared/seqlock-and-contention',
      '读取一次已经完成的共享写入',
      '持续争用时会怎样'
    ],
    [
      '/en/docs/store-shared/seqlock-and-contention',
      'Read one completed shared write',
      'What happens during sustained contention'
    ],
    [
      '/zh/docs/store-shared/dirty-pages-and-sparse-sync',
      '同步其他运行时修改的数组',
      '了解底层同步方法的作用'
    ],
    [
      '/en/docs/store-shared/dirty-pages-and-sparse-sync',
      'Synchronize array writes from another Runtime',
      'Understand the low-level synchronization methods'
    ],
    [
      '/zh/docs/store-shared/watch-waitasync-and-fallback',
      '用真实 Worker 唤醒共享状态观察者',
      '在已有循环中选择手动同步'
    ],
    [
      '/en/docs/store-shared/watch-waitasync-and-fallback',
      'Wake shared-state observers from a real Worker',
      'Choose manual synchronization in an existing loop'
    ],
    [
      '/zh/docs/store-shared/atomic-update-and-low-level-primitives',
      '预订一件库存并了解底层方法',
      '共享 Signal 的观察节点成员'
    ],
    [
      '/en/docs/store-shared/atomic-update-and-low-level-primitives',
      'Reserve one item and understand low-level methods',
      'Observable members of a shared Signal'
    ],
    [
      '/zh/docs/store-shared/ownership-pruning-and-disposal',
      '关闭本地视图并保留共享数据',
      '分别结束视图、包装对象与 Worker'
    ],
    [
      '/en/docs/store-shared/ownership-pruning-and-disposal',
      'Close a local view while retaining shared data',
      'Finish views, wrappers, and Workers separately'
    ],
    [
      '/zh/docs/store-shared/security-capacity-and-recovery',
      '按可信快照重新创建共享库存',
      '识别七个公开错误码与原始宿主错误'
    ],
    [
      '/en/docs/store-shared/security-capacity-and-recovery',
      'Recreate shared stock from a trusted snapshot',
      'Identify seven public codes and original host errors'
    ],
    ['/zh/docs/store-devtools', '查看 Store 的历史、动作与真实依赖关系', '为什么选它'],
    [
      '/en/docs/store-devtools',
      'Inspect Store history, actions and real dependency paths',
      'Why choose it'
    ],
    ['/zh/docs/store-devtools/getting-started', '记录修改并恢复购物车数量', 'tools 的全部成员'],
    [
      '/en/docs/store-devtools/getting-started',
      'Record an edit and restore a cart quantity',
      'Every member of tools'
    ],
    [
      '/zh/docs/store-devtools/session-and-history',
      '设置历史容量并标记调试时刻',
      '检查条目是否还在历史中'
    ],
    [
      '/en/docs/store-devtools/session-and-history',
      'Bound history and label debugging checkpoints',
      'Check whether an entry remains available'
    ],
    [
      '/zh/docs/store-devtools/actions-and-runtime-trace',
      '查看动作摘要与 Runtime 事件',
      '区分历史与整条 Runtime 流'
    ],
    [
      '/en/docs/store-devtools/actions-and-runtime-trace',
      'Inspect action summaries and Runtime events',
      'Distinguish history from the Runtime stream'
    ],
    [
      '/zh/docs/store-devtools/time-travel-and-side-effects',
      '恢复字段时，观察者还会执行',
      '回放期间记录哪些内容'
    ],
    [
      '/en/docs/store-devtools/time-travel-and-side-effects',
      'Observers still run when restoring fields',
      'Recording during replay'
    ],
    [
      '/zh/docs/store-devtools/dependency-and-observer-trees',
      '依赖树与观察者树',
      '读取结果与展开深度'
    ],
    [
      '/en/docs/store-devtools/dependency-and-observer-trees',
      'Dependency and observer trees',
      'Returned data and traversal depth'
    ],
    [
      '/zh/docs/store-devtools/clone-redaction-and-failure-containment',
      '克隆、脱敏与失败处理',
      '编辑无效 JSON 时诊断失败不打断草稿'
    ],
    [
      '/en/docs/store-devtools/clone-redaction-and-failure-containment',
      'Cloning, redaction, and failure handling',
      'Keep a draft usable when diagnostic JSON parsing fails'
    ],
    [
      '/zh/docs/store-devtools/command-bridge-boundary',
      '命令常量与本地映射',
      '常量提供拼写，应用决定动作'
    ],
    [
      '/en/docs/store-devtools/command-bridge-boundary',
      'Command constants and local mapping',
      'Constants name commands; the application chooses actions'
    ],
    ['/zh/docs/store-devtools/performance-and-disposal', '诊断成本与释放', '关闭会话与处理失败'],
    [
      '/en/docs/store-devtools/performance-and-disposal',
      'Diagnostic cost and disposal',
      'Dispose the session and handle failures'
    ],
    ['/zh/docs/store-ssr', '为每次请求收集页面状态', '为什么选它'],
    ['/en/docs/store-ssr', 'Collect page state for each request', 'Why choose it'],
    ['/zh/docs/store-ssr/getting-started', '生成第一次请求的状态文本', '返回的作用域可做什么'],
    [
      '/en/docs/store-ssr/getting-started',
      'Produce state text for the first request',
      'What the returned scope provides'
    ],
    [
      '/zh/docs/store-ssr/request-isolation-and-runtime',
      '让每次请求使用自己的状态',
      '把创建和清理放在同一请求 owner 中'
    ],
    [
      '/en/docs/store-ssr/request-isolation-and-runtime',
      'Give each request its own state',
      'Keep creation and cleanup with the request owner'
    ],
    [
      '/zh/docs/store-ssr/register-and-own-state',
      '登记状态并确定清理责任',
      '先收到快照，再登记对象'
    ],
    [
      '/en/docs/store-ssr/register-and-own-state',
      'Register state and assign cleanup ownership',
      'Receive state before registering an object'
    ],
    [
      '/zh/docs/store-ssr/hydrate-and-dehydrate',
      '把订单快照还原到新的请求范围',
      '选择稳定传输快照'
    ],
    [
      '/en/docs/store-ssr/hydrate-and-dehydrate',
      'Restore an order snapshot into a new request scope',
      'Choose a stable transfer snapshot'
    ],
    [
      '/zh/docs/store-ssr/await-resources-and-timeouts',
      '等待读取完成后生成首屏数据',
      '等待后打包资源与 Store'
    ],
    [
      '/en/docs/store-ssr/await-resources-and-timeouts',
      'Wait for loading before generating initial page data',
      'Package resources and Stores after waiting'
    ],
    ['/zh/docs/store-ssr/embed-and-read-state', '把结账状态写入页面并读回', '文档对象和数据标签'],
    [
      '/en/docs/store-ssr/embed-and-read-state',
      'Write checkout state into HTML and read it back',
      'Document fields and data elements'
    ],
    [
      '/zh/docs/store-ssr/custom-codecs-and-abort',
      '通过编解码器生成状态脚本',
      '从真实文档入口读取编码状态'
    ],
    [
      '/en/docs/store-ssr/custom-codecs-and-abort',
      'Generate a state script through a codec registry',
      'Read encoded state from a document host'
    ],
    [
      '/zh/docs/store-ssr/validation-security-and-trusted-path',
      '检查状态，再选择受信路径',
      '受信类型不能代替数据检查'
    ],
    [
      '/en/docs/store-ssr/validation-security-and-trusted-path',
      'Validate state before choosing the trusted path',
      'A trusted type is not input authentication'
    ],
    [
      '/zh/docs/store-ssr/shutdown-errors-and-streaming',
      '流输出完成后关闭请求范围',
      '区分十二个公开错误码'
    ],
    [
      '/en/docs/store-ssr/shutdown-errors-and-streaming',
      'Close the request scope after stream output completes',
      'Distinguish the twelve public error codes'
    ],
    ['/zh/docs/store-persist', '恢复设置与集合，按顺序保存修改', '为什么选它'],
    [
      '/en/docs/store-persist',
      'Restore settings and collections, then save changes in order',
      'Why choose it'
    ],
    ['/zh/docs/store-persist/getting-started', '保存并读回主题设置', '接入应用中的存储'],
    [
      '/en/docs/store-persist/getting-started',
      'Save and read back a theme',
      'Connect application storage'
    ],
    ['/zh/docs/store-persist/choose-an-adapter', '按状态对象选择保存入口', '选项差别与错误'],
    [
      '/en/docs/store-persist/choose-an-adapter',
      'Choose the entry for your state object',
      'Option differences and errors'
    ],
    [
      '/zh/docs/store-persist/partialize-merge-and-migrations',
      '筛选保存字段并升级旧格式',
      '选择合并方式'
    ],
    [
      '/en/docs/store-persist/partialize-merge-and-migrations',
      'Select saved fields and upgrade old formats',
      'Choose how to combine saved and current state'
    ],
    [
      '/zh/docs/store-persist/codecs-and-storage-capabilities',
      '选择文本或字节保存格式',
      '单次存取工具的参数与结果'
    ],
    [
      '/en/docs/store-persist/codecs-and-storage-capabilities',
      'Choose text or byte storage',
      'Parameters and results for one-off storage helpers'
    ],
    [
      '/zh/docs/store-persist/hydration-and-startup-races',
      '恢复与启动竞态',
      '区分“尝试结束”和“读取成功”'
    ],
    [
      '/en/docs/store-persist/hydration-and-startup-races',
      'Hydration and startup races',
      'Separate attempt completion from success'
    ],
    [
      '/zh/docs/store-persist/write-queue-debounce-and-flush',
      '有序写入、防抖与保存',
      '关闭时仍有待保存的编辑'
    ],
    [
      '/en/docs/store-persist/write-queue-debounce-and-flush',
      'Write queues, debounce, and flush',
      'Close with an edit still awaiting its timer'
    ],
    [
      '/zh/docs/store-persist/keyed-families-and-clear',
      '按键保存与批量删除',
      '退出用户草稿编辑后删除存档'
    ],
    [
      '/en/docs/store-persist/keyed-families-and-clear',
      'Keyed persistence and clearing',
      'Remove archives after leaving the draft editor'
    ],
    ['/zh/docs/store-persist/retry-errors-and-shutdown', '重试、错误与关闭', '排错与适配器工具'],
    [
      '/en/docs/store-persist/retry-errors-and-shutdown',
      'Retry, errors, and shutdown',
      'Troubleshooting and adapter tools'
    ],
    ['/zh/docs/store-middleware', '观察 Store 动作并明确写入与清理边界', '为什么选它'],
    [
      '/en/docs/store-middleware',
      'Observe Store actions with explicit write and cleanup boundaries',
      'Why choose it'
    ],
    ['/zh/docs/store-middleware/getting-started', '给计数 Store 接入日志', '绑定返回什么'],
    [
      '/en/docs/store-middleware/getting-started',
      'Add logging to a counter Store',
      'What the binding returns'
    ],
    [
      '/zh/docs/store-middleware/binding-and-shared-policy',
      '绑定已有 Store 与共享写入策略',
      '返回句柄与插件管理'
    ],
    [
      '/en/docs/store-middleware/binding-and-shared-policy',
      'Bind a Store and share its mutation policy',
      'Returned handle and plugin management'
    ],
    ['/zh/docs/store-middleware/events-and-plugins', '按事件编写审计插件', '同步管道的处理顺序'],
    [
      '/en/docs/store-middleware/events-and-plugins',
      'Write an audit plugin for events',
      'Synchronous pipeline order'
    ],
    [
      '/zh/docs/store-middleware/actions-and-mutation-boundaries',
      '在同一操作范围内更新订单',
      '理解业务函数与事件的完成时间'
    ],
    [
      '/en/docs/store-middleware/actions-and-mutation-boundaries',
      'Update an order inside one action scope',
      'Distinguish business execution from event timing'
    ],
    [
      '/zh/docs/store-middleware/snapshot-clone-policies',
      '保存订单记录时选择复制方式',
      '了解诊断复制的实际限制'
    ],
    [
      '/en/docs/store-middleware/snapshot-clone-policies',
      'Choose a copy policy when recording an order',
      'Understand diagnostic fallback limits'
    ],
    [
      '/zh/docs/store-middleware/devtools-and-state-commands',
      '通过本地检查器恢复计数状态',
      '安装、应用状态与卸载'
    ],
    [
      '/en/docs/store-middleware/devtools-and-state-commands',
      'Restore counter state from a local inspector',
      'Install, apply state, and remove'
    ],
    [
      '/zh/docs/store-middleware/pipeline-errors-and-reentrancy',
      '让事件继续传递并区分错误出口',
      '检查七个公开错误码'
    ],
    [
      '/en/docs/store-middleware/pipeline-errors-and-reentrancy',
      'Continue event delivery and distinguish failure paths',
      'Inspect the seven public error codes'
    ],
    [
      '/zh/docs/store-middleware/shutdown-and-ownership',
      '先关闭观察绑定，再处理 Store',
      '检查逻辑关闭与实际清理'
    ],
    [
      '/en/docs/store-middleware/shutdown-and-ownership',
      'Close observation bindings before disposing the Store',
      'Inspect logical closure and physical cleanup'
    ],
    ['/zh/docs/store-indexed', '只观察视图读取的字段、下标与成员', '为什么选它'],
    [
      '/en/docs/store-indexed',
      'Observe the fields, positions, and members a view reads',
      'Why choose it'
    ],
    ['/zh/docs/store-indexed/getting-started', '观察任务列表的第一项', '写入检查、调试名称与释放'],
    [
      '/en/docs/store-indexed/getting-started',
      'Observe the first task in a list',
      'Mutation checks, debug naming, and cleanup'
    ],
    ['/zh/docs/store-indexed/choose-a-collection', '按数据形状选择集合', '四种集合共用的成员'],
    [
      '/en/docs/store-indexed/choose-a-collection',
      'Choose a collection for the data shape',
      'Members shared by all four collections'
    ],
    [
      '/zh/docs/store-indexed/tracking-and-cell-lifecycle',
      '让价格视图只读取所需条目',
      '让集合与观察者使用同一个 Runtime'
    ],
    [
      '/en/docs/store-indexed/tracking-and-cell-lifecycle',
      'Let a price view read its selected entry',
      'Use one Runtime for the collection and its observer'
    ],
    [
      '/zh/docs/store-indexed/array-index-semantics',
      '删除首行后继续观察第一个位置',
      '位置变化不等于跟随同一商品'
    ],
    [
      '/en/docs/store-indexed/array-index-semantics',
      'Observe the first position after removing a row',
      'Position tracking does not follow a product'
    ],
    [
      '/zh/docs/store-indexed/bulk-replacement-and-pruning',
      '用新库存整体替换当前内容',
      '理解 prune 实际整理什么'
    ],
    [
      '/en/docs/store-indexed/bulk-replacement-and-pruning',
      'Replace current contents with refreshed inventory',
      'Understand what prune actually retires'
    ],
    [
      '/zh/docs/store-indexed/mutation-guards-and-runtime',
      '在操作范围内修改订单',
      '让集合与观察使用同一运行时'
    ],
    [
      '/en/docs/store-indexed/mutation-guards-and-runtime',
      'Modify an order inside an action',
      'Use one runtime for a collection and its observers'
    ],
    [
      '/zh/docs/store-indexed/disposal-and-errors',
      '关闭选择列表并保留错误来源',
      '检查五个公开码与外部错误'
    ],
    [
      '/en/docs/store-indexed/disposal-and-errors',
      'Close a selection list and preserve error sources',
      'Check five public codes and external errors'
    ],
    ['/zh/docs/store-keyed', 'Store Keyed：一份状态定义，在每个作用域里各有一份值', '为什么选它'],
    [
      '/en/docs/store-keyed',
      'Store Keyed: one state definition, a separate value in every scope',
      'Why choose it'
    ],
    ['/zh/docs/store-keyed/getting-started', '订阅购物车小计', '继续查找 AtomStore 成员'],
    [
      '/en/docs/store-keyed/getting-started',
      'Subscribe to a cart subtotal',
      'Find the remaining AtomStore members'
    ],
    [
      '/zh/docs/store-keyed/definitions-and-scopes',
      '定义复用与独立会话状态',
      '供适配器使用的实例 atom 协议'
    ],
    [
      '/en/docs/store-keyed/definitions-and-scopes',
      'Reuse definitions with independent session state',
      'The instance atom protocol for adapters'
    ],
    [
      '/zh/docs/store-keyed/derived-and-writable-state',
      '把结算操作放进可写派生',
      '调度更新与处理失败'
    ],
    [
      '/en/docs/store-keyed/derived-and-writable-state',
      'Put checkout logic in a writable derivation',
      'Schedule updates and handle failures'
    ],
    [
      '/zh/docs/store-keyed/optics-and-split-lists',
      '按商品键编辑列表中的数量',
      '需要自定义投影时复用底层工具'
    ],
    [
      '/en/docs/store-keyed/optics-and-split-lists',
      'Edit a line quantity by its product key',
      'Reuse low-level tools for custom projections'
    ],
    [
      '/zh/docs/store-keyed/families-and-cache-identity',
      '按会话编号选择草稿定义',
      '管理定义缓存与已有状态'
    ],
    [
      '/en/docs/store-keyed/families-and-cache-identity',
      'Choose a draft definition by conversation ID',
      'Manage cached definitions and existing state'
    ],
    [
      '/zh/docs/store-keyed/preview-and-overrides',
      '预览表单与临时替换价格',
      '临时使用活动价格，再恢复普通价格'
    ],
    [
      '/en/docs/store-keyed/preview-and-overrides',
      'Preview a form and temporarily replace pricing',
      'Use campaign pricing and restore regular pricing'
    ],
    [
      '/zh/docs/store-keyed/release-and-disposal',
      '关闭会话后回收状态和缓存',
      '按公开错误码检查原因'
    ],
    [
      '/en/docs/store-keyed/release-and-disposal',
      'Release state and cached definitions after a conversation closes',
      'Inspect failures using public codes'
    ],
    [
      '/zh/docs/store-light',
      'Store Light：用普通对象写状态，字段、派生值和方法自动响应',
      '为什么选它'
    ],
    [
      '/en/docs/store-light',
      'Store Light: write state as a plain object, and fields, derived values and methods react',
      'Why choose it'
    ],
    [
      '/zh/docs/store-light/getting-started',
      '安装并创建一个设置对象',
      '创建后可以读什么、调用什么'
    ],
    [
      '/en/docs/store-light/getting-started',
      'Install and create a settings object',
      'Properties and methods after creation'
    ],
    ['/zh/docs/store-light/object-store-model', '字段、计算值、方法和订阅', '一起修改配送地址'],
    [
      '/en/docs/store-light/object-store-model',
      'Fields, computed values, methods, and subscriptions',
      'Update a shipping address together'
    ],
    [
      '/zh/docs/store-light/field-builders-and-mutation',
      '接入自定义字段和写入策略',
      '失败与释放如何处理'
    ],
    [
      '/en/docs/store-light/field-builders-and-mutation',
      'Add custom fields and write policies',
      'Failure and cleanup'
    ],
    [
      '/zh/docs/store-light/async-fields-and-readiness',
      '异步字段与就绪',
      '初始化失败也要释放已创建字段'
    ],
    [
      '/en/docs/store-light/async-fields-and-readiness',
      'Asynchronous fields and readiness',
      'Release initialized fields after another fails'
    ],
    ['/zh/docs/store-light/snapshots-and-hydration', '快照与恢复', '恢复旧设置'],
    [
      '/en/docs/store-light/snapshots-and-hydration',
      'Snapshots and hydration',
      'Restore older settings'
    ],
    ['/zh/docs/store-light/resources-and-suspense', '异步资源与 Suspense', '关闭一组报告资源'],
    [
      '/en/docs/store-light/resources-and-suspense',
      'Resources and Suspense',
      'Close a group of report resources'
    ],
    [
      '/zh/docs/store-light/resource-versions-and-lifecycle',
      '版本与资源释放',
      '等待关闭并保留失败线索'
    ],
    [
      '/en/docs/store-light/resource-versions-and-lifecycle',
      'Resource versions and cleanup',
      'Await cleanup and preserve failures'
    ],
    ['/zh/docs/wasm', 'Wasm：对齐分配字节，独立读取转码结果', '为什么选它'],
    ['/en/docs/wasm', 'Wasm: aligned bytes and independent conversion results', 'Why choose it'],
    ['/zh/docs/wasm/getting-started', '快速开始：写入并读取地图坐标', '继续分配时重新创建视图'],
    [
      '/en/docs/wasm/getting-started',
      'Quick start: write and read map coordinates',
      'Recreate views when allocating more'
    ],
    [
      '/zh/docs/wasm/initialization-and-hosts',
      '初始化与宿主：从本地文件启动草稿转换',
      '使用返回的内存，转换用具名函数'
    ],
    [
      '/en/docs/wasm/initialization-and-hosts',
      'Initialization and hosts: start draft conversion from a local file',
      'Use returned memory and named conversion functions'
    ],
    [
      '/zh/docs/wasm/arena-memory',
      '暂存字节和数值，读取时使用当前内存',
      '根据返回值处理分配和释放'
    ],
    [
      '/en/docs/wasm/arena-memory',
      'Store bytes and numbers using the current memory',
      'Handle allocation and release results'
    ],
    [
      '/zh/docs/wasm/conversion-boundaries',
      '转换边界：把一份草稿存为 MessagePack，再还原',
      '一份输入只能包含一个文档'
    ],
    [
      '/en/docs/wasm/conversion-boundaries',
      'Conversion boundaries: save a draft as MessagePack and restore it',
      'One input must contain one document'
    ],
    [
      '/zh/docs/wasm/ownership-and-cleanup',
      '使用后清理：转码结果和字节缓冲区分别释放',
      '哪些数据仍然需要保留'
    ],
    [
      '/en/docs/wasm/ownership-and-cleanup',
      'Clean up after use: release conversion results and byte buffers separately',
      'Data that may still need to remain available'
    ],
    [
      '/zh/docs/wasm/troubleshooting',
      '排错：转码没有输出，或字节视图不能用了',
      '视图或释放结果不符合预期'
    ],
    [
      '/en/docs/wasm/troubleshooting',
      'Troubleshooting: conversion has no output or a byte view stops working',
      'Investigate unexpected view or release results'
    ],
    ['/zh/docs/tray', 'Tray：就绪后使用，结束时释放', '为什么选它'],
    ['/en/docs/tray', 'Tray: become ready, run, then release', 'Why choose it'],
    ['/zh/docs/tray/getting-started', '从一个配置值开始', '需要多个插件实例时'],
    [
      '/en/docs/tray/getting-started',
      'Start with one configuration value',
      'When you need multiple plugin instances'
    ],
    ['/zh/docs/tray/static-composition', '让计算值等待配置', '什么时候发现定义错误'],
    [
      '/en/docs/tray/static-composition',
      'Let computed values wait for configuration',
      'When definition errors appear'
    ],
    ['/zh/docs/tray/readiness-and-errors', '确认启动条件，再处理错误', '完整错误码'],
    [
      '/en/docs/tray/readiness-and-errors',
      'Check readiness before handling errors',
      'All error codes'
    ],
    ['/zh/docs/tray/resource-ownership', '把文件交给 Graph 释放', '取消和完成是两件事'],
    [
      '/en/docs/tray/resource-ownership',
      'Let the Graph release an audit file',
      'Cancellation and completion are separate'
    ],
    ['/zh/docs/tray/dynamic-host', '运行中添加报告插件', '保留已知扩展类型'],
    [
      '/en/docs/tray/dynamic-host',
      'Add a report plugin while running',
      'Retain known extension types'
    ],
    ['/zh/docs/tray/mutation-and-blocking', '补齐依赖后启用收银插件', '保留一次变更的完整观察'],
    [
      '/en/docs/tray/mutation-and-blocking',
      'Enable checkout when its dependency arrives',
      'Retain the complete mutation observation'
    ],
    ['/zh/docs/tray/physical-cleanup', '卸载后等待报告任务结束', '按实际资源关系关闭'],
    [
      '/en/docs/tray/physical-cleanup',
      'Wait for report completion after removal',
      'Close according to resource ownership'
    ],
    ['/zh/docs/tray/loaders-and-adapters', '从文件加载报告插件', '区分返回资源和资源释放'],
    [
      '/en/docs/tray/loaders-and-adapters',
      'Load a report plugin from a file',
      'Separate artifacts from their release'
    ],
    ['/zh/docs/tray/runtime-tasks', '完成报告任务后卸载自身', '在当前一代中执行回调'],
    [
      '/en/docs/tray/runtime-tasks',
      'Remove a report plugin after its task finishes',
      'Execute against the current generation'
    ],
    ['/zh/docs/tray/instances-and-routing', '管理实例与选择报价路由', '按当前记录处理调用失败'],
    [
      '/en/docs/tray/instances-and-routing',
      'Manage instances and route pricing calls',
      'Handle calls according to the current record'
    ],
    [
      '/zh/docs/tray/native-thread-and-process',
      '运行真实 Worker 和子进程',
      '区分已运行场景和源码说明'
    ],
    [
      '/en/docs/tray/native-thread-and-process',
      'Run real Workers and child processes',
      'Separate executed examples from source-based options'
    ],
    ['/zh/docs/tray/topics-and-events', '发布业务消息与观察实例事件', '观察事件并结束等待'],
    [
      '/en/docs/tray/topics-and-events',
      'Publish topics and observe instance events',
      'Observe events and finish waiting'
    ],
    ['/zh/docs/utils', 'Utils：把超时、重试、并发和错误追踪写对', '按问题找 API'],
    [
      '/en/docs/utils',
      'Utils: get timeouts, retries, concurrency and error tracing right',
      'Find the API for your problem'
    ],
    ['/zh/docs/utils/getting-started', '快速开始：给一个不稳定的请求加上重试', 'retry 的选项'],
    [
      '/en/docs/utils/getting-started',
      'Quick start: add retries to a flaky request',
      'retry options'
    ],
    ['/zh/docs/utils/deadlines-and-abort', '超时与取消', '选项'],
    ['/en/docs/utils/deadlines-and-abort', 'Timeouts and cancellation', 'Options'],
    ['/zh/docs/utils/retry-and-concurrency', '重试与并发限制', '限制同时进行的任务数'],
    [
      '/en/docs/utils/retry-and-concurrency',
      'Retries and concurrency limits',
      'Cap concurrent tasks'
    ],
    ['/zh/docs/utils/error-identity-and-causes', '错误身份与原因链', '本包的错误代码'],
    [
      '/en/docs/utils/error-identity-and-causes',
      'Error identification and causes',
      'Error codes of this package'
    ],
    ['/zh/docs/utils/bytes-and-text', '字节与文本：Base64 和 UTF-8', 'ArrayBuffer 和 Uint8Array'],
    [
      '/en/docs/utils/bytes-and-text',
      'Bytes and text: Base64 and UTF-8',
      'ArrayBuffer and Uint8Array'
    ],
    ['/zh/docs/utils/immutable-objects-and-paths', '对象路径与不可变更新', '路径写法'],
    [
      '/en/docs/utils/immutable-objects-and-paths',
      'Object paths and immutable updates',
      'Path syntax'
    ],
    ['/zh/docs/utils/configuration-ownership', '配置所有权：接收、保护、更新、合并', '选项'],
    [
      '/en/docs/utils/configuration-ownership',
      'Configuration ownership: accept, protect, update, merge',
      'Options'
    ],
    ['/zh/docs/utils/function-and-value-guards', '一次性初始化与值判断', '判断空值和值的种类'],
    [
      '/en/docs/utils/function-and-value-guards',
      'Run once and value checks',
      'Check empty values and value kinds'
    ],
    ['/zh/docs/utils/strings-and-numbers', '字符串模板与数字格式化', '数字格式化'],
    [
      '/en/docs/utils/strings-and-numbers',
      'String templates and number formatting',
      'Number formatting'
    ],
    ['/zh/docs/storage-web', '按数据种类保存记录，并明确升级与释放', '为什么选它'],
    [
      '/en/docs/storage-web',
      'Store record kinds with explicit upgrades and cleanup',
      'Why choose it'
    ],
    ['/zh/docs/storage-web/getting-started', '安装并保存第一项设置', '命名空间编解码器'],
    ['/en/docs/storage-web/getting-started', 'Install and save a setting', 'Namespace codec'],
    [
      '/zh/docs/storage-web/entity-schema-and-codecs',
      '校验、查询并升级业务记录',
      '版本升级与迁移统计'
    ],
    [
      '/en/docs/storage-web/entity-schema-and-codecs',
      'Validate, query, and upgrade application records',
      'Version upgrades and migration counts'
    ],
    ['/zh/docs/storage-web/host-and-plugins', '按名称组合存储并统一关闭', '检查自定义后端 ID'],
    [
      '/en/docs/storage-web/host-and-plugins',
      'Compose named stores and close them together',
      'Validate custom backend IDs'
    ],
    [
      '/zh/docs/storage-web/indexeddb-and-transactions',
      'IndexedDB：记录、分页与事务',
      '让升级和关闭完成'
    ],
    [
      '/en/docs/storage-web/indexeddb-and-transactions',
      'IndexedDB records, scans, and transactions',
      'Allow upgrade and shutdown'
    ],
    [
      '/zh/docs/storage-web/reactive-live-queries',
      '持续查询：让页面跟随存储变化',
      '页面关闭时停止查询'
    ],
    [
      '/en/docs/storage-web/reactive-live-queries',
      'Live queries that follow storage changes',
      'Stop querying when the page closes'
    ],
    [
      '/zh/docs/storage-web/cookies-and-security',
      'Cookie：路径、删除与可见范围',
      '区分可见偏好与认证数据'
    ],
    [
      '/en/docs/storage-web/cookies-and-security',
      'Cookie paths, deletion, and visibility',
      'Separate visible preferences from authentication data'
    ],
    [
      '/zh/docs/storage-web/cancellation-errors-and-shutdown',
      '取消、错误与关闭',
      '关闭访问对象，保留持久数据'
    ],
    [
      '/en/docs/storage-web/cancellation-errors-and-shutdown',
      'Cancellation, errors, and shutdown',
      'Close the accessor and keep persisted data'
    ],
    ['/zh/docs/logger', 'Logger：把结构化日志交给明确的输出端', '内置插件'],
    ['/en/docs/logger', 'Logger: send structured entries to explicit outputs', 'Built-in plugins'],
    ['/zh/docs/logger/getting-started', '快速开始：第一个 Logger', '常用方法'],
    ['/en/docs/logger/getting-started', 'Quick start: your first Logger', 'Common methods'],
    ['/zh/docs/logger/entries-hooks-and-sinks', 'Entry、Hook 与 Sink', '输出端出错时'],
    [
      '/en/docs/logger/entries-hooks-and-sinks',
      'Entries, hooks, and sinks',
      'When an output fails'
    ],
    ['/zh/docs/logger/plugins-and-batching', '内置插件与批量上报', '其他插件'],
    ['/en/docs/logger/plugins-and-batching', 'Built-in plugins and batching', 'Other plugins'],
    ['/zh/docs/logger/custom-plugin', '编写自定义插件', '编写插件时注意'],
    ['/en/docs/logger/custom-plugin', 'Write a custom plugin', 'Rules for plugins'],
    ['/zh/docs/logger/pipelines', '处理步骤：在输出之前修改或拦截日志', '选择模式'],
    [
      '/en/docs/logger/pipelines',
      'Pipelines: modify or drop entries before output',
      'Choose a mode'
    ],
    ['/zh/docs/logger/flush-and-shutdown', 'Flush 与关闭：退出前确认日志都写完', '例子'],
    [
      '/en/docs/logger/flush-and-shutdown',
      'Flush and shutdown: confirm logs are written before exit',
      'Example'
    ],
    ['/zh/docs/logger/runtime-and-forwarding', '转发与运行环境', '替换底层能力'],
    [
      '/en/docs/logger/runtime-and-forwarding',
      'Forwarding and runtime',
      'Replace low-level capabilities'
    ],
    ['/zh/docs/logger/troubleshooting', '排错与常见问题', '常见错误代码'],
    ['/en/docs/logger/troubleshooting', 'Troubleshooting and FAQ', 'Common error codes'],
    ['/zh/docs/plugin-host', 'Plugin Host：把安装、依赖和清理交给宿主', '为什么选它'],
    [
      '/en/docs/plugin-host',
      'Plugin Host: own installation, dependencies and cleanup',
      'Why choose it'
    ],
    ['/zh/docs/plugin-host/getting-started', '快速开始：安装第一个插件', 'defineHost 的选项'],
    [
      '/en/docs/plugin-host/getting-started',
      'Quick start: install your first plugin',
      'defineHost options'
    ],
    ['/zh/docs/plugin-host/install-and-compose', '插件之间共享能力', '依赖关系受到保护'],
    [
      '/en/docs/plugin-host/install-and-compose',
      'Share capabilities between plugins',
      'Dependencies are protected'
    ],
    ['/zh/docs/plugin-host/configuration', '插件配置', '配置的规则'],
    ['/en/docs/plugin-host/configuration', 'Plugin configuration', 'Configuration rules'],
    [
      '/zh/docs/plugin-host/pipelines',
      '处理链：让插件参与处理每一个请求',
      '选择模式并使用对应的注册方法'
    ],
    [
      '/en/docs/plugin-host/pipelines',
      'Pipelines: let plugins process every request',
      'Choose a mode and the matching registration method'
    ],
    ['/zh/docs/plugin-host/removal-and-rollback', '卸载、禁用与替换', '禁用：暂停而不释放'],
    [
      '/en/docs/plugin-host/removal-and-rollback',
      'Remove, disable, and replace',
      'Disable: pause without releasing'
    ],
    ['/zh/docs/capability', 'Capability：让功能启停有归属、依赖有顺序', '为什么选它'],
    [
      '/en/docs/capability',
      'Capability: owned feature lifetimes and ordered dependencies',
      'Why choose it'
    ],
    ['/zh/docs/capability/getting-started', '快速开始：打开通知功能，再关闭它', '启用结果与状态'],
    [
      '/en/docs/capability/getting-started',
      'Quick start: open a notification feature, then close it',
      'Enable results and states'
    ],
    ['/zh/docs/capability/graph', '读取配置后启动界面', '按错误码找到问题'],
    [
      '/en/docs/capability/graph',
      'Start a view after loading configuration',
      'Find the cause by error code'
    ],
    [
      '/zh/docs/capability/graph-dynamic',
      '动态 Graph：运行中更换服务，等待旧请求结束',
      '由组合层启动和释放实例'
    ],
    [
      '/en/docs/capability/graph-dynamic',
      'Dynamic Graph: replace a service after old requests finish',
      'Let the composition layer start and release instances'
    ],
    ['/zh/docs/capability/graph-topology', '先检查依赖，再计算启动顺序', '解释检查失败的原因'],
    [
      '/en/docs/capability/graph-topology',
      'Check dependencies before choosing startup order',
      'Understand validation failures'
    ],
    [
      '/zh/docs/capability/graph-dependency',
      '依赖计划：删除或替换功能前，先安排步骤',
      '读取步骤、顺序和依赖记录'
    ],
    [
      '/en/docs/capability/graph-dependency',
      'Dependency plans: arrange steps before removing or replacing a feature',
      'Read steps, order, and dependency records'
    ],
    ['/zh/docs/capability/troubleshooting', '排错：功能没有启用，或关闭没有完成', 'Host 错误码'],
    [
      '/en/docs/capability/troubleshooting',
      'Troubleshooting: a feature will not open or finish closing',
      'Host error codes'
    ],
    [
      '/zh/docs/middleware-pipeline',
      'Middleware Pipeline：复用步骤，并保留各自的执行顺序',
      '为什么选它'
    ],
    [
      '/en/docs/middleware-pipeline',
      'Middleware Pipeline: reusable steps with explicit execution order',
      'Why choose it'
    ],
    [
      '/zh/docs/middleware-pipeline/getting-started',
      '快速开始：第一个 pipeline',
      '一个步骤最多调用一次 next'
    ],
    [
      '/en/docs/middleware-pipeline/getting-started',
      'Quick start: your first pipeline',
      'A stage calls next at most once'
    ],
    [
      '/zh/docs/middleware-pipeline/sync-and-async',
      '同步、异步与洋葱模型',
      '在异步 pipeline 里复用同步步骤'
    ],
    [
      '/en/docs/middleware-pipeline/sync-and-async',
      'Sync, async and the onion model',
      'Reuse a sync stage in an async pipeline'
    ],
    [
      '/zh/docs/middleware-pipeline/generators',
      'Generator 模式：用 return 决定下一步',
      '和 sync 模式的区别'
    ],
    [
      '/en/docs/middleware-pipeline/generators',
      'Generator modes: return decides what happens next',
      'How it differs from sync mode'
    ],
    [
      '/zh/docs/middleware-pipeline/cancellation-and-errors',
      '取消一次运行，并处理错误',
      '两个错误同时出现'
    ],
    [
      '/en/docs/middleware-pipeline/cancellation-and-errors',
      'Cancel a run and handle errors',
      'Two errors at once'
    ],
    ['/zh/docs/resource', 'Resource：会随输入自动刷新、可取消的异步数据', '为什么选它'],
    [
      '/en/docs/resource',
      'Resource: async data that refreshes with its inputs and can be cancelled',
      'Why choose it'
    ],
    ['/zh/docs/resource/getting-started', '快速开始：加载一个用户', '构造选项'],
    ['/en/docs/resource/getting-started', 'Quick start: load a user', 'Constructor options'],
    ['/zh/docs/resource/caching-and-refresh', '缓存与刷新', '什么时候会重新请求'],
    ['/en/docs/resource/caching-and-refresh', 'Caching and refresh', 'When a new request starts'],
    ['/zh/docs/resource/suspense-and-ssr', 'Suspense 与服务端渲染', '服务端渲染：把数据带到浏览器'],
    [
      '/en/docs/resource/suspense-and-ssr',
      'Suspense and server rendering',
      'Server rendering: carry data to the browser'
    ],
    ['/zh/docs/resource/cancellation-and-retry', '取消与重试', '失败后自动重试'],
    ['/en/docs/resource/cancellation-and-retry', 'Cancellation and retry', 'Retry after failure'],
    ['/zh/docs/resource/troubleshooting', '排错与常见问题', '错误代码'],
    ['/en/docs/resource/troubleshooting', 'Troubleshooting and FAQ', 'Error codes'],
    ['/zh/docs/reactive', 'Reactive：值变了，依赖它的计算和副作用自动更新', '按问题找 API'],
    [
      '/en/docs/reactive',
      'Reactive: when a value changes, dependent computations and effects update',
      'Find the API for your problem'
    ],
    ['/zh/docs/reactive/getting-started', '快速开始：第一张依赖图', '释放'],
    ['/en/docs/reactive/getting-started', 'Quick start: your first dependency graph', 'Disposal'],
    ['/zh/docs/reactive/reactive', 'Signal、Computed、Effect', '读取但不建立依赖'],
    ['/en/docs/reactive/reactive', 'Signal, Computed, Effect', 'Read without a dependency'],
    ['/zh/docs/reactive/runtime', 'Runtime 与调度', '每个场景使用自己的 Runtime'],
    ['/en/docs/reactive/runtime', 'Runtime and scheduling', 'Give each context its own Runtime'],
    ['/zh/docs/reactive/troubleshooting', '排错与常见问题', '错误代码'],
    ['/en/docs/reactive/troubleshooting', 'Troubleshooting and FAQ', 'Error codes'],
    ['/zh/docs/event-subscriber', 'Event Subscriber：订阅有归属，通知有顺序', '为什么选它'],
    [
      '/zh/docs/event-subscriber/getting-started',
      '快速开始：第一次订阅和发布',
      'createEventChannel 的选项'
    ],
    [
      '/en/docs/event-subscriber',
      'Event Subscriber: owned subscriptions and predictable delivery',
      'Why choose it'
    ],
    [
      '/en/docs/event-subscriber/getting-started',
      'Quick start: your first subscribe and publish',
      'createEventChannel options'
    ],
    ['/zh/docs/event-subscriber/subscriptions', '订阅与退订', '三种结束订阅的方式'],
    [
      '/en/docs/event-subscriber/subscriptions',
      'Subscribing and unsubscribing',
      'Three ways to end a subscription'
    ],
    ['/zh/docs/event-subscriber/async-invocation', '等待 listener 的结果', '六个函数怎么选'],
    [
      '/en/docs/event-subscriber/async-invocation',
      'Waiting for listener results',
      'Choosing among six functions'
    ],
    ['/zh/docs/lifecycle', 'Lifecycle：让关闭、取消和替换在并发下也不出错', '按问题找 API'],
    [
      '/en/docs/lifecycle',
      'Lifecycle: shutdown, cancellation and replacement that stay correct under concurrency',
      'Find the API for your problem'
    ],
    [
      '/zh/docs/lifecycle/graceful-shutdown',
      '服务优雅停机：等进行中的请求，但不被它们挂住',
      '资源关不掉时，先优雅、再强制'
    ],
    [
      '/en/docs/lifecycle/graceful-shutdown',
      'Graceful service shutdown: wait for requests in flight without hanging on them',
      'When a resource will not close: gracefully first, then by force'
    ],
    ['/zh/docs/lifecycle/getting-started', '快速开始：一起结束页面里的连接和订阅', '构造选项'],
    [
      '/en/docs/lifecycle/getting-started',
      'Quick start: release a page connection and subscription',
      'Constructor options'
    ],
    ['/zh/docs/lifecycle/scope', '作用域：谁负责释放资源', '只记录关闭状态'],
    [
      '/en/docs/lifecycle/scope',
      'Scopes: decide who releases each resource',
      'Record closure without releasing resources'
    ],
    [
      '/zh/docs/lifecycle/disposal',
      '释放资源：正常关闭、超时和清理失败',
      '先启动全部清理，再等待异步步骤'
    ],
    [
      '/en/docs/lifecycle/disposal',
      'Release resources: normal closure, timeouts, and failures',
      'Start all cleanup before waiting for async steps'
    ],
    ['/zh/docs/lifecycle/abort', '取消与监听器：页面关闭后停止处理请求', '取消动作失败时怎么处理'],
    [
      '/en/docs/lifecycle/abort',
      'Cancellation and listeners: stop using a request after the page closes',
      'Handle a failed cancellation action'
    ],
    ['/zh/docs/lifecycle/quiescence', '等保存任务结束后再关闭文档', '计数不会替你释放资源'],
    [
      '/en/docs/lifecycle/quiescence',
      'Close a document after its saves finish',
      'Counting does not release resources'
    ],
    [
      '/zh/docs/lifecycle/scheduler',
      '时间与等待：给保存任务一个截止时间',
      '接收一个调用方提供的调度器'
    ],
    [
      '/en/docs/lifecycle/scheduler',
      'Time and waiting: give a save task a deadline',
      'Accept a caller-provided scheduler'
    ],
    ['/zh/docs/lifecycle/generation', '只显示最新请求的结果', '取消、完成与释放失败'],
    [
      '/en/docs/lifecycle/generation',
      'Display only the latest request result',
      'Cancellation, completion, and release failures'
    ],
    ['/zh/docs/lifecycle/application-load-state', '由应用保存加载状态', '处理当前请求的失败'],
    [
      '/en/docs/lifecycle/application-load-state',
      'Keep loading state in application code',
      'Handle current request failures'
    ],
    ['/zh/docs/lifecycle/mutation-queue', '按提交顺序保存草稿', '排队太久或等待了自己的后续任务'],
    [
      '/en/docs/lifecycle/mutation-queue',
      'Save drafts in submission order',
      'Long waits and waiting for your own next task'
    ],
    [
      '/zh/docs/lifecycle/errors',
      '清理失败：收集错误，也保留最初的原因',
      '回调可能返回 Promise 时'
    ],
    [
      '/en/docs/lifecycle/errors',
      'Cleanup failures: collect errors and keep the original cause',
      'When a callback may return a Promise'
    ],
    ['/zh/docs/lifecycle/troubleshooting', '排错：资源没释放，或关闭一直在等待', '错误代码'],
    [
      '/en/docs/lifecycle/troubleshooting',
      'Troubleshooting: unreleased resources or shutdown waits',
      'Error codes'
    ],
    ['/zh/docs/serialize', 'Serialize：选择格式，明确数据与分片边界', '为什么选它'],
    [
      '/en/docs/serialize',
      'Serialize: explicit formats, values and slice boundaries',
      'Why choose it'
    ],
    [
      '/zh/docs/serialize/getting-started',
      '快速开始：保存并读取一份草稿',
      '本例使用的参数与返回值'
    ],
    [
      '/en/docs/serialize/getting-started',
      'Quick start: save and read a draft',
      'Inputs and results in the example'
    ],
    [
      '/zh/docs/serialize/chunk-shapes-and-wire-conversion',
      '把文本和字节转换成接收方需要的格式',
      '逐段处理附件'
    ],
    [
      '/en/docs/serialize/chunk-shapes-and-wire-conversion',
      'Convert text and bytes for the receiver',
      'Process an attachment in parts'
    ],
    [
      '/zh/docs/serialize/registry-and-plugins',
      'Registry 与插件：写新格式，也能读取旧存档',
      'JSON 写入时去掉本地缓存'
    ],
    [
      '/en/docs/serialize/registry-and-plugins',
      'Registry and plugins: write a new format and read old records',
      'Remove local cache data from saved settings'
    ],
    [
      '/zh/docs/serialize/streaming-and-backpressure',
      '流式处理：逐批导入订单，限制同时编码的批数',
      '读取失败或提前停止'
    ],
    [
      '/en/docs/serialize/streaming-and-backpressure',
      'Streaming: import orders in batches and bound concurrent encoding',
      'Handle read failure or stop early'
    ],
    ['/zh/docs/serialize/portable-values', '准备可保存的数据与配置文本', '读取转换结果或只取值'],
    [
      '/en/docs/serialize/portable-values',
      'Prepare values and configuration text for storage',
      'Read the metadata result or just the value'
    ],
    [
      '/zh/docs/serialize/codecs',
      '选择 Codec：把设置或消息变成可保存的数据',
      '只有实现 Codec 时才需要的工具'
    ],
    [
      '/en/docs/serialize/codecs',
      'Choose a Codec: turn settings or messages into stored data',
      'Tools for libraries implementing Codecs'
    ],
    [
      '/zh/docs/serialize/shutdown-and-errors',
      '关闭与排错：保存失败或退出迟迟未完成',
      '自定义 parser 如何保留原生错误类型'
    ],
    [
      '/en/docs/serialize/shutdown-and-errors',
      'Shutdown and troubleshooting: saving fails or exit never finishes',
      'Keep native error types in a custom parser'
    ],
    ['/zh/docs/supervision', 'Supervision：让崩溃、卡死和关不掉的任务都有人管', '按问题找 API'],
    [
      '/en/docs/supervision',
      'Supervision: someone to watch crashing, hanging and stubborn tasks',
      'Find the API for your problem'
    ],
    ['/zh/docs/supervision/getting-started', '快速开始：启动一个草稿格式化任务', '其余构造选项'],
    [
      '/en/docs/supervision/getting-started',
      'Quick start: launch a draft formatter',
      'Remaining constructor options'
    ],
    [
      '/zh/docs/supervision/budget-and-queues',
      '预算与排队：一次只导出一个文件',
      '关闭预算不会结束已有任务'
    ],
    [
      '/en/docs/supervision/budget-and-queues',
      'Budgets and queues: export one file at a time',
      'Closing a budget does not stop held work'
    ],
    [
      '/zh/docs/supervision/supervisor-control',
      '控制服务：启动、停止和替换运行中的任务',
      '停止分几步等待'
    ],
    [
      '/en/docs/supervision/supervisor-control',
      'Control a service: start, stop, and replace running work',
      'Wait through the shutdown phases'
    ],
    [
      '/zh/docs/supervision/restart-and-health',
      '重启与健康：重新连接服务，并观察检查结果',
      '状态面板能读到什么'
    ],
    [
      '/en/docs/supervision/restart-and-health',
      'Restart and health: reconnect a service and inspect checks',
      'Fields for a status panel'
    ],
    [
      '/zh/docs/supervision/profiles-and-hooks',
      '适配器与回调：服务什么时候算准备好',
      '订阅状态变化而不启动任务'
    ],
    [
      '/en/docs/supervision/profiles-and-hooks',
      'Adapters and callbacks: decide when a service is ready',
      'Observe changes without starting work'
    ],
    [
      '/zh/docs/supervision/coroutine-tasks',
      '协程任务：打开草稿读取接口，离开时停止',
      '从启动结果读取任务接口与退出情况'
    ],
    [
      '/en/docs/supervision/coroutine-tasks',
      'Coroutine tasks: open a draft reader and stop it on departure',
      'Read the task interface and fulfilled exit status'
    ],
    [
      '/zh/docs/supervision/coroutine-heartbeat',
      '协程心跳：扫描完成一页就报告进度',
      '检查最近进度，保持任务可取消'
    ],
    [
      '/en/docs/supervision/coroutine-heartbeat',
      'Coroutine heartbeat: report progress after scanning a page',
      'Check recent progress while keeping work cancellable'
    ],
    [
      '/zh/docs/supervision/troubleshooting',
      '排错：服务没有 ready，或者停止后容量没归还',
      '按现象决定下一步'
    ],
    [
      '/en/docs/supervision/troubleshooting',
      'Troubleshooting: startup is not ready or capacity remains occupied',
      'Choose the next step from the symptom'
    ],
    [
      '/zh/docs/supervision/thread-profile',
      '线程配置：把报告任务交给应用的启动器',
      '只报告这一个线程能提供的数据'
    ],
    [
      '/en/docs/supervision/thread-profile',
      'Thread profile: hand a report task to an application launcher',
      'Report only data available for this thread'
    ],
    ['/zh/docs/supervision/process-profile', '配置进程命令和宿主适配器', '用共同命令管理这个进程'],
    [
      '/en/docs/supervision/process-profile',
      'Configure a process command and host adapter',
      'Manage the process with the shared commands'
    ],
    [
      '/zh/docs/supervision/process-output-and-usage',
      '读取最近输出并检查进程用量',
      '区分用量超限和采样失败'
    ],
    [
      '/en/docs/supervision/process-output-and-usage',
      'Read recent output and check process usage',
      'Distinguish exceeded limits from failed samples'
    ],
    [
      '/zh/docs/supervision/process-recovery',
      '扫描父进程上次留下的进程记录',
      '逐条处理探测、停止和删除'
    ],
    [
      '/en/docs/supervision/process-recovery',
      'Scan process records left by a previous parent',
      'Handle probing, termination, and removal per record'
    ],
    [
      '/zh/docs/supervision/process-prewarm',
      '准备备用 worker 并在关闭应用时撤下它们',
      '接手时保留原预算名额'
    ],
    [
      '/en/docs/supervision/process-prewarm',
      'Prepare standby workers and retire them on shutdown',
      'Keep the existing budget slot during handover'
    ],
    [
      '/zh/docs/supervision/process-parent-loss',
      '父进程断开后停止接收任务并关闭服务',
      '把关闭函数和退出函数分开'
    ],
    [
      '/en/docs/supervision/process-parent-loss',
      'Stop accepting work and shut down after parent loss',
      'Keep shutdown and exit callbacks separate'
    ],
    ['/zh/docs/storage-contract', '用同一契约连接存储实现', '为什么选它'],
    [
      '/en/docs/storage-contract',
      'Connect storage implementations through one contract',
      'Why choose it'
    ],
    ['/zh/docs/storage-contract/getting-started', '安装并保存第一项偏好', '字符串存储的完整方法'],
    [
      '/en/docs/storage-contract/getting-started',
      'Install and save a preference',
      'All string-store methods'
    ],
    [
      '/zh/docs/storage-contract/capability-narrowing',
      '根据后端能力选择方法',
      '需要同步访问时检查后端文档'
    ],
    [
      '/en/docs/storage-contract/capability-narrowing',
      'Choose methods from backend capabilities',
      'Consult the backend for synchronous access'
    ],
    ['/zh/docs/storage-contract/safe-operations-and-keys', '保存操作参数与查询键', '范围读取参数'],
    [
      '/en/docs/storage-contract/safe-operations-and-keys',
      'Capture operation options and query keys',
      'Range-read options'
    ],
    [
      '/zh/docs/storage-contract/records-indexes-and-transactions',
      '记录、事务与二级索引',
      '索引事务中的方法'
    ],
    [
      '/en/docs/storage-contract/records-indexes-and-transactions',
      'Records, transactions, and secondary indexes',
      'Methods inside an indexed transaction'
    ],
    [
      '/zh/docs/storage-contract/change-feed-and-subscription-ownership',
      '根据变更更新界面并及时退订',
      '每次通知包含什么'
    ],
    [
      '/en/docs/storage-contract/change-feed-and-subscription-ownership',
      'Update a view from changes and unsubscribe',
      'Fields in each notification'
    ],
    ['/zh/docs/storage-contract/codecs-and-errors', '编解码与按现象排错', '二进制与诊断辅助函数'],
    [
      '/en/docs/storage-contract/codecs-and-errors',
      'Codecs and troubleshooting',
      'Binary and diagnostic helpers'
    ],
    ['/zh/docs/rpc-contract', 'RPC Contract：确定线上数据与接收边界', '为什么选它'],
    [
      '/en/docs/rpc-contract',
      'RPC Contract: define wire data and receiving boundaries',
      'Why choose it'
    ],
    ['/zh/docs/rpc-contract/getting-started', '安装并检查库存查询消息', '把检查后的值交给连接层'],
    [
      '/en/docs/rpc-contract/getting-started',
      'Install and check a stock-query message',
      'Pass the checked value to a connection'
    ],
    [
      '/zh/docs/rpc-contract/descriptors-and-envelopes',
      '说明组件版本与消息字段',
      '避免重复提示未知字段'
    ],
    [
      '/en/docs/rpc-contract/descriptors-and-envelopes',
      'Describe component versions and message fields',
      'Avoid repeated unknown-field warnings'
    ],
    ['/zh/docs/rpc-contract/portable-values', '准备能传给对端的业务值', '普通 JSON 与原生二进制'],
    [
      '/en/docs/rpc-contract/portable-values',
      'Prepare values the receiver can represent',
      'Ordinary JSON and native binary'
    ],
    ['/zh/docs/rpc-contract/real-world-bindings', '同一份消息定义接入不同宿主', '选择实际宿主'],
    [
      '/en/docs/rpc-contract/real-world-bindings',
      'Share message definitions across hosts',
      'Choose the actual host'
    ],
    ['/zh/docs/rpc-contract/fetch', '用 HTTP 读取共享格式的订单', '格式检查与 HTTP 各负责什么'],
    [
      '/en/docs/rpc-contract/fetch',
      'Read an order with shared JSON over HTTP',
      'Responsibilities of formatting and HTTP'
    ],
    ['/zh/docs/rpc-contract/websocket', '用 WebSocket 读取共享订单', '一条业务消息的处理次序'],
    [
      '/en/docs/rpc-contract/websocket',
      'Read a shared order over WebSocket',
      'Handle one business message'
    ],
    ['/zh/docs/rpc-contract/sse', '用 SSE 接收订单金额', '事件流与上行请求分开'],
    [
      '/en/docs/rpc-contract/sse',
      'Receive an order amount through SSE',
      'Separate server events from upstream requests'
    ],
    ['/zh/docs/rpc-contract/process', '用 Node IPC 读取订单', '进程由创建它的一方关闭'],
    [
      '/en/docs/rpc-contract/process',
      'Read an order through Node IPC',
      'The creating parent closes the process'
    ],
    [
      '/zh/docs/rpc-contract/framing-and-streams',
      '还原完整消息，再读取流项目',
      '检查流项目与已经持有的额度'
    ],
    [
      '/en/docs/rpc-contract/framing-and-streams',
      'Reassemble messages before reading stream items',
      'Check stream items against held demand'
    ],
    [
      '/zh/docs/rpc-contract/wire-errors-and-metadata',
      '传递错误链，并选择对外内容',
      '按来源与错误码定位'
    ],
    [
      '/en/docs/rpc-contract/wire-errors-and-metadata',
      'Transfer error chains and select public details',
      'Locate failures by source and code'
    ],
    [
      '/zh/docs/rpc-contract/runtime-bindings',
      '构造运行时消息，并检查启动数据',
      '在真实 MessageChannel 上交换能力数据'
    ],
    [
      '/en/docs/rpc-contract/runtime-bindings',
      'Construct runtime messages and inspect startup data',
      'Exchange capability data over a real MessageChannel'
    ],
    [
      '/zh/docs/rpc-contract/binary-messages',
      '保存二进制内容并核对完整性',
      '宿主在接收前测量原生包装'
    ],
    [
      '/en/docs/rpc-contract/binary-messages',
      'Preserve binary data and verify integrity',
      'Let the host inspect native wrappers before restore'
    ]
  ] as const

  for (const [path, title, section] of expectations) {
    const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
    assert.match(html, new RegExp(`<h1>${title}</h1>`), `missing task title: ${path}`)
    assert.match(html, new RegExp(section), `missing task section: ${path}`)
    assert.match(html, /class="guide-journey-next"/, `missing bounded next action: ${path}`)
  }

  const gettingStarted = readFileSync(
    join(buildRoot, artifactPath('/en/docs/reactive/getting-started')),
    'utf8'
  )
  assert.match(gettingStarted, /createRuntime[\s\S]*?@migaia\/reactive/)
  assert.match(gettingStarted, /Maintained example/)
  assert.doesNotMatch(gettingStarted, /维护示例/)
  assert.doesNotMatch(gettingStarted, /VersionClock|DependencyTracker|node-internals/)

  const capabilityTopics = [
    'getting-started',
    'graph',
    'graph-dynamic',
    'graph-topology',
    'graph-dependency',
    'troubleshooting'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/docs/capability/${topic}`)), 'utf8')
    )
    .join('\n')
  assert.match(capabilityTopics, /createCapabilityHost/)
  assert.match(capabilityTopics, /createCapabilityGraph/)
  assert.match(capabilityTopics, /createDynamicCapabilityGraph/)
  assert.match(capabilityTopics, /buildCapabilityTopology/)
  assert.match(capabilityTopics, /Notification:[\s\S]*?Ada Draft saved/)
  assert.match(capabilityTopics, /mutationAdmissionMs[\s\S]*?finite and nonnegative/)
  assert.match(capabilityTopics, /Running work is not timed out/)
  assert.doesNotMatch(guideSource, /host\.enable\([^)]*\) === true/)
  assert.match(capabilityTopics, /every capability is gated/)
  assert.match(capabilityTopics, /setFlags\(next\)/)
  assert.match(capabilityTopics, /partial-resource cleanup to the batch callback/)
  assert.match(
    capabilityTopics,
    /queued change can time out even while its predecessor remains stuck/
  )

  const middlewareTopics = [
    'getting-started',
    'sync-and-async',
    'generators',
    'cancellation-and-errors'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/docs/middleware-pipeline/${topic}`)), 'utf8')
    )
    .join('\n')
  assert.match(middlewareTopics, /createPipeline/)
  assert.match(middlewareTopics, /pipeline\.lift\(/)
  assert.match(middlewareTopics, /GENERATOR_HALT/)
  assert.match(middlewareTopics, /AggregateError/)
  assert.match(guideSource, /await next\(\{ \.\.\.request, user: 'ada' \}\)/)
  assert.doesNotMatch(guideSource, /Promise\.race\([^)]*signal/)

  const resourceTopics = [
    'getting-started',
    'caching-and-refresh',
    'suspense-and-ssr',
    'cancellation-and-retry',
    'troubleshooting'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/docs/resource/${topic}`)), 'utf8')
    )
    .join('\n')
  const resourceText = renderedText(resourceTopics)
  assert.match(resourceText, /new Resource/)
  assert.match(resourceText, /autoStart/)
  assert.match(resourceText, /initialSnapshot/)
  assert.match(resourceText, /systemScheduler/)
  assert.match(resourceText, /staleWhileRevalidate/)
  assert.match(resourceText, /dehydrate|hydrate/)
  assert.match(resourceText, /retryDelay/)
  assert.match(guideSource, /const id = userId\.value/)
  /** Resource now exposes the host AbortSignal directly; the old assertion cast is unnecessary. */
  assert.match(resourceText, /\(\{ signal \}\) => fetchUser\('1', signal\)/)
  assert.doesNotMatch(resourceText, /signal as AbortSignal/)
  assert.match(guideSource, /JSON\.stringify\(onServer\.dehydrate\(\)\)/)
  assert.match(guideSource, /initialSnapshot: JSON\.parse\(json\)/)

  const serializeTopics = [
    'getting-started',
    'chunk-shapes-and-wire-conversion',
    'registry-and-plugins',
    'streaming-and-backpressure',
    'portable-values',
    'codecs',
    'shutdown-and-errors'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/docs/serialize/${topic}`)), 'utf8')
    )
    .join('\n')
  const serializeText = renderedText(serializeTopics)
  assert.match(serializeText, /createSerializeRegistry/)
  assert.match(serializeText, /chunkToBytes/)
  assert.match(serializeText, /convert to text or Base64 when it requires strings/)
  assert.match(serializeText, /replacer/)
  assert.match(serializeText, /TextDecoder/)
  assert.match(serializeText, /primaryType/)
  assert.match(serializeText, /maxInFlight/)
  assert.match(serializeText, /deadlineAt/)
  assert.match(serializeText, /CODEC_NOT_FOUND/)
  assert.match(guideSource, /type: registry\.primaryType,\\n  chunk: await registry\.encode/)
  assert.match(guideSource, /for \(const part of streamBase64Chunks\(attachment\)\)/)
  assert.match(serializeText, /targetMs[\s\S]*?default is 8 milliseconds/)
  assert.match(serializeText, /This desired slice duration is not an execution timeout/)

  const storageContractTopics = [
    'getting-started',
    'capability-narrowing',
    'safe-operations-and-keys',
    'records-indexes-and-transactions',
    'change-feed-and-subscription-ownership',
    'codecs-and-errors'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/docs/storage-contract/${topic}`)), 'utf8')
    )
    .join('\n')
  const storageContractText = renderedText(storageContractTopics)
  assert.match(storageContractText, /snapshotKeyValueStore/)
  assert.match(storageContractText, /isRecordStore/)
  assert.match(storageContractText, /pageSize/)
  assert.match(storageContractText, /it identifies one built index configuration/)
  assert.match(storageContractText, /This real memory backend emits events after a write commits/)
  assert.match(storageContractText, /The example skips non-increasing numbers/)
  assert.match(storageContractText, /Call unsubscribe\(\) when the view closes/)
  assert.match(storageContractText, /defineCollectionsJsonCodec/)
  assert.match(storageContractText, /fromValueCodec/)
  assert.doesNotMatch(storageContractText, /import \{ collectionsJsonCodec \}/)
  assert.match(storageContractText, /UNSUPPORTED_CAPABILITY/)
  assert.match(guideSource, /const stableKey = snapshotStorageKey\(key, 'memory'/)
  assert.match(guideSource, /change\.sequence <= sequence/)
  assert.match(storageContractText, /Inspection does not route or save it/)

  const pluginHostTopics = [
    'getting-started',
    'install-and-compose',
    'configuration',
    'pipelines',
    'removal-and-rollback',
    'troubleshooting'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/docs/plugin-host/${topic}`)), 'utf8')
    )
    .join('\n')
  const pluginHostText = renderedText(pluginHostTopics)
  assert.match(pluginHostText, /defineHost/)
  assert.match(pluginHostText, /const \[upperHandle\] = await host\.use\(upper\)/)
  assert.match(pluginHostText, /upperHandle\.extensions\.upper/)
  assert.match(pluginHostText, /dependencies, holds the dependency outputs/)
  assert.match(
    pluginHostText,
    /the Host orders by dependency: even with greeter first, formatter installs first/i
  )
  assert.match(pluginHostText, /Handles still follow the input order/)
  assert.match(pluginHostText, /core\.config\.get\(\)/)
  assert.match(pluginHostText, /handle\.config\.update/)
  assert.match(pluginHostText, /core\.onDispose/)
  assert.match(pluginHostText, /host\.runPipeline/)
  assert.match(pluginHostText, /pipelineDrainTimeoutMs/)
  assert.match(pluginHostText, /REGISTRATION_REVOKED/)
  assert.match(pluginHostText, /physicalCompletion/)
  assert.match(pluginHostText, /DEPENDENCY_BLOCKED/)
  assert.match(pluginHostText, /PLUGIN_INSTALL_FAILED/)
  assert.match(guideSource, /mutationTimeoutMs: 5000/)
  assert.match(guideSource, /const \[greeterHandle\] = await host\.use\(greeter, formatter\)/)
  assert.match(guideSource, /await handle\.config\.update\(\(previous\) =>/)
  assert.match(guideSource, /core\.useAsyncPipeline\(async \(request, next\)/)
  assert.match(guideSource, /dependencies\.casing\.upper\(name\)/)

  const loggerTopics = [
    'getting-started',
    'entries-hooks-and-sinks',
    'plugins-and-batching',
    'custom-plugin',
    'pipelines',
    'flush-and-shutdown',
    'runtime-and-forwarding',
    'troubleshooting'
  ]
    .map((topic) => readFileSync(join(buildRoot, artifactPath(`/en/docs/logger/${topic}`)), 'utf8'))
    .join('\n')
  const loggerText = renderedText(loggerTopics)
  assert.match(loggerText, /onFailure/)
  assert.match(loggerText, /dispatchRaw/)
  assert.match(loggerText, /batch must come before http/)
  assert.match(loggerText, /BATCH_OVERFLOW/)
  assert.match(loggerText, /PIPELINE_MODE_MISMATCH/)
  assert.match(loggerText, /a closed Logger cannot be reopened/)
  assert.match(loggerText, /setLoggerRuntimeManager/)
  assert.match(guideSource, /level\(\{ level: 'info' \}\)/)
  assert.match(guideSource, /log\.usePipeline\(\(entry, next\)/)
  assert.match(guideSource, /setLoggerRuntimeManager\(\{/)
  assert.match(guideSource, /api\.extends\(audit\)/)

  const storageWebStart = readFileSync(
    join(buildRoot, artifactPath('/en/docs/storage-web/getting-started')),
    'utf8'
  )
  const storageWebStartText = renderedText(storageWebStart)
  assert.match(storageWebStartText, /secondaryIndexes[\s\S]*changeFeed/)
  assert.match(storageWebStartText, /putRecord/)
  assert.match(storageWebStartText, /Compose backends/)
  assert.match(storageWebStartText, /memoryBackendPlugin/)
  assert.match(storageWebStartText, /Close the instance without deleting browser-persistent data/)
  assert.match(storageWebStartText, /namespaceCodec/)

  const storageWebTopics = [
    'indexeddb-and-transactions',
    'entity-schema-and-codecs',
    'host-and-plugins',
    'reactive-live-queries',
    'cookies-and-security',
    'cancellation-errors-and-shutdown'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/docs/storage-web/${topic}`)), 'utf8')
    )
    .join('\n')
  const storageWebText = renderedText(storageWebTopics)
  assert.match(storageWebText, /TRANSACTION_CONFLICT/)
  assert.match(storageWebText, /cleanupLegacyRecords/)
  assert.match(storageWebText, /factory[\s\S]*keyRange/)
  assert.match(storageWebText, /validate → normalize → schema\.encode → codec\.encode/)
  assert.match(storageWebText, /STORAGE_HOST_BUSY/)
  assert.match(storageWebText, /keepPreviousData/)
  assert.match(storageWebText, /COOKIE_SCOPE_AMBIGUOUS/)
  assert.match(storageWebText, /StorageContractError/)
  assert.match(storageWebText, /memoryBackendPlugin\(\{ id: 'drafts' \}\)/)
  assert.match(guideSource, /await db\.transaction\(async \(tx\)/)
  assert.match(storageWebText, /reactiveFeature\(indexedDbBackendKind\)/)
  assert.match(storageWebText, /indexedDbBackendPlugin\(/)
  assert.match(storageWebText, /query\(\)\.limit\(20\)\.live\(/)

  /** RPC examples use the actual host facade and one installed transport. */
  const rpcStart = renderedText(
    readFileSync(join(buildRoot, artifactPath('/en/docs/rpc-host/getting-started')), 'utf8')
  )
  assert.match(rpcStart, /createRpcHost/)
  assert.match(rpcStart, /coroutinePlugin/)
  assert.match(rpcStart, /host\.request\('double', 21\)/)
  assert.match(rpcStart, /await host\.close\(\)/)
  const rpcTopics = ['host-and-plugins', 'transports-and-security', 'calls-and-cancellation']
    .map((topic) =>
      renderedText(
        readFileSync(join(buildRoot, artifactPath(`/en/docs/rpc-host/${topic}`)), 'utf8')
      )
    )
    .join('\n')
  assert.match(rpcTopics, /createRpcHost/)
  assert.match(rpcTopics, /source/)
  assert.match(rpcTopics, /code/)
  assert.match(rpcTopics, /cause/)
  assert.match(rpcTopics, /host\.close\(\)/)
  assert.doesNotMatch(
    rpcTopics,
    /create(?:ClientEndpoint|ProviderEndpoint|ComposedEndpoint|\w*Peer)\b/
  )

  const eventStart = readFileSync(
    join(buildRoot, artifactPath('/en/docs/event-subscriber/getting-started')),
    'utf8'
  )
  assert.match(eventStart, /createEventChannel[\s\S]*?@migaia\/event-subscriber/)
  assert.doesNotMatch(eventStart, /invokeParallelSettled[\s\S]*?invokeTaskSettled/)

  const eventTopics = ['subscriptions', 'async-invocation']
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/docs/event-subscriber/${topic}`)), 'utf8')
    )
    .join('\n')
  assert.match(eventTopics, /subscribeUntil/)
  assert.match(eventTopics, /invokeParallelSettled/)
  assert.match(eventTopics, /EventSubscriberState/)

  const lifecycleStart = readFileSync(
    join(buildRoot, artifactPath('/en/docs/lifecycle/getting-started')),
    'utf8'
  )
  assert.match(lifecycleStart, /createLifecycleScope[\s\S]*?@migaia\/lifecycle/)
  assert.doesNotMatch(lifecycleStart, /VersionClock|createMutationQueue|createManualScheduler/)

  const lifecycleTopics = [
    'scope',
    'disposal',
    'abort',
    'quiescence',
    'scheduler',
    'generation',
    'errors'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/docs/lifecycle/${topic}`)), 'utf8')
    )
    .join('\n')
  assert.doesNotMatch(guideSource, /scope\.own\(\(\)|createAbortController\(\{|advanceBy\(/)
  assert.match(guideSource, /page\.own\([^,]+, \{(?:\\n\s*| )force:/)
  assert.match(lifecycleTopics, /observeAbortSubscription/)
  assert.match(lifecycleTopics, /scheduler[\s\S]*?advance/)
  assert.match(lifecycleTopics, /gracefulTimeoutMs/)
  assert.match(guideSource, /console\.log\('Cleanup failures:', failures\.length\)/)
  assert.match(lifecycleTopics, /Higher finite numbers release first/)
  assert.match(guideSource, /requests\.adopt\(request\.token/)
  assert.match(guideSource, /createErrorCollector\('collect'/)
  for (const locale of ['zh', 'en']) {
    /** The rendered overview must expose both API groups and actual local reference links. */
    const home = readFileSync(join(buildRoot, artifactPath(`/${locale}/docs/lifecycle`)), 'utf8')
    assert.ok(home.includes(locale === 'zh' ? '常用 API' : 'Essentials'))
    assert.ok(home.includes(locale === 'zh' ? '全部 API' : 'All APIs'))
    assert.ok(
      home.includes(`href="/${locale}/docs/lifecycle/api/disposal/executeReleaseDescriptor"`)
    )
    assert.ok(home.includes(`href="/${locale}/docs/lifecycle/api/errors/containAsyncRejection"`))
  }
})

test('flushes the queued rerun before disposing the Effect', () => {
  for (const locale of ['en', 'zh']) {
    const page = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/reactive/getting-started`)),
      'utf8'
    )
    const flush = page.indexOf('runtime.flush')
    const stop = page.indexOf('stop.dispose()')

    assert.ok(flush >= 0, `/${locale}/docs/reactive/getting-started misses runtime.flush()`)
    assert.ok(stop > flush, `/${locale}/docs/reactive/getting-started disposes before flush`)
    assert.ok(page.includes(locale === 'zh' ? '总价: 30' : 'total: 30'))
  }
})

test('explains graph tracking, scheduling, and exact cleanup', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/reactive/readme')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /Effect → Computed → Signal.*?依赖自动登记/s)
  assert.match(text, /count\.value = 3.*?不会在 setter 内立刻重跑副作用/s)
  assert.match(text, /runtime\.flush\(\).*?同步排空.*?队列/s)
  assert.match(text, /测试、服务端渲染或需要确定提交边界的代码才显式调用 flush\(\)/)
  assert.match(text, /释放顺序按消费者到数据源执行/)
  assert.match(text, /Runtime 本身没有 dispose\(\)/)
  assert.match(text, /Scope.*?统一释放/s)
})

test('documents every supported lift direction and the forbidden one', () => {
  for (const locale of ['en', 'zh']) {
    const page = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/middleware-pipeline/sync-and-async`)),
      'utf8'
    )

    for (const fragment of [
      'pipeline.lift(trim, MiddlewarePipelineMode.sync)',
      'sync, async',
      'sync, generator',
      'sync, generator, async-generator',
      'INVALID_OPTION',
      'onViolation'
    ])
      assert.ok(
        page.includes(fragment),
        `/${locale}/docs/middleware-pipeline lift guide misses ${fragment}`
      )
    assert.ok(locale === 'en' ? /unsupported/i.test(page) : page.includes('不支持'))
  }
})

test('teaches aliases while preserving the canonical Channel contract', () => {
  for (const locale of ['en', 'zh']) {
    const page = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/event-subscriber/getting-started`)),
      'utf8'
    )

    for (const fragment of [
      'subscribe-publish',
      'on-emit',
      'on-trigger',
      'listen-fire',
      'defineEventApiStyle',
      'on',
      'emit',
      'subscribe',
      'publish',
      'dispatchPolicy',
      'publishBudget'
    ])
      assert.ok(
        page.includes(fragment),
        `/${locale}/docs/event-subscriber style misses ${fragment}`
      )
  }
})

test('keeps every maintained RPC continuation resolvable without retired owner redirects', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const owners = [
    'rpc-host',
    'rpc-plugin-process',
    'rpc-plugin-thread',
    'rpc-plugin-browser',
    'rpc-plugin-coroutines',
    'rpc-plugin-pool',
    'rpc-plugin-devtools'
  ]
  for (const locale of ['en', 'zh'] as const) {
    for (const owner of owners)
      for (const { topic } of listGuideJourneys(owner, locale)) {
        const path = `/${locale}/docs/${owner}${topic === 'index' ? '' : `/${topic}`}`
        assert.ok(routes.has(path), `missing maintained RPC route: ${path}`)
        const journey = findGuideJourney(owner, topic, locale)
        assert.ok(journey)
        const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
        assert.ok(renderedText(html).includes(journey.title), `missing task title: ${path}`)
        assert.match(html, /class="guide-journey-next"/, `missing bounded next action: ${path}`)
        const links = [
          ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
        ].map((match) => match[1])
        for (const link of links)
          assert.ok(routes.has(link), `broken maintained RPC link: ${path} -> ${link}`)
      }
    for (const retired of [
      'rpc-core',
      'rpc-process',
      'rpc-threads',
      'rpc-browser',
      'rpc-pool',
      'rpc-devtools'
    ]) {
      assert.equal(
        [...routes].some(
          (path) =>
            path === `/${locale}/docs/${retired}` || path.startsWith(`/${locale}/docs/${retired}/`)
        ),
        false
      )
      assert.equal(
        existsSync(join(buildRoot, artifactPath(`/${locale}/docs/${retired}`))),
        false,
        `retired RPC owner must not remain as a redirect: ${retired}`
      )
    }
  }
})

test('renders every transport plugin tutorial in both locales', () => {
  const factories = [
    ['rpc-plugin-process', 'processPlugin'],
    ['rpc-plugin-thread', 'threadPlugin'],
    ['rpc-plugin-browser', 'windowPlugin'],
    ['rpc-plugin-browser', 'dedicatedWorkerPlugin'],
    ['rpc-plugin-browser', 'sharedWorkerPlugin'],
    ['rpc-plugin-browser', 'serviceWorkerPlugin'],
    ['rpc-plugin-browser', 'broadcastChannelPlugin'],
    ['rpc-plugin-browser', 'rtcDataChannelPlugin'],
    ['rpc-plugin-browser', 'webTransportPlugin'],
    ['rpc-plugin-coroutines', 'coroutinePlugin']
  ] as const
  for (const locale of ['en', 'zh'])
    for (const [owner, factory] of factories) {
      const path = `/${locale}/docs/${owner}/api/${factory}`
      const text = renderedText(readFileSync(join(buildRoot, artifactPath(path)), 'utf8'))
      for (const contract of [factory, 'createRpcHost', '.close()'])
        assert.ok(text.includes(contract), `${path} misses ${contract}`)
      assert.doesNotMatch(
        text,
        /create(?:ClientEndpoint|ProviderEndpoint|ComposedEndpoint|\w*Peer)\b/
      )
    }
})

test('exposes the host and plugin roots with their actual guides in the left rail', () => {
  const roots = [
    ['rpc-host', 'createRpcHost'],
    ['rpc-plugin-process', 'processPlugin'],
    ['rpc-plugin-thread', 'threadPlugin'],
    ['rpc-plugin-browser', 'dedicatedWorkerPlugin'],
    ['rpc-plugin-coroutines', 'coroutinePlugin'],
    ['rpc-plugin-pool', 'poolPlugin'],
    ['rpc-plugin-devtools', 'devtoolsPlugin']
  ] as const
  for (const locale of ['en', 'zh'] as const)
    for (const [owner, factory] of roots) {
      const path = `/${locale}/docs/${owner}`
      const page = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const rail = stableLeftRail(page)
      assert.ok(
        rail.includes(`/${locale}/docs/${owner}/api/${factory}`),
        `${path} hides ${factory}`
      )
      assert.ok(rail.includes(`/${locale}/docs/${owner}/getting-started`))
      for (const { topic } of listGuideJourneys(owner, locale))
        if (topic !== 'index') assert.ok(rail.includes(`/${locale}/docs/${owner}/${topic}`))
    }
})

test('keeps user construction on the host and explicit plugin composition', () => {
  for (const locale of ['en', 'zh']) {
    const path = `/${locale}/docs/rpc-host/host-and-plugins`
    const text = renderedText(readFileSync(join(buildRoot, artifactPath(path)), 'utf8'))
    for (const contract of ['createRpcHost', 'plugins:', 'provide:', '.request(', '.close()'])
      assert.ok(text.includes(contract), `${path} misses ${contract}`)
    assert.doesNotMatch(
      text,
      /create(?:ClientEndpoint|ProviderEndpoint|FullEndpoint|ComposedEndpoint|\w*Peer)\b/
    )
  }
})

test('documents the public feature boundary without exposing private endpoint composition', () => {
  for (const locale of ['en', 'zh'])
    for (const feature of [
      'authFeature',
      'chunkFeature',
      'retryFeature',
      'timeoutFeature',
      'typegenFeature'
    ]) {
      const api = apiManifest.apis.find(
        (entry) =>
          entry.library === 'rpc-host' &&
          entry.symbols.some((symbol) => symbol.name === feature && symbol.kind !== 'type')
      )
      assert.ok(api, `missing public feature ${feature}`)
      const symbol = api.symbols.find((entry) => entry.name === feature)!
      const path = `${publicModulePath(locale, 'rpc-host', api.module)}/${symbol.routeSlug ?? feature}`
      const text = renderedText(readFileSync(join(buildRoot, artifactPath(path)), 'utf8'))
      assert.ok(text.includes(feature))
      assert.ok(text.includes('createRpcHost'))
      assert.doesNotMatch(text, /create(?:ComposedEndpoint|OutboundFeature|ProviderFeature)\b/)
    }
})

test('keeps guide topics, the host entry, and features in one stable rail', () => {
  for (const locale of ['en', 'zh'] as const) {
    const page = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/rpc-host/host-and-plugins`)),
      'utf8'
    )
    const rail = stableLeftRail(page)
    assert.ok(rail.includes(`/${locale}/docs/rpc-host/api/createRpcHost`))
    for (const topic of ['host-and-plugins', 'transports-and-security', 'calls-and-cancellation'])
      assert.ok(rail.includes(`/${locale}/docs/rpc-host/${topic}`))
    assert.equal(
      rail,
      stableLeftRail(
        readFileSync(
          join(buildRoot, artifactPath(`/${locale}/docs/rpc-host/api/createRpcHost`)),
          'utf8'
        )
      )
    )
  }
})

test('keeps every maintained Utils continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'deadlines-and-abort',
    'retry-and-concurrency',
    'error-identity-and-causes',
    'bytes-and-text',
    'immutable-objects-and-paths',
    'type-utilities',
    'configuration-ownership',
    'function-and-value-guards',
    'strings-and-numbers'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/utils${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Utils link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Tray continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'static-composition',
    'readiness-and-errors',
    'resource-ownership',
    'dynamic-host',
    'mutation-and-blocking',
    'physical-cleanup',
    'loaders-and-adapters',
    'runtime-tasks',
    'instances-and-routing',
    'native-thread-and-process',
    'topics-and-events'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/tray${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Tray link: ${path} -> ${link}`)
      }
    }
  }
})

test('explains Host options, managed reads, and every mutation outcome', () => {
  const expectations = [
    [
      '/zh/docs/tray/dynamic-host',
      ['mutationAdmissionMs', 'quiescenceMs', 'shutdown.mode', 'readyPlugins', 'pluginState']
    ],
    [
      '/en/docs/tray/dynamic-host',
      ['mutationAdmissionMs', 'quiescenceMs', 'shutdown.mode', 'readyPlugins', 'pluginState']
    ],
    [
      '/zh/docs/tray/mutation-and-blocking',
      [
        'ok:true / committed:true',
        'ok:false / committed:false',
        'ok:false / committed:true',
        'removed:false'
      ]
    ],
    [
      '/en/docs/tray/mutation-and-blocking',
      [
        'ok:true / committed:true',
        'ok:false / committed:false',
        'ok:false / committed:true',
        'removed:false'
      ]
    ]
  ] as const

  for (const [path, fragments] of expectations) {
    const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
    for (const fragment of fragments)
      assert.ok(html.includes(fragment), `${path} misses ${fragment}`)
  }
})

test('keeps every maintained WASM continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'initialization-and-hosts',
    'arena-memory',
    'conversion-boundaries',
    'ownership-and-cleanup',
    'troubleshooting'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/wasm${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained WASM link: ${path} -> ${link}`)
      }
    }
  }
})

test('releases both arena ids and ConversionResult wrappers', () => {
  for (const locale of ['en', 'zh']) {
    const gettingStarted = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/wasm/getting-started`)),
      'utf8'
    )
    const ownership = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/wasm/ownership-and-cleanup`)),
      'utf8'
    )

    assert.match(gettingStarted, /alloc_bytes/)
    assert.match(gettingStarted, /dealloc_bytes/)
    assert.match(ownership, /ConversionResult/)
    assert.match(ownership, /result\?\.free\(\)/)
    assert.match(ownership, /Symbol\.dispose/)
    assert.match(ownership, /dealloc_bytes/)
  }
})

test('keeps every maintained Store Light continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'object-store-model',
    'async-fields-and-readiness',
    'snapshots-and-hydration',
    'field-builders-and-mutation',
    'resources-and-suspense',
    'resource-versions-and-lifecycle'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/store-light${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Store Light link: ${path} -> ${link}`)
      }
    }
  }
})

test('explains Store, hydration, and Resource option defaults', () => {
  const expectations = [
    [
      'getting-started',
      ['runtime', 'defaultRuntime', 'debugName', 'warnAsyncActions', 'mutationPolicy']
    ],
    ['snapshots-and-hydration', ['ignore', 'report', 'strict', 'onUnknown']],
    ['resources-and-suspense', ['keepAliveMs', 'dispose', 'onError', 'onTerminal']]
  ] as const

  for (const locale of ['en', 'zh']) {
    for (const [topic, fragments] of expectations) {
      const html = readFileSync(
        join(buildRoot, artifactPath(`/${locale}/docs/store-light/${topic}`)),
        'utf8'
      )
      for (const fragment of fragments) {
        assert.ok(
          html.includes(fragment),
          `/${locale}/docs/store-light/${topic} misses ${fragment}`
        )
      }
      if (topic === 'snapshots-and-hydration') {
        assert.match(
          renderedText(html),
          locale === 'zh' ? /默认\s*'ignore'/ : /Defaults to\s*'ignore'/
        )
      }
      if (topic === 'resources-and-suspense') {
        assert.match(renderedText(html), locale === 'zh' ? /默认\s*1000/ : /Defaults to\s*1000/)
      }
    }
  }
})

test('keeps every maintained Store Keyed continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'definitions-and-scopes',
    'derived-and-writable-state',
    'optics-and-split-lists',
    'families-and-cache-identity',
    'preview-and-overrides',
    'release-and-disposal'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/store-keyed${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Store Keyed link: ${path} -> ${link}`)
      }
    }
  }
})

test('explains key domain, cache bounds, and split ownership', () => {
  for (const locale of ['en', 'zh']) {
    const family = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/store-keyed/families-and-cache-identity`)),
      'utf8'
    )
    const split = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/store-keyed/optics-and-split-lists`)),
      'utf8'
    )

    for (const fragment of [
      'maxSize',
      '4096',
      'debugLabel',
      'WeakRef',
      'FinalizationRegistry',
      'store.release'
    ])
      assert.ok(family.includes(fragment), `/${locale}/docs/store-keyed family misses ${fragment}`)
    for (const fragment of ['splitDef', 'prune', 'store.release'])
      assert.ok(split.includes(fragment), `/${locale}/docs/store-keyed split misses ${fragment}`)
  }
})

test('keeps every maintained Store Indexed continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'choose-a-collection',
    'tracking-and-cell-lifecycle',
    'array-index-semantics',
    'bulk-replacement-and-pruning',
    'mutation-guards-and-runtime',
    'disposal-and-errors'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/store-indexed${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Store Indexed link: ${path} -> ${link}`)
      }
    }
  }
})

test('explains construction defaults and mutation boundaries', () => {
  for (const locale of ['en', 'zh']) {
    const page = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/store-indexed/getting-started`)),
      'utf8'
    )

    for (const fragment of [
      'defaultRuntime',
      'mutationGuard',
      'assertMutationAllowed',
      'debugName',
      'ObservableObject',
      'ObservableArray',
      'ObservableMap',
      'ObservableSet'
    ])
      assert.ok(page.includes(fragment), `/${locale}/docs/store-indexed config misses ${fragment}`)
  }
})

test('keeps every maintained Store Middleware continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'binding-and-shared-policy',
    'events-and-plugins',
    'actions-and-mutation-boundaries',
    'snapshot-clone-policies',
    'devtools-and-state-commands',
    'pipeline-errors-and-reentrancy',
    'shutdown-and-ownership'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/store-middleware${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Store Middleware link: ${path} -> ${link}`)
      }
    }
  }
})

test('makes every binding default and ownership edge explicit', () => {
  for (const locale of ['en', 'zh']) {
    const page = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/store-middleware/binding-and-shared-policy`)),
      'utf8'
    )

    for (const fragment of [
      'mutationTimeoutMs',
      'pipelineDrainTimeoutMs',
      'actionPrefix',
      'diagnosticClone',
      'ClonePolicy.immutable',
      'off'
    ])
      assert.ok(
        page.includes(fragment),
        `/${locale}/docs/store-middleware config misses ${fragment}`
      )
  }
})

test('keeps every maintained Store Persist continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'choose-an-adapter',
    'hydration-and-startup-races',
    'partialize-merge-and-migrations',
    'write-queue-debounce-and-flush',
    'codecs-and-storage-capabilities',
    'keyed-families-and-clear',
    'retry-errors-and-shutdown'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/store-persist${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Store Persist link: ${path} -> ${link}`)
      }
    }
  }
})

test('exposes the real handle and post-hydration read path', () => {
  for (const locale of ['en', 'zh']) {
    /** Adapter selection and retry guidance document the shared handle controls. */
    const handleGuides = ['choose-an-adapter', 'retry-errors-and-shutdown']
      .map((topic) =>
        readFileSync(
          join(buildRoot, artifactPath(`/${locale}/docs/store-persist/${topic}`)),
          'utf8'
        )
      )
      .join('\n')
    const keyed = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/docs/store-persist/keyed-families-and-clear`)),
      'utf8'
    )

    for (const fragment of ['IPersistHandle', 'ready', 'retryHydrate', 'flush', 'clear'])
      assert.ok(
        `${handleGuides}${keyed}`.includes(fragment),
        `/${locale}/docs/store-persist keyed misses ${fragment}`
      )
    for (const fragment of ['await handle.ready', 'atomStore.get(definition)', 'initial u1']) {
      if (locale === 'en')
        assert.ok(
          renderedText(keyed).includes(fragment),
          `/${locale}/docs/store-persist keyed misses ${fragment}`
        )
    }
    assert.ok(!keyed.includes('handle.value is the current restored value'))
  }
})

test('keeps every maintained Store React continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'provider-ownership-and-readiness',
    'selectors-and-concurrent-tracking',
    'atoms-and-definitions',
    'resources-and-suspense',
    'registry-and-dependency-injection',
    'features-and-config',
    'ssr-strict-mode-and-shutdown'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/store-react${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Store React link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Store SSR continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'request-isolation-and-runtime',
    'register-and-own-state',
    'hydrate-and-dehydrate',
    'await-resources-and-timeouts',
    'embed-and-read-state',
    'custom-codecs-and-abort',
    'validation-security-and-trusted-path',
    'shutdown-errors-and-streaming'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/store-ssr${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Store SSR link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Store Devtools continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'session-and-history',
    'actions-and-runtime-trace',
    'time-travel-and-side-effects',
    'dependency-and-observer-trees',
    'clone-redaction-and-failure-containment',
    'command-bridge-boundary',
    'performance-and-disposal'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/store-devtools${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Store Devtools link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Store Worker continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'choose-an-offload-path',
    'adapter-requests-and-cancellation',
    'worker-handlers-and-lifecycle',
    'resource-computed-and-cache',
    'serialization-worker-pipeline',
    'byte-copy-and-transfer-ownership',
    'errors-timeouts-and-cleanup',
    'performance-and-shutdown-order'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/store-worker${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Store Worker link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Store WASM continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'initialization-and-provider-readiness',
    'choose-a-field-layout',
    'number-boolean-and-string-fields',
    'array-granularity-and-bulk-writes',
    'record-layout-and-field-tracking',
    'memory-safety-views-and-capacity',
    'errors-rollback-and-disposal',
    'performance-and-when-not-to-use'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/store-wasm${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Store WASM link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Store Shared continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'environment-and-buffer-handoff',
    'shared-signal-and-sync',
    'shared-array-and-reactive-cells',
    'seqlock-and-contention',
    'dirty-pages-and-sparse-sync',
    'watch-waitasync-and-fallback',
    'atomic-update-and-low-level-primitives',
    'ownership-pruning-and-disposal',
    'security-capacity-and-recovery'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/store-shared${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Store Shared link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Storage Contract continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'capability-narrowing',
    'safe-operations-and-keys',
    'records-indexes-and-transactions',
    'change-feed-and-subscription-ownership',
    'codecs-and-errors'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/storage-contract${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Storage Contract link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Serialize continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'chunk-shapes-and-wire-conversion',
    'registry-and-plugins',
    'streaming-and-backpressure',
    'portable-values',
    'codecs',
    'shutdown-and-errors'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/serialize${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Serialize link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Plugin Host continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'install-and-compose',
    'configuration',
    'pipelines',
    'removal-and-rollback',
    'troubleshooting'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/plugin-host${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Plugin Host link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Resource continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'caching-and-refresh',
    'suspense-and-ssr',
    'cancellation-and-retry'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/resource${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Resource link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Logger continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'entries-hooks-and-sinks',
    'plugins-and-batching',
    'custom-plugin',
    'pipelines',
    'flush-and-shutdown',
    'runtime-and-forwarding'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/logger${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Logger link: ${path} -> ${link}`)
      }
    }
  }
})

test('keeps every maintained Storage Web continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'indexeddb-and-transactions',
    'entity-schema-and-codecs',
    'host-and-plugins',
    'reactive-live-queries',
    'cookies-and-security',
    'cancellation-errors-and-shutdown'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/docs/storage-web${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained Storage Web link: ${path} -> ${link}`)
      }
    }
  }
})

test('explains selection and the real clone boundary', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/docs/storage-web/readme')), 'utf8')
  const text = renderedText(html)
  assert.match(text, /@migaia\/storage-host\/entity/)
  assert.match(
    text,
    /jsonCodec.*output.*text.*structuredCodec.*output.*structured.*binaryCodec.*output.*binary.*selectCodec.*直连、回退或拒绝/s
  )
  assert.match(text, /structuredCodec.*encode\/decode.*原样返回值，不复制.*真正复制在记录后端/s)
  assert.match(text, /内存后端会复制字节，记录采用 structuredClone/)
  assert.match(text, /binaryCodec.*校验后原样返回字节视图，后端负责写入快照/s)
  assert.match(text, /jsonCodec.*不能表示循环.*structuredCodec.*内建类型与循环/s)
  assert.match(text, /defineCollectionsJsonCodec.*fromValueCodec/s)
  assert.match(text, /UNSUPPORTED_CAPABILITY/)
  assert.match(text, /schema 处理领域表示，codec 处理保存格式/)
  assert.match(text, /不重建 class 业务实例，也不做 schema 校验/)
  assert.match(text, /codec.decode.*版本迁移（存储表示）.*schema.decode.*validate/s)
})
