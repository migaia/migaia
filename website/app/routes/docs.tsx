import { Fragment, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import {
  apis,
  domainPath,
  findLibrary,
  findLibraryApis,
  libraries,
  moduleSlug,
  type IApiSymbol,
  type IDomain,
  type ILocale
} from '../content.js'
import { copyFor, domainDescription, domainTitle } from '../copy.js'

type IDocsRouteProps = {
  readonly params: { readonly lang?: string; readonly '*': string | undefined }
}

/** Renders one of the three content domains from the canonical route and generated graph. */
export default function Docs({ params }: IDocsRouteProps) {
  const locale = (params.lang === 'zh' ? 'zh' : 'en') as ILocale
  const location = useLocation()
  const parts = (params['*'] ?? '').split('/').filter(Boolean)
  const domain = (location.pathname.split('/')[2] || 'docs') as IDomain
  const librarySlug = parts.shift()
  const library = librarySlug ? findLibrary(librarySlug) : undefined
  const modulePath = parts.join('/') || undefined
  if (librarySlug && !library) return <NotFound locale={locale} domain={domain} />
  if (!library) return <DomainIndex locale={locale} domain={domain} />
  if (domain === 'docs')
    return <DocsLibrary locale={locale} library={library} modulePath={modulePath} />
  return <DomainLibrary locale={locale} domain={domain} library={library} modulePath={modulePath} />
}

/** Displays a domain index with one discoverable entry for every current library. */
function DomainIndex({ locale, domain }: { locale: ILocale; domain: IDomain }) {
  const copy = copyFor(locale)
  return (
    <main id="main-content" className="page-shell content-page" lang={locale}>
      <Breadcrumb locale={locale} domain={domain} />
      <p className="eyebrow">{domain}</p>
      <h1>{domainTitle(locale, domain)}</h1>
      <p className="lede">{domainDescription(locale, domain)}</p>
      <section className="section-block" aria-labelledby="library-index">
        <h2 id="library-index">{copy.libraryIndex}</h2>
        <div className="library-grid">
          {libraries.map((library) => (
            <Link
              className="library-item"
              key={library.slug}
              to={domainPath(locale, domain, library.slug)}
            >
              <strong>{library.slug}</strong>
              <span>
                {locale === 'zh'
                  ? `${library.slug} 的源码契约、能力边界与使用入口。`
                  : (library.description ?? 'Source-backed entry with maintained boundary facts.')}
              </span>
              <small>
                {locale === 'zh'
                  ? `${library.exports.length} 个公开模块`
                  : `${library.exports.length} public module${library.exports.length === 1 ? '' : 's'}`}
              </small>
            </Link>
          ))}
        </div>
      </section>
      <NextActions locale={locale} domain={domain} />
    </main>
  )
}

/** Renders a library documentation root and its source-backed module map. */
function DocsLibrary({
  locale,
  library,
  modulePath
}: {
  locale: ILocale
  library: NonNullable<ReturnType<typeof findLibrary>>
  modulePath?: string
}) {
  const copy = copyFor(locale)
  const moduleName = modulePath?.split('/').filter(Boolean).join('/')
  const libraryApis = findLibraryApis(library.slug)
  if (!moduleName || moduleName === 'overview')
    return (
      <main id="main-content" className="page-shell content-page" lang={locale}>
        <Breadcrumb locale={locale} domain="docs" library={library.slug} />
        <p className="eyebrow">
          {locale === 'zh' ? '类库' : 'Library'} · {library.slug}
        </p>
        <h1>{library.slug}</h1>
        <p className="lede">
          {locale === 'zh'
            ? `${library.slug} 提供由源码支撑的公开能力与清晰边界。`
            : (library.description ??
              'A source-backed library boundary with explicit public exports.')}
        </p>
        <MetaLine locale={locale} library={library} />
        <ApiNav locale={locale} library={library.slug} apis={libraryApis} />
        <section className="section-block" aria-labelledby="responsibility">
          <h2 id="responsibility">{copy.responsibility}</h2>
          <p>{copy.responsibilityBody}</p>
        </section>
        <section className="section-block" aria-labelledby="module-map">
          <h2 id="module-map">{copy.moduleMap}</h2>
          <div className="module-list">
            {libraryApis.map((api) => (
              <Link key={api.id} to={`/${locale}/docs/${library.slug}/${api.module}`}>
                <span>{api.module}</span>
                <small>{api.exportPath}</small>
              </Link>
            ))}
          </div>
        </section>
        <NextActions locale={locale} domain="docs" library={library.slug} />
      </main>
    )
  const api = libraryApis.find(
    (candidate) =>
      candidate.module === moduleName || moduleSlug(candidate.exportPath) === moduleName
  )
  return (
    <main id="main-content" className="page-shell content-page" lang={locale}>
      <Breadcrumb locale={locale} domain="docs" library={library.slug} moduleName={moduleName} />
      <div className="reading-layout">
        <aside className="left-rail" aria-label={copy.libraryModules}>
          <strong>{library.slug}</strong>
          {libraryApis.map((candidate) => (
            <Link
              className={candidate === api ? 'active' : ''}
              key={candidate.id}
              to={`/${locale}/docs/${library.slug}/${candidate.module}`}
            >
              {candidate.module}
            </Link>
          ))}
        </aside>
        <article className="article-column">
          <p className="eyebrow">
            {locale === 'zh' ? '模块' : 'Module'} · {library.slug}
          </p>
          <h1>{moduleName}</h1>
          <p className="lede">
            {locale === 'zh'
              ? `${moduleName} 模块公开由源码支撑的符号及其有序契约。`
              : `The ${moduleName} module exposes source-backed public symbols and their ordered contracts.`}
          </p>
          {api ? (
            <ApiSections locale={locale} api={api} />
          ) : (
            <EmptyState locale={locale} library={library.slug} />
          )}
        </article>
        {api ? (
          <>
            <RightRail locale={locale} api={api} />
            <details className="mobile-toc">
              <summary>{copy.onPage}</summary>
              <nav aria-label={copy.mobileSections}>
                {(
                  api.symbols[0]?.sections
                    .filter(isVisibleSymbolSection)
                    .map((section) => section.id) ?? api.sections
                ).map((section) => (
                  <a
                    key={section}
                    href={
                      api.symbols[0] ? `#${api.symbols[0].fragment}--${section}` : `#${section}`
                    }
                  >
                    {localizedSection(locale, section)}
                  </a>
                ))}
              </nav>
            </details>
          </>
        ) : null}
      </div>
      <NextActions locale={locale} domain="docs" library={library.slug} />
    </main>
  )
}

/** Tracks the URL fragment so the visible right-rail anchor follows direct loads and history. */
function RightRail({ locale, api }: { locale: ILocale; api: (typeof apis)[number] }) {
  const copy = copyFor(locale)
  const railRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const updateHash = () => {
      const currentHash = window.location.hash
      railRef.current?.querySelectorAll('a').forEach((anchor) => {
        anchor.classList.toggle('active', anchor.getAttribute('href') === currentHash)
        if (anchor.getAttribute('href') === currentHash)
          anchor.setAttribute('aria-current', 'location')
        else anchor.removeAttribute('aria-current')
      })
    }
    updateHash()
    window.addEventListener('hashchange', updateHash)
    return () => window.removeEventListener('hashchange', updateHash)
  }, [api])
  return (
    <aside className="right-rail" aria-label={copy.onPage} ref={railRef}>
      <strong>{copy.onPage}</strong>
      {(
        api.symbols[0]?.sections.filter(isVisibleSymbolSection).map((section) => section.id) ??
        api.sections
      ).map((section) => {
        const href = api.symbols[0] ? `#${api.symbols[0].fragment}--${section}` : `#${section}`
        return (
          <a key={section} href={href}>
            {localizedSection(locale, section)}
          </a>
        )
      })}
    </aside>
  )
}

