/**
 * Rendered-page audit: checks bilingual reference leaves on their manifest-owned articles
 * (`PAGE-COVERAGE`), every in-site link's destination article (`PAGE-LINK`), and Chinese prose and
 * example comments (`PAGE-ZH`, `CODE-ZH`). Loader data, other pages and declaration signatures
 * cannot satisfy coverage. No TypeScript compiler API is used.
 *
 * Usage (site from `bun run dev` or a preview server): bun scripts/audit/reference-pages.ts
 * http://localhost:5180 logger plugin-host
 *
 * Exit code 1 when any finding exists.
 */
import { readFileSync } from 'node:fs'
import { symbolSlug, type IApiSymbol } from '../../app/content-contract.ts'
import { normalizeExampleImports } from '../../app/example-imports.ts'
import type { ILibraryReference, IText } from '../../app/reference/contract.ts'
import { libraryReferences } from '../../app/reference/index.ts'
import type { IManifestModule } from '../../app/reference/rules.ts'

/** Command-line base URL and library slugs. */
const [base, ...args] = process.argv.slice(2)
/** Suppresses individual findings while retaining per-rule counts. */
const summaryOnly = args.includes('--summary')
/** Requested libraries; flags do not become manifest names. */
const libraries = args.filter((arg) => !arg.startsWith('--'))
if (!base || libraries.length === 0) {
  console.error('usage: bun scripts/audit/reference-pages.ts <base-url> <library...>')
  process.exit(2)
}

/** English prose: four or more words outside identifiers. */
const ENGLISH_RUN = /[A-Za-z][\w'-]*(?:[ ,]+[A-Za-z][\w'-]*){3,}/

/** One localized authored leaf, with an address that identifies the missing contract text. */
type ILeaf = Readonly<{ where: string; text: string; code: boolean }>

/** Manifest-owned page and its own reference entries, never the loader's projection. */
type IOwner = Readonly<{ path: string; leaves: readonly ILeaf[] }>

/** Minimal response retained for article coverage and link checks; hydration is discarded. */
type IPage = Readonly<{
  status: number
  article: string
  hasArticle: boolean
  links: readonly string[]
}>

/** Decodes React's named and numeric text entities before comparing reader-visible text. */
function decode(text: string): string {
  /** Decode once so a displayed literal such as `&lt;` is not decoded a second time. */
  const named: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    nbsp: ' '
  }
  return text.replace(
    /&(amp|lt|gt|quot|nbsp|#x([\da-f]+)|#(\d+));/gi,
    (_entity, name: string, hex: string, decimal: string) =>
      named[name] ?? String.fromCodePoint(Number.parseInt(hex ?? decimal, hex ? 16 : 10))
  )
}

/** Extracts the article column; navigation, rails and footer are interface chrome. */
function articleOf(html: string): string {
  const start = html.indexOf('<article class="article-column"')
  if (start < 0) return ''
  const end = html.indexOf('</article>', start)
  return html.slice(start, end < 0 ? undefined : end)
}

/**
 * `COVER-TERM-POPOVER`: removes only library-reference hover notes and non-reader HTML. A small tag
 * stack handles the note's nested spans; deleting through the first closing span would leave
 * injected link prose behind. Inline labels remain, so links cannot split an authored sentence.
 */
function readerText(html: string): string {
  /** Tags that do not push an HTML element onto the stack. */
  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr'
  ])
  /** Open elements, including whether their subtree is excluded from reader text. */
  const stack: { tag: string; excluded: boolean }[] = []
  /** Text nodes only; HTML attributes and hydration payload never enter coverage. */
  const chunks: string[] = []
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b([^>]*)>|([^<]+)/gi)) {
    if (token[3] !== undefined) {
      if (!stack.at(-1)?.excluded) chunks.push(decode(token[3]))
      continue
    }
    /** HTML element name; comments have no element and contribute no text. */
    const tag = token[1]?.toLowerCase()
    if (!tag) continue
    if (token[0].startsWith('</')) {
      /** Closing tags discard the matching element and its already-closed descendants. */
      const index = stack.map((element) => element.tag).lastIndexOf(tag)
      if (index >= 0) stack.length = index
      continue
    }
    /** Only explicit UI note/visibility attributes can exclude a reader subtree. */
    const attributes = token[2] ?? ''
    /** Descendants inherit exclusion until their owning element closes. */
    const excluded =
      Boolean(stack.at(-1)?.excluded) ||
      /^(?:script|style|template)$/.test(tag) ||
      /\bclass="[^"]*\blibrary-reference-popover\b/.test(attributes) ||
      /\shidden(?:\s|=|$)|\baria-hidden="true"/.test(attributes)
    if (!voidTags.has(tag) && !token[0].endsWith('/>')) stack.push({ tag, excluded })
  }
  return chunks.join('')
}

