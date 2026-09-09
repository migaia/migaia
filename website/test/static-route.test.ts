import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'

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
const webRpcGuideSource = readFileSync(join(websiteRoot, 'app/web-rpc-api-guides.ts'), 'utf8')
const routeManifest = JSON.parse(
  readFileSync(join(websiteRoot, 'src/generated/manifests/routes.json'), 'utf8')
) as {
  readonly entries: readonly { readonly path: string }[]
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
      readonly sections: readonly { readonly id: string; readonly content: string }[]
    }[]
  }[]
}

/** Maps a canonical URL to the React Router static output artifact. */
function artifactPath(path: string): string {
  return path === '/' ? 'index.html' : `${path.slice(1)}/index.html`
}

/** Builds the public module URL while hiding the repository root export name. */
function publicModulePath(locale: string, library: string, moduleName: string): string {
  return `/${locale}/docs/${library}${moduleName === 'index' ? '' : `/${moduleName}`}`
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

/** Extracts the navigation tree while ignoring the route-specific active marker. */
function stableLeftRail(html: string): string {
  const rail = html.match(/<aside class="left-rail-content"[^>]*>([\s\S]*?)<\/aside>/)?.[1]
  assert.ok(rail, 'missing desktop left rail')
  return rail.replace(/ class="(?:active)?"/g, '')
}

/** Produces the semantic public path segment for one runtime symbol. */
function apiSymbolPath(
  symbol: { readonly kind: string; readonly name: string },
  siblings: readonly { readonly kind: string; readonly name: string }[]
): string {
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

test('SITE-T-HOME uses the header language control and explains the documentation paths', () => {
  assert.doesNotMatch(homeSource, />\s*English\s*</)
  assert.doesNotMatch(homeSource, />\s*中文\s*</)
  assert.match(homeSource, /API reference/)
  assert.match(homeSource, /Task guides/)
  assert.match(homeSource, /Architecture/)
  assert.match(styleSource, /\.button:not\(\.button-primary\):hover/)
  assert.match(
    styleSource,
    /\.button\.button-primary:hover[\s\S]*?background:[\s\S]*?color:\s*var\(--canvas\)/
  )
})

test('SITE-T-LANGUAGE-HOME presents concrete production library combinations', () => {
  assert.doesNotMatch(languageSource, /copy\.chooseGoal|copy\.architecturePreview/)
  assert.match(languageSource, /copy\.reactiveResource/)
  assert.match(languageSource, /copy\.capabilityPluginHost/)
  assert.match(languageSource, /copy\.webRpcSerialize/)
  assert.match(copySource, /跟踪变化的输入，取消过期请求/)
  assert.match(copySource, /按策略启用可选能力/)
  assert.match(copySource, /定义类型安全的远程调用/)
})

test('SITE-T-DOCS-NAV classifies public symbols by developer-facing role', () => {
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
  for (const middleware of [
    'abort',
    'authentication',
    'chunk',
    'codec',
    'connect',
    'contract',
    'framer',
    'hooks',
    'ping',
    'protocol',
    'timeout'
  ])
    assert.match(docsSource, new RegExp(`'${middleware}'`))
  assert.match(docsSource, /middlewarePluginLinks\.map/)
  assert.doesNotMatch(docsSource, /candidate === api\s*\? apiLinks/)
})

test('SITE-T-STORAGE-WEB-NAV groups APIs by caller task instead of export module', () => {
  for (const label of [
    '存储后端',
    '实体、Schema 与序列化',
    '宿主创建与运行',
    'Feature 定义与拓扑',
    '插件与 Backend Kind 定义',
    'Backend 插件',
    '响应式适配插件',
    '错误与基础契约'
  ])
    assert.match(docsSource, new RegExp(label))
  assert.match(docsSource, /groupStorageWebApiLinks\(apiLinks, locale\)/)
  assert.match(docsSource, /librarySlug !== 'storage-web' && rootApis\.map/)
  assert.match(docsSource, /librarySlug !== 'storage-web' && nestedGroups\.map/)
})

test('SITE-T-DOCS-RAIL keeps the expanded API navigation visible below the sticky header', () => {
  assert.match(styleSource, /\.left-rail-sticky\s*\{[\s\S]*?align-self: start;/)
  assert.match(styleSource, /height: calc\(100dvh - 6\.5rem\);/)
  assert.match(styleSource, /max-height: calc\(100dvh - 6\.5rem\);/)
  assert.match(styleSource, /position: sticky;/)
  assert.match(styleSource, /top: 6\.5rem;/)
  assert.equal(docsSource.match(/className="left-rail-sticky"/g)?.length, 2)
})

test('SITE-T-API-SCENARIOS renders maintained multi-host examples as separate sections', () => {
  assert.match(docsSource, /guide\?\.examples\?\.length/)
  assert.match(docsSource, /className="api-scenario-example"/)
  assert.match(docsSource, /在不同宿主中使用/)
  assert.match(docsSource, /examples: \['Production scenarios', '场景实战'\]/)
})

test('SITE-T-WEBRPC-CONTRACT-TRANSPORTS documents contract use across host boundaries', () => {
  for (const scenario of [
    'createWindowMessageTransport',
    'createWebWorkerTransport',
    'createBroadcastChannelTransport',
    'createServiceWorkerTransport'
  ])
    assert.match(webRpcGuideSource, new RegExp(scenario))
  for (const exampleId of [
    'iframe-transport',
    'worker-transport',
    'broadcast-transport',
    'service-worker-transport'
  ])
    assert.match(webRpcGuideSource, new RegExp(`id: '${exampleId}'`))
})

test('SITE-T-WEBRPC-MIDDLEWARE-TRANSPORTS applies real-host examples to every middleware guide', () => {
  assert.match(webRpcGuideSource, /function middlewareTransportExamples/)
  assert.match(
    webRpcGuideSource,
    /examplesEn: input\.examplesEn \?\? middlewareTransportExamples\(input\.name, input\.code, 'en'\)/
  )
  assert.match(
    webRpcGuideSource,
    /examplesZh: input\.examplesZh \?\? middlewareTransportExamples\(input\.name, input\.code, 'zh'\)/
  )
})

test('SITE-T-WEBRPC-PING-SCENARIOS documents operational liveness decisions', () => {
  for (const exampleId of [
    'preflight-liveness',
    'fanout-liveness',
    'cancel-liveness',
    'periodic-liveness'
  ])
    assert.match(webRpcGuideSource, new RegExp(`id: '${exampleId}'`))
  assert.match(webRpcGuideSource, /\.\.\.pingUsageExamples\('zh'\)/)
})

test('SITE-T01 emits the admitted nested static route set', () => {
  const routePaths = ['index.html', 'en/index.html', 'zh/index.html', 'en/docs/utils/index.html']

  for (const routePath of routePaths) {
    assert.ok(existsSync(join(buildRoot, routePath)), `missing artifact: ${routePath}`)
  }
})

test('SITE-T-NO-INDEX keeps repository entry names out of public docs routes', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  assert.ok(routes.has('/zh/docs/event-subscriber'))
  assert.ok(routes.has('/zh/docs/event-subscriber/createEventChannel'))
  assert.ok(routes.has('/zh/docs/utils/function/assimilateCapturedThen'))
  for (const route of routes) assert.doesNotMatch(route, /^\/(?:en|zh)\/docs\/[^/]+\/index(?:\/|$)/)
  const html = readFileSync(join(buildRoot, 'zh/docs/event-subscriber/index.html'), 'utf8')
  assert.match(html, /createEventChannel/)
  assert.doesNotMatch(html, /href=\x22\/zh\/docs\/event-subscriber\/index(?:\/|\x22)/)

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

test('SITE-T-TOC renders only right-rail anchors backed by real page sections', () => {
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
    if (!html.includes('id="module-guidance"')) continue
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

test('SITE-T-SEMANTIC-ROUTES keeps API links stable, readable, and collision-safe', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  assert.ok(routes.has('/zh/docs/event-subscriber/createEventChannel'))
  assert.equal(
    routeManifest.entries.some((entry) => /\/[A-Za-z_$][\w$]*-[a-f0-9]{10}$/.test(entry.path)),
    false
  )
  for (const path of [
    '/en/docs/store-indexed/observableArray-function',
    '/en/docs/store-indexed/ObservableArray-class',
    '/en/docs/store-shared/sharedInt32Array-const',
    '/en/docs/store-shared/SharedInt32Array-class'
  ])
    assert.ok(routes.has(path), `missing semantic collision route: ${path}`)

  const moduleHtml = readFileSync(join(buildRoot, 'zh/docs/event-subscriber/index.html'), 'utf8')
  assert.match(moduleHtml, /href="\/zh\/docs\/event-subscriber\/createEventChannel"/)
  assert.doesNotMatch(moduleHtml, /href="[^"]+-[a-f0-9]{10}"/)
})

test('SITE-T-NESTED-MODULES preserves export hierarchy in routes and navigation', () => {
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

  /** Current WebRPC features come from package exports rather than a hard-coded plugin inventory. */
  const webRpcFeatures = nestedApis.filter(
    (api) => api.library === 'web-rpc' && api.module.startsWith('features/')
  )
  assert.ok(webRpcFeatures.length > 0, 'expected WebRPC feature modules')
  const webRpcFeatureHtml = readFileSync(
    join(buildRoot, artifactPath(publicModulePath('zh', 'web-rpc', webRpcFeatures[0].module))),
    'utf8'
  )
  const featureRail = stableLeftRail(webRpcFeatureHtml)
  assert.match(featureRail, />功能插件</)
  assert.doesNotMatch(featureRail, />features</)
  for (const feature of webRpcFeatures)
    assert.match(
      featureRail,
      new RegExp(`href="${publicModulePath('zh', 'web-rpc', feature.module)}"`)
    )
  assert.doesNotMatch(featureRail, /web-rpc\/features-[^/"]+/)
})

test('SITE-T-LEFT-RAIL-INVARIANT keeps every module tree stable across all API routes', () => {
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

test('SITE-T-LOCALE keeps Chinese navigation and introductions localized', () => {
  const chineseHome = readFileSync(join(buildRoot, 'zh/index.html'), 'utf8')
  const chineseDocs = readFileSync(join(buildRoot, 'zh/docs/index.html'), 'utf8')

  assert.match(chineseHome, /<html[^>]+lang="zh"/)
  assert.match(chineseHome, /选择最短且有效的路径。/)
  assert.match(chineseHome, /开始查文档/)
  assert.match(chineseHome, /浏览指南/)
  assert.match(chineseHome, /href="\/zh\/docs"/)
  assert.match(chineseHome, /href="\/zh\/docs"[^>]*>文档<\/a>/)
  assert.match(chineseHome, /href="\/zh\/guides"[^>]*>指南<\/a>/)
  assert.match(chineseHome, /跟随时间 · (日出|日落|夜晚|午夜)/)
  assert.doesNotMatch(
    chineseHome,
    /Choose the shortest useful path|Make one small result|开始查 Docs|浏览 Guides|用清晰、可组合的 library|沿着真实的 library、module/
  )
  assert.match(chineseDocs, /找到你需要的 API。/)
  assert.match(chineseDocs, /类库索引/)
  assert.doesNotMatch(chineseDocs, /Find the API you need|Library index/)
})

test('SITE-T-BRAND uses the canonical Migaia name on every rendered page', () => {
  const home = readFileSync(join(buildRoot, 'en/index.html'), 'utf8')
  assert.match(home, /Migaia library home|>migaia</)
  for (const file of emittedFiles(buildRoot).filter((candidate) => candidate.endsWith('.html'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\bMigai\b/i, `legacy brand name: ${file}`)
  }
})

test('SITE-T-THEME exposes persistent light, dark, and local-time gradient modes', () => {
  assert.match(rootSource, /'light' \| 'dark' \| 'time'/)
  for (const phase of ['sunrise', 'sunset', 'night', 'midnight']) {
    assert.match(rootSource, new RegExp(`'${phase}'`))
    assert.match(styleSource, new RegExp(`data-time-phase='${phase}'`))
  }
  assert.match(rootSource, /localStorage\.setItem\(THEME_STORAGE_KEY/)
  assert.match(rootSource, /setInterval\(refreshPhase, 60_000\)/)
  assert.match(rootSource, /<option value="time">/)
  assert.match(rootSource, /<option value="sunrise">/)
  assert.match(rootSource, /selectTheme\(event\.target\.value as IThemeChoice\)/)
})

test('SITE-T01 embeds route content before JavaScript', () => {
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
  assert.match(readFileSync(join(buildRoot, apiRoute), 'utf8'), /<h2>Purpose<\/h2>/)
})

test('SITE-T-READABILITY emits semantic symbol lists and labelled code surfaces', () => {
  const symbol = apiManifest.apis
    .find((api) => api.library === 'event-subscriber' && api.module === 'index')
    ?.symbols.find((candidate) => candidate.name === 'createEventChannel')
  assert.ok(symbol)
  const html = readFileSync(
    join(
      buildRoot,
      `en/docs/event-subscriber/${apiSymbolPath(symbol, apiManifest.apis.find((api) => api.library === 'event-subscriber' && api.module === 'index')!.symbols)}/index.html`
    ),
    'utf8'
  )

  assert.match(html, /<figure class="code-frame">/)
  assert.match(html, /<span>Public type signature<\/span>/)
  assert.match(html, /<pre class="code-block"><code>/)
  assert.match(html, /class="syntax-keyword">export<\/span>/)
  assert.match(html, /class="syntax-type">IEventApiStyle<\/span>/)
  assert.match(html, /export<\/span> <span class="syntax-keyword">declare<\/span>[\s\S]*?\n/)
  assert.doesNotMatch(html, /Declared shape:/)
  assert.match(html, /<h2>Purpose<\/h2>/)
  assert.doesNotMatch(html, /<h4>介绍<\/h4>/)
  assert.doesNotMatch(html, /when its public contract matches the result you need/)
  assert.doesNotMatch(html, /start with the smallest valid input/i)
  assert.doesNotMatch(html, / · [a-f0-9]{8}\./)
})

test('SITE-T-RESOURCE-OPTIONS renders maintained constructor fields omitted by declaration expansion', () => {
  const resourceHtml = readFileSync(join(buildRoot, 'zh/docs/resource/Resource/index.html'), 'utf8')
  const resourceFragment = apiManifest.apis
    .find((api) => api.library === 'resource' && api.module === 'index')
    ?.symbols.find((symbol) => symbol.name === 'Resource')?.fragment
  assert.ok(resourceFragment)
  assert.match(resourceHtml, />配置参考</)
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

test('SITE-T-RESOURCE-OVERVIEW renders the maintained learning path before its API index', () => {
  const html = readFileSync(join(buildRoot, 'zh/docs/resource/index.html'), 'utf8')
  const text = renderedText(html)

  assert.match(text, /从场景到生产组合/)
  assert.match(text, /需要缓存过期与后台刷新/)
  assert.match(text, /new Resource/)
  assert.match(text, /userId 写入 → Resource 标脏 → 新请求状态写入 → Effect 重跑/)
  assert.match(text, /generation 校验.*?旧结果/s)
  assert.match(text, /高阶用法教程/)
  assert.ok(text.indexOf('从场景到生产组合') < text.indexOf('选择一个入口'))
})

test('SITE-T-RESOURCE-START explains request generations, observation, and terminal cleanup', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/resource')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /构造函数默认 autoStart: true.*?立即创建第一代请求/s)
  assert.match(text, /switch 读取的是当前快照/)
  assert.match(text, /Effect.*?框架适配层.*?读取 user\.state/s)
  assert.match(text, /refetch\(\).*?创建新一代.*?取消仍在途的上一代/s)
  assert.match(text, /generation 检查.*?防止旧结果覆盖新状态/s)
  assert.match(text, /dispose\(\) 是终止整个 Resource，不等同于取消一次请求/)
  assert.match(text, /不会释放外部传入的 runtime/)
  assert.match(text, /RESOURCE_DISPOSED/)
  assert.match(text, /暂时停止当前请求.*?cancel\(\)/s)
})

test('SITE-T-RESOURCE-REACTIVE shows the complete invalidation and render chain', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/resource')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /const id = userId\.value/)
  assert.match(text, /const stopRendering = runtime\.effect/)
  assert.match(text, /const state = user\.state/)
  assert.match(text, /userId 写入 → Resource 标脏 → 新请求状态写入 → Effect 重跑/)
  assert.match(text, /同一批次内.*?多次写入合并/s)
  assert.match(text, /idle\/microtask 通道通知 Resource/)
  assert.match(text, /abort 被取代 generation 的 signal/)
  assert.match(text, /generation 校验.*?丢弃旧结果/s)
  assert.match(text, /返回 Promise 之前的同步阶段/)
  assert.match(text, /先停止渲染 Effect，再终止 Resource，最后释放输入 Signal/)
})

test('SITE-T-RESOURCE-DECISION keeps use cases and direct-await tradeoffs above the example', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/resource')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /当异步结果依赖 Signal\/Computed/)
  assert.match(text, /相比直接 await.*?可观察、可复用的状态机/s)
  assert.match(text, /一次性.*?请求仍应直接 await/s)
  assert.match(text, /1\. 这是什么/)
  assert.match(text, /2\. 适合什么场景/)
  assert.match(text, /3\. 用了之后能得到什么/)
  assert.match(text, /旧请求不会覆盖新状态/)
  assert.match(text, /Suspense 友好的读取原语/)
  assert.match(text, /缓存与后台刷新/)
  assert.match(text, /SSR\/持久化快照/)

  const decisionIndex = text.indexOf('2. 适合什么场景')
  const exampleIndex = text.indexOf('4. 五分钟上手')
  assert.ok(decisionIndex >= 0 && decisionIndex < exampleIndex)
})

test('SITE-T-LOGGER-RUNTIME renders the process-wide layer contract and every host capability', () => {
  const loggerHtml = readFileSync(
    join(buildRoot, 'zh/docs/logger/setLoggerRuntimeManager/index.html'),
    'utf8'
  )
  assert.match(loggerHtml, /进程级 Logger 宿主能力/)
  assert.match(loggerHtml, /finally/)
  assert.match(loggerHtml, /restore\(\)/)
  for (const option of [
    'process',
    'createAbortController',
    'randomUUID',
    'defer',
    'write',
    'console',
    'fetch'
  ]) {
    assert.match(loggerHtml, new RegExp(`--option-${option}"`))
  }
})

test('SITE-T-PLUGIN-HOST-ERROR renders identity, cause, and detail as separate contracts', () => {
  const errorHtml = readFileSync(
    join(buildRoot, 'zh/docs/plugin-host/defined/PluginHostError/index.html'),
    'utf8'
  )
  assert.match(errorHtml, /\(source, code\)/)
  assert.match(errorHtml, /原始失败通过 cause 保持可达/)
  assert.match(errorHtml, /不可变结构化诊断放入 detail/)
  for (const option of ['code', 'message', 'options-cause', 'options-detail']) {
    assert.match(errorHtml, new RegExp(`--option-${option}"`))
  }
})

test('SITE-T-TRAY-ENTRYPOINTS render distinct static and dynamic ownership paths', () => {
  const staticHtml = readFileSync(join(buildRoot, 'zh/docs/tray/createTray/index.html'), 'utf8')
  const hostHtml = readFileSync(join(buildRoot, 'zh/docs/tray/host/createHost/index.html'), 'utf8')
  assert.match(staticHtml, /不可变静态组合根/)
  assert.match(staticHtml, /await tray\.ready\(\)/)
  assert.match(staticHtml, /await tray\.dispose\(\)/)
  assert.match(staticHtml, /--option-entries-key"/)
  assert.match(hostHtml, /唯一由 Tray 托管的 PluginHost 身份/)
  assert.match(hostHtml, /physicalCompletion/)
  assert.match(hostHtml, /--option-mutationAdmissionMs"/)
  assert.match(hostHtml, /--option-shutdown-mode"/)
})

test('SITE-T-CAPABILITY-ENTRYPOINTS render distinct ownership and mutation paths', () => {
  const hostHtml = readFileSync(
    join(buildRoot, 'zh/docs/capability/createCapabilityHost/index.html'),
    'utf8'
  )
  const readinessHtml = readFileSync(
    join(buildRoot, 'zh/docs/capability/snapshotGraphReadiness/index.html'),
    'utf8'
  )
  const staticHtml = readFileSync(
    join(buildRoot, 'zh/docs/capability/graph/createCapabilityGraph/index.html'),
    'utf8'
  )
  const dynamicHtml = readFileSync(
    join(buildRoot, 'zh/docs/capability/graph-dynamic/createDynamicCapabilityGraph/index.html'),
    'utf8'
  )
  const topologyHtml = readFileSync(
    join(buildRoot, 'zh/docs/capability/graph-topology/buildCapabilityTopology/index.html'),
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

test('SITE-T-MIDDLEWARE-ENTRYPOINTS render each control algebra and supported adapter', () => {
  /** Reads one maintained middleware API page. */
  const readMiddleware = (symbol: string): string =>
    readFileSync(join(buildRoot, `zh/docs/middleware-pipeline/${symbol}/index.html`), 'utf8')
  assert.match(readMiddleware('runSyncMiddleware'), /扁平同步 middleware chain/)
  assert.match(readMiddleware('runAsyncMiddleware'), /洋葱模型/)
  assert.match(readMiddleware('runAsyncMiddleware'), /--option-combineStageAndDownstreamError"/)
  assert.match(readMiddleware('runGeneratorMiddleware'), /yield 只属于当前 stage/)
  assert.match(readMiddleware('runAsyncGeneratorMiddleware'), /严格串行运行 async generator/)
  assert.match(readMiddleware('adaptSyncStageToAsync'), /adapter 的 violation reporter/)
  assert.match(readMiddleware('adaptSyncStageToGenerator'), /violation reporter 必填/)
  assert.match(readMiddleware('adaptGeneratorStageToAsyncGenerator'), /thrown error identity/)
  assert.match(readMiddleware('adaptSyncStageToAsyncGenerator'), /halt\/continue 映射/)
})

test('SITE-T-WASM-API-ENTRYPOINTS render exact memory and conversion ownership', () => {
  /** Reads one maintained WASM API page. */
  const readWasm = (symbol: string): string =>
    readFileSync(join(buildRoot, `zh/docs/wasm/${symbol}/index.html`), 'utf8')
  assert.match(readWasm('initSync'), /不会发起 fetch/)
  assert.match(readWasm('alloc_bytes'), /稳定非零 allocation id/)
  assert.match(readWasm('ptr_of'), /稳定的是 id/)
  assert.match(readWasm('byte_len_of'), /capacity 不是逻辑 payload 长度/)
  assert.match(readWasm('dealloc_bytes'), /二次释放或未知 id 返回 false/)
  assert.match(readWasm('ConversionResult'), /各有独立 cleanup 义务/)
  assert.match(readWasm('json_to_msgpack'), /绝不释放输入/)
  assert.match(readWasm('msgpack_to_json'), /尾随字节或第二个文档会失败/)
})

test('SITE-T-STORE-SHARED-API-ENTRYPOINTS render ABI, synchronization, and error identity', () => {
  /** Reads one maintained Store Shared API page. */
  const readShared = (routeSegment: string): string =>
    readFileSync(join(buildRoot, `zh/docs/store-shared/${routeSegment}/index.html`), 'utf8')
  assert.match(readShared('sharedInt32'), /显式 sync 或 watch/)
  assert.match(readShared('sharedInt32'), /--option-initialValue"/)
  assert.match(readShared('SharedInt32Signal'), /dispose 一个 view/)
  assert.match(readShared('sharedInt32Array-const'), /非追踪读取保持 O\(1\)/)
  assert.match(readShared('sharedInt32Array-const'), /--option-initialValues"/)
  assert.match(readShared('SharedInt32Array-class'), /底层 cell 原语/)
  assert.match(readShared('createStoreSharedError'), /原始失败必须通过 cause 保持可达/)
  assert.match(readShared('createStoreSharedRangeError'), /native error type 保持可观察/)
})

test('SITE-T-STORE-WORKER-API-ENTRYPOINTS render compute, streaming, and ownership boundaries', () => {
  /** Reads one maintained Store Worker API page. */
  const readWorker = (moduleName: string, symbol: string): string =>
    readFileSync(
      join(
        buildRoot,
        artifactPath(`${publicModulePath('zh', 'store-worker', moduleName)}/${symbol}`)
      ),
      'utf8'
    )
  assert.match(readWorker('index', 'WorkerAdapter'), /只有 await dispose 会释放 endpoint/)
  assert.match(readWorker('index', 'WorkerAdapter'), /--option-request-options-transfer"/)
  assert.match(readWorker('index', 'createWorkerHandler'), /不能成为 unhandled Worker error/)
  assert.match(readWorker('index', 'workerComputed'), /supersede 旧 generation/)
  assert.match(readWorker('serialize', 'workerParser'), /有界 backpressure/)
  assert.match(readWorker('serialize', 'workerParser'), /--option-ownership"/)
  assert.match(readWorker('serialize', 'workerPlugin'), /只增加 registry shape/)
  assert.match(readWorker('serialize', 'createSerializeWorkerHandler'), /双 credit producer window/)
  assert.match(readWorker('serialize', 'transferablesOf'), /SharedArrayBuffer/)
  assert.match(readWorker('index', 'createStoreWorkerAggregateError'), /按顺序保留/)
})

test('SITE-T-STORE-WASM-API-ENTRYPOINTS render readiness, field layout, and cleanup', () => {
  /** Reads one maintained Store WASM API page. */
  const readStoreWasm = (symbol: string): string =>
    readFileSync(join(buildRoot, 'zh/docs/store-wasm/' + symbol + '/index.html'), 'utf8')
  assert.match(readStoreWasm('ensureWasm'), /identity 稳定的 readiness Promise/)
  assert.match(readStoreWasm('number'), /8-byte WASM f64 allocation/)
  assert.match(readStoreWasm('boolean'), /单个 WASM byte/)
  assert.match(readStoreWasm('string'), /4-byte length header/)
  assert.match(readStoreWasm('string'), /--option-maxBytes"/)
  assert.match(readStoreWasm('array'), /commit 失败会回滚已写 cell/)
  assert.match(readStoreWasm('array'), /--option-granularity"/)
  assert.match(readStoreWasm('record'), /dispose\/disposed 是保留 lifecycle 名/)
  assert.match(readStoreWasm('createStoreWasmTypeError'), /hostile property access failure/)
  assert.match(readStoreWasm('createStoreWasmAggregateError'), /按顺序保留/)
})

test('SITE-T-DOC-FLOW renders maintained guidance without architecture trampoline routes', () => {
  assert.equal(
    routeManifest.entries.some((entry) =>
      /^\/(?:en|zh)\/architecture\/[^/]+\/(?:index|overview|ownership)$/.test(entry.path)
    ),
    false
  )
  const architecture = readFileSync(
    join(buildRoot, 'zh/architecture/event-subscriber/index.html'),
    'utf8'
  )
  const api = readFileSync(join(buildRoot, 'zh/docs/event-subscriber/index.html'), 'utf8')
  const symbol = apiManifest.apis
    .find((candidate) => candidate.library === 'event-subscriber' && candidate.module === 'index')
    ?.symbols.find((candidate) => candidate.name === 'createEventChannel')
  assert.ok(symbol)
  const apiDetail = readFileSync(
    join(
      buildRoot,
      `zh/docs/event-subscriber/${apiSymbolPath(symbol, apiManifest.apis.find((api) => api.library === 'event-subscriber' && api.module === 'index')!.symbols)}/index.html`
    ),
    'utf8'
  )
  assert.match(architecture, /适用与不适用场景/)
  assert.match(architecture, /本地、瞬时的事件订阅/)
  assert.match(api, /何时使用，以及可选择的公开 API/)
  assert.match(api, /选择一个入口/)
  assert.match(
    api,
    new RegExp(
      `href="/zh/docs/event-subscriber/${apiSymbolPath(symbol, apiManifest.apis.find((candidate) => candidate.library === 'event-subscriber' && candidate.module === 'index')!.symbols)}"`
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
    assert.match(apiDetail, new RegExp(`<code>${option}</code>`))
  }
  assert.match(apiDetail, /配置参考/)
  assert.match(apiDetail, /适合这些场景/)
  assert.match(apiDetail, /不要用于/)
  assert.match(apiDetail, /何时使用：/)
  assert.match(apiDetail, /最小可运行示例/)
  assert.match(apiDetail, />subscribe</)
  assert.match(apiDetail, />publish</)
  assert.match(apiDetail, /style 不改变顺序、调度、错误或生命周期语义/)
  assert.match(apiDetail, /subscribe-publish/)
  assert.match(apiDetail, /defineEventApiStyle/)
  assert.doesNotMatch(apiDetail, /<h2>错误码<\/h2>|配置与任务指南/)
  assert.match(apiDetail, /<h2>完整类型签名<\/h2>/)
  assert.ok(apiDetail.indexOf('最小可运行示例') < apiDetail.indexOf('配置参考'))
  assert.ok(apiDetail.indexOf('配置参考') < apiDetail.indexOf('类型签名'))
  assert.match(apiDetail, /<figure class="code-frame">/)
  assert.doesNotMatch(architecture + api, /本节说明|场景 1|打开完整|This section records/)

  for (const [name, expectations] of [
    ['createEventHub', ['按事件键惰性分配 Channel', 'resourceId', 'style 示例']],
    ['defineEventApiStyle', ['保留字符串字面量类型', '同一套领域命名', 'handle']]
  ] as const) {
    const candidate = apiManifest.apis
      .find((entry) => entry.library === 'event-subscriber' && entry.module === 'index')
      ?.symbols.find((entry) => entry.name === name)
    assert.ok(candidate)
    const candidateHtml = readFileSync(
      join(
        buildRoot,
        `zh/docs/event-subscriber/${apiSymbolPath(candidate, apiManifest.apis.find((entry) => entry.library === 'event-subscriber' && entry.module === 'index')!.symbols)}/index.html`
      ),
      'utf8'
    )
    for (const expectation of expectations) assert.match(candidateHtml, new RegExp(expectation))
    assert.doesNotMatch(candidateHtml, /配置与任务指南|Declaration:| · [a-f0-9]{8}/)
  }
})

test('SITE-T-CROSS-LIBRARY makes maintained cross-library references explainable and navigable', () => {
  const capability = readFileSync(join(buildRoot, 'zh/architecture/capability/index.html'), 'utf8')
  assert.match(capability, /class="library-reference"[^>]*href="\/zh\/architecture\/plugin-host"/)
  assert.match(capability, /负责插件定义、安装、管线组合、回滚与释放/)
  assert.match(capability, /class="library-reference"[^>]*href="\/zh\/architecture\/storage-web"/)

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

test('SITE-T-CODE-EXPLANATIONS keeps example guidance plain and label-free', () => {
  const capabilityArchitecture = readFileSync(
    join(buildRoot, 'zh/architecture/capability/index.html'),
    'utf8'
  )

  assert.doesNotMatch(capabilityArchitecture, /代码旁白/)
  assert.doesNotMatch(capabilityArchitecture, /最后执行这一项操作/)
  assert.doesNotMatch(capabilityArchitecture, /finally、组件卸载或任务结束时调用 dispose\(\)/)
})

test('SITE-T-CONTRACT-LAYOUT separates signatures, fields, validation, and neighboring APIs', () => {
  const capabilityArchitecture = readFileSync(
    join(buildRoot, 'zh/architecture/capability/index.html'),
    'utf8'
  )

  assert.match(capabilityArchitecture, /class="contract-signature"/)
  assert.match(capabilityArchitecture, /class="contract-field-list"/)
  assert.match(capabilityArchitecture, /class="contract-field"/)
  assert.match(capabilityArchitecture, /class="contract-validation"/)
  assert.match(capabilityArchitecture, /data-slot="separator"/)

  const storeLightArchitecture = readFileSync(
    join(buildRoot, artifactPath('/zh/architecture/store-light')),
    'utf8'
  )
  assert.match(
    storeLightArchitecture,
    /class="contract-signature-code">\(shape: IStoreDefinition&lt;S&gt;, options\?: ICreateStoreOptions\) =&gt; IReactiveStore&lt;S&gt;<\//
  )
  assert.match(storeLightArchitecture, /class="contract-signature-description"/)
  assert.doesNotMatch(storeLightArchitecture, /<div class="contract-signature">[\s\S]{0,500}签名：/)
})

test('SITE-T-CAPABILITY-LIFECYCLE shows when to enable, consume, disable, and dispose', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/capability')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /type INotificationCenter = ICapabilityHandle/)
  assert.match(text, /capabilities\.register<INotificationCenter>/)
  assert.match(text, /const result = await capabilities\.enable\('notificationCenter'\)/)
  assert.match(text, /capabilities\.handle<INotificationCenter>\('notificationCenter'\)/)
  assert.match(text, /notifications\?\.show\(message\)/)
  assert.match(text, /await capabilities\.disable\('notificationCenter'\)/)
  assert.match(text, /await capabilities\.dispose\(\)/)
  assert.match(text, /enable\(\) 返回的是状态而不是业务对象/)
  assert.match(text, /用户关闭抽屉时调用 disable\(\)/)
  assert.match(text, /配置或权限被撤回时用 setFlag\('notificationCenter', false\)/)
})

test('SITE-T-PLUGIN-HOST-TRAY explains composition terms in reader language', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/plugin-host')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /这一节只给 Tray.*? 的 Host 适配器维护者看/)
  assert.match(text, /prepared admission.*数据库事务提交前的暂存区/s)
  assert.match(text, /Host revision 就是 Host 的修改版本号/)
  assert.match(text, /安装凭证.*exact receipt/s)
  assert.match(text, /opaque data-order slot.*Host 内部保存的排序位置/s)
  assert.match(text, /第一步先让新请求看不到待卸载插件/)
  assert.match(text, /cleanupComplete: false.*不代表资源已经释放/s)
  assert.match(text, /仍须等待返回的 physicalCompletion Promise/)
})

test('SITE-T-PLUGIN-HOST-DEFINE uses definePlugin and consumes the committed view', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/plugin-host')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /import \{ definePlugin \} from '@migaia\/plugin-host\/defined'/)
  assert.match(text, /const upper = definePlugin<ICore, \{ upper\(value: string\): string \}>/)
  assert.match(text, /const view = await host\.use\(upper\)/)
  assert.match(text, /view\.extensions\.upper\('migaia'\)/)
  assert.match(text, /await view\.unUse\('upper'\)/)
  assert.match(text, /definePlugin\(name, install\).*短写法/s)
  assert.match(text, /definePlugin\(\{ name, config, install, shared, update, dispose \}\)/)
  assert.match(text, /只会校验并保存定义，不会执行 install\(\)/)
  assert.match(text, /use\(\) 成功后返回不可变 view/)
})

test('SITE-T-PLUGIN-HOST-GENERATOR-CONTINUE explains the control signal and transition', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/plugin-host')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /GENERATOR_CONTINUE 是框架导出的唯一 Symbol 控制信号，不是.*?业务数据/)
  assert.match(text, /最后一次 yield.*?交给下一 stage/s)
  assert.match(text, /一次也没有 yield.*?原样转发.*?输入/s)
  assert.match(text, /第二个 stage 收到 MIGAIA，最终结果是 \[MIGAIA\]/)
  assert.match(text, /return transformedValue.*?直接把该值交给下一 stage/s)
  assert.match(text, /GENERATOR_HALT.*?终止整条 pipeline/s)
  assert.match(text, /GENERATOR_UNDEFINED.*?真正的 undefined.*?继续向下传/s)
})

test('SITE-T-HEADER-RADIUS softens both lower navigation corners', () => {
  assert.match(styleSource, /border-radius: 1rem 1rem 1\.5rem 1\.5rem/)
  assert.match(styleSource, /border-radius: 0 0 1\.25rem 1\.25rem/)
})

test('SITE-T-ROOT-LANGUAGE-SWITCH sends the unprefixed landing page to Chinese', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/')), 'utf8')

  assert.match(html, /aria-label="Switch to Chinese"[^>]+href="\/zh"/)
  assert.doesNotMatch(html, /aria-label="Switch to Chinese"[^>]+href="\/"/)
})

test('SITE-T01 uses one static React Router pipeline without legacy framework leftovers', () => {
  assert.match(routeConfig, /ssr: false/)
  assert.match(routeConfig, /routeManifest\.entries\.map/)
  const legacyFramework = String.fromCharCode(97, 115, 116, 114, 111)
  const legacyName = [legacyFramework, 'config', 'mjs'].join('.')
  const legacyExtension = '.' + legacyFramework
  assert.ok(!existsSync(join(websiteRoot, legacyName)))
  assert.ok(!existsSync(join(websiteRoot, 'src/pages/[lang]/[...slug]' + legacyExtension)))
  assert.ok(!existsSync(join(websiteRoot, '.' + legacyName.slice(0, -7))))
})

test('SITE-T-A05/A10 closes every generated route and API body artifact', () => {
  const seen = new Set<string>()
  for (const entry of routeManifest.entries) {
    assert.ok(!seen.has(entry.path), `duplicate canonical route: ${entry.path}`)
    seen.add(entry.path)
    const output = join(buildRoot, artifactPath(entry.path))
    assert.ok(existsSync(output), `missing static artifact: ${entry.path}`)
    assert.match(readFileSync(output, 'utf8'), /<main(?:\s|>)/)
  }
  for (const api of apiManifest.apis) {
    for (const locale of ['en', 'zh']) {
      const modulePath = publicModulePath(locale, api.library, api.module)
      const output = join(buildRoot, artifactPath(modulePath))
      const html = readFileSync(output, 'utf8')
      if (api.symbols.length === 0) {
        assert.match(html, locale === 'zh' ? /重新导出的符号/ : /Re-exported symbols/)
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
        for (const section of ['overview', 'core-usage', 'signature']) {
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

test('SITE-T-A26/A30 closes emitted chunk and terminology boundaries', () => {
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
    assert.doesNotMatch(renderedText(proseHtml), /\bpackages?\b|\bzh-cn\b|\.\.\/packages/i)
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

test('SITE-T-PERF keeps route code separate from generated library data', () => {
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

test('SITE-T-A34/A35 closes API ordering and exposes a meaningful next action for every page', () => {
  for (const entry of routeManifest.entries) {
    const html = readFileSync(join(buildRoot, artifactPath(entry.path)), 'utf8')
    assert.match(html, /class="next-actions"|class="actions"|class="architecture-stack"/)
  }
  for (const api of apiManifest.apis) {
    assert.ok(api.sections.indexOf('core-usage') < api.sections.indexOf('advanced-usage'))
  }
})

test('SITE-T-ARCHITECTURE-INDEX keeps the landing page focused on library families', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture')), 'utf8')

  assert.match(html, /class="architecture-stack"/)
  assert.doesNotMatch(html, /阅读架构时先回答三个问题/)
})

test('SITE-T-LIBRARY-DESCRIPTIONS uses concrete responsibilities instead of slogans', () => {
  const docsIndex = readFileSync(join(buildRoot, artifactPath('/zh/docs')), 'utf8')
  const utilsArchitecture = readFileSync(
    join(buildRoot, artifactPath('/zh/architecture/utils')),
    'utf8'
  )
  const loggerEnglish = readFileSync(
    join(buildRoot, artifactPath('/en/architecture/logger')),
    'utf8'
  )

  assert.match(docsIndex, /utils.*提供取消、并发、错误、集合、字符串等通用基础工具/s)
  assert.match(utilsArchitecture, /多个包共同需要、且不应绑定 Store、DOM 或具体运行时/)
  assert.match(utilsArchitecture, /不是无边界的杂物箱/)
  assert.match(loggerEnglish, /Structured logging with stable levels.*flush ownership/s)
  for (const html of [docsIndex, utilsArchitecture, loggerEnglish]) {
    assert.doesNotMatch(html, /归属与边界模型/)
    assert.doesNotMatch(html, /源码契约、能力边界与使用入口/)
    assert.doesNotMatch(html, /Source-backed entry with maintained boundary facts/)
    assert.doesNotMatch(html, /owns this capability boundary and its public contracts/)
  }
})

test('SITE-T-ARCHITECTURE-LEDES explain capability, pain, and design for every library', () => {
  const architectureEntries = routeManifest.entries.filter(
    (entry) => entry.locale === 'zh' && /^\/zh\/architecture\/[^/]+$/.test(entry.path)
  )

  assert.ok(architectureEntries.length > 20)
  for (const entry of architectureEntries) {
    const html = readFileSync(join(buildRoot, artifactPath(entry.path)), 'utf8')
    const lede = html.match(/<p class="lede">([^<]+)<\/p>/)?.[1] ?? ''
    assert.ok(lede.length >= 70, `architecture lede is too thin: ${entry.path}`)
    assert.doesNotMatch(lede, /归属与边界模型|源码契约|使用入口/)
    assert.match(
      lede,
      /用于|当|核心设计|解决|相比|避免|统一|提供/,
      `architecture lede lacks reader-facing capability context: ${entry.path}`
    )
  }

  const lifecycle = readFileSync(
    join(buildRoot, artifactPath('/zh/architecture/lifecycle')),
    'utf8'
  )
  assert.match(lifecycle, /一组资源必须随同一 owner 关闭/)
  assert.match(lifecycle, /scope、generation、terminal controller 与 dispose transaction/)
  assert.match(lifecycle, /不负责事件分发、业务排队或依赖图/)

  const tray = readFileSync(join(buildRoot, artifactPath('/zh/architecture/tray')), 'utf8')
  assert.match(tray, /先准备配置，再用配置创建 logger、API client 或数据库连接/)
  assert.match(tray, /任一步失败都不会暴露半初始化对象/)
  assert.match(tray, /dispose\(\) 会逆序释放已启动项/)
  assert.match(tray, /不是运行期增删服务的 DI 容器/)
})

test('SITE-T-ARCHITECTURE-API-NAV exposes library API shortcuts beside architecture content', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')

  assert.match(html, /class="architecture-reading-layout"/)
  assert.match(html, /class="architecture-api-rail"/)
  assert.match(html, /分类导航/)
  assert.match(html, /href="\/zh\/docs\/utils\/function\/onceAsync"/)
})

test('SITE-T-CODE-EXPLANATION-PROSE renders explanations without decorative numbering', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')

  assert.match(html, /class="code-walkthrough-notes"><p>/)
  assert.doesNotMatch(html, /class="code-walkthrough"><ol>/)
})

test('SITE-T-CODE-SURFACES gives inline and block code a consistent themed hierarchy', () => {
  assert.match(styleSource, /--inline-code-background:/)
  assert.match(styleSource, /--inline-code-border:/)
  assert.match(styleSource, /--inline-code-text:/)
  assert.match(
    styleSource,
    /:not\(pre\) > code \{[\s\S]*?background: var\(--inline-code-background\);[\s\S]*?border-radius: 0\.42rem;[\s\S]*?font-weight: 600;/
  )
  assert.match(styleSource, /:not\(pre\) > code::selection/)
  assert.match(styleSource, /\.code-frame \{[\s\S]*?border-radius: 0\.78rem;/)
  assert.match(styleSource, /\.code-block \{[\s\S]*?scrollbar-color: var\(--code-border\)/)
  assert.match(
    styleSource,
    /\.option-heading h3 code,[\s\S]*?\.type-declaration > h3 code \{[\s\S]*?box-shadow: none;/
  )
})

test('SITE-T-GUIDE-API-NAV renders symbols as plain navigation text', () => {
  assert.match(
    styleSource,
    /\.guide-api-menu \.guide-api-group code \{[\s\S]*?background: transparent;[\s\S]*?border: 0;[\s\S]*?box-shadow: none;[\s\S]*?padding: 0;/
  )
  assert.match(
    styleSource,
    /\.guide-api-menu \.guide-api-group nav a:hover > code,[\s\S]*?color: var\(--accent-default\);/
  )
})

test('SITE-T-CONTENT-LISTS renders API and re-export entries as responsive cards', () => {
  assert.match(
    styleSource,
    /\.api-reference-list,[\s\S]*?\.reexport-list ul \{[\s\S]*?grid-template-columns: repeat\(auto-fit,[\s\S]*?list-style: none;/
  )
  assert.match(
    styleSource,
    /\.api-reference-list li,[\s\S]*?\.reexport-list li \{[\s\S]*?border-radius: 0\.72rem;[\s\S]*?transition:/
  )
  assert.match(styleSource, /\.reexport-list li:hover \{[\s\S]*?transform: translateY\(-1px\);/)
})

test('SITE-T-DOMAIN-INDEX-SPACING keeps catalogue introductions compact', () => {
  assert.match(docsSource, /className="page-shell content-page domain-index-page"/)
  assert.match(
    styleSource,
    /\.domain-index-page \{[\s\S]*?padding-block: clamp\(2rem, 4vw, 4rem\);/
  )
  assert.match(
    styleSource,
    /\.domain-index-page > \.section-block \{[\s\S]*?margin-top: clamp\(2\.75rem, 4vw, 3\.5rem\);/
  )
})

test('SITE-T-CODE-EXPLANATION-QUALITY rejects generated filler across every rendered page', () => {
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
    "is part of this module's public class contract"
  ]
  const htmlFiles = emittedFiles(buildRoot).filter((path) => path.endsWith('.html'))

  for (const path of htmlFiles) {
    const html = readFileSync(path, 'utf8')
    const text = renderedText(html)
    for (const phrase of forbidden)
      assert.ok(!text.includes(phrase), `generated filler remains in ${path}: ${phrase}`)
  }
})

test('SITE-T-CODE-EXPLANATION-REPETITION rejects site-wide fallback commentary', () => {
  const occurrences = new Map<string, number>()
  const chineseHtmlFiles = emittedFiles(join(buildRoot, 'zh')).filter((path) =>
    path.endsWith('.html')
  )

  for (const path of chineseHtmlFiles) {
    const html = readFileSync(path, 'utf8')
    for (const notes of html.matchAll(/<div class="code-walkthrough-notes">([\s\S]*?)<\/div>/g)) {
      for (const paragraph of notes[1].matchAll(/<p>([\s\S]*?)<\/p>/g)) {
        const explanation = renderedText(paragraph[1]).trim()
        occurrences.set(explanation, (occurrences.get(explanation) ?? 0) + 1)
      }
    }
  }

  for (const [explanation, count] of occurrences)
    assert.ok(count <= 10, `commentary repeated ${count} times: ${explanation}`)
})

test('SITE-T-API-EXAMPLE-COMMENTARY requires concrete guidance on every primary API example', () => {
  const detailPages = emittedFiles(join(buildRoot, 'zh/docs')).filter((path) =>
    path.endsWith('index.html')
  )

  for (const path of detailPages) {
    const html = readFileSync(path, 'utf8')
    for (const section of html.matchAll(
      /<section[^>]*data-primary-api-example="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g
    )) {
      const apiName = section[1]
      assert.match(
        section[2],
        /data-comment-count="[1-9]\d*"/,
        `${apiName} has no code-specific explanation: ${path}`
      )
      assert.match(
        section[2],
        /class="code-walkthrough"/,
        `${apiName} has no reader-visible walkthrough: ${path}`
      )
    }
  }
})

test('SITE-T-API-SIGNATURE-COMMENTARY explains every public declaration and overload set', () => {
  const detailPages = emittedFiles(join(buildRoot, 'zh/docs')).filter((path) =>
    path.endsWith('index.html')
  )

  for (const path of detailPages) {
    const html = readFileSync(path, 'utf8')
    for (const section of html.matchAll(
      /<section class="api-signature"[^>]*>([\s\S]*?)<\/section>/g
    )) {
      assert.match(
        section[1],
        /data-comment-count="[1-9]\d*"/,
        `public signature has no explanation: ${path}`
      )
      assert.match(
        section[1],
        /class="code-walkthrough"/,
        `public signature has no reader-visible walkthrough: ${path}`
      )
    }
  }
})

test('SITE-T-CAPABILITY-HOST-EXAMPLE explains its complete production lifecycle', () => {
  const html = readFileSync(
    join(buildRoot, 'zh/docs/capability/createCapabilityHost/index.html'),
    'utf8'
  )
  const text = renderedText(html)

  assert.match(text, /flags\.persistence 只允许这一项能力启用/)
  assert.match(text, /undefined（未配置错误接收回调）/)
  assert.doesNotMatch(text, /诊断 sink/)
  assert.match(text, /并不会立即下载或打开存储/)
  assert.match(text, /只有 enabled 才能从 handle\('persistence'\)/)
  assert.match(text, /作废在途激活并释放已经打开或迟到返回的 handle/)
})

test('SITE-T-EVENT-STYLE explains the exact subscription, delivery, and removal behavior', () => {
  const html = readFileSync(
    join(buildRoot, artifactPath('/zh/architecture/event-subscriber')),
    'utf8'
  )
  const text = renderedText(html)

  assert.match(text, /on\(\) 登记监听器，并返回只属于这次订阅的取消句柄 stop/)
  assert.match(text, /emit\(1\) 同步把值 1 交给当前监听器/)
  assert.match(text, /stop\.off\(\) 删除这条 registration/)
  assert.match(text, /只是 subscribe、publish、unsubscribe 的别名/)
  assert.doesNotMatch(text, /最后执行这一项操作/)
})

test('SITE-T-EVENT-SUBSCRIBER uses its subpath and states the style boundary precisely', () => {
  const html = readFileSync(
    join(buildRoot, artifactPath('/zh/architecture/event-subscriber')),
    'utf8'
  )
  const text = renderedText(html)

  assert.match(text, /from '@migaia\/event-subscriber\/subscriber'/)
  assert.match(text, /可接收保留该方法的 styled channel/)
  assert.match(text, /不读取 style 配置/)
  assert.match(text, /返回值固定为 canonical IUnsubscribe/)
  assert.match(text, /不会带上 off、dispose、unlisten 等 style alias/)
})

test('SITE-T-EVENT-SUBSCRIBER-NAME explains why the legacy class event name was removed', () => {
  const html = readFileSync(
    join(buildRoot, artifactPath('/zh/architecture/event-subscriber')),
    'utf8'
  )
  const text = renderedText(html)

  assert.match(text, /const channel = createEventChannel<number>\(\)/)
  assert.match(text, /旧草案里的 abstract class EventSubscriber/)
  assert.match(text, /静态 EVENT_NAME/)
  assert.match(text, /那套接口没有进入当前公开契约/)
  assert.match(text, /IEventSubscriber 只是 \{ handle\(event\) \}/)
  assert.match(text, /由传给 subscribeSubscriber\(channel, subscriber\) 的 channel 决定/)
  assert.match(text, /hub\.subscribe\('count', listener\)/)
})

test('SITE-T-EVENT-TASK defines the channel, registration, payload, and settled result', () => {
  const html = readFileSync(
    join(buildRoot, artifactPath('/zh/architecture/event-subscriber')),
    'utf8'
  )
  const text = renderedText(html)

  assert.match(text, /const tasks = createEventChannel<IEmailJob, IEmailReceipt>\(\)/)
  assert.match(text, /\{ taskId: 'email' \}/)
  assert.match(text, /const job: IEmailJob = \{ recipient: 'ada@example\.com'/)
  assert.match(text, /tasks 不是特殊类型或全局任务表/)
  assert.match(text, /job 会成为 listener 收到的 event\.value/)
  assert.match(text, /result 则明确区分发送成功的 receipt 与发送失败的原因/)
})

test('SITE-T-API-EXAMPLES import the primary API from its public owner', () => {
  const host = readFileSync(
    join(buildRoot, 'zh/docs/capability/createCapabilityHost/index.html'),
    'utf8'
  )
  const timeout = readFileSync(
    join(buildRoot, 'zh/docs/utils/promise/withTimeout/index.html'),
    'utf8'
  )

  assert.match(renderedText(host), /import \{ createCapabilityHost \} from '@migaia\/capability'/)
  assert.match(renderedText(timeout), /import \{ withTimeout \} from '@migaia\/utils\/promise'/)
})

test('SITE-T-FUNCTION-EXAMPLE-COVERAGE gives every function detail page a copyable example', () => {
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

test('SITE-T-CLASS-EXAMPLE-COVERAGE gives every class detail page a maintained example', () => {
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

test('SITE-T-UTILS-DEFERRED recommends the native Promise.withResolvers API first', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')

  assert.match(html, /优先使用原生 API/)
  assert.match(html, /Promise\.withResolvers/)
  assert.match(html, /兼容旧运行时/)
})

test('SITE-T-UTILS-TO-PROMISE explains execution timing and identity tradeoffs', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')

  assert.match(html, /当前调用栈立即执行/)
  assert.match(html, /下一次 microtask/)
  assert.match(html, /同一个 Promise/)
  assert.match(html, /新的链式 Promise/)
})

test('SITE-T-UTILS-MANUAL-SCHEDULER marks repository-only test infrastructure', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')

  assert.match(html, /本仓测试专用/)
  assert.match(html, /不面向外部业务代码/)
  assert.match(html, /测试框架提供的 fake timers/)
})

test('SITE-T-UTILS-SYSTEM-SCHEDULER distinguishes the injectable clock from Date.now', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /返回的都是 Unix 时间戳，数值与精度没有区别/)
  assert.match(text, /now\(\).*schedule\(\).*同一个 IUtilsScheduler/s)
  assert.match(text, /绕过注入的调度器/)
  assert.match(text, /真实时间和虚拟定时器/)
})

test('SITE-T-UTILS-ERROR-CODES renders every code as a described list item', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(html, /<li><code>invalidArgument<\/code>/)
  assert.match(html, /<li><code>numberFormatInvalid<\/code>/)
  assert.match(text, /ERROR_IDENTITY_CONFLICT.*保留原错误身份/s)
  assert.match(text, /DEADLINE_EXCEEDED.*scope.*timeoutMs/s)
  assert.match(text, /NUMBER_FORMAT_INVALID.*Intl\.NumberFormat/s)
})

test('SITE-T-UTILS-BYTE-CONTEXT explains ArrayBuffer storage and Uint8Array views', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /ArrayBuffer.*原始连续内存.*不能按下标读写/s)
  assert.match(text, /Uint8Array.*8 位无符号整数视图.*0～255/s)
  assert.match(text, /byteOffset.*不会复制数据.*同一底层 ArrayBuffer/s)
  assert.match(text, /独立副本.*slice\(\).*共享窗口.*subarray\(\)/s)
  assert.match(text, /SharedArrayBuffer.*并发语义不同/s)
})

test('SITE-T-UTILS-PROBE-PROPERTY shows its input object and all result branches', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /const user = \{.*name: 'Ada'.*get profile\(\): never/s)
  assert.match(text, /switch \(result.kind\).*case 'value'.*case 'missing'.*case 'failed'/s)
  assert.match(text, /readLabel\(user, 'name'\).*读取成功，消费 value/s)
  assert.match(text, /readLabel\(user, 'email'\).*字段不存在，走业务默认值/s)
  assert.match(text, /readLabel\(user, 'profile'\).*getter 异常被显式上报/s)
  assert.match(text, /profileReads.*1.*没有为了判断结果而重复触发 getter/s)
  assert.match(text, /user.*第一个参数 value.*普通对象、class 实例/s)
  assert.match(text, /字段不存在.*读取字段失败.*分开/s)
})

test('SITE-T-UTILS-IMMUTABLE-SNAPSHOT explains structured clone mechanics and limits', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /globalThis\.structuredClone\(\).*不经过 JSON 字符串/s)
  assert.match(text, /循环引用.*共享关系.*Date.*Map.*Set.*ArrayBuffer.*TypedArray/s)
  assert.match(text, /不会保留自定义 class 的原型方法.*getter\/setter.*属性描述符/s)
  assert.match(text, /没有传 transfer list.*ArrayBuffer.*复制.*不会.*detached/s)
  assert.match(text, /不调用 Object\.freeze\(\).*返回对象本身仍可修改/s)
  assert.match(text, /copy\.primary === copy\.alias.*true.*共享引用关系被保留/s)
})

test('SITE-T-UTILS-DIAGNOSTIC-SNAPSHOT contrasts strict and best-effort cloning', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /原生 structuredClone\(value\).*全有或全无/s)
  assert.match(text, /immutableSnapshot\(value\).*ENV_UNSUPPORTED.*CLONE_UNSUPPORTED/s)
  assert.match(text, /diagnosticSnapshot\(value\).*不先克隆整张对象图.*保留原引用/s)
  assert.match(text, /structuredDiagnosticSnapshot\(value\).*先尝试原生 structuredClone.*退回/s)
  assert.match(text, /value\.callback === callback.*true.*不支持的函数保留原引用/s)
  assert.match(text, /diagnostics 非空.*不能把返回值宣称为完全隔离快照/s)
})

test('SITE-T-UTILS-IDENTITY-SNAPSHOT documents its only meaningful policy use', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /identitySnapshot.*单独调用它没有运行时收益/s)
  assert.match(text, /可配置 snapshot policy.*零拷贝.*接受共享引用/s)
  assert.match(text, /liveConfig\.retry = 3.*retained\.retry.*3.*同一对象/s)
  assert.match(text, /可信进程内.*身份敏感或不可克隆对象.*共享所有权/s)
  assert.match(text, /外部输入.*历史状态.*跨边界传输.*immutableSnapshot/s)
})

test('SITE-T-UTILS-SET explains immutable updates and structural sharing precisely', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /每次 set 都返回新根对象/s)
  assert.match(text, /next\.user !== data\.user.*路径上的对象被浅拷贝/s)
  assert.match(text, /next\.settings === data\.settings.*未修改分支继续共享引用/s)
  assert.match(text, /immutable.*更新方式.*不会深拷贝整棵树.*不会调用 Object\.freeze/s)
  assert.match(text, /Object\.is\(\).*相等.*直接返回原根对象/s)
})

test('SITE-T-UTILS-OWN-CONFIG demonstrates admission, isolation, and managed successors', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /ownConfig.*接收外部配置的边界.*独立、可验证所有权/s)
  assert.match(text, /callerOptions\.retry\.attempts = 99.*config\.retry\.attempts.*2/s)
  assert.match(text, /Set 也已复制/s)
  assert.match(text, /WeakMap.*profile 与 limits/s)
  assert.match(text, /readonlyConfig.*公开读取.*patchConfig.*派生新根.*readConfigPath/s)
  assert.match(text, /返回对象没有被冻结.*运行时配置.*不应当作可序列化数据/s)
})

test('SITE-T-UTILS-COMBINE-CONFIG shows both inputs, merged output, and an explicit diff', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /const defaults = ownConfig\(\{\s*retries: 1/)
  assert.match(text, /const override = ownConfig\(\{\s*retries: 3/)
  assert.match(text, /strategies: \{ record: 'merge', array: 'concat' \}/)
  assert.match(text, /transport: \{ timeoutMs: 2500, keepAlive: true \}/)
  assert.match(text, /const diff = \{/)
  assert.match(text, /before: defaults\.retries, after: merged\.retries/)
  assert.match(text, /diff 只是把结果变化写明，不是 combineConfig 的额外返回值/)
})

test('SITE-T-UTILS-ONCE explains module scope, singleton limits, and Proxy responsibility', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /export const getRuntime = once/)
  assert.match(text, /first === second; \/\/ true/)
  assert.match(text, /每调用一次 once\(fn\) 都会创建一份独立缓存/)
  assert.match(text, /iframe、Worker、Node vm 等不同 realm/)
  assert.match(text, /globalThis\[Symbol\.for\('your-app\/runtime'\)\]/)
  assert.match(text, /Proxy 可以把首次属性访问转成惰性初始化/)
  assert.match(text, /它不会自动保证全局唯一/)
  assert.match(text, /不适合需要重试、重置、热更新或按请求隔离的初始化/)
})

test('SITE-T-UTILS-ONCE-ASYNC explains concrete use cases and shared-failure boundaries', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')

  assert.match(html, /export const loadAppConfig = onceAsync/)
  assert.match(html, /加载不会刷新的启动配置/)
  assert.match(html, /初始化一个共享 SDK 客户端/)
  assert.match(html, /动态导入并编译同一份 WASM 模块/)
  assert.match(html, /首次失败会一直缓存/)
  assert.match(html, /按租户或请求隔离/)
  assert.match(html, /其他等待者也会受影响/)
  assert.match(html, /模块重复实例化或跨 iframe、Worker、Node <code>vm<\/code> 时不会共享/)
})

test('SITE-T-UTILS-READONLY-CONFIG explains read-only behavior in plain language', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/utils')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /readonlyConfig.*给已有配置套上只读保护/s)
  assert.match(text, /正常读取.*没有复制第二份配置/s)
  assert.match(text, /不允许调用方.*修改任何层级/s)
  assert.match(text, /Map\.set\(\).*Set\.add\(\).*Date\.setFullYear\(\).*都会报错/s)
  assert.match(text, /patchConfig\(\).*生成下一份.*不是写 view/s)
  assert.doesNotMatch(text, /门面/)
})

test('SITE-T-API-TYPING keeps runtime APIs primary and typing subordinate', () => {
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

test('SITE-T-API-TYPING renders legacy type paths inside the subordinate module disclosure', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  assert.ok(routes.has('/zh/docs/utils/promise/IAbortSignal'))
  assert.match(docsSource, /const selectedType = selectedApi\?\.symbols\.find/)
  assert.match(docsSource, /selectedTypeFragment: selectedType\?\.fragment/)
  assert.match(
    docsSource,
    /docsModulePath\([\s\S]*alias\.ownerModule,[\s\S]*symbolSlug\(ownerSymbol, ownerApi\.symbols\)/
  )
  assert.match(docsSource, /navigate\([\s\S]*symbolSlug\(selectedSymbol, api\.symbols\)/)
  assert.match(docsSource, /target\.scrollIntoView\(\{ block: 'start' }\)/)
})

test('SITE-T-NO-ACCORDION keeps all generated content continuously readable', () => {
  assert.doesNotMatch(docsSource, /<details|<summary/)
  for (const file of emittedFiles(buildRoot).filter((candidate) => candidate.endsWith('.html')))
    assert.doesNotMatch(readFileSync(file, 'utf8'), /<details(?:\s|>)|<summary(?:\s|>)/, file)
})

test('SITE-T-TYPE-CODE keeps every module type declaration visible with its code', () => {
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
        /<figure class="code-frame">/,
        `${api.library}/${api.module} hides code for ${symbol.name}`
      )
    }
  }
})

test('SITE-T-GUIDE-JOURNEYS gives primary tasks independent bilingual pages', () => {
  const expectations = [
    ['/zh/guides/store-react', 'Store React 学习路径', '先按状态来源选择 Hook'],
    ['/en/guides/store-react', 'Store React learning paths', 'Choose a Hook from the state source'],
    [
      '/zh/guides/store-react/getting-started',
      '五分钟建立作用域 Store 与精确 Selector',
      '在挂载前注册，在组件中按 Token 读取'
    ],
    [
      '/en/guides/store-react/getting-started',
      'Build a scoped Store with a precise Selector in five minutes',
      'Register before mount and read by Token inside components'
    ],
    [
      '/zh/guides/store-react/provider-ownership-and-readiness',
      '明确 StoreProvider 所有权与 Ready Barrier',
      '按输入决定默认 dispose 行为'
    ],
    [
      '/en/guides/store-react/provider-ownership-and-readiness',
      'Define StoreProvider ownership and Ready Barriers',
      'Derive default disposal from supplied ownership'
    ],
    [
      '/zh/guides/store-react/resources-and-suspense',
      '正确选择 Resource、StoreResource 与 Suspense Hook',
      '从资源来源选择 Hook'
    ],
    [
      '/en/guides/store-react/resources-and-suspense',
      'Choose Resource, StoreResource, and Suspense Hooks correctly',
      'Choose a Hook from the resource source'
    ],
    ['/zh/guides/store-worker', 'Store Worker 学习路径', '先判断工作是否值得跨线程'],
    [
      '/en/guides/store-worker',
      'Store Worker learning paths',
      'First decide whether work deserves a thread boundary'
    ],
    [
      '/zh/guides/store-worker/getting-started',
      '五分钟建立可取消的 Worker 计算链',
      'Worker 侧建立处理器'
    ],
    [
      '/en/guides/store-worker/getting-started',
      'Build a cancellable Worker computation path in five minutes',
      'Create the Worker-side handler'
    ],
    [
      '/zh/guides/store-worker/byte-copy-and-transfer-ownership',
      '在 copy 安全性与 transfer 零拷贝之间选择',
      '转移前确认输入是独占整块视图'
    ],
    [
      '/en/guides/store-worker/byte-copy-and-transfer-ownership',
      'Choose between copy safety and zero-copy transfer',
      'Transfer only an exclusively owned full-buffer view'
    ],
    ['/zh/guides/store-wasm', 'Store WASM 学习路径', '按数据形状选择最窄字段'],
    [
      '/en/guides/store-wasm',
      'Store WASM learning paths',
      'Choose the narrowest field for the data shape'
    ],
    [
      '/zh/guides/store-wasm/getting-started',
      '五分钟建立并释放 WASM 字段 Store',
      '显式完成 Readiness 后创建 Store'
    ],
    [
      '/en/guides/store-wasm/getting-started',
      'Build and release a WASM-field Store in five minutes',
      'Complete Readiness before creating Store'
    ],
    [
      '/zh/guides/store-wasm/array-granularity-and-bulk-writes',
      '按订阅密度选择 Array Granularity',
      '从读取模式选择分桶'
    ],
    [
      '/en/guides/store-wasm/array-granularity-and-bulk-writes',
      'Choose Array Granularity from subscription density',
      'Choose buckets from the read pattern'
    ],
    ['/zh/guides/store-shared', 'Store Shared 学习路径', '先判断是否真的需要共享内存'],
    [
      '/en/guides/store-shared',
      'Store Shared learning paths',
      'First decide whether shared memory is necessary'
    ],
    [
      '/zh/guides/store-shared/getting-started',
      '五分钟在主线程与 Worker 共享响应式数组',
      '主线程创建并交接 Buffer'
    ],
    [
      '/en/guides/store-shared/getting-started',
      'Share a reactive array between main thread and Worker in five minutes',
      'Create and hand off the Buffer on main'
    ],
    [
      '/zh/guides/store-shared/seqlock-and-contention',
      '理解 Seqlock 一致读写与不可恢复竞争',
      '读写协议避免新值配旧版本'
    ],
    [
      '/en/guides/store-shared/seqlock-and-contention',
      'Understand Seqlock consistency and unrecoverable contention',
      'The protocol prevents new value with an old version'
    ],
    ['/zh/guides/store-devtools', 'Store Devtools 学习路径', '先按要回答的问题选择入口'],
    [
      '/en/guides/store-devtools',
      'Store Devtools learning paths',
      'Choose an entry from the question'
    ],
    [
      '/zh/guides/store-devtools/getting-started',
      '五分钟记录状态、定位 Action 并安全释放',
      '围绕一个 Store 建立有界诊断会话'
    ],
    [
      '/en/guides/store-devtools/getting-started',
      'Record state, inspect Actions, and release safely in five minutes',
      'Build one bounded diagnostic session around a Store'
    ],
    [
      '/zh/guides/store-devtools/time-travel-and-side-effects',
      '把 jumpTo 当作状态复水，不是事务回滚',
      '明确能恢复与不能恢复的内容'
    ],
    [
      '/en/guides/store-devtools/time-travel-and-side-effects',
      'Treat jumpTo as state hydration, not transaction rollback',
      'Know what can and cannot be restored'
    ],
    ['/zh/guides/store-ssr', 'Store SSR 学习路径', '沿一次请求的生命周期阅读'],
    ['/en/guides/store-ssr', 'Store SSR learning paths', 'Follow one request lifecycle'],
    [
      '/zh/guides/store-ssr/getting-started',
      '五分钟完成服务端脱水与浏览器复水',
      '服务端：创建、渲染、注入、关闭'
    ],
    [
      '/en/guides/store-ssr/getting-started',
      'Complete server dehydration and browser hydration in five minutes',
      'Server: create, render, embed, and close'
    ],
    [
      '/zh/guides/store-ssr/await-resources-and-timeouts',
      '用总预算收敛异步 Resource',
      'timeoutMs 是整个等待过程的预算'
    ],
    [
      '/en/guides/store-ssr/await-resources-and-timeouts',
      'Converge async Resources under one total budget',
      'timeoutMs budgets the complete wait'
    ],
    [
      '/zh/guides/store-ssr/validation-security-and-trusted-path',
      '建立载荷边界，再决定是否使用 Trusted 快速路径',
      'assertSSRState 的拒绝边界'
    ],
    [
      '/en/guides/store-ssr/validation-security-and-trusted-path',
      'Establish payload boundaries before choosing the trusted fast path',
      'assertSSRState rejection boundaries'
    ],
    ['/zh/guides/store-persist', 'Store Persist 学习路径', '先按内存状态模型选择入口'],
    [
      '/en/guides/store-persist',
      'Store Persist learning paths',
      'Choose the entry from the in-memory state model'
    ],
    [
      '/zh/guides/store-persist/getting-started',
      '五分钟恢复、修改并落盘用户设置',
      '把 readiness 和物理写入放进调用流程'
    ],
    [
      '/en/guides/store-persist/getting-started',
      'Restore, modify, and persist user settings in five minutes',
      'Place readiness and physical writing in the caller flow'
    ],
    [
      '/zh/guides/store-persist/hydration-and-startup-races',
      '处理 Hydration 与启动期本地写入竞态',
      'Plain object 使用启动快照三向合并'
    ],
    [
      '/en/guides/store-persist/hydration-and-startup-races',
      'Handle Hydration races with local startup writes',
      'Plain objects use a three-way startup snapshot merge'
    ],
    [
      '/zh/guides/store-persist/codecs-and-storage-capabilities',
      '让 Codec 输出与 Backend 能力精确匹配',
      '按 codec.output 选择存储通道'
    ],
    [
      '/en/guides/store-persist/codecs-and-storage-capabilities',
      'Match Codec output to Backend capability exactly',
      'Select a storage channel from codec.output'
    ],
    ['/zh/guides/store-middleware', 'Store Middleware 学习路径', '先判断是否需要 Host'],
    [
      '/en/guides/store-middleware',
      'Store Middleware learning paths',
      'Decide whether a Host is necessary'
    ],
    [
      '/zh/guides/store-middleware/getting-started',
      '五分钟启用 Actions-only 与日志插件',
      '共享策略实例并显式关闭 Host'
    ],
    [
      '/en/guides/store-middleware/getting-started',
      'Enable actions-only writes and a logging plugin in five minutes',
      'Share the policy instance and close the Host explicitly'
    ],
    [
      '/zh/guides/store-middleware/snapshot-clone-policies',
      '为状态快照选择明确的 Clone Policy',
      '按消费场景选择，而不是统一使用“宽容克隆”'
    ],
    [
      '/en/guides/store-middleware/snapshot-clone-policies',
      'Choose an explicit Clone Policy for state snapshots',
      'Choose by consumer instead of applying one tolerant clone everywhere'
    ],
    [
      '/zh/guides/store-middleware/devtools-and-state-commands',
      '安全接入 Redux DevTools 状态命令',
      '只有提供 applyState 才能接受状态命令'
    ],
    [
      '/en/guides/store-middleware/devtools-and-state-commands',
      'Integrate Redux DevTools state commands safely',
      'Accept state commands only when applyState exists'
    ],
    ['/zh/guides/store-indexed', 'Store Indexed 学习路径', '先从访问模式选择集合'],
    [
      '/en/guides/store-indexed',
      'Store Indexed learning paths',
      'Choose a collection from the access pattern'
    ],
    [
      '/zh/guides/store-indexed/getting-started',
      '五分钟订阅一个大集合中的单个 key',
      '在同一个 Runtime 中创建集合和 Effect'
    ],
    [
      '/en/guides/store-indexed/getting-started',
      'Subscribe to one key in a large collection in five minutes',
      'Create the collection and Effect in one Runtime'
    ],
    [
      '/zh/guides/store-indexed/choose-a-collection',
      '选择 Object、Array、Map 或 Set',
      '类与工厂函数的参数顺序不同'
    ],
    [
      '/en/guides/store-indexed/choose-a-collection',
      'Choose Object, Array, Map, or Set',
      'Classes and factory functions use different argument order'
    ],
    [
      '/zh/guides/store-indexed/array-index-semantics',
      '正确使用 ObservableArray 的纯索引语义',
      '不要把移动后的索引当稳定实体'
    ],
    [
      '/en/guides/store-indexed/array-index-semantics',
      'Use ObservableArray pure index semantics correctly',
      'Do not treat a shifted index as stable entity identity'
    ],
    [
      '/zh/guides/store-indexed/mutation-guards-and-runtime',
      '接入 Mutation Guard，并隔离 Runtime',
      '跨 Runtime 追踪必须失败'
    ],
    [
      '/en/guides/store-indexed/mutation-guards-and-runtime',
      'Integrate a Mutation Guard and isolate Runtime',
      'Cross-Runtime tracking must fail'
    ],
    ['/zh/guides/store-keyed', 'Store Keyed 学习路径', '先判断是否真的需要键控定义'],
    [
      '/en/guides/store-keyed',
      'Store Keyed learning paths',
      'Decide whether keyed definitions are necessary'
    ],
    [
      '/zh/guides/store-keyed/getting-started',
      '五分钟建立两个互不串状态的作用域',
      '模块顶层定义，作用域边界实例化'
    ],
    [
      '/en/guides/store-keyed/getting-started',
      'Build two state-isolated scopes in five minutes',
      'Define at module scope and instantiate at the scope boundary'
    ],
    [
      '/zh/guides/store-keyed/definitions-and-scopes',
      '选择 Definition，并明确实例作用域',
      '按初值与写入契约选择构造器'
    ],
    [
      '/en/guides/store-keyed/definitions-and-scopes',
      'Choose a Definition and name its instance scope',
      'Choose a constructor by initialization and write contract'
    ],
    [
      '/zh/guides/store-keyed/optics-and-split-lists',
      '用 Optics 聚焦对象并按稳定 key 拆分列表',
      '长期列表必须同时管理源项与 token 缓存'
    ],
    [
      '/en/guides/store-keyed/optics-and-split-lists',
      'Focus objects with Optics and split lists by stable key',
      'A long-lived list owns source items and token cache separately'
    ],
    [
      '/zh/guides/store-keyed/families-and-cache-identity',
      '按业务 key 建立 Family，并控制缓存 identity',
      '让 key 选择 Definition，而不是共享实例'
    ],
    [
      '/en/guides/store-keyed/families-and-cache-identity',
      'Build a family by business key and control cache identity',
      'Let the key choose a Definition, not a shared instance'
    ],
    [
      '/zh/guides/store-keyed/preview-and-overrides',
      '在并发预览和测试替换中保持契约',
      '只有纯工厂才能在 speculative preview 中执行'
    ],
    [
      '/en/guides/store-keyed/preview-and-overrides',
      'Preserve contracts during concurrent preview and test replacement',
      'Only a pure factory may run during speculative preview'
    ],
    [
      '/zh/guides/store-keyed/release-and-disposal',
      '释放单个 Definition 或终止整个 AtomStore',
      '按所有权层级选择清理动作'
    ],
    [
      '/en/guides/store-keyed/release-and-disposal',
      'Release one Definition or terminate the whole AtomStore',
      'Choose cleanup at the owning layer'
    ],
    ['/zh/guides/store-light', 'Store Light 学习路径', '先判断数据是否适合对象 Store'],
    [
      '/en/guides/store-light',
      'Store Light learning paths',
      'Decide whether the data fits an object Store'
    ],
    [
      '/zh/guides/store-light/getting-started',
      '五分钟创建、订阅并释放对象 Store',
      '直接描述业务对象'
    ],
    [
      '/en/guides/store-light/getting-started',
      'Create, subscribe to, and dispose an object Store in five minutes',
      'Describe the business object directly'
    ],
    [
      '/zh/guides/store-light/object-store-model',
      '理解字段、Computed、Action 与 raw',
      '每一种输入形状只有一个含义'
    ],
    [
      '/en/guides/store-light/object-store-model',
      'Understand fields, Computed values, Actions, and raw',
      'Every input shape has one meaning'
    ],
    [
      '/zh/guides/store-light/async-fields-and-readiness',
      '选择同步、异步或 Legacy Store 创建入口',
      '按 Builder 模式选择入口'
    ],
    [
      '/en/guides/store-light/async-fields-and-readiness',
      'Choose synchronous, asynchronous, or legacy Store creation',
      'Choose an entry from Builder mode'
    ],
    [
      '/zh/guides/store-light/snapshots-and-hydration',
      '区分完整快照、持久化数据与宽松 Hydration',
      '不要用一个快照承担所有用途'
    ],
    [
      '/en/guides/store-light/snapshots-and-hydration',
      'Separate complete snapshots, persisted data, and tolerant hydration',
      'Do not make one snapshot serve every purpose'
    ],
    [
      '/zh/guides/store-light/field-builders-and-mutation',
      '扩展 FieldBuilder，并保持 Runtime 与写入边界',
      '声明同步或异步构造模式'
    ],
    [
      '/en/guides/store-light/field-builders-and-mutation',
      'Extend FieldBuilder while preserving Runtime and mutation boundaries',
      'Declare synchronous or asynchronous construction mode'
    ],
    [
      '/zh/guides/store-light/resources-and-suspense',
      '用 StoreResource 建立 Suspense 安全异步值',
      '把请求取消和错误观察放进资源'
    ],
    [
      '/en/guides/store-light/resources-and-suspense',
      'Build a Suspense-safe asynchronous value with StoreResource',
      'Place request cancellation and error observation in the resource'
    ],
    [
      '/zh/guides/store-light/resource-versions-and-lifecycle',
      '管理 Resource 版本、Capture 与终态',
      '区分稳定持有与 provisional capture'
    ],
    [
      '/en/guides/store-light/resource-versions-and-lifecycle',
      'Manage Resource versions, captures, and terminal state',
      'Separate stable retention from provisional capture'
    ],
    ['/zh/guides/wasm', 'WASM 学习路径', '按宿主与数据边界进入'],
    ['/en/guides/wasm', 'WASM learning paths', 'Enter by host and data boundary'],
    [
      '/zh/guides/wasm/getting-started',
      '五分钟完成 JSON 到 MessagePack 转码',
      '让每一个分配都有明确释放点'
    ],
    [
      '/en/guides/wasm/getting-started',
      'Convert JSON to MessagePack in five minutes',
      'Give every allocation an explicit release point'
    ],
    [
      '/zh/guides/wasm/initialization-and-hosts',
      '在浏览器、Node 与预编译宿主中初始化 WASM',
      '按加载权限选择初始化方式'
    ],
    [
      '/en/guides/wasm/initialization-and-hosts',
      'Initialize WASM in browsers, Node, and precompiled hosts',
      'Choose initialization by loading authority'
    ],
    [
      '/zh/guides/wasm/arena-memory',
      '正确使用稳定 ID、指针与 8 字节对齐 Arena',
      '读取每个 Arena API 的精确语义'
    ],
    [
      '/en/guides/wasm/arena-memory',
      'Use stable ids, pointers, and the eight-byte-aligned arena correctly',
      'Read the exact semantic of every arena API'
    ],
    [
      '/zh/guides/wasm/conversion-boundaries',
      '保持单文档转码与独立结果语义',
      '只从当前 ConversionResult 判断成功'
    ],
    [
      '/en/guides/wasm/conversion-boundaries',
      'Preserve single-document conversion and independent result semantics',
      'Determine success only from the current ConversionResult'
    ],
    [
      '/zh/guides/wasm/ownership-and-cleanup',
      '确定性释放 WASM 分配并保留失败事实',
      '为每种结果写出释放矩阵'
    ],
    [
      '/en/guides/wasm/ownership-and-cleanup',
      'Release WASM allocations deterministically and preserve failure facts',
      'Write a release matrix for every outcome'
    ],
    ['/zh/guides/tray', 'Tray 学习路径', '先选择正确的组合根'],
    ['/en/guides/tray', 'Tray learning paths', 'Choose the correct composition root first'],
    ['/zh/guides/tray/getting-started', '五分钟创建可释放的静态 Tray', '声明完整集合与显式依赖'],
    [
      '/en/guides/tray/getting-started',
      'Create a disposable static Tray in five minutes',
      'Declare the complete set and explicit dependencies'
    ],
    [
      '/zh/guides/tray/static-composition',
      '设计静态 Entry 图与 admission 边界',
      '每个 Entry 只声明自己的边界'
    ],
    [
      '/en/guides/tray/static-composition',
      'Design a static entry graph and admission boundary',
      'Each entry declares only its own boundary'
    ],
    [
      '/zh/guides/tray/readiness-and-errors',
      '关闭 Readiness gate，并按错误身份恢复',
      '在启动前解释 blocked 与 failed'
    ],
    [
      '/en/guides/tray/readiness-and-errors',
      'Close readiness gates and recover by error identity',
      'Explain blocked and failed before startup'
    ],
    ['/zh/guides/tray/resource-ownership', '让 Graph 唯一拥有 Entry 资源', '把辅助资源绑定到节点'],
    [
      '/en/guides/tray/resource-ownership',
      'Let the Graph own entry resources exactly once',
      'Bind auxiliary resources to the node'
    ],
    [
      '/zh/guides/tray/dynamic-host',
      '创建唯一身份的托管 Plugin Host',
      '一次性声明初始 definitions 与时间边界'
    ],
    [
      '/en/guides/tray/dynamic-host',
      'Create one managed Plugin Host identity',
      'Declare initial definitions and time boundaries once'
    ],
    [
      '/zh/guides/tray/mutation-and-blocking',
      '解释 use、replace、unUse 与 blocked closure',
      '读取结构化 mutation 结果'
    ],
    [
      '/en/guides/tray/mutation-and-blocking',
      'Interpret use, replace, unUse, and blocked closure',
      'Read the structured mutation result'
    ],
    [
      '/zh/guides/tray/physical-cleanup',
      '区分逻辑提交与物理清理完成',
      '始终保留同一个 physicalCompletion'
    ],
    [
      '/en/guides/tray/physical-cleanup',
      'Separate logical commit from physical cleanup completion',
      'Retain and observe the same physicalCompletion'
    ],
    ['/zh/guides/utils', 'Utils 学习路径', '按问题选择最窄入口'],
    ['/en/guides/utils', 'Utils learning paths', 'Choose the narrowest entry for the problem'],
    [
      '/zh/guides/utils/getting-started',
      '五分钟建立有界、可取消的批处理',
      '把 deadline 放在最外层'
    ],
    [
      '/en/guides/utils/getting-started',
      'Build a bounded, cancellable batch in five minutes',
      'Put the total deadline at the outside'
    ],
    [
      '/zh/guides/utils/deadlines-and-abort',
      '选择 signal composition、abort race 或 deadline',
      '按结算所有权选择'
    ],
    [
      '/en/guides/utils/deadlines-and-abort',
      'Choose signal composition, an abort race, or a deadline',
      'Choose by settlement ownership'
    ],
    [
      '/zh/guides/utils/retry-and-concurrency',
      '用有限重试与并发准入保护依赖',
      '明确总预算与单次预算'
    ],
    [
      '/en/guides/utils/retry-and-concurrency',
      'Protect dependencies with finite retry and concurrency admission',
      'Define total and per-attempt budgets'
    ],
    [
      '/zh/guides/utils/error-identity-and-causes',
      '保留错误身份、原始类型与完整因果链',
      '在包边界附加稳定身份'
    ],
    [
      '/en/guides/utils/error-identity-and-causes',
      'Preserve error identity, native type, and the complete cause chain',
      'Attach stable identity at the public boundary'
    ],
    ['/zh/guides/utils/bytes-and-text', '在协议边界正确处理 Base64 与 UTF-8', '拒绝非规范 Base64'],
    [
      '/en/guides/utils/bytes-and-text',
      'Handle Base64 and UTF-8 correctly at protocol boundaries',
      'Reject non-canonical Base64'
    ],
    [
      '/zh/guides/utils/immutable-objects-and-paths',
      '选择快照语义，并安全更新嵌套路径',
      '明确你要哪一种快照'
    ],
    [
      '/en/guides/utils/immutable-objects-and-paths',
      'Choose snapshot semantics and update nested paths safely',
      'Choose the snapshot you actually mean'
    ],
    [
      '/zh/guides/utils/configuration-ownership',
      '建立配置所有权、只读边界与合并策略',
      '在入口取得配置所有权'
    ],
    [
      '/en/guides/utils/configuration-ownership',
      'Establish configuration ownership, readonly boundaries, and merge policy',
      'Take configuration ownership at the boundary'
    ],
    [
      '/zh/guides/utils/function-and-value-guards',
      '正确判断空值，并让初始化只执行一次',
      '按业务语义选择判断器'
    ],
    [
      '/en/guides/utils/function-and-value-guards',
      'Classify absent values and run initialization exactly once',
      'Choose a guard by business semantic'
    ],
    [
      '/zh/guides/utils/strings-and-numbers',
      '安全插值文本，并统一本地化数字展示',
      '显式决定缺失值和 nullish 策略'
    ],
    [
      '/en/guides/utils/strings-and-numbers',
      'Interpolate display text safely and localize numeric output consistently',
      'Choose missing-value and nullish policy explicitly'
    ],
    ['/zh/guides/web-rpc', 'WebRPC 学习路径', '先决定端点需要公开什么'],
    ['/en/guides/web-rpc', 'WebRPC learning paths', 'First decide what the endpoint must expose'],
    [
      '/zh/guides/web-rpc/getting-started',
      '五分钟建立可释放的 WebRPC 调用链',
      '先建立 transport，再分别创建两端'
    ],
    [
      '/en/guides/web-rpc/getting-started',
      'Build a disposable WebRPC call path in five minutes',
      'Create the transport first, then construct both endpoints'
    ],
    [
      '/zh/guides/web-rpc/endpoint-composition',
      '选择预设，或组合最小 Endpoint',
      '优先选择最窄预设'
    ],
    [
      '/en/guides/web-rpc/endpoint-composition',
      'Choose a preset or compose the smallest endpoint',
      'Prefer the narrowest preset'
    ],
    [
      '/zh/guides/web-rpc/calls-and-cancellation',
      '正确选择调用、广播、通知与取消语义',
      '不要用一个方法模拟另一种语义'
    ],
    [
      '/en/guides/web-rpc/calls-and-cancellation',
      'Choose call, fan-out, notification, and cancellation semantics correctly',
      'Do not use one operation to imitate another'
    ],
    [
      '/zh/guides/web-rpc/providers-and-contracts',
      '用 Provider 与 Contract 固定网络边界',
      '为每个公开方法声明参数与结果'
    ],
    [
      '/en/guides/web-rpc/providers-and-contracts',
      'Fix the network boundary with providers and contracts',
      'Declare parameters and results for every public method'
    ],
    [
      '/zh/guides/web-rpc/transports-and-security',
      '按拓扑选择 Transport，并建立真实安全边界',
      '先声明真实拓扑'
    ],
    [
      '/en/guides/web-rpc/transports-and-security',
      'Choose a transport by topology and establish a real security boundary',
      'Declare the real topology first'
    ],
    [
      '/zh/guides/web-rpc/extension-authoring',
      '扩展 WebRPC：Feature 边界与自定义 Middleware',
      '编写一个可释放的自定义 Middleware'
    ],
    [
      '/en/guides/web-rpc/extension-authoring',
      'Extend WebRPC: Feature boundaries and custom middleware',
      'Author disposable custom middleware'
    ],
    [
      '/zh/guides/web-rpc/discovery-and-control',
      '发现远端能力，并显式启用控制面',
      '把自动发现与手动发现当成不同策略'
    ],
    [
      '/en/guides/web-rpc/discovery-and-control',
      'Discover remote capabilities and enable the control plane explicitly',
      'Treat automatic and manual discovery as different policies'
    ],
    [
      '/zh/guides/web-rpc/chunking-and-backpressure',
      '在明确容量预算下启用分片',
      '同时选择 chunk Feature 与策略 middleware'
    ],
    [
      '/en/guides/web-rpc/chunking-and-backpressure',
      'Enable chunking under explicit capacity budgets',
      'Select both the chunk Feature and policy middleware'
    ],
    [
      '/zh/guides/web-rpc/replay-retry-and-lifecycle',
      '区分重放保护、业务重试与 Endpoint 终态',
      '按双向请求吞吐配置重放窗口'
    ],
    [
      '/en/guides/web-rpc/replay-retry-and-lifecycle',
      'Separate replay protection, business retry, and endpoint terminal state',
      'Size the replay window from bidirectional request throughput'
    ],
    ['/zh/guides/storage-web', 'Storage Web 学习路径', '先根据能力选择存储'],
    ['/en/guides/storage-web', 'Storage Web learning paths', 'Choose storage by capability first'],
    [
      '/zh/guides/storage-web/getting-started',
      '五分钟选择并使用 Storage Web 后端',
      'Local Storage 异步契约：保持调用模型可替换'
    ],
    [
      '/en/guides/storage-web/getting-started',
      'Choose and use a Storage Web backend in five minutes',
      'Local Storage async contract for a replaceable call model'
    ],
    [
      '/zh/guides/storage-web/indexeddb-and-transactions',
      '用 IndexedDB 管理记录与事务',
      '完成一条 record 的创建、读取、更新、删除与遍历'
    ],
    [
      '/en/guides/storage-web/indexeddb-and-transactions',
      'Manage records and transactions with IndexedDB',
      'Create, read, update, delete, and iterate one record'
    ],
    [
      '/zh/guides/storage-web/entity-schema-and-codecs',
      '组合 Entity、Schema、Codec 与迁移',
      '用一个定义产生 repository'
    ],
    [
      '/en/guides/storage-web/entity-schema-and-codecs',
      'Compose Entity, Schema, Codec, and migrations',
      'Produce a repository from one definition'
    ],
    [
      '/zh/guides/storage-web/host-and-plugins',
      '用 Storage Host 组合多个后端',
      '整个 plugins 数组全部成功后'
    ],
    [
      '/en/guides/storage-web/host-and-plugins',
      'Compose several backends with Storage Host',
      'The Host exposes backends only after the whole plugin array succeeds'
    ],
    [
      '/zh/guides/storage-web/reactive-live-queries',
      '创建可取消的 Reactive live query',
      'Live Query 解决“数据变了，读取结果何时重算”'
    ],
    [
      '/en/guides/storage-web/reactive-live-queries',
      'Create a cancellable reactive live query',
      'Live Query answers when a read must rerun after data changes'
    ],
    [
      '/zh/guides/storage-web/cookies-and-security',
      '正确处理 Cookie scope 与安全边界',
      '把 scope 当作 Cookie 持久身份的一部分'
    ],
    [
      '/en/guides/storage-web/cookies-and-security',
      'Handle cookie scope and security boundaries correctly',
      'Treat scope as part of persistent Cookie identity'
    ],
    [
      '/zh/guides/storage-web/cancellation-errors-and-shutdown',
      '处理取消、错误与 Storage 终态',
      '用户不再需要结果时，用 AbortController 主动取消'
    ],
    [
      '/en/guides/storage-web/cancellation-errors-and-shutdown',
      'Handle cancellation, errors, and Storage terminal state',
      'Use AbortController when the user no longer needs a result'
    ],
    ['/zh/guides/logger', 'Logger 学习路径', '按你要解决的问题进入'],
    ['/en/guides/logger', 'Logger learning paths', 'Enter through the problem you need to solve'],
    [
      '/zh/guides/logger/getting-started',
      '五分钟建立可关闭的结构化 Logger',
      '构造、输出并观察失败'
    ],
    [
      '/en/guides/logger/getting-started',
      'Build a shutdown-safe structured Logger in five minutes',
      'Construct, emit, and observe failures'
    ],
    [
      '/zh/guides/logger/entries-hooks-and-sinks',
      '组织 entry、hook 与 sink',
      '需要字段语义时使用 dispatchRaw'
    ],
    [
      '/en/guides/logger/entries-hooks-and-sinks',
      'Organize entries, hooks, and sinks',
      'Use dispatchRaw when fields carry meaning'
    ],
    ['/zh/guides/logger/plugins-and-batching', '组合内置插件与有界批处理', '按 provider'],
    [
      '/en/guides/logger/plugins-and-batching',
      'Compose built-in plugins and bounded batching',
      'Order plugins from provider to consumer'
    ],
    ['/zh/guides/logger/pipelines', '为 Logger 选择 pipeline 模式', '不要把四种控制流混用'],
    [
      '/en/guides/logger/pipelines',
      'Choose a Logger pipeline mode',
      'Do not mix the four control flows'
    ],
    ['/zh/guides/logger/flush-and-shutdown', '正确 flush 并进入终态', '按所有权边界选择操作'],
    [
      '/en/guides/logger/flush-and-shutdown',
      'Flush correctly and enter terminal state',
      'Choose an operation from the ownership boundary'
    ],
    [
      '/zh/guides/logger/runtime-and-forwarding',
      '跨运行时适配并组合多个 Logger',
      '只在平台边界替换 runtime manager'
    ],
    [
      '/en/guides/logger/runtime-and-forwarding',
      'Adapt runtimes and compose multiple Loggers',
      'Replace the runtime manager only at a platform boundary'
    ],
    ['/zh/guides/plugin-host', 'Plugin Host 学习路径', '先按任务选择入口'],
    ['/en/guides/plugin-host', 'Plugin Host learning paths', 'Choose an entry by task'],
    ['/zh/guides/plugin-host/getting-started', '创建并使用第一个 Plugin Host', '定义领域 core'],
    [
      '/en/guides/plugin-host/getting-started',
      'Create and use your first Plugin Host',
      'Define a domain core'
    ],
    ['/zh/guides/plugin-host/install-and-compose', '安装与组合插件', '先排序，再交给 Host 安装'],
    [
      '/en/guides/plugin-host/install-and-compose',
      'Install and compose plugins',
      'Order first, then install'
    ],
    [
      '/zh/guides/plugin-host/configuration-and-shared',
      '配置与 shared 能力',
      '配置更新成功后才提交'
    ],
    [
      '/en/guides/plugin-host/configuration-and-shared',
      'Configuration and shared capabilities',
      'Commit configuration only after successful updates'
    ],
    ['/zh/guides/plugin-host/pipelines', '选择并运行 pipeline', '按控制流选择模式'],
    [
      '/en/guides/plugin-host/pipelines',
      'Choose and run a pipeline',
      'Choose a mode from control flow'
    ],
    ['/zh/guides/plugin-host/removal-and-rollback', '卸载、回滚与物理清理', '按依赖反向卸载'],
    [
      '/en/guides/plugin-host/removal-and-rollback',
      'Removal, rollback, and physical cleanup',
      'Remove in reverse dependency order'
    ],
    ['/zh/guides/capability', 'Capability 学习路径', '从变化发生在哪里开始'],
    ['/en/guides/capability', 'Capability learning paths', 'Start with where change occurs'],
    [
      '/zh/guides/capability/getting-started',
      '五分钟建立可回退的运行时能力',
      '登记惰性能力并保留释放句柄'
    ],
    [
      '/en/guides/capability/getting-started',
      'Build a revocable runtime capability in five minutes',
      'Register a lazy capability with an owned release handle'
    ],
    [
      '/zh/guides/capability/graph',
      '启动一个封闭的静态 Capability Graph',
      '声明直接 provider，而不是在 start 内隐式查找'
    ],
    [
      '/en/guides/capability/graph',
      'Start a closed static Capability Graph',
      'Declare direct providers instead of discovering them inside start'
    ],
    [
      '/zh/guides/capability/graph-dynamic',
      '在运行中安全替换 Capability Graph 节点',
      '把一次变更当作受影响闭包事务'
    ],
    [
      '/en/guides/capability/graph-dynamic',
      'Replace Capability Graph nodes safely at runtime',
      'Treat one mutation as an affected-closure transaction'
    ],
    [
      '/zh/guides/capability/graph-topology',
      '为组合层构建不可变拓扑快照',
      '只在你已经拥有 lifecycle 时使用'
    ],
    [
      '/en/guides/capability/graph-topology',
      'Build an immutable topology snapshot for a composition layer',
      'Use it only when you already own lifecycle'
    ],
    ['/zh/guides/middleware-pipeline', 'Middleware Pipeline 学习路径', '按控制流选择 runner'],
    [
      '/en/guides/middleware-pipeline',
      'Middleware Pipeline learning paths',
      'Choose a runner by control flow'
    ],
    [
      '/zh/guides/middleware-pipeline/getting-started',
      '五分钟建立异步洋葱 Pipeline',
      '把下游 Promise 当作当前 stage 的生命周期'
    ],
    [
      '/en/guides/middleware-pipeline/getting-started',
      'Build an asynchronous onion Pipeline in five minutes',
      'Treat the downstream Promise as the current stage lifetime'
    ],
    [
      '/zh/guides/middleware-pipeline/sync-and-async',
      '在同步链和异步洋葱之间做出明确选择',
      '不要用 async stage 填进同步 runner'
    ],
    [
      '/en/guides/middleware-pipeline/sync-and-async',
      'Choose explicitly between a synchronous chain and an async onion',
      'Do not place an async stage in the synchronous runner'
    ],
    [
      '/zh/guides/middleware-pipeline/generators',
      '用 generator 明确区分候选值与控制信号',
      '阅读 return，而不是只看 yield'
    ],
    [
      '/en/guides/middleware-pipeline/generators',
      'Separate candidate values from control signals with generators',
      'Read the return value, not only each yield'
    ],
    [
      '/zh/guides/middleware-pipeline/cancellation-and-errors',
      '组合协作取消与双失败，而不丢失原始错误',
      '把 signal 当作共享只读上下文'
    ],
    [
      '/en/guides/middleware-pipeline/cancellation-and-errors',
      'Compose cooperative cancellation and dual failures without losing causes',
      'Treat signal as shared read-only context'
    ],
    ['/zh/guides/resource', 'Resource 学习路径', '把可见状态与传输状态分开'],
    [
      '/en/guides/resource',
      'Resource learning paths',
      'Separate visible state from transport state'
    ],
    [
      '/zh/guides/resource/getting-started',
      '五分钟建立响应式异步 Resource',
      '建立依赖追踪与 latest-wins 请求'
    ],
    [
      '/en/guides/resource/getting-started',
      'Build a reactive asynchronous Resource in five minutes',
      'Connect dependency tracking to latest-wins requests'
    ],
    [
      '/zh/guides/resource/caching-and-refresh',
      '设计 Resource 缓存新鲜度与后台刷新',
      '分别选择时间、展示和保活策略'
    ],
    [
      '/en/guides/resource/caching-and-refresh',
      'Design Resource cache freshness and background refresh',
      'Choose time, presentation, and retention separately'
    ],
    [
      '/zh/guides/resource/suspense-and-ssr',
      '把 Resource 接入 Suspense 与 SSR 快照',
      '三种结果进入正确边界'
    ],
    [
      '/en/guides/resource/suspense-and-ssr',
      'Integrate Resource with Suspense and SSR snapshots',
      'outcome to the right boundary'
    ],
    [
      '/zh/guides/resource/cancellation-and-retry',
      '控制 Resource 取消、重试与退避',
      '让重试策略受错误和次数约束'
    ],
    [
      '/en/guides/resource/cancellation-and-retry',
      'Control Resource cancellation, retries, and backoff',
      'Bound retry by both error and attempt count'
    ],
    ['/zh/guides/reactive', 'Reactive 学习路径', '先理解三个角色'],
    ['/zh/guides/reactive/getting-started', '五分钟建立响应式状态', '建立第一张图'],
    ['/zh/guides/reactive/reactive', '组合 Signal、Computed 与 Effect', '区分 value 与 peek'],
    ['/zh/guides/reactive/runtime', '隔离 Runtime 与宿主能力', '每个隔离域创建一个 Runtime'],
    ['/en/guides/reactive', 'Reactive learning paths', 'Start with three roles'],
    [
      '/en/guides/reactive/getting-started',
      'Build reactive state in five minutes',
      'Build the first graph'
    ],
    [
      '/en/guides/reactive/reactive',
      'Compose Signal, Computed, and Effect',
      'Distinguish value from peek'
    ],
    [
      '/en/guides/reactive/runtime',
      'Isolate Runtime and host capabilities',
      'Create one Runtime per isolation domain'
    ],
    ['/zh/guides/event-subscriber', 'Event Subscriber 学习路径', '先选择事件边界'],
    [
      '/zh/guides/event-subscriber/getting-started',
      '五分钟建立类型安全的 Channel',
      '创建并拥有一个 Channel'
    ],
    [
      '/en/guides/event-subscriber',
      'Event Subscriber learning paths',
      'Choose the event boundary first'
    ],
    [
      '/en/guides/event-subscriber/getting-started',
      'Build a type-safe Channel in five minutes',
      'Create and own one Channel'
    ],
    [
      '/zh/guides/event-subscriber/subscriptions',
      '把订阅寿命交给明确的所有者',
      '先选择订阅何时结束'
    ],
    [
      '/en/guides/event-subscriber/subscriptions',
      'Give every subscription an explicit lifetime owner',
      'Choose when the subscription ends first'
    ],
    [
      '/zh/guides/event-subscriber/async-invocation',
      '显式选择异步 listener 的顺序与失败结果',
      '用两条轴选择 API'
    ],
    [
      '/en/guides/event-subscriber/async-invocation',
      'Choose async listener ordering and failure shape explicitly',
      'Choose an API on two axes'
    ],
    ['/zh/guides/lifecycle', 'Lifecycle 学习路径', '按所有权问题选择原语'],
    ['/zh/guides/lifecycle/getting-started', '五分钟建立资源 Scope', '登记资源并统一释放'],
    ['/en/guides/lifecycle', 'Lifecycle learning paths', 'Choose a primitive by ownership problem'],
    [
      '/en/guides/lifecycle/getting-started',
      'Build a resource Scope in five minutes',
      'Own resources and release them together'
    ],
    ['/zh/guides/lifecycle/scope', '用 Scope 表达资源所有权', 'Scope 是所有权边界'],
    [
      '/en/guides/lifecycle/scope',
      'Express resource ownership with Scope',
      'A Scope is an ownership boundary'
    ],
    ['/zh/guides/lifecycle/disposal', '组合可追踪的释放事务', '先归一化释放意图'],
    [
      '/en/guides/lifecycle/disposal',
      'Compose traceable disposal transactions',
      'Normalize release intent first'
    ],
    ['/zh/guides/lifecycle/abort', '让取消由明确的 owner 驱动', '组合外部 signal 与本地取消'],
    [
      '/en/guides/lifecycle/abort',
      'Let one explicit owner drive cancellation',
      'Compose an external signal with local cancellation'
    ],
    ['/zh/guides/lifecycle/quiescence', '证明任务与 lease 已经归零', '先登记，再封闭，最后等待'],
    [
      '/en/guides/lifecycle/quiescence',
      'Prove that tasks and leases reached zero',
      'Retain first, seal admission, then wait'
    ],
    [
      '/zh/guides/lifecycle/scheduler',
      '统一生命周期时间与调度',
      '生产使用系统时间，测试使用手动时间'
    ],
    [
      '/en/guides/lifecycle/scheduler',
      'Unify lifecycle time and scheduling',
      'Use system time in production and manual time in tests'
    ],
    ['/zh/guides/lifecycle/generation', '只接纳最新一代异步结果', '为每次启动捕获独立 token'],
    [
      '/en/guides/lifecycle/generation',
      'Adopt only the latest asynchronous generation',
      'Capture a distinct token for every start'
    ],
    [
      '/zh/guides/lifecycle/errors',
      '选择错误策略，而不是吞掉 cleanup 失败',
      '按调用边界选择四种结果'
    ],
    [
      '/en/guides/lifecycle/errors',
      'Choose an error policy instead of swallowing cleanup failures',
      'Choose one of four outcomes at the call boundary'
    ]
  ] as const

  for (const [path, title, section] of expectations) {
    const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
    assert.match(html, new RegExp(`<h1>${title}</h1>`), `missing task title: ${path}`)
    assert.match(html, new RegExp(section), `missing task section: ${path}`)
    assert.match(html, /class="guide-journey-next"/, `missing bounded next action: ${path}`)
  }

  const gettingStarted = readFileSync(
    join(buildRoot, artifactPath('/en/guides/reactive/getting-started')),
    'utf8'
  )
  assert.match(gettingStarted, /createRuntime[\s\S]*?@migaia\/reactive/)
  assert.match(gettingStarted, /Maintained example/)
  assert.doesNotMatch(gettingStarted, /维护示例/)
  assert.doesNotMatch(gettingStarted, /VersionClock|DependencyTracker|node-internals/)

  const capabilityTopics = ['getting-started', 'graph', 'graph-dynamic', 'graph-topology']
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/guides/capability/${topic}`)), 'utf8')
    )
    .join('\n')
  assert.match(capabilityTopics, /createCapabilityHost/)
  assert.match(capabilityTopics, /createCapabilityGraph/)
  assert.match(capabilityTopics, /createDynamicCapabilityGraph/)
  assert.match(capabilityTopics, /buildCapabilityTopology/)
  assert.match(guideSource, /await import\('\.\/persistence\.js'\)/)
  assert.match(guideSource, /mutationAdmissionMs: 1_000/)
  assert.doesNotMatch(guideSource, /host\.enable\([^)]*\) === true/)
  assert.match(capabilityTopics, /every capability is gated/)
  assert.match(capabilityTopics, /setFlags\(next\)/)
  assert.match(capabilityTopics, /startBatch and releaseBatch transfer ownership/)
  assert.match(capabilityTopics, /does not bound start or release execution/)

  const middlewareTopics = [
    'getting-started',
    'sync-and-async',
    'generators',
    'cancellation-and-errors'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/guides/middleware-pipeline/${topic}`)), 'utf8')
    )
    .join('\n')
  assert.match(middlewareTopics, /runAsyncMiddleware/)
  assert.match(middlewareTopics, /runSyncMiddleware/)
  assert.match(middlewareTopics, /runGeneratorMiddleware/)
  assert.match(middlewareTopics, /AggregateError/)
  assert.match(guideSource, /await next\(\{ \.\.\.request, authenticated: true \}\)/)
  assert.doesNotMatch(guideSource, /Promise\.race\([^)]*signal/)

  const resourceTopics = [
    'getting-started',
    'caching-and-refresh',
    'suspense-and-ssr',
    'cancellation-and-retry'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/guides/resource/${topic}`)), 'utf8')
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
  assert.match(guideSource, /fetch\(`\/api\/users\/\$\{id\}`.*\{ signal \}/)
  assert.match(guideSource, /const payload = JSON\.stringify\(snapshot\)/)
  assert.match(guideSource, /initialSnapshot,\\n  ttl: 30_000/)

  const serializeTopics = [
    'getting-started',
    'chunk-shapes-and-wire-conversion',
    'registry-and-plugins',
    'streaming-and-backpressure',
    'shutdown-and-errors'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/guides/serialize/${topic}`)), 'utf8')
    )
    .join('\n')
  const serializeText = renderedText(serializeTopics)
  assert.match(serializeText, /createSerializeRegistry/)
  assert.match(serializeText, /chunkToBytes/)
  assert.match(serializeText, /string-only channel/)
  assert.match(serializeText, /replacer/)
  assert.match(serializeText, /TextDecoder/)
  assert.match(serializeText, /primaryType/)
  assert.match(serializeText, /maxInFlight/)
  assert.match(serializeText, /deadlineAt/)
  assert.match(serializeText, /CODEC_NOT_FOUND/)
  assert.match(guideSource, /type: registry\.primaryType,\\n    chunk: await registry\.encode/)
  assert.match(guideSource, /for \(const textPart of streamBase64Chunks\(payload\)\)/)
  assert.match(guideSource, /scheduler: systemScheduler,\\n  targetMs: 8/)

  const storageContractTopics = [
    'getting-started',
    'capability-narrowing',
    'safe-operations-and-keys',
    'records-indexes-and-transactions',
    'change-feed-and-subscription-ownership',
    'codecs-and-errors'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/guides/storage-contract/${topic}`)), 'utf8')
    )
    .join('\n')
  const storageContractText = renderedText(storageContractTopics)
  assert.match(storageContractText, /snapshotKeyValueStore/)
  assert.match(storageContractText, /isRecordStore/)
  assert.match(storageContractText, /pageSize/)
  assert.match(storageContractText, /generation-bound handle/)
  assert.match(storageContractText, /Events arrive after commit/)
  assert.match(storageContractText, /sequence detects duplicates or reordering/)
  assert.match(storageContractText, /Call unsubscribe\(\)/)
  assert.match(storageContractText, /collectionsJsonCodec/)
  assert.match(storageContractText, /UNSUPPORTED_CAPABILITY/)
  assert.match(guideSource, /const stableKey = snapshotStorageKey\(key, store\.backend/)
  assert.match(guideSource, /change\.sequence <= sequence/)
  assert.match(guideSource, /stableCodec\.output === 'binary'/)

  const pluginHostTopics = [
    'getting-started',
    'install-and-compose',
    'configuration-and-shared',
    'pipelines',
    'removal-and-rollback'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/guides/plugin-host/${topic}`)), 'utf8')
    )
    .join('\n')
  const pluginHostText = renderedText(pluginHostTopics)
  assert.match(pluginHostText, /new AppHost/)
  assert.match(pluginHostText, /view\.extensions/)
  assert.match(pluginHostText, /provider before its consumer/)
  assert.match(pluginHostText, /queueAdmissionTimeoutMs/)
  assert.match(pluginHostText, /disposeStepTimeoutMs/)
  assert.match(pluginHostText, /Register installation resources with core\.onDispose/)
  assert.match(pluginHostText, /Expose a domain entry point from the Host subclass/)
  assert.match(pluginHostText, /pipelineDrainTimeoutMs/)
  assert.match(pluginHostText, /VIEW_REVOKED/)
  assert.match(pluginHostText, /physicalCompletion/)
  assert.match(guideSource, /mutationTimeoutMs: 5_000/)
  assert.match(guideSource, /satisfies IPlugin<IAppCore, IGreetingExtension, IGreetingConfig>/)
  assert.match(guideSource, /installed\.config\.update\('greeting'/)
  assert.match(guideSource, /core\.usePipeline\(\(value, next\)/)
  assert.match(guideSource, /consumer first/)

  const loggerTopics = [
    'getting-started',
    'entries-hooks-and-sinks',
    'plugins-and-batching',
    'custom-plugin',
    'pipelines',
    'flush-and-shutdown',
    'runtime-and-forwarding'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/guides/logger/${topic}`)), 'utf8')
    )
    .join('\n')
  const loggerText = renderedText(loggerTopics)
  assert.match(loggerText, /onFailure/)
  assert.match(loggerText, /systemScheduler/)
  assert.match(loggerText, /core\.ctx\.options/)
  assert.match(loggerText, /dispatchRaw/)
  assert.match(loggerText, /batch must precede http/)
  assert.match(loggerText, /BATCH_OVERFLOW/)
  assert.match(loggerText, /PIPELINE_NEXT_DUPLICATE/)
  assert.match(loggerText, /shutdown-safe|terminal state/)
  assert.match(loggerText, /setLoggerRuntimeManager/)
  assert.match(guideSource, /plugins: \[level\(\{ level: 'info' \}\), color\(\)\]/)
  assert.match(guideSource, /log\.usePipeline\(\(entry, next\)/)
  assert.match(guideSource, /const restore = setLoggerRuntimeManager/)
  assert.match(guideSource, /requestLog\.extends\(appLog, auditLog\)/)

  const storageWebStart = readFileSync(
    join(buildRoot, artifactPath('/en/guides/storage-web/getting-started')),
    'utf8'
  )
  const storageWebStartText = renderedText(storageWebStart)
  assert.match(storageWebStartText, /store\.capabilities|capabilities\.syncRead/)
  assert.match(storageWebStartText, /putRecord/)
  assert.match(storageWebStartText, /createStorageHost/)
  assert.match(storageWebStartText, /memoryBackendPlugin/)
  assert.match(storageWebStartText, /dispose terminates the store without deleting persistent data/)
  assert.match(guideSource, /namespace: 'settings'/)
  assert.match(guideSource, /plugins: \[memoryBackendPlugin\(\{ id: 'cache' \}\)\] as const/)

  const storageWebTopics = [
    'indexeddb-and-transactions',
    'entity-schema-and-codecs',
    'host-and-plugins',
    'reactive-live-queries',
    'cookies-and-security',
    'cancellation-errors-and-shutdown'
  ]
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/guides/storage-web/${topic}`)), 'utf8')
    )
    .join('\n')
  const storageWebText = renderedText(storageWebTopics)
  assert.match(storageWebText, /TRANSACTION_CONFLICT/)
  assert.match(storageWebText, /cleanupLegacyRecords/)
  assert.match(storageWebText, /factory \/ keyRange/)
  assert.match(storageWebText, /validate → normalize → schema\.encode → codec\.encode/)
  assert.match(storageWebText, /STORAGE_HOST_BUSY/)
  assert.match(storageWebText, /keepPreviousData/)
  assert.match(storageWebText, /COOKIE_SCOPE_AMBIGUOUS/)
  assert.match(storageWebText, /StorageContractError/)
  assert.match(guideSource, /await db\.transaction\(async \(tx\)/)
  assert.match(guideSource, /plugins: \[indexedDbReactive\(\{[\s\S]*?id: 'primary'/)

  const webRpcStart = readFileSync(
    join(buildRoot, artifactPath('/en/guides/web-rpc/getting-started')),
    'utf8'
  )
  const webRpcStartText = renderedText(webRpcStart)
  assert.match(webRpcStartText, /createClientEndpoint/)
  assert.match(webRpcStartText, /createProviderEndpoint/)
  assert.match(webRpcStartText, /createMemoryTransportPair/)
  assert.match(webRpcStartText, /provider\.provide/)
  assert.match(webRpcStartText, /client\.send/)
  assert.match(webRpcStartText, /construction\.timeoutMs/)
  assert.match(webRpcStartText, /4096 \/ 310000 ms/)
  assert.match(webRpcStartText, /OVERLOADED/)
  assert.match(webRpcStartText, /dispatch is a one-way notification/)
  assert.match(guideSource, /middlewares: \[\\n\s+contract\(\{ version: '1' \}\),/)
  assert.match(guideSource, /await Promise\.all\(\[client\.dispose\(\), provider\.dispose\(\)\]\)/)
  assert.match(guideSource, /path: 'endpoint-composition'/)
  assert.match(guideSource, /\[outbound\(\), discovery\(\), control\(\)\] as const/)
  assert.match(guideSource, /controller\.abort\(new Error\('route changed'\)\)/)
  assert.match(guideSource, /params: z\.object\(\{ a: z\.number\(\), b: z\.number\(\) \}\)/)
  assert.match(guideSource, /providerLimits\.maxGlobal defaults to 256/)
  assert.match(guideSource, /Misreporting a multiplexed or broadcast channel as exclusive/)
  assert.match(guideSource, /endpoint\.discovery is a readonly remote snapshot/)
  assert.match(guideSource, /maxConcurrentMessages \/ maxConcurrentMessagesPerPeer/)
  assert.match(guideSource, /A terminal endpoint cannot be revived/)

  const eventStart = readFileSync(
    join(buildRoot, artifactPath('/en/guides/event-subscriber/getting-started')),
    'utf8'
  )
  assert.match(eventStart, /createEventChannel[\s\S]*?@migaia\/event-subscriber/)
  assert.doesNotMatch(eventStart, /invokeParallelSettled[\s\S]*?invokeTaskSettled/)

  const eventTopics = ['subscriptions', 'async-invocation']
    .map((topic) =>
      readFileSync(join(buildRoot, artifactPath(`/en/guides/event-subscriber/${topic}`)), 'utf8')
    )
    .join('\n')
  assert.match(eventTopics, /subscribeUntil/)
  assert.match(eventTopics, /invokeParallelSettled/)
  assert.match(eventTopics, /EventSubscriberState/)

  const lifecycleStart = readFileSync(
    join(buildRoot, artifactPath('/en/guides/lifecycle/getting-started')),
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
      readFileSync(join(buildRoot, artifactPath(`/en/guides/lifecycle/${topic}`)), 'utf8')
    )
    .join('\n')
  assert.doesNotMatch(guideSource, /scope\.own\(\(\)|createAbortController\(\{|advanceBy\(/)
  assert.match(guideSource, /scope\.own\([^,]+, \{ force:/)
  assert.match(lifecycleTopics, /observeAbortSubscription/)
  assert.match(lifecycleTopics, /scheduler[\s\S]*?advance/)
  assert.match(lifecycleTopics, /gracefulTimeoutMs/)
  assert.match(guideSource, /failures\.length > 0/)
  assert.match(lifecycleTopics, /higher values release first/)
  assert.match(guideSource, /requests\.adopt\(request\.token/)
  assert.match(guideSource, /createErrorCollector\('collect'/)
})

test('SITE-T-REACTIVE-START flushes the queued rerun before disposing the Effect', () => {
  for (const locale of ['en', 'zh']) {
    const page = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/guides/reactive/getting-started`)),
      'utf8'
    )
    const flush = page.indexOf('runtime.flush')
    const stop = page.indexOf('stop()')

    assert.ok(flush >= 0, `/${locale}/guides/reactive/getting-started misses runtime.flush()`)
    assert.ok(stop > flush, `/${locale}/guides/reactive/getting-started disposes before flush`)
    assert.ok(page.includes('total: 36'))
  }
})

test('SITE-T-REACTIVE-START explains graph tracking, scheduling, and exact cleanup', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/reactive')), 'utf8')
  const text = renderedText(html)

  assert.match(text, /Effect → Computed → Signal.*?依赖自动登记/s)
  assert.match(text, /count\.value = 3.*?不会在 setter 内立刻重跑副作用/s)
  assert.match(text, /runtime\.flush\(\).*?同步排空.*?队列/s)
  assert.match(text, /测试、SSR.*?才显式调用 flush\(\)/s)
  assert.match(text, /释放顺序按消费者到数据源执行/)
  assert.match(text, /Runtime 本身没有 dispose\(\)/)
  assert.match(text, /Scope.*?统一释放/s)
})

test('SITE-T-MIDDLEWARE-ADAPTERS documents every supported conversion and the forbidden direction', () => {
  for (const locale of ['en', 'zh']) {
    const page = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/guides/middleware-pipeline/sync-and-async`)),
      'utf8'
    )

    for (const fragment of [
      'adaptSyncStageToAsync',
      'adaptSyncStageToGenerator',
      'adaptGeneratorStageToAsyncGenerator',
      'adaptSyncStageToAsyncGenerator',
      'GENERATOR_HALT',
      'onViolation'
    ])
      assert.ok(
        page.includes(fragment),
        `/${locale}/guides/middleware-pipeline adapters misses ${fragment}`
      )
    assert.ok(locale === 'en' ? page.includes('Unsupported') : page.includes('不支持'))
  }
})

test('SITE-T-EVENT-STYLE teaches aliases while preserving the canonical Channel contract', () => {
  for (const locale of ['en', 'zh']) {
    const page = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/guides/event-subscriber/getting-started`)),
      'utf8'
    )

    for (const fragment of [
      'subscribe-publish',
      'on-emit',
      'on-trigger',
      'listen-fire',
      'defineEventApiStyle',
      'saved',
      'on',
      'emit',
      'subscribe',
      'publish',
      'dispatchPolicy',
      'publishBudget'
    ])
      assert.ok(
        page.includes(fragment),
        `/${locale}/guides/event-subscriber style misses ${fragment}`
      )
  }
})

test('SITE-T-WEBRPC-LINKS keeps every maintained WebRPC continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'endpoint-composition',
    'extension-authoring',
    'calls-and-cancellation',
    'providers-and-contracts',
    'transports-and-security',
    'discovery-and-control',
    'chunking-and-backpressure',
    'replay-retry-and-lifecycle'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/guides/web-rpc${topic ? `/${topic}` : ''}`
      const html = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
      const internalLinks = [
        ...html.matchAll(/href="(\/(?:en|zh)\/(?:docs|guides|architecture)[^"#?]*)/g)
      ]
        .map((match) => match[1])
        .filter((link): link is string => link !== undefined)

      for (const link of internalLinks) {
        assert.ok(routes.has(link), `broken maintained WebRPC link: ${path} -> ${link}`)
      }
    }
  }
})

test('SITE-T-WEBRPC-TRANSPORTS renders every adapter tutorial in both locales', () => {
  const factories = [
    'createMemoryTransportPair',
    'createWindowMessageTransport',
    'createBrowserMessagePortTransport',
    'createNodeMessagePortTransport',
    'createWebWorkerTransport',
    'createSharedWorkerTransport',
    'createServiceWorkerTransport',
    'createBroadcastChannelTransport',
    'createRtcDataChannelTransport',
    'createWebTransportDatagramTransport'
  ]
  for (const locale of ['en', 'zh']) {
    const path = `/${locale}/guides/web-rpc/transports-and-security`
    const page = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
    for (const factory of factories) assert.ok(page.includes(factory), `${path} misses ${factory}`)
    assert.ok(!page.includes('createMessagePortTransport'))
  }
})

test('SITE-T-WEBRPC-NAV exposes primary endpoints and every guide from the left rail', () => {
  for (const locale of ['en', 'zh']) {
    const docsPath = `/${locale}/docs/web-rpc`
    const docsPage = readFileSync(join(buildRoot, artifactPath(docsPath)), 'utf8')
    for (const endpoint of [
      'createEndpoint',
      'createClientEndpoint',
      'createProviderEndpoint',
      'createFullEndpoint',
      'createComposedEndpoint'
    ])
      assert.ok(docsPage.includes(`>${endpoint}</a>`), `${docsPath} hides ${endpoint}`)
    assert.ok(docsPage.includes(`/${locale}/guides/web-rpc/transports-and-security`))
    assert.ok(docsPage.includes(`/${locale}/guides/web-rpc/endpoint-composition`))

    const guidePath = `/${locale}/guides/web-rpc/transports-and-security`
    const guidePage = readFileSync(join(buildRoot, artifactPath(guidePath)), 'utf8')
    for (const anchor of [
      'window-transport',
      'web-worker-transport',
      'shared-worker-transport',
      'broadcast-channel-transport'
    ]) {
      assert.ok(guidePage.includes(`id="${anchor}"`), `${guidePath} misses #${anchor}`)
      assert.ok(guidePage.includes(`href="#${anchor}"`), `${guidePath} does not link #${anchor}`)
    }
    for (const topic of [
      'getting-started',
      'endpoint-composition',
      'extension-authoring',
      'calls-and-cancellation',
      'providers-and-contracts',
      'transports-and-security',
      'discovery-and-control',
      'chunking-and-backpressure',
      'replay-retry-and-lifecycle'
    ])
      assert.ok(guidePage.includes(`/${locale}/guides/web-rpc/${topic}`))
    assert.ok(guidePage.includes('href="#memory-transport"'))
    assert.ok(guidePage.includes('href="#web-transport-datagram-transport"'))
  }
})

test('SITE-T-WEBRPC-ENDPOINT-SELECTION explains all factories and the universal entry', () => {
  for (const locale of ['en', 'zh']) {
    const path = `/${locale}/guides/web-rpc/endpoint-composition`
    const page = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
    for (const factory of [
      'createEndpoint',
      'createClientEndpoint',
      'createProviderEndpoint',
      'createFullEndpoint',
      'createComposedEndpoint'
    ])
      assert.ok(page.includes(factory), `${path} misses ${factory}`)
    assert.ok(page.includes('createEndpoint'))
    assert.ok(page.includes('createFullEndpoint'))
    assert.match(page, locale === 'zh' ? /万能 API/ : /universal API/)
    assert.match(page, locale === 'zh' ? /同一个函数引用/ : /same function reference/)
    for (const feature of ['outbound()', 'provider()', 'discovery()', 'control()'])
      assert.ok(page.includes(feature), `${path} does not explain built-in ${feature}`)
    assert.ok(page.includes(`/${locale}/guides/web-rpc/extension-authoring`))
  }
})

test('SITE-T-WEBRPC-EXTENSIONS documents the public Feature boundary and custom middleware', () => {
  for (const locale of ['en', 'zh']) {
    const path = `/${locale}/guides/web-rpc/extension-authoring`
    const page = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
    for (const contract of [
      'IWebRpcPlugin',
      'reportTransportErrors',
      'scope.own',
      'IWebRpcEndpointModule',
      'defineEndpointModule'
    ])
      assert.ok(page.includes(contract), `${path} misses ${contract}`)
    assert.ok(page.includes(`/${locale}/guides/web-rpc/endpoint-composition`))
  }
})

test('SITE-T-WEBRPC-GUIDE-NAV separates APIs, plugins, specifications, adapters, and errors', () => {
  const expectations = {
    en: ['APIs', 'Plugins', 'Specifications', 'Host adapters', 'Errors and diagnostics'],
    zh: ['API', '插件', '规范', '宿主适配器', '错误与诊断']
  } as const
  for (const locale of ['en', 'zh'] as const) {
    const path = `/${locale}/guides/web-rpc/extension-authoring`
    const page = readFileSync(join(buildRoot, artifactPath(path)), 'utf8')
    for (const heading of expectations[locale])
      assert.ok(page.includes(`<h3>${heading}</h3>`), `${path} misses ${heading}`)
    assert.ok(!page.includes('公开入口、插件与规范'))
    assert.ok(!page.includes('APIs, plugins, and contracts'))
    assert.match(page, /<h3>插件<\/h3>|<h3>Plugins<\/h3>/)
    assert.match(page, /<code>connect<\/code>/)
    assert.match(page, /<h3>规范<\/h3>|<h3>Specifications<\/h3>/)
    assert.match(page, /<code>WebRpcTransportTopology<\/code>/)
  }
})

test('SITE-T-UTILS-LINKS keeps every maintained Utils continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'deadlines-and-abort',
    'retry-and-concurrency',
    'error-identity-and-causes',
    'bytes-and-text',
    'immutable-objects-and-paths',
    'configuration-ownership',
    'function-and-value-guards',
    'strings-and-numbers'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/guides/utils${topic ? `/${topic}` : ''}`
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

test('SITE-T-TRAY-LINKS keeps every maintained Tray continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'static-composition',
    'readiness-and-errors',
    'resource-ownership',
    'dynamic-host',
    'mutation-and-blocking',
    'physical-cleanup'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/guides/tray${topic ? `/${topic}` : ''}`
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

test('SITE-T-TRAY-RUNTIME explains Host options, managed reads, and every mutation outcome', () => {
  const expectations = [
    [
      '/zh/guides/tray/dynamic-host',
      ['mutationAdmissionMs', 'quiescenceMs', 'shutdown.mode', 'readyPlugins', 'pluginState']
    ],
    [
      '/en/guides/tray/dynamic-host',
      ['mutationAdmissionMs', 'quiescenceMs', 'shutdown.mode', 'readyPlugins', 'pluginState']
    ],
    [
      '/zh/guides/tray/mutation-and-blocking',
      [
        'ok:true, committed:true',
        'ok:false, committed:false',
        'ok:false, committed:true',
        'removed:false'
      ]
    ],
    [
      '/en/guides/tray/mutation-and-blocking',
      [
        'ok:true, committed:true',
        'ok:false, committed:false',
        'ok:false, committed:true',
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

test('SITE-T-WASM-LINKS keeps every maintained WASM continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'initialization-and-hosts',
    'arena-memory',
    'conversion-boundaries',
    'ownership-and-cleanup'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/guides/wasm${topic ? `/${topic}` : ''}`
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

test('SITE-T-WASM-OWNERSHIP releases both arena ids and ConversionResult wrappers', () => {
  for (const locale of ['en', 'zh']) {
    const gettingStarted = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/guides/wasm/getting-started`)),
      'utf8'
    )
    const ownership = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/guides/wasm/ownership-and-cleanup`)),
      'utf8'
    )

    assert.match(gettingStarted, /using(?:<!-- -->|\s)+result/)
    assert.match(gettingStarted, /Symbol\.dispose/)
    assert.match(ownership, /ConversionResult wrapper/)
    assert.match(ownership, /dealloc_bytes/)
  }
})

test('SITE-T-STORE-LIGHT-LINKS keeps every maintained Store Light continuation resolvable', () => {
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
      const path = `/${locale}/guides/store-light${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORE-LIGHT-CONFIG explains Store, hydration, and Resource option defaults', () => {
  const expectations = [
    [
      'object-store-model',
      ['runtime', 'defaultRuntime', 'debugName', 'warnAsyncActions', 'mutationPolicy']
    ],
    ['snapshots-and-hydration', ['ignore（默认）', 'report', 'strict', 'onUnknown']],
    ['resources-and-suspense', ['keepAliveMs', '1000 ms', 'dispose', 'onError', 'onTerminal']]
  ] as const

  for (const locale of ['en', 'zh']) {
    for (const [topic, fragments] of expectations) {
      const html = readFileSync(
        join(buildRoot, artifactPath(`/${locale}/guides/store-light/${topic}`)),
        'utf8'
      )
      for (const fragment of fragments) {
        const localized =
          locale === 'en' && fragment === 'ignore（默认）' ? 'ignore (default)' : fragment
        assert.ok(
          html.includes(localized),
          `/${locale}/guides/store-light/${topic} misses ${localized}`
        )
      }
    }
  }
})

test('SITE-T-STORE-KEYED-LINKS keeps every maintained Store Keyed continuation resolvable', () => {
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
      const path = `/${locale}/guides/store-keyed${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORE-KEYED-FAMILY explains key domain, cache bounds, and split ownership', () => {
  for (const locale of ['en', 'zh']) {
    const family = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/guides/store-keyed/families-and-cache-identity`)),
      'utf8'
    )
    const split = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/guides/store-keyed/optics-and-split-lists`)),
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
      assert.ok(
        family.includes(fragment),
        `/${locale}/guides/store-keyed family misses ${fragment}`
      )
    for (const fragment of ['splitDef', 'prune', 'store.release'])
      assert.ok(split.includes(fragment), `/${locale}/guides/store-keyed split misses ${fragment}`)
  }
})

test('SITE-T-STORE-INDEXED-LINKS keeps every maintained Store Indexed continuation resolvable', () => {
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
      const path = `/${locale}/guides/store-indexed${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORE-INDEXED-CONFIG explains construction defaults and mutation boundaries', () => {
  for (const locale of ['en', 'zh']) {
    const page = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/guides/store-indexed/choose-a-collection`)),
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
      assert.ok(
        page.includes(fragment),
        `/${locale}/guides/store-indexed config misses ${fragment}`
      )
  }
})

test('SITE-T-STORE-MIDDLEWARE-LINKS keeps every maintained Store Middleware continuation resolvable', () => {
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
      const path = `/${locale}/guides/store-middleware${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORE-MIDDLEWARE-CONFIG makes every binding default and ownership edge explicit', () => {
  for (const locale of ['en', 'zh']) {
    const page = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/guides/store-middleware/binding-and-shared-policy`)),
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
        `/${locale}/guides/store-middleware config misses ${fragment}`
      )
  }
})

test('SITE-T-STORE-PERSIST-LINKS keeps every maintained Store Persist continuation resolvable', () => {
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
      const path = `/${locale}/guides/store-persist${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORE-PERSIST-KEYED exposes the real handle and post-hydration read path', () => {
  for (const locale of ['en', 'zh']) {
    const adapter = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/guides/store-persist/choose-an-adapter`)),
      'utf8'
    )
    const keyed = readFileSync(
      join(buildRoot, artifactPath(`/${locale}/guides/store-persist/keyed-families-and-clear`)),
      'utf8'
    )

    for (const fragment of ['IPersistHandle', 'ready', 'retryHydrate', 'flush', 'clear'])
      assert.ok(
        `${adapter}${keyed}`.includes(fragment),
        `/${locale}/guides/store-persist keyed misses ${fragment}`
      )
    for (const fragment of [
      'await handle.ready',
      'atomStore',
      'get',
      'sessionDef',
      'construction'
    ]) {
      if (locale === 'en')
        assert.ok(
          keyed.includes(fragment),
          `/${locale}/guides/store-persist keyed misses ${fragment}`
        )
    }
    assert.ok(!keyed.includes('handle.value is the current restored value'))
  }
})

test('SITE-T-STORE-REACT-LINKS keeps every maintained Store React continuation resolvable', () => {
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
      const path = `/${locale}/guides/store-react${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORE-SSR-LINKS keeps every maintained Store SSR continuation resolvable', () => {
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
      const path = `/${locale}/guides/store-ssr${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORE-DEVTOOLS-LINKS keeps every maintained Store Devtools continuation resolvable', () => {
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
      const path = `/${locale}/guides/store-devtools${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORE-WORKER-LINKS keeps every maintained Store Worker continuation resolvable', () => {
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
      const path = `/${locale}/guides/store-worker${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORE-WASM-LINKS keeps every maintained Store WASM continuation resolvable', () => {
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
      const path = `/${locale}/guides/store-wasm${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORE-SHARED-LINKS keeps every maintained Store Shared continuation resolvable', () => {
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
      const path = `/${locale}/guides/store-shared${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORAGE-CONTRACT-LINKS keeps every maintained Storage Contract continuation resolvable', () => {
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
      const path = `/${locale}/guides/storage-contract${topic ? `/${topic}` : ''}`
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

test('SITE-T-SERIALIZE-LINKS keeps every maintained Serialize continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'chunk-shapes-and-wire-conversion',
    'registry-and-plugins',
    'streaming-and-backpressure',
    'shutdown-and-errors'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/guides/serialize${topic ? `/${topic}` : ''}`
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

test('SITE-T-PLUGIN-HOST-LINKS keeps every maintained Plugin Host continuation resolvable', () => {
  const routes = new Set(routeManifest.entries.map((entry) => entry.path))
  const topics = [
    '',
    'getting-started',
    'install-and-compose',
    'configuration-and-shared',
    'pipelines',
    'removal-and-rollback'
  ]

  for (const locale of ['en', 'zh']) {
    for (const topic of topics) {
      const path = `/${locale}/guides/plugin-host${topic ? `/${topic}` : ''}`
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

test('SITE-T-RESOURCE-LINKS keeps every maintained Resource continuation resolvable', () => {
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
      const path = `/${locale}/guides/resource${topic ? `/${topic}` : ''}`
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

test('SITE-T-LOGGER-LINKS keeps every maintained Logger continuation resolvable', () => {
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
      const path = `/${locale}/guides/logger${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORAGE-WEB-LINKS keeps every maintained Storage Web continuation resolvable', () => {
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
      const path = `/${locale}/guides/storage-web${topic ? `/${topic}` : ''}`
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

test('SITE-T-STORAGE-WEB-STRUCTURED-CODEC explains selection and the real clone boundary', () => {
  const html = readFileSync(join(buildRoot, artifactPath('/zh/architecture/storage-web')), 'utf8')

  assert.match(html, /四者不是同一种格式的别名/)
  assert.match(html, /真正的复制发生在 IndexedDB\/Memory 的 structured clone/)
  assert.match(html, /codec 不复制/)
  assert.match(html, /Date\/Map\/Set\/bytes\/循环引用仍保留/)
  assert.match(html, /UNSUPPORTED_CAPABILITY/)
  assert.match(html, /字段校验、版本迁移以及 class 实例重建仍应由 Schema\/Entity 层处理/)
})