/** Renders a guide or architecture library page with its fixed page-family order. */
function DomainLibrary({
  locale,
  domain,
  library,
  modulePath
}: {
  locale: ILocale
  domain: IDomain
  library: NonNullable<ReturnType<typeof findLibrary>>
  modulePath?: string
}) {
  const topic = modulePath ?? 'overview'
  const guide = domain === 'guides'
  const headings = guide
    ? locale === 'zh'
      ? [
          '目标结果',
          '适用场景',
          '前置条件',
          '实现步骤',
          '逐步验证',
          '常见失败与恢复',
          '相关 API',
          '下一任务'
        ]
      : [
          'Goal result',
          'When to use',
          'Prerequisites',
          'Implementation',
          'Verify each step',
          'Common failure and recovery',
          'Related API',
          'Next task'
        ]
    : locale === 'zh'
      ? [
          '问题',
          '约束',
          '采用方案',
          '数据与控制流',
          '失败模式',
          '备选方案与拒绝理由',
          '受影响 API 与指南',
          '相关主题'
        ]
      : [
          'Problem',
          'Constraints',
          'Adopted approach',
          'Data and control flow',
          'Failure modes',
          'Alternatives and rejection',
          'Affected APIs and guides',
          'Related topic'
        ]
  return (
    <main id="main-content" className="page-shell content-page" lang={locale}>
      <Breadcrumb locale={locale} domain={domain} library={library.slug} moduleName={topic} />
      <article className="article-column full-article">
        <p className="eyebrow">
          {guide ? (locale === 'zh' ? '指南' : 'Guide') : locale === 'zh' ? '架构' : 'Architecture'}{' '}
          · {library.slug}
        </p>
        <h1>{topic}</h1>
        <p className="lede">
          {locale === 'zh'
            ? guide
              ? `使用 ${library.slug} 产出可验证结果的有限任务路径。`
              : `${library.slug} 的归属与边界模型。`
            : guide
              ? `A bounded task path for producing a verifiable result with ${library.slug}.`
              : `The ownership and boundary model for ${library.slug}.`}
        </p>
        {headings.map((heading, index) => (
          <section className="section-block compact" id={`section-${index}`} key={heading}>
            <h2>{heading}</h2>
            <p>
              {locale === 'zh'
                ? index === 0
                  ? guide
                    ? '从可观察结果开始，只选择达成结果所需的能力。'
                    : '保持类库边界清晰，让调用方能够判断归属与变更影响。'
                  : `本节说明 ${library.slug} 的“${heading}”，并连接到下一个具体决策。`
                : index === 0
                  ? guide
                    ? 'Start from the observable result, then choose only the capabilities required to reach it.'
                    : 'Keep this library boundary explicit so callers can reason about ownership and change.'
                  : `This section records the ${heading.toLowerCase()} for the ${library.slug} ${domain} entry and links the next concrete decision.`}
            </p>
            {heading.includes('API') ? (
              <Link className="text-link" to={`/${locale}/docs/${library.slug}/index`}>
                {locale === 'zh' ? '打开 API 入口 →' : 'Open the API entry →'}
              </Link>
            ) : null}
            {index === 0 ? (
              <Link
                className="text-link"
                to={`/${locale}/${domain}/${library.slug}/${guide ? 'getting-started' : 'ownership'}`}
              >
                {locale === 'zh'
                  ? `打开完整${guide ? '指南' : '归属说明'} →`
                  : `Open the full ${guide ? 'guide' : 'ownership'} →`}
              </Link>
            ) : null}
          </section>
        ))}
      </article>
      <NextActions locale={locale} domain={domain} library={library.slug} />
    </main>
  )
}