/** `COVER-WHITESPACE-BACKTICKS`: layout whitespace and inline-code delimiters carry no prose. */
function normalizeText(text: string): string {
  return text.replace(/[\s`]+/gu, '')
}

/**
 * `COVER-LINK-LABEL` keeps the label of the exact maintained-link syntax supported by InlineText.
 * `COVER-DISPLAY-LIBRARY` mirrors its documented package/packages display substitution, preserving
 * package paths, identifiers and GitHub Packages. Neither rule discards an authored description.
 */
function displayedProse(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\((\/(?:zh|en)\/docs\/[A-Za-z0-9_./#-]+|#[A-Za-z0-9_-]+)\)/g, '$1')
    .replace(/(?<!GitHub |[\w.:/-])packages(?![\w.:/-])/gi, 'libraries')
    .replace(/(?<![\w.:/-])package(?![\w.:/-])/gi, 'library')
}

/**
 * `COVER-CODE-LAYOUT` compares lexical tokens, preserving literals and comments while ignoring
 * whitespace and optional trailing commas. `COVER-PUBLIC-IMPORT` uses the canonical public-import
 * rewrite; no arbitrary token skipping, fuzzy matching, or prose deletion is allowed.
 */
function codeTokens(code: string): string {
  /** Strings, templates and comments stay whole so formatting cannot hide changed payloads. */
  const tokens =
    normalizeExampleImports(code).match(
      /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\s]/g
    ) ?? []
  return tokens
    .filter((token, index) => token !== ',' || !/^[}\])>]$/.test(tokens[index + 1] ?? ''))
    .map((token) => (/^\/[/*]/.test(token) ? token.replace(/\s+/g, ' ') : token))
    .join('\0')
}

/** Extracts only example code, excluding signatures that could mask absent member descriptions. */
function exampleBlocks(article: string): string[] {
  return [
    ...article.matchAll(/<figure class="code-frame" data-code-kind="example"[\s\S]*?<\/figure>/g)
  ].map((match) => readerText(match[0].match(/<pre[\s\S]*?<\/pre>/)?.[0] ?? ''))
}

/**
 * Identifies ICode fields by their contract ownership, not their final name. A parameter called
 * `install` or `example` is IText prose; only a module/symbol/type/member/grant example or an
 * enhancer's own installation field is code.
 */
function isCodeField(group: keyof ILibraryReference, path: readonly string[]): boolean {
  if (path.length === 1)
    return (
      (path[0] === 'example' && group !== 'enums') ||
      (path[0] === 'install' && group === 'enhancers')
    )
  if (path.length !== 3 || path[2] !== 'example') return false
  return (
    (group === 'symbols' && path[0] === 'optionDocs') ||
    (group === 'types' && path[0] === 'members') ||
    (group === 'enhancers' && path[0] === 'grants')
  )
}

/** Collects every bilingual prose leaf and schema-owned example, not type-name metadata. */
function leavesOf(
  value: unknown,
  locale: keyof IText,
  where: string,
  group: keyof ILibraryReference,
  path: readonly string[] = []
): ILeaf[] {
  if (!value || typeof value !== 'object') return []
  if ('en' in value && 'zh' in value) {
    /** Locale selection reads the authored source, never the loader's reduced reference. */
    const text = (value as IText)[locale]
    return [{ where, text, code: isCodeField(group, path) }]
  }
  return Object.entries(value).flatMap(([key, child]) => {
    /** Stable leaf path shown with every coverage failure. */
    const at = `${where}.${key}`
    /** Schema-relative path keeps parameter/member names separate from documentation fields. */
    const childPath = [...path, key]
    if (isCodeField(group, childPath) && typeof child === 'string')
      return [{ where: at, text: child, code: true }]
    return leavesOf(child, locale, at, group, childPath)
  })
}

/** Reads module-qualified docs first, exactly like the reference renderer's lookup. */
function entryFor<T>(
  record: Readonly<Record<string, T>>,
  module: string,
  name: string
): T | undefined {
  return record[`${module}:${name}`] ?? record[name]
}

/**
 * Creates every actual module/symbol route, including unlinked types and collision suffixes. Bare
 * entries apply at every manifest declaration that owns them; qualified entries apply only to that
 * module. No invented unsuffixed path or text from another article can pass coverage.
 */
function ownersOf(
  library: string,
  modules: readonly IManifestModule[],
  reference: ILibraryReference
): IOwner[] {
  return (['zh', 'en'] as const).flatMap((locale) =>
    modules.flatMap((api) => {
      /** Root exports omit `index`; all other public module segments remain intact. */
      const modulePath = `/${locale}/docs/${library}/api${api.module === 'index' ? '' : `/${api.module}`}`
      /** Orientation copy belongs only to the module overview article. */
      const moduleDoc = reference.modules[api.module]
      return [
        {
          path: modulePath,
          leaves: leavesOf(moduleDoc, locale, `modules.${api.module}`, 'modules')
        },
        ...api.symbols.map((symbol: IApiSymbol) => {
          /** Only entries owned by this declaration can satisfy its coverage obligation. */
          const leaves: ILeaf[] = []
          /** Types do not render same-name runtime docs on their collision-suffixed pages. */
          const type = symbol.kind === 'type' || symbol.kind === 'interface'
          for (const group of (type
            ? ['types']
            : ['symbols', 'types', 'enums', 'enhancers']) as (keyof Omit<
            ILibraryReference,
            'modules'
          >)[]) {
            /** Module-qualified entry wins over its shared bare-name fallback. */
            const doc = entryFor(
              reference[group] as Readonly<Record<string, unknown>>,
              api.module,
              symbol.name
            )
            leaves.push(...leavesOf(doc, locale, `${group}.${api.module}:${symbol.name}`, group))
          }
          return { path: `${modulePath}/${symbolSlug(symbol, api.symbols)}`, leaves }
        })
      ]
    })
  )
}

/** Reader prose of an article: code, signatures, disclosures and identifiers removed. */
function proseOf(article: string): string[] {
  const stripped = article
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<figure class="code-frame"[\s\S]*?<\/figure>/g, ' ')
    .replace(/<details[\s\S]*?<\/details>/g, ' ')
    .replace(/<code[\s\S]*?<\/code>/g, ' ')
    .replace(/<(?:nav|aside)[\s\S]*?<\/(?:nav|aside)>/g, ' ')
  return stripped
    .split(/<\/?(?:p|li|dd|dt|td|th|h[1-6]|figcaption|div|section|span|a)\b[^>]*>/)
    .map((chunk) =>
      decode(chunk.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
}

/** Comments of every example code block (signature blocks are verbatim declarations). */
function exampleComments(article: string): string[] {
  return exampleBlocks(article).flatMap((code) => code.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? [])
}

/** Destination responses are shared across libraries; each URL is fetched only once per run. */
const pages = new Map<string, Promise<IPage>>()

/** Fetches a same-site page and retains only reader article and actual anchor destinations. */
function pageAt(url: URL): Promise<IPage> {
  url.hash = ''
  /** Fragment destinations reuse the same fetched article. */
  const key = url.href
  /** Promise caching also avoids overlapping duplicate fetches. */
  const cached = pages.get(key)
  if (cached) return cached
  /** Hydration and other page-wide data are dropped after collecting article/link evidence. */
  const pending = (async () => {
    /** HTTP status and article presence are independent link requirements. */
    const response = await fetch(url)
    /** HTML is inspected only for reader markup and real anchor destinations. */
    const html = await response.text()
    return {
      status: response.status,
      article: articleOf(html),
      hasArticle: /<article\b/i.test(html),
      links: [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => decode(match[1]!))
    }
  })()
  pages.set(key, pending)
  return pending
}

/** Total findings across every page. */
let total = 0
for (const library of libraries) {
  /** Current generated declarations determine ownership independently of navigation links. */
  const manifest = JSON.parse(
    readFileSync(
      new URL(`../../src/generated/manifests/libraries/${library}.json`, import.meta.url),
      'utf8'
    )
  ) as { apis: IManifestModule[] }
  /** Full registered source reference, independent of the page projection. */
  const reference = libraryReferences[library]
  if (!reference) {
    console.error(`No registered reference for ${library}`)
    process.exit(2)
  }
  /** Both locales, every manifest declaration and every module overview. */
  const owners = ownersOf(library, manifest.apis, reference)
  /** Findings of this library. */
  const findings: string[] = []
  for (const { path, leaves } of owners) {
    /** Source page URL resolves relative hrefs exactly as a browser does. */
    const url = new URL(path, base)
    /** Reuse an earlier destination response if navigation already reached this owner. */
    const page = await pageAt(url)
    if (page.status < 200 || page.status >= 300) {
      findings.push(`[PAGE] ${path} — HTTP ${page.status}`)
      continue
    }
    if (!page.article) findings.push(`[PAGE-COVERAGE] ${path} — owner article missing`)
    /** Prose cannot pass because a declaration or example happens to repeat its words. */
    const prose = normalizeText(
      readerText(page.article.replace(/<figure\b[\s\S]*?<\/figure>/g, ''))
    )
    /** Each authored example must occur in one actual example block. */
    const examples = exampleBlocks(page.article).map(codeTokens)
    for (const leaf of leaves) {
      /** Match complete prose or code after only the named display normalizations. */
      const covered = leaf.code
        ? examples.some((example) => example.includes(codeTokens(leaf.text)))
        : prose.includes(normalizeText(displayedProse(leaf.text)))
      if (!covered)
        findings.push(
          `[PAGE-COVERAGE] ${path} — ${leaf.where}: ${leaf.text.slice(0, 140).replace(/\s+/g, ' ')}`
        )
    }
    /** Unique destination per source page; fragments share their article response. */
    const targets = new Set(
      page.links
        .map((href) => new URL(href, url))
        .filter((target) => target.origin === url.origin && /^https?:$/.test(target.protocol))
        .map((target) => {
          target.hash = ''
          return target.href
        })
    )
    for (const target of targets) {
      /** A successful shell with no article remains a broken reader destination. */
      const destination = await pageAt(new URL(target))
      if (destination.status < 200 || destination.status >= 300 || !destination.hasArticle)
        findings.push(
          `[PAGE-LINK] ${path} — ${new URL(target).pathname}: HTTP ${destination.status}${destination.hasArticle ? '' : ', no article'}`
        )
    }
    if (!path.startsWith('/zh/')) continue
    for (const prose of proseOf(page.article)) {
      /** Existing Chinese-language gate remains independent of leaf coverage. */
      const run = prose.match(ENGLISH_RUN)
      if (run) findings.push(`[PAGE-ZH] ${path} — "${run[0]}" in: ${prose.slice(0, 120)}`)
    }
    for (const comment of exampleComments(page.article))
      if (/[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){2,}/.test(comment.replace(/`[^`]*`/g, '')))
        findings.push(`[CODE-ZH] ${path} — ${comment.slice(0, 100)}`)
  }
  total += findings.length
  /** Per-rule counts make initial and repaired-renderer results independently reviewable. */
  const byRule = new Map<string, number>()
  for (const finding of findings) {
    /** Rule id is emitted first by every finding above. */
    const rule = finding.match(/^\[([^\]]+)\]/)![1]!
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1)
  }
  console.log(
    `${library}: ${owners.length} page(s), ${findings.length} finding(s)${findings.length ? ` — ${[...byRule].map(([rule, count]) => `${rule}=${count}`).join(' ')}` : ''}`
  )
  if (!summaryOnly) for (const finding of findings) console.log(`  ${finding}`)
}
process.exitCode = total > 0 ? 1 : 0
