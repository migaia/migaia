import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const websiteRoot = fileURLToPath(new URL('../', import.meta.url))
const buildRoot = join(websiteRoot, 'build/client')
const routeConfig = readFileSync(join(websiteRoot, 'react-router.config.ts'), 'utf8')
const rootSource = readFileSync(join(websiteRoot, 'app/root.tsx'), 'utf8')
const styleSource = readFileSync(join(websiteRoot, 'app/app.css'), 'utf8')
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

/** Recursively returns emitted client files for closed-world output scans. */
function emittedFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? emittedFiles(path) : [path]
  })
}

test('SITE-T01 emits the admitted nested static route set', () => {
  const routePaths = [
    'index.html',
    'en/index.html',
    'zh/index.html',
    'en/docs/utils/index/index.html'
  ]

  for (const routePath of routePaths) {
    assert.ok(existsSync(join(buildRoot, routePath)), `missing artifact: ${routePath}`)
  }
})

test('SITE-T-LOCALE keeps Chinese navigation and introductions localized', () => {
  const chineseHome = readFileSync(join(buildRoot, 'zh/index.html'), 'utf8')
  const chineseDocs = readFileSync(join(buildRoot, 'zh/docs/index.html'), 'utf8')

  assert.match(chineseHome, /<html[^>]+lang="zh"/)
  assert.match(chineseHome, /选择最短且有效的路径。/)
  assert.match(chineseHome, /href="\/zh\/docs"/)
  assert.doesNotMatch(chineseHome, /Choose the shortest useful path|Make one small result/)
  assert.match(chineseDocs, /找到你需要的 API。/)
  assert.match(chineseDocs, /类库索引/)
  assert.doesNotMatch(chineseDocs, /Find the API you need|Library index/)
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
  const ownerRoute = `en/docs/${ownerApi.library}/${ownerApi.module}/index.html`
  assert.match(readFileSync(join(buildRoot, ownerRoute), 'utf8'), /Public API symbols/)
  assert.match(readFileSync(join(buildRoot, ownerRoute), 'utf8'), /Introduction/)
})

test('SITE-T-READABILITY emits semantic symbol lists and labelled code surfaces', () => {
  const html = readFileSync(join(buildRoot, 'en/docs/event-subscriber/index/index.html'), 'utf8')

  assert.match(
    html,
    /<ul class="symbol-list">[\s\S]*?<li><a href="#[^"]+">createCanonicalChannel<\/a><\/li>/
  )
  assert.match(html, /<figure class="code-frame">/)
  assert.match(html, /<span>Type signature<\/span>/)
  assert.match(html, /<pre class="code-block"><code>/)
  assert.match(html, /class="syntax-keyword">export<\/span>/)
  assert.match(html, /class="syntax-type">IEventApiStyle<\/span>/)
  assert.match(html, /export<\/span> <span class="syntax-keyword">declare<\/span>[\s\S]*?\n/)
  assert.doesNotMatch(html, /Declared shape:/)
  assert.match(html, /<h4>Introduction<\/h4>/)
  assert.doesNotMatch(html, /<h4>介绍<\/h4>/)
  assert.doesNotMatch(html, / · [a-f0-9]{8}\./)
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
      const output = join(buildRoot, artifactPath(`/${locale}/docs/${api.library}/${api.module}`))
      const html = readFileSync(output, 'utf8')
      if (api.symbols.length === 0) {
        assert.match(html, locale === 'zh' ? /重新导出的符号/ : /Re-exported symbols/)
        continue
      }
      let previous = -1
      const firstApiSymbol = api.symbols.find(
        (symbol) => symbol.kind !== 'type' && symbol.kind !== 'interface'
      )
      const visibleSections =
        firstApiSymbol?.sections
          .filter(
            (section) =>
              !section.content.startsWith('No additional advanced behavior is declared for ')
          )
          .map((section) => section.id) ?? []
      for (const section of visibleSections) {
        const position = html.indexOf(`--${section}"`)
        assert.ok(position > previous, `API section order drift: ${api.library}/${api.module}`)
        previous = position
      }
      for (const symbol of api.symbols) {
        assert.match(
          html,
          new RegExp(`id="${symbol.fragment}"`),
          `missing symbol fragment: ${api.library}/${api.module}#${symbol.fragment}`
        )
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
  for (const file of emittedFiles(buildRoot).filter((candidate) => candidate.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8')
    assert.doesNotMatch(html, /\bpackages?\b|\bzh-cn\b|\.\.\/packages/i)
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

test('SITE-T-A34/A35 closes API ordering and completion action for every page', () => {
  for (const entry of routeManifest.entries) {
    const html = readFileSync(join(buildRoot, artifactPath(entry.path)), 'utf8')
    assert.match(html, /class="next-actions"|class="actions"/)
  }
  for (const api of apiManifest.apis) {
    assert.ok(api.sections.indexOf('core-usage') < api.sections.indexOf('advanced-usage'))
  }
})

test('SITE-T-API-TYPING keeps runtime APIs primary and typing subordinate', () => {
  for (const api of apiManifest.apis) {
    const html = readFileSync(
      join(buildRoot, artifactPath(`/en/docs/${api.library}/${api.module}`)),
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
        assert.match(
          html,
          new RegExp(`class="symbol-section" id="${escapedFragment}"`),
          `runtime API missing from primary flow: ${api.library}/${api.module}#${symbol.fragment}`
        )
      }
    }
  }
})