/** Renders the six required API sections in contract order. */
function ApiSections({ locale, api }: { locale: ILocale; api: (typeof apis)[number] }) {
  const copy = copyFor(locale)
  return (
    <>
      <section className="api-overview" aria-labelledby="api-overview">
        <h2 id="api-overview">{copy.publicApiSymbols}</h2>
        <p>{copy.publicApiIntro}</p>
      </section>
      <SymbolSections locale={locale} symbols={api.symbols} />
      {api.aliases.length > 0 ? (
        <section className="symbol-aliases" aria-labelledby="symbol-aliases">
          <h2 id="symbol-aliases">{copy.reexports}</h2>
          <p>{copy.reexportsBody}</p>
          {api.aliases.map((alias) => (
            <p key={`${alias.exportPath}:${alias.name}`}>
              <a href={`#${alias.ownerFragment}`}>{alias.name}</a> <code>{alias.exportPath}</code>
            </p>
          ))}
        </section>
      ) : null}
      <div className="api-links">
        <Link to={`/${locale}/guides/${api.library}/getting-started`}>{copy.applyGuide}</Link>
        <Link to={`/${locale}/architecture/${api.library}/ownership`}>
          {copy.understandBoundary}
        </Link>
      </div>
    </>
  )
}

/** Renders source-backed symbol declarations with stable per-symbol fragments. */
function SymbolSections({ locale, symbols }: { locale: ILocale; symbols: readonly IApiSymbol[] }) {
  const copy = copyFor(locale)
  if (symbols.length === 0) return null
  const apiSymbols = symbols.filter(
    (symbol) => symbol.kind !== 'type' && symbol.kind !== 'interface'
  )
  const typingSymbols = symbols.filter(
    (symbol) => symbol.kind === 'type' || symbol.kind === 'interface'
  )
  const typingOwners = new Map<string, string>()
  for (const api of apiSymbols) {
    const pending = typingSymbols.filter((typing) =>
      new RegExp(`\\b${typing.name}\\b`).test(api.signature)
    )
    while (pending.length > 0) {
      const typing = pending.shift()
      if (!typing || typingOwners.has(typing.fragment)) continue
      typingOwners.set(typing.fragment, api.fragment)
      for (const dependency of typingSymbols) {
        if (
          !typingOwners.has(dependency.fragment) &&
          new RegExp(`\\b${dependency.name}\\b`).test(typing.signature)
        )
          pending.push(dependency)
      }
    }
  }
  const unownedTyping = typingSymbols.filter((typing) => !typingOwners.has(typing.fragment))
  return (
    <section className="symbol-index" aria-labelledby="public-symbols">
      <h2 id="public-symbols">{copy.publicSymbols}</h2>
      {apiSymbols.length > 0 ? (
        <nav aria-label={copy.publicSymbols} className="symbol-list-navigation">
          <ul className="symbol-list">
            {apiSymbols.map((symbol) => (
              <li key={symbol.fragment}>
                <a href={`#${symbol.fragment}`}>{symbol.name}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {apiSymbols.map((symbol) => (
        <section className="symbol-section" id={symbol.fragment} key={symbol.fragment}>
          <h3>{symbol.name}</h3>
          <CodeBlock
            code={symbol.signature}
            label={locale === 'zh' ? '类型签名' : 'Type signature'}
          />
          {symbol.sections.filter(isVisibleSymbolSection).map((section) => (
            <SymbolDetailSection
              key={section.id}
              locale={locale}
              section={section}
              symbol={symbol}
            />
          ))}
          <RelatedTypes
            locale={locale}
            symbols={typingSymbols.filter(
              (typing) => typingOwners.get(typing.fragment) === symbol.fragment
            )}
          />
        </section>
      ))}
      <RelatedTypes locale={locale} standalone symbols={unownedTyping} />
    </section>
  )
}

/** Keeps type declarations subordinate to runtime APIs and collapsed until requested. */
function RelatedTypes({
  locale,
  standalone = false,
  symbols
}: {
  readonly locale: ILocale
  readonly standalone?: boolean
  readonly symbols: readonly IApiSymbol[]
}) {
  if (symbols.length === 0) return null
  return (
    <details className={standalone ? 'type-reference standalone' : 'type-reference'}>
      <summary>
        {standalone
          ? locale === 'zh'
            ? `类型参考（${symbols.length}）`
            : `Type reference (${symbols.length})`
          : locale === 'zh'
            ? `相关类型（${symbols.length}）`
            : `Related types (${symbols.length})`}
      </summary>
      <div className="type-reference-body">
        {symbols.map((symbol) => (
          <details className="type-declaration" id={symbol.fragment} key={symbol.fragment}>
            <summary>
              <code>{symbol.name}</code>
            </summary>
            <CodeBlock
              code={symbol.signature}
              label={locale === 'zh' ? '类型定义' : 'Type definition'}
            />
            <p>{readableSectionContent(locale, 'introduction', symbol.purpose, symbol)}</p>
          </details>
        ))}
      </div>
    </details>
  )
}

/** Renders one generated contract section as bounded, reader-oriented content. */
function SymbolDetailSection({
  locale,
  section,
  symbol
}: {
  readonly locale: ILocale
  readonly section: IApiSymbol['sections'][number]
  readonly symbol: IApiSymbol
}) {
  const sectionId = `${symbol.fragment}--${section.id}`
  if (section.id === 'core-usage') {
    const parameterNames = Array.from(
      new Set(symbol.parameterDetails.map((parameter) => parameter.name))
    )
    const documentedErrors = symbol.errors.filter(
      (error) => !error.startsWith('No documented errors are declared for ')
    )
    const documentedLifecycle = !symbol.lifecycleConcurrency.startsWith(
      'No lifecycle or concurrency behavior is declared for '
    )
    return (
      <section className="api-section symbol-api-section" data-api-part={section.id} id={sectionId}>
        <h4>{localizedSection(locale, section.id)}</h4>
        <dl className="api-facts">
          <div>
            <dt>{locale === 'zh' ? '输入' : 'Inputs'}</dt>
            <dd>
              {parameterNames.length > 0
                ? parameterNames.map((name) => <code key={name}>{name}</code>)
                : locale === 'zh'
                  ? '无需输入。'
                  : 'No inputs.'}
            </dd>
          </div>
          <div>
            <dt>{locale === 'zh' ? '输出' : 'Output'}</dt>
            <dd>
              {locale === 'zh'
                ? '返回类型以完整类型签名为准。'
                : 'The complete return type is shown in the signature above.'}
            </dd>
          </div>
          {documentedErrors.length > 0 ? (
            <div>
              <dt>{locale === 'zh' ? '错误' : 'Errors'}</dt>
              <dd>{documentedErrors.join(' ')}</dd>
            </div>
          ) : null}
          {documentedLifecycle ? (
            <div>
              <dt>{locale === 'zh' ? '生命周期' : 'Lifecycle'}</dt>
              <dd>{symbol.lifecycleConcurrency}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    )
  }
  const content = readableSectionContent(locale, section.id, section.content, symbol)
  return (
    <section className="api-section symbol-api-section" data-api-part={section.id} id={sectionId}>
      <h4>{localizedSection(locale, section.id)}</h4>
      <p>{content}</p>
      {section.example ? (
        <CodeBlock code={section.example} label={locale === 'zh' ? '示例' : 'Example'} />
      ) : null}
    </section>
  )
}

/** Removes generator provenance and bounds prose that cannot serve as public documentation. */
function readableSectionContent(
  locale: ILocale,
  sectionId: string,
  content: string,
  symbol: IApiSymbol
): string {
  if (sectionId === 'when-to-use')
    return locale === 'zh'
      ? `当 ${symbol.name} 的公开契约与所需结果匹配时使用；否则选择更贴合输入与输出的 API。`
      : `Use ${symbol.name} when its public contract matches the result you need; otherwise choose an API with closer input and output semantics.`
  const withoutProvenance = content
    .replace(/\s+Declaration:.*$/s, '')
    .replace(/ · [a-f0-9]{8}\b/g, '')
    .trim()
  if (/\.d\.ts:\d+/.test(withoutProvenance) || withoutProvenance.length > 420)
    return locale === 'zh'
      ? `${symbol.name} 是该模块公开 API 的一部分；完整类型约束见上方签名。`
      : `${symbol.name} is part of this module's public API; see the signature above for its complete type contract.`
  return withoutProvenance
}

/** Hides generated absence records that carry no actionable information for a reader. */
function isVisibleSymbolSection(section: IApiSymbol['sections'][number]): boolean {
  return !section.content.startsWith('No additional advanced behavior is declared for ')
}

/** Presents source text as a labelled, horizontally scrollable Dracula code surface. */
function CodeBlock({ code, label }: { readonly code: string; readonly label: string }) {
  return (
    <figure className="code-frame">
      <figcaption className="code-toolbar">
        <span>TypeScript</span>
        <span>{label}</span>
      </figcaption>
      <pre className="code-block">
        <code>{highlightTypeScript(code)}</code>
      </pre>
    </figure>
  )
}

/** Tokenizes formatted TypeScript into safe React spans using the Dracula palette. */
function highlightTypeScript(code: string) {
  const keywords = new Set([
    'as',
    'const',
    'declare',
    'export',
    'extends',
    'false',
    'from',
    'function',
    'import',
    'infer',
    'keyof',
    'never',
    'new',
    'null',
    'readonly',
    'return',
    'true',
    'type',
    'typeof',
    'undefined',
    'void'
  ])
  const tokens = code.split(
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[{}()[\]<>?:=|&;,\.])/g
  )
  return tokens.map((token, index) => {
    let tokenClass: string | undefined
    if (/^\/\//.test(token) || /^\/\*/.test(token)) tokenClass = 'syntax-comment'
    else if (/^['"`]/.test(token)) tokenClass = 'syntax-string'
    else if (/^\d/.test(token)) tokenClass = 'syntax-number'
    else if (keywords.has(token)) tokenClass = 'syntax-keyword'
    else if (/^[A-Z]/.test(token)) tokenClass = 'syntax-type'
    else if (/^[{}()[\]<>?:=|&;,\.]$/.test(token)) tokenClass = 'syntax-punctuation'
    return tokenClass ? (
      <span className={tokenClass} key={index}>
        {token}
      </span>
    ) : (
      <Fragment key={index}>{token}</Fragment>
    )
  })
}

/** Shows the shared left-tree API entry points while keeping route state canonical. */
function ApiNav({
  locale,
  library,
  apis: libraryApis
}: {
  locale: ILocale
  library: string
  apis: readonly (typeof apis)[number][]
}) {
  return (
    <nav className="api-nav" aria-label={copyFor(locale).apiModules}>
      {libraryApis.slice(0, 8).map((api) => (
        <Link key={api.id} to={`/${locale}/docs/${library}/${api.module}`}>
          {api.module}
        </Link>
      ))}
    </nav>
  )
}

/** Renders a compact source/version line without leaking repository terminology. */
function MetaLine({
  locale,
  library
}: {
  locale: ILocale
  library: NonNullable<ReturnType<typeof findLibrary>>
}) {
  const copy = copyFor(locale)
  return (
    <p className="meta-line">
      <span>{copy.sourceBacked}</span>
      {library.version ? <span>v{library.version}</span> : null}
      <span>
        {library.exports.length} {copy.exports}
      </span>
    </p>
  )
}

/** Renders derived breadcrumb position for all content pages. */
function Breadcrumb({
  locale,
  domain,
  library,
  moduleName
}: {
  locale: ILocale
  domain: IDomain
  library?: string
  moduleName?: string
}) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link to={`/${locale}`}>{locale}</Link>
      <span>/</span>
      <Link to={domainPath(locale, domain)}>{domain}</Link>
      {library ? (
        <>
          <span>/</span>
          <Link to={domainPath(locale, domain, library)}>{library}</Link>
        </>
      ) : null}
      {moduleName ? (
        <>
          <span>/</span>
          <span>{moduleName}</span>
        </>
      ) : null}
    </nav>
  )
}

/** Provides at most three meaningful continuation actions. */
function NextActions({
  locale,
  domain,
  library
}: {
  locale: ILocale
  domain: IDomain
  library?: string
}) {
  const copy = copyFor(locale)
  return (
    <nav className="next-actions" aria-label={copy.continueReading}>
      <Link to={domainPath(locale, domain, library)}>
        {library ? copy.libraryEntry : copy.browseLibraries} →
      </Link>
      <Link to={domainPath(locale, 'guides', library)}>{copy.taskGuides} →</Link>
      <Link to={domainPath(locale, 'architecture', library)}>{copy.architecture} →</Link>
    </nav>
  )
}

/** Keeps invalid or empty module paths recoverable without throwing. */
function EmptyState({ locale, library }: { locale: ILocale; library: string }) {
  const copy = copyFor(locale)
  return (
    <section className="empty-state">
      <h2>{copy.nothingMatched}</h2>
      <p>{copy.nothingMatchedBody}</p>
      <Link className="text-link" to={`/${locale}/docs/${library}`}>
        {copy.returnTo} {library} →
      </Link>
    </section>
  )
}

/** Keeps invalid library paths inside the current language and content domain. */
function NotFound({ locale, domain }: { locale: ILocale; domain: IDomain }) {
  const copy = copyFor(locale)
  return (
    <main id="main-content" className="page-shell">
      <Breadcrumb locale={locale} domain={domain} />
      <p className="eyebrow">{copy.notFound}</p>
      <h1>{copy.missingEntry}</h1>
      <p className="lede">{copy.missingEntryBody}</p>
      <Link className="button button-primary" to={domainPath(locale, domain)}>
        {copy.browse} {domain}
      </Link>
      <NextActions locale={locale} domain={domain} />
    </main>
  )
}

/** Translates stable API section labels while preserving technical identifiers. */
function localizedSection(locale: ILocale, section: string): string {
  if (locale === 'en') {
    const label = section.replaceAll('-', ' ')
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  const localizedSections: Readonly<Record<string, string>> = {
    introduction: '介绍',
    setup: '准备',
    'getting-started': '上手',
    scenario: '使用场景',
    'when-to-use': '适用场景',
    implementation: '快速实现',
    'quick-implementation': '快速实现',
    'core-usage': '核心用法',
    'advanced-usage': '高阶用法'
  }
  return localizedSections[section] ?? section
}
