import { Fragment, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import {
  domainPath,
  isCallableApiSymbol,
  moduleSlug,
  symbolSlug,
  type IApi,
  type IApiSymbol,
  type IDomain,
  type ILibrary,
  type IMaintainedBlock,
  type IMaintainedDocument,
  type ILocale
} from '../content-contract.js'
import {
  librarySummaries,
  loadLibraryRouteContent,
  type ILibraryRouteContent
} from '../content-loader.js'
import { copyFor, domainDescription, domainTitle } from '../copy.js'
import type { IApiGuide } from '../api-guides.js'
import { findGuideJourney, listGuideJourneys, type IGuideJourney } from '../guide-journeys.js'
import { ScrollArea } from '../components/ui/scroll-area.js'
import { normalizeExampleImports } from '../example-imports.js'

type IDocsLoaderData = ILibraryRouteContent & {
  readonly guide?: IApiGuide
  readonly journey?: IGuideJourney
  readonly optionTranslations?: Readonly<Record<string, string>>
  readonly selectedTypeFragment?: string
}

type IDocsRouteProps = {
  readonly params: { readonly lang?: string; readonly '*': string | undefined }
  readonly loaderData: IDocsLoaderData | null
}

/** Loads only the library selected by this route; domain indexes need no API payload. */
export async function loader({
  params,
  request
}: {
  readonly params: IDocsRouteProps['params']
  readonly request: Request
}) {
  const parts = (params['*'] ?? '').split('/').filter(Boolean)
  const librarySlug = parts[0]
  if (!librarySlug) return null
  const pathname = new URL(request.url).pathname
  const domain = pathname.split('/')[2]
  const locale = pathname.split('/')[1]
  const topic = parts.slice(1).join('/') || 'index'
  const journeyExists =
    domain === 'guides' &&
    Boolean(findGuideJourney(librarySlug, topic, locale === 'zh' ? 'zh' : 'en'))
  const documentation =
    domain === 'docs' && locale === 'zh' && parts.length === 1
      ? 'all'
      : domain === 'architecture' && locale === 'zh'
        ? 'readme'
        : domain === 'guides' && locale === 'zh' && !journeyExists
          ? 'guide'
          : 'none'
  /** First path segment after the library is either a submodule or a root API symbol. */
  const requestedSegment = domain === 'docs' ? parts[1] : undefined
  let selectedModule = requestedSegment ?? 'index'
  let selectedSymbolPath = domain === 'docs' ? parts[2] : undefined
  let content = await loadLibraryRouteContent(librarySlug, {
    documentation,
    includeApiIndex: domain === 'docs',
    selectedModule: domain === 'docs' ? selectedModule : undefined,
    selectedSymbol: selectedSymbolPath
  })
  let selectedApi = content?.apis.find(
    (api) => api.module === selectedModule || moduleSlug(api.exportPath) === selectedModule
  )
  if (domain === 'docs' && requestedSegment && !selectedApi) {
    selectedModule = 'index'
    selectedSymbolPath = requestedSegment
    content = await loadLibraryRouteContent(librarySlug, {
      documentation,
      includeApiIndex: true,
      selectedModule,
      selectedSymbol: selectedSymbolPath
    })
    selectedApi = content?.apis.find((api) => api.module === 'index')
  }
  /** Detail pages do not carry the package-level README/guide through hydration. */
  if (
    domain === 'docs' &&
    selectedSymbolPath &&
    selectedApi &&
    selectedApi.symbols.some(
      (symbol) => symbolSlug(symbol, selectedApi!.symbols) === selectedSymbolPath
    )
  ) {
    content = await loadLibraryRouteContent(librarySlug, {
      documentation: 'none',
      includeApiIndex: true,
      selectedModule,
      selectedSymbol: selectedSymbolPath
    })
    selectedApi = content?.apis.find(
      (api) => api.module === selectedModule || moduleSlug(api.exportPath) === selectedModule
    )
  }
  const selectedSymbol = selectedApi?.symbols.find(
    (symbol) =>
      symbolSlug(symbol, selectedApi.symbols) === selectedSymbolPath &&
      symbol.kind !== 'type' &&
      symbol.kind !== 'interface'
  )
  /** Legacy direct type routes resolve to the owning module's subordinate type disclosure. */
  const selectedType = selectedApi?.symbols.find(
    (symbol) =>
      symbolSlug(symbol, selectedApi.symbols) === selectedSymbolPath &&
      (symbol.kind === 'type' || symbol.kind === 'interface')
  )
  let guide: IApiGuide | undefined
  let optionTranslations: Readonly<Record<string, string>> | undefined
  if (domain === 'docs' && selectedApi && selectedSymbol) {
    const guideModule = await import('../api-guides.js')
    const guideLocale = locale === 'zh' ? 'zh' : 'en'
    guide =
      guideModule.findApiGuide(librarySlug, selectedApi.module, selectedSymbol.name, guideLocale) ??
      guideModule.createSupportingContractGuide(librarySlug, selectedSymbol, guideLocale)
    optionTranslations = Object.fromEntries(
      selectedSymbol.configuration.flatMap((field) => {
        const description = guideModule.findOptionTranslation(
          librarySlug,
          selectedApi.module,
          selectedSymbol.name,
          field.name,
          guideLocale
        )
        return description ? [[field.name, description]] : []
      })
    )
  }
  return content
    ? {
        ...content,
        guide,
        journey: journeyExists
          ? findGuideJourney(librarySlug, topic, locale === 'zh' ? 'zh' : 'en')
          : undefined,
        optionTranslations,
        selectedTypeFragment: selectedType?.fragment
      }
    : null
}

/** Renders one of the three content domains from the canonical route and generated graph. */
function Docs({ params, loaderData }: IDocsRouteProps) {
  const locale = (params.lang === 'zh' ? 'zh' : 'en') as ILocale
  const location = useLocation()
  const parts = (params['*'] ?? '').split('/').filter(Boolean)
  const domain = (location.pathname.split('/')[2] || 'docs') as IDomain
  const librarySlug = parts.shift()
  const library = loaderData?.library
  const libraryApis = loaderData?.apis ?? []
  /** Root exports render at the library path; only real submodules own another segment. */
  const firstContentSegment = parts[0]
  const hasNamedSubmodule = libraryApis.some(
    (api) => api.module !== 'index' && api.module === firstContentSegment
  )
  const modulePath =
    domain === 'docs'
      ? [
          hasNamedSubmodule ? firstContentSegment : 'index',
          ...(hasNamedSubmodule ? parts.slice(1) : parts)
        ]
          .filter(Boolean)
          .join('/')
      : parts.join('/') || undefined
  if (librarySlug && !library) return <NotFound locale={locale} domain={domain} />
  if (!library) return <DomainIndex locale={locale} domain={domain} />
  if (domain === 'docs' && firstContentSegment === 'index')
    return <NotFound locale={locale} domain={domain} />
  if (domain === 'docs')
    return (
      <DocsLibrary
        guide={loaderData?.guide}
        locale={locale}
        library={library}
        libraryApis={libraryApis}
        modulePath={modulePath}
        optionTranslations={loaderData?.optionTranslations}
        selectedTypeFragment={loaderData?.selectedTypeFragment}
      />
    )
  return (
    <DomainLibrary
      locale={locale}
      domain={domain}
      library={library}
      modulePath={modulePath}
      journey={loaderData?.journey}
    />
  )
}

/** Displays a domain index with one discoverable entry for every current library. */
function DomainIndex({ locale, domain }: { locale: ILocale; domain: IDomain }) {
  const copy = copyFor(locale)
  return (
    <main id="main-content" className="page-shell content-page" lang={locale} data-pagefind-body>
      <Breadcrumb locale={locale} domain={domain} />
      <p className="eyebrow">{domain}</p>
      <h1>{domainTitle(locale, domain)}</h1>
      <p className="lede">{domainDescription(locale, domain)}</p>
      <section className="section-block" aria-labelledby="library-index">
        <h2 id="library-index">{copy.libraryIndex}</h2>
        <div className="library-grid">
          {librarySummaries.map((library) => (
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

/** Builds a public docs path without leaking the repository root entry name. */
function docsModulePath(
  locale: ILocale,
  library: string,
  moduleName: string,
  symbol?: string
): string {
  const moduleSegment = moduleName === 'index' ? '' : `/${moduleName}`
  return `/${locale}/docs/${library}${moduleSegment}${symbol ? `/${symbol}` : ''}`
}

/** Renders a library documentation root and its source-backed module map. */
function DocsLibrary({
  guide,
  locale,
  library,
  libraryApis,
  modulePath,
  optionTranslations,
  selectedTypeFragment
}: {
  guide?: IApiGuide
  locale: ILocale
  library: ILibrary
  libraryApis: readonly IApi[]
  modulePath?: string
  optionTranslations?: Readonly<Record<string, string>>
  selectedTypeFragment?: string
}) {
  const copy = copyFor(locale)
  const routeParts = modulePath?.split('/').filter(Boolean) ?? []
  const moduleName = routeParts[0]
  const symbolName = routeParts[1]
  if (!moduleName || moduleName === 'overview')
    return (
      <main id="main-content" className="page-shell content-page" lang={locale} data-pagefind-body>
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
              <Link key={api.id} to={docsModulePath(locale, library.slug, api.module)}>
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
  const selectedSymbol = api?.symbols.find(
    (symbol) =>
      symbolSlug(symbol, api.symbols) === symbolName &&
      symbol.kind !== 'type' &&
      symbol.kind !== 'interface'
  )
  const selectedGuide = selectedSymbol ? guide : undefined
  /** Exact section inventory shared by the desktop and mobile tables of contents. */
  const onPageSections = selectedSymbol
    ? referenceSections(
        locale,
        selectedSymbol,
        Boolean(selectedGuide),
        Boolean(selectedGuide?.options.length)
      )
    : api
      ? moduleReferenceSections(library.documentation, api)
      : []
  return (
    <main id="main-content" className="page-shell content-page" lang={locale} data-pagefind-body>
      <Breadcrumb
        locale={locale}
        domain="docs"
        library={library.slug}
        moduleName={selectedSymbol?.name ?? (moduleName === 'index' ? undefined : moduleName)}
      />
      <div className="reading-layout">
        <ScrollArea className="left-rail">
          <aside className="left-rail-content" aria-label={copy.libraryModules}>
            <strong>{library.slug}</strong>
            <LibraryModuleLinks
              api={api}
              libraryApis={libraryApis}
              librarySlug={library.slug}
              locale={locale}
              selectedSymbol={selectedSymbol}
            />
          </aside>
        </ScrollArea>
        <section className="mobile-module-nav" aria-label={copy.libraryModules}>
          <h2>
            {locale === 'zh' ? '模块与 API' : 'Modules and APIs'} ·{' '}
            {selectedSymbol?.name ?? moduleName}
          </h2>
          <nav aria-label={copy.libraryModules}>
            <LibraryModuleLinks
              api={api}
              libraryApis={libraryApis}
              librarySlug={library.slug}
              locale={locale}
              selectedSymbol={selectedSymbol}
            />
          </nav>
        </section>
        <article className="article-column">
          <p className="eyebrow">
            {locale === 'zh' ? '模块' : 'Module'} · {library.slug}
          </p>
          <h1>
            {selectedSymbol?.name ??
              (moduleName === 'index'
                ? locale === 'zh'
                  ? `${library.slug} 核心 API`
                  : `${library.slug} core API`
                : moduleName)}
          </h1>
          <p className="lede">
            {locale === 'zh'
              ? selectedSymbol
                ? `${selectedSymbol.name} 的公开契约、最小用法与组合边界。`
                : `${moduleName} 模块解决什么问题、何时使用，以及可选择的公开 API。`
              : selectedSymbol
                ? `Public contract, minimal usage, and composition boundaries for ${selectedSymbol.name}.`
                : `What ${moduleName} solves, when to use it, and which public API to choose.`}
          </p>
          {api && selectedSymbol ? (
            <SingleApiReference
              guide={selectedGuide}
              locale={locale}
              library={library}
              libraryApis={libraryApis}
              api={api}
              optionTranslations={optionTranslations}
              symbol={selectedSymbol}
            />
          ) : api ? (
            <ModuleOverview
              locale={locale}
              library={library}
              libraryApis={libraryApis}
              api={api}
              selectedTypeFragment={selectedTypeFragment}
            />
          ) : (
            <EmptyState locale={locale} library={library.slug} />
          )}
        </article>
        {api ? (
          <>
            <RightRail locale={locale} sections={onPageSections} symbol={selectedSymbol} />
            <aside className="mobile-toc">
              <strong>{copy.onPage}</strong>
              <nav aria-label={copy.mobileSections}>
                {onPageSections.map((section) => (
                  <a
                    key={section}
                    href={
                      selectedSymbol ? `#${selectedSymbol.fragment}--${section}` : `#${section}`
                    }
                  >
                    {section === 'module-guidance'
                      ? locale === 'zh'
                        ? '阅读路径'
                        : 'Learning path'
                      : section === 'api-index'
                        ? locale === 'zh'
                          ? 'API 索引'
                          : 'API index'
                        : moduleReferenceSectionLabel(locale, section)}
                  </a>
                ))}
              </nav>
            </aside>
          </>
        ) : null}
      </div>
      <NextActions locale={locale} domain="docs" library={library.slug} />
    </main>
  )
}

/** Renders the same nested module tree in the desktop rail and mobile disclosure. */
function LibraryModuleLinks({
  api,
  libraryApis,
  librarySlug,
  locale,
  selectedSymbol
}: {
  readonly api: IApi | undefined
  readonly libraryApis: readonly IApi[]
  readonly librarySlug: string
  readonly locale: ILocale
  readonly selectedSymbol: IApiSymbol | undefined
}) {
  /** Primary WebRPC entry points must not be buried under generated module names. */
  const primaryEntries =
    librarySlug === 'web-rpc'
      ? ([
          ['createEndpoint', 'index', 'createEndpoint'],
          ['createClientEndpoint', 'client', 'createClientEndpoint'],
          ['createProviderEndpoint', 'provider', 'createProviderEndpoint'],
          ['createFullEndpoint', 'full', 'createFullEndpoint'],
          ['createComposedEndpoint', 'core', 'createComposedEndpoint']
        ] as const)
      : []
  return (
    <>
      {primaryEntries.length > 0 ? (
        <div className="left-rail-group left-rail-primary">
          <span>{locale === 'zh' ? '常用 Endpoint' : 'Primary endpoints'}</span>
          <div className="left-rail-children">
            {primaryEntries.map(([label, moduleName, symbol]) => (
              <Link key={label} to={docsModulePath(locale, librarySlug, moduleName, symbol)}>
                {label}
              </Link>
            ))}
          </div>
          <Link to={`/${locale}/guides/web-rpc/transports-and-security`}>
            {locale === 'zh' ? 'Transport 选择与完整案例' : 'Transport selection and examples'}
          </Link>
        </div>
      ) : null}
      {libraryApis.map((candidate) => (
        <div className="left-rail-group" key={candidate.id}>
          <Link
            className={candidate === api && !selectedSymbol ? 'active' : ''}
            to={docsModulePath(locale, librarySlug, candidate.module)}
          >
            {candidate.module === 'index'
              ? locale === 'zh'
                ? '核心 API'
                : 'Core API'
              : candidate.module}
          </Link>
          {candidate === api ? (
            <div className="left-rail-children">
              {runtimeSymbolGroups(candidate.symbols).map((group) => (
                <div className="left-rail-symbol-group" key={group.key}>
                  <span>{symbolGroupLabel(locale, group.key)}</span>
                  {group.symbols.map((symbol) => (
                    <Link
                      className={symbol === selectedSymbol ? 'active' : ''}
                      key={symbol.fragment}
                      to={docsModulePath(
                        locale,
                        librarySlug,
                        candidate.module,
                        symbolSlug(symbol, candidate.symbols)
                      )}
                    >
                      {symbol.name}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </>
  )
}

/** Tracks the URL fragment so the visible right-rail anchor follows direct loads and history. */
function RightRail({
  locale,
  sections,
  symbol
}: {
  readonly locale: ILocale
  readonly sections: readonly string[]
  readonly symbol?: IApiSymbol
}) {
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
  }, [symbol])
  return (
    <aside className="right-rail" aria-label={copy.onPage} ref={railRef}>
      <strong>{copy.onPage}</strong>
      {sections.map((section) => {
        const href = symbol ? `#${symbol.fragment}--${section}` : `#${section}`
        return (
          <a key={section} href={href}>
            {section === 'module-guidance'
              ? locale === 'zh'
                ? '阅读路径'
                : 'Learning path'
              : section === 'api-index'
                ? locale === 'zh'
                  ? 'API 索引'
                  : 'API index'
                : section.startsWith('guide-')
                  ? symbol?.guidance.find((candidate) => `guide-${candidate.id}` === section)
                      ?.heading
                  : symbol
                    ? referenceSectionLabel(locale, section)
                    : moduleReferenceSectionLabel(locale, section)}
          </a>
        )
      })}
    </aside>
  )
}

/** Mirrors the rendered package landing-page learning order in both table-of-contents rails. */
function moduleReferenceSections(
  documentation: ILibrary['documentation'],
  api: IApi
): readonly string[] {
  return [
    'module-guidance',
    ...packageLearningSections(documentation, api).map(({ kind }) => `learning-${kind}`),
    'api-index'
  ]
}

/** Gives package learning anchors explicit task-oriented labels. */
function moduleReferenceSectionLabel(locale: ILocale, section: string): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    'learning-scenarios': ['Use cases', '使用场景'],
    'learning-quick-start': ['Quick Start', '快速上手'],
    'learning-composition': ['Composition', '组合用法'],
    'learning-advanced': ['Advanced usage', '高级用法']
  }
  const label = labels[section]
  return label ? label[locale === 'zh' ? 1 : 0] : section
}

/** Returns the actual rendered reading order for desktop and mobile API outlines. */
function referenceSections(
  locale: ILocale,
  symbol: IApiSymbol,
  curated: boolean,
  hasGuideOptions = false
): string[] {
  return [
    'overview',
    ...(symbol.examples.length > 0 ? ['quick-start'] : []),
    ...(symbol.configuration.length > 0 || hasGuideOptions ? ['configuration'] : []),
    ...(!curated && locale === 'zh' ? symbol.guidance.map((section) => `guide-${section.id}`) : []),
    'core-usage',
    'signature'
  ]
}

/** Presents a module as a choice guide instead of expanding every declaration inline. */
function ModuleOverview({
  locale,
  library,
  libraryApis,
  api,
  selectedTypeFragment
}: {
  readonly locale: ILocale
  readonly library: ILibrary
  readonly libraryApis: readonly IApi[]
  readonly api: IApi
  readonly selectedTypeFragment?: string
}) {
  const runtimeSymbols = api.symbols.filter(
    (symbol) => symbol.kind !== 'type' && symbol.kind !== 'interface'
  )
  const operationSymbols = runtimeSymbols.filter(
    (symbol) => !isSupportingContract(symbol) && !isErrorContract(symbol)
  )
  const supportingSymbols = runtimeSymbols
    .filter((symbol) => isSupportingContract(symbol) && !isErrorContract(symbol))
    .sort(
      (left, right) => right.usageScore - left.usageScore || left.name.localeCompare(right.name)
    )
  const errorSymbols = runtimeSymbols
    .filter(isErrorContract)
    .sort(
      (left, right) => right.usageScore - left.usageScore || left.name.localeCompare(right.name)
    )
  const typingSymbols = api.symbols.filter(
    (symbol) => symbol.kind === 'type' || symbol.kind === 'interface'
  )
  return (
    <>
      <ModuleGuidance locale={locale} library={library} api={api} />
      <section className="section-block compact" id="api-index">
        <p className="eyebrow">{locale === 'zh' ? 'API 参考' : 'API reference'}</p>
        <h2>{locale === 'zh' ? '选择一个入口' : 'Choose an entry point'}</h2>
        <p>
          {locale === 'zh'
            ? '先按目标选择 API；每组依据维护文档中的真实使用频率从高到低排列。签名、参数、例子和相关类型只在对应页面展开。'
            : 'Choose by outcome first. Each group is ordered by use frequency in maintained documentation. Signatures, examples, and related types expand on the API page.'}
        </p>
        {runtimeSymbolGroups(operationSymbols).map((group) => (
          <section className="api-reference-group" key={group.key}>
            <h3>{symbolGroupLabel(locale, group.key)}</h3>
            <ul className="api-reference-list">
              {group.symbols.map((symbol) => (
                <li key={symbol.fragment}>
                  <Link
                    to={docsModulePath(
                      locale,
                      api.library,
                      api.module,
                      symbolSlug(symbol, api.symbols)
                    )}
                  >
                    <code>{symbol.name}</code>
                    <span>{localizedSymbolPurpose(locale, symbol)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {supportingSymbols.length > 0 ? (
          <section className="api-reference-group supporting-contracts">
            <h3>{locale === 'zh' ? '常量与诊断契约' : 'Constants and diagnostic contracts'}</h3>
            <p>
              {locale === 'zh'
                ? '这些符号用于配置、状态比较或错误识别，不是可调用的操作入口。'
                : 'These symbols support configuration, state comparison, or error identification; they are not callable operations.'}
            </p>
            <ul className="api-reference-list">
              {supportingSymbols.map((symbol) => (
                <li key={symbol.fragment}>
                  <Link
                    to={docsModulePath(
                      locale,
                      api.library,
                      api.module,
                      symbolSlug(symbol, api.symbols)
                    )}
                  >
                    <code>{symbol.name}</code>
                    <span>{localizedSymbolPurpose(locale, symbol)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {errorSymbols.length > 0 ? (
          <section className="api-reference-group error-contracts">
            <h3>{locale === 'zh' ? '错误与诊断' : 'Errors and diagnostics'}</h3>
            <p>
              {locale === 'zh'
                ? '错误类型、稳定错误码与来源标识集中在这里；它们用于失败处理，不属于正常操作路径。'
                : 'Error classes, stable codes, and source markers live here for failure handling rather than the normal operation path.'}
            </p>
            <ul className="api-reference-list">
              {errorSymbols.map((symbol) => (
                <li key={symbol.fragment}>
                  <Link
                    to={docsModulePath(
                      locale,
                      api.library,
                      api.module,
                      symbolSlug(symbol, api.symbols)
                    )}
                  >
                    <code>{symbol.name}</code>
                    <span>{localizedSymbolPurpose(locale, symbol)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {api.aliases.length > 0 ? (
          <div className="reexport-list">
            <h3>{locale === 'zh' ? '重新导出的符号' : 'Re-exported symbols'}</h3>
            <p>
              {locale === 'zh'
                ? '这些入口由其他模块维护；链接会直接带你到规范定义。'
                : 'These entries are maintained by another module; follow the link to the canonical definition.'}
            </p>
            <ul>
              {api.aliases.map((alias) => {
                const ownerApi = libraryApis.find(
                  (candidate) =>
                    candidate.library === api.library && candidate.module === alias.ownerModule
                )
                const ownerSymbol = ownerApi?.symbols.find(
                  (symbol) => symbol.fragment === alias.ownerFragment
                )
                const destination =
                  ownerApi && ownerSymbol
                    ? ownerSymbol.kind === 'type' || ownerSymbol.kind === 'interface'
                      ? docsModulePath(
                          locale,
                          api.library,
                          alias.ownerModule,
                          symbolSlug(ownerSymbol, ownerApi.symbols)
                        )
                      : docsModulePath(
                          locale,
                          api.library,
                          alias.ownerModule,
                          symbolSlug(ownerSymbol, ownerApi.symbols)
                        )
                    : docsModulePath(locale, api.library, alias.ownerModule)
                return (
                  <li key={`${alias.exportPath}:${alias.name}`}>
                    <Link to={destination}>
                      <code>{alias.name}</code>
                      {ownerSymbol?.kind === 'type' || ownerSymbol?.kind === 'interface' ? (
                        <span>
                          {locale === 'zh'
                            ? `${alias.ownerModule} 中的规范类型定义`
                            : `Canonical type definition in ${alias.ownerModule}`}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </section>
      <RelatedTypes
        api={api}
        locale={locale}
        selectedFragment={selectedTypeFragment}
        standalone
        symbols={typingSymbols}
      />
    </>
  )
}

/** Converts a configuration path into a stable, human-readable fragment segment. */
function optionAnchor(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Renders public type names as links while preserving the surrounding TypeScript expression. */
function TypeExpression({
  api,
  libraryApis,
  locale,
  value
}: {
  readonly api: IApi
  readonly libraryApis: readonly IApi[]
  readonly locale: ILocale
  readonly value: string
}) {
  const typeSymbols = new Map(
    libraryApis.flatMap((ownerApi) =>
      ownerApi.symbols
        .filter((symbol) => symbol.kind === 'type' || symbol.kind === 'interface')
        .map((symbol) => [symbol.name, { ownerApi, symbol }] as const)
    )
  )
  return (
    <code className="type-expression">
      {value.split(/([A-Za-z_$][\w$]*)/u).map((part, index) => {
        const match = typeSymbols.get(part)
        return match ? (
          <Link
            className="type-link"
            key={`${part}-${index}`}
            to={docsModulePath(
              locale,
              api.library,
              match.ownerApi.module,
              symbolSlug(match.symbol, match.ownerApi.symbols)
            )}
          >
            {part}
          </Link>
        ) : (
          <Fragment key={`${part}-${index}`}>{part}</Fragment>
        )
      })}
    </code>
  )
}

/** Reader-facing transport choices for the WebRPC transport configuration field. */
const webRpcTransportChoices = [
  ['createMemoryTransportPair', 'adapters-memory', '同一进程内测试或本地连接两个 endpoint'],
  ['createBroadcastChannelTransport', 'adapters-broadcast-channel', '同源浏览器标签页之间通信'],
  [
    'createBrowserMessagePortTransport',
    'adapters-message-port',
    '浏览器 MessagePort 或 MessageChannel'
  ],
  [
    'createNodeMessagePortTransport',
    'adapters-message-port',
    'Node.js worker_threads 的 MessagePort'
  ],
  ['createWindowMessageTransport', 'adapters-window', '窗口、iframe 或弹窗之间通信'],
  ['createWebWorkerTransport', 'adapters-web-worker', '页面与 Dedicated Worker 通信'],
  ['createSharedWorkerTransport', 'adapters-shared-worker', '多个页面共享一个 Shared Worker'],
  ['createServiceWorkerTransport', 'adapters-service-worker', '页面与 Service Worker 通信'],
  ['createRtcDataChannelTransport', 'adapters-rtc-data-channel', '已建立连接的 WebRTC DataChannel'],
  ['createWebTransportDatagramTransport', 'adapters-web-transport', 'WebTransport datagram 通道']
] as const

/** Adds task-level help where a raw parameter description cannot explain a required choice. */
function ParameterGuide({
  api,
  fieldName,
  locale
}: {
  readonly api: IApi
  readonly fieldName: string
  readonly locale: ILocale
}) {
  if (api.library !== 'web-rpc' || fieldName !== 'transport') return null
  return (
    <div className="parameter-guide" data-parameter-guide="web-rpc-transport">
      <h4>{locale === 'zh' ? '如何选择 transport' : 'Choosing a transport'}</h4>
      <p>
        {locale === 'zh'
          ? 'transport 是 endpoint 用来发送和接收消息的连接对象。WebRPC 不会自动猜测运行环境；请按两端实际所在位置选择适配器，并把创建出的 transport 传给 endpoint。'
          : 'A transport is the connection object an endpoint uses to send and receive messages. WebRPC does not guess the host environment; choose an adapter for the actual two peers and pass the created transport to the endpoint.'}
      </p>
      <ul className="parameter-choice-list">
        {webRpcTransportChoices.map(([name, module, description]) => (
          <li key={name}>
            <Link to={docsModulePath(locale, api.library, module, name)}>
              <code>{name}</code>
            </Link>
            <span>
              {locale === 'zh'
                ? description
                : (
                    {
                      createMemoryTransportPair: 'Connect two endpoints in one process or test.',
                      createBroadcastChannelTransport:
                        'Communicate between same-origin browser tabs.',
                      createBrowserMessagePortTransport:
                        'Use a browser MessagePort or MessageChannel.',
                      createNodeMessagePortTransport: 'Use a Node.js worker_threads MessagePort.',
                      createWindowMessageTransport: 'Communicate with a window, iframe, or popup.',
                      createWebWorkerTransport:
                        'Communicate between a page and a dedicated worker.',
                      createSharedWorkerTransport: 'Share one worker across multiple pages.',
                      createServiceWorkerTransport:
                        'Communicate between pages and a service worker.',
                      createRtcDataChannelTransport: 'Use an established WebRTC data channel.',
                      createWebTransportDatagramTransport: 'Use a WebTransport datagram channel.'
                    } as const
                  )[name]}
            </span>
          </li>
        ))}
      </ul>
      <p>
        {locale === 'zh'
          ? '如果只发送单向通知且不等待返回值，可直接使用宿主环境的消息 API；只有需要调用方法并等待成功或失败结果时，才需要 RPC endpoint。'
          : 'For one-way notifications with no result, use the host messaging API directly. Create an RPC endpoint when a caller must invoke a method and await either a result or a failure.'}
      </p>
    </div>
  )
}

/** Renders one runtime API as a focused reference article with subordinate typing. */
function SingleApiReference({
  guide,
  locale,
  library,
  libraryApis,
  api,
  optionTranslations,
  symbol
}: {
  readonly guide?: IApiGuide
  readonly locale: ILocale
  readonly library: ILibrary
  readonly libraryApis: readonly IApi[]
  readonly api: IApi
  readonly optionTranslations?: Readonly<Record<string, string>>
  readonly symbol: IApiSymbol
}) {
  const typingSymbols = api.symbols.filter(
    (candidate) => candidate.kind === 'type' || candidate.kind === 'interface'
  )
  const relatedTypes = collectRelatedTypes(symbol, typingSymbols)
  const coreUsage = symbol.sections.find((section) => section.id === 'core-usage')
  const quickExample =
    guide?.quickStart ??
    diagnosticSourceExample(symbol, api.library) ??
    runnableExample(symbol.examples)
  /**
   * Complete rendered option set, including maintained fields the declaration extractor cannot
   * expand.
   */
  const configuration = [
    ...symbol.configuration,
    ...(guide?.options ?? [])
      .filter((option) => !symbol.configuration.some((field) => field.name === option.name))
      .map((option) => ({
        name: option.name,
        type: option.type ?? 'unknown',
        optional: option.optional ?? true,
        description: option.description,
        descriptionEn: locale === 'en' ? option.description : undefined,
        descriptionZh: locale === 'zh' ? option.description : undefined
      }))
  ]
  return (
    <div className="single-api-reference" id={symbol.fragment}>
      <section className="api-overview" id={`${symbol.fragment}--overview`}>
        <p className="eyebrow">
          {isSupportingContract(symbol)
            ? locale === 'zh'
              ? '公开契约'
              : 'Public contract'
            : locale === 'zh'
              ? 'API 参考'
              : 'API reference'}
        </p>
        <h2>{locale === 'zh' ? '作用' : 'Purpose'}</h2>
        <p>{guide?.purpose ?? localizedSymbolPurpose(locale, symbol)}</p>
        {guide ? <ApiDecisionGuide guide={guide} locale={locale} /> : null}
      </section>
      {quickExample ? (
        <section className="section-block compact" id={`${symbol.fragment}--quick-start`}>
          <p className="eyebrow">
            {isSupportingContract(symbol)
              ? locale === 'zh'
                ? '如何使用'
                : 'How to use it'
              : locale === 'zh'
                ? '先跑起来'
                : 'Start here'}
          </p>
          <h2>
            {isSupportingContract(symbol)
              ? locale === 'zh'
                ? '契约识别示例'
                : 'Contract identification example'
              : locale === 'zh'
                ? '最小可运行示例'
                : 'Minimal working example'}
          </h2>
          <p>
            {isSupportingContract(symbol)
              ? locale === 'zh'
                ? '在边界处读取稳定标识；不要把这个常量当作可调用函数。'
                : 'Read the stable identifier at a boundary; do not treat this constant as a callable function.'
              : locale === 'zh'
                ? '先用这个维护示例确认行为，再按下面的配置参考扩展。'
                : 'Start with this maintained example, then extend it using the configuration reference below.'}
          </p>
          <CodeBlock
            code={quickExample}
            label={locale === 'zh' ? '维护示例' : 'Maintained example'}
          />
        </section>
      ) : null}
      {configuration.length > 0 ? (
        <section
          className="section-block compact api-configuration"
          id={`${symbol.fragment}--configuration`}
        >
          <p className="eyebrow">{locale === 'zh' ? '逐项说明' : 'Field reference'}</p>
          <h2>{locale === 'zh' ? '配置参考' : 'Configuration'}</h2>
          <p>
            {locale === 'zh'
              ? '只设置场景需要的选项。每项先说明行为，再给出精确类型；嵌套名称表示所属配置组。'
              : 'Set only what the use case needs. Each option explains behavior before its exact type; dotted names show nested groups.'}
          </p>
          <div className="option-reference">
            {configuration.map((field) => {
              const optionGuide = guide?.options.find((candidate) => candidate.name === field.name)
              const translatedDescription = optionTranslations?.[field.name]
              return (
                <section
                  className="option-entry"
                  id={`${symbol.fragment}--option-${optionAnchor(field.name)}`}
                  key={field.name}
                >
                  <div className="option-heading">
                    <h3>
                      <code>{field.name}</code>
                    </h3>
                    <span className="option-requirement">
                      {field.optional
                        ? locale === 'zh'
                          ? '可选'
                          : 'Optional'
                        : locale === 'zh'
                          ? '必填'
                          : 'Required'}
                    </span>
                  </div>
                  <p>
                    {optionGuide?.description ??
                      translatedDescription ??
                      (locale === 'zh' ? field.descriptionZh : field.descriptionEn) ??
                      field.description}
                  </p>
                  {optionGuide ? (
                    <p className="option-when">
                      <strong>{locale === 'zh' ? '何时使用：' : 'When to use: '}</strong>
                      {optionGuide.whenToUse}
                    </p>
                  ) : null}
                  <dl className="option-meta">
                    <div>
                      <dt>{locale === 'zh' ? '类型' : 'Type'}</dt>
                      <dd>
                        <TypeExpression
                          api={api}
                          libraryApis={libraryApis}
                          locale={locale}
                          value={field.type}
                        />
                      </dd>
                    </div>
                    {optionGuide?.defaultValue ? (
                      <div>
                        <dt>{locale === 'zh' ? '默认值' : 'Default'}</dt>
                        <dd>
                          <code>{optionGuide.defaultValue}</code>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <ParameterGuide api={api} fieldName={field.name} locale={locale} />
                  {optionGuide?.example ? (
                    <CodeBlock
                      code={optionGuide.example}
                      label={locale === 'zh' ? `${field.name} 示例` : `${field.name} example`}
                    />
                  ) : null}
                </section>
              )
            })}
          </div>
        </section>
      ) : null}
      {!guide ? <ApiMaintainedGuidance locale={locale} library={library} symbol={symbol} /> : null}
      {coreUsage ? (
        <SymbolDetailSection locale={locale} section={coreUsage} symbol={symbol} />
      ) : null}
      <section className="api-signature" id={`${symbol.fragment}--signature`}>
        <h2>{locale === 'zh' ? '完整类型签名' : 'Full type signature'}</h2>
        <p>
          {locale === 'zh'
            ? '用于核对泛型、重载与返回类型。日常使用应先阅读上面的场景、示例和配置语义。'
            : 'Use this to inspect generics, overloads, and return types after reading the scenarios, examples, and configuration semantics above.'}
        </p>
        <CodeBlock
          code={symbol.signature}
          label={locale === 'zh' ? '公开类型签名' : 'Public type signature'}
        />
      </section>
      <RelatedTypes locale={locale} symbols={relatedTypes} />
      <p className="document-next-step">
        <Link className="text-link" to={docsModulePath(locale, api.library, api.module)}>
          {locale === 'zh' ? '← 返回模块 API 索引' : '← Back to the module API index'}
        </Link>
      </p>
    </div>
  )
}

/** Identifies exported constants that support APIs rather than perform an operation themselves. */
function isSupportingContract(symbol: IApiSymbol): boolean {
  return symbol.kind === 'const' && !isCallableApiSymbol(symbol)
}

/** Separates failure-handling contracts from normal operation entry points. */
function isErrorContract(symbol: IApiSymbol): boolean {
  const sourceName =
    symbol.source
      .split('/')
      .at(-1)
      ?.replace(/\.d\.ts$/, '') ?? ''
  return (
    sourceName === 'errors' ||
    sourceName === 'error-code' ||
    /(?:Error|ErrorCode|_SOURCE)$/.test(symbol.name)
  )
}

/** Rejects import-only snippets that cannot demonstrate observable behavior by themselves. */
function runnableExample(examples: readonly string[]): string | undefined {
  return examples.find(
    (example) => !/^\s*import\s+[\s\S]+?\s+from\s+['"][^'"]+['"];?\s*$/.test(example)
  )
}

/** Demonstrates the real boundary-checking role of a package source marker. */
function diagnosticSourceExample(symbol: IApiSymbol, library: string): string | undefined {
  if (symbol.kind !== 'const' || !symbol.name.endsWith('_SOURCE')) return undefined
  return `import { ${symbol.name} } from '@migaia/${library}'

type IPackageError = Error & { readonly source: string }

function isPackageError(error: unknown): error is IPackageError {
  return (
    error instanceof Error &&
    'source' in error &&
    error.source === ${symbol.name}
  )
}`
}

/** Helps readers decide whether the selected API fits before they inspect configuration. */
function ApiDecisionGuide({
  guide,
  locale
}: {
  readonly guide: IApiGuide
  readonly locale: ILocale
}) {
  return (
    <div className="api-decision-guide">
      <section>
        <h3>{locale === 'zh' ? '适合这些场景' : 'Use it when'}</h3>
        <ul className="prose-list">
          {guide.scenarios.map((useCase) => (
            <li key={useCase}>{useCase}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>{locale === 'zh' ? '不要用于' : 'Do not use it for'}</h3>
        <ul className="prose-list">
          {guide.avoidWhen.map((useCase) => (
            <li key={useCase}>{useCase}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** Finds the transitive type declarations referenced by one runtime signature. */
function collectRelatedTypes(
  symbol: IApiSymbol,
  typingSymbols: readonly IApiSymbol[]
): readonly IApiSymbol[] {
  const related: IApiSymbol[] = []
  const pending = typingSymbols.filter((typing) =>
    new RegExp(`\\b${typing.name}\\b`).test(symbol.signature)
  )
  while (pending.length > 0) {
    const typing = pending.shift()
    if (!typing || related.includes(typing)) continue
    related.push(typing)
    for (const dependency of typingSymbols)
      if (
        !related.includes(dependency) &&
        new RegExp(`\\b${dependency.name}\\b`).test(typing.signature)
      )
        pending.push(dependency)
  }
  return related
}

/** Groups runtime entries by their canonical implementation concern. */
function runtimeSymbolGroups(symbols: readonly IApiSymbol[]) {
  const groups = new Map<string, IApiSymbol[]>()
  for (const symbol of symbols) {
    if (symbol.kind === 'type' || symbol.kind === 'interface') continue
    if (isErrorContract(symbol)) {
      const errors = groups.get('error-contracts') ?? []
      errors.push(symbol)
      groups.set('error-contracts', errors)
      continue
    }
    if (isSupportingContract(symbol)) {
      const contracts = groups.get('supporting-contracts') ?? []
      contracts.push(symbol)
      groups.set('supporting-contracts', contracts)
      continue
    }
    const sourceName =
      symbol.source
        .split('/')
        .at(-1)
        ?.replace(/\.d\.ts$/, '') ?? 'general'
    const group = groups.get(sourceName) ?? []
    group.push(symbol)
    groups.set(sourceName, group)
  }
  return Array.from(groups, ([key, groupedSymbols]) => ({
    key,
    symbols: [...groupedSymbols].sort(
      (left, right) => right.usageScore - left.usageScore || left.name.localeCompare(right.name)
    )
  })).sort(
    (left, right) =>
      Math.max(...right.symbols.map((symbol) => symbol.usageScore), 0) -
        Math.max(...left.symbols.map((symbol) => symbol.usageScore), 0) ||
      left.key.localeCompare(right.key)
  )
}

/** Gives source-owned groups reader-facing names without exposing repository paths. */
function symbolGroupLabel(locale: ILocale, key: string): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    channel: ['Channels and subscriptions', 'Channel 与订阅'],
    async: ['Async invocation', '异步调用'],
    hub: ['Event hubs', '事件 Hub'],
    style: ['API styles', 'API 风格'],
    'error-code': ['Errors', '错误'],
    'state-constants': ['States and policies', '状态与策略'],
    'supporting-contracts': ['Constants and contracts', '常量与契约'],
    'error-contracts': ['Errors and diagnostics', '错误与诊断']
  }
  const label = labels[key]
  if (label) return label[locale === 'zh' ? 1 : 0]
  const readable = key.replaceAll('-', ' ')
  return readable.charAt(0).toUpperCase() + readable.slice(1)
}

/** Adds only maintained sections that directly discuss the selected API. */
function ApiMaintainedGuidance({
  locale,
  library,
  symbol
}: {
  readonly locale: ILocale
  readonly library: ILibrary
  readonly symbol: IApiSymbol
}) {
  if (locale !== 'zh' || symbol.guidance.length === 0) return null
  return (
    <div className="maintained-document api-maintained-guidance">
      {symbol.guidance.map((section) => (
        <section
          className="section-block compact"
          id={`${symbol.fragment}--guide-${section.id}`}
          key={section.id}
        >
          <p className="eyebrow">配置与任务指南</p>
          <h2>{section.heading}</h2>
          {section.blocks.map((block, index) => (
            <MaintainedBlock block={block} key={`${section.id}:${index}`} locale={locale} />
          ))}
        </section>
      ))}
      <p className="document-next-step">
        <Link className="text-link" to={`/${locale}/guides/${library.slug}`}>
          在完整任务指南中继续阅读 →
        </Link>
      </p>
    </div>
  )
}

/** Selects maintained task guidance that names this module or one of its runtime APIs. */
function ModuleGuidance({
  locale,
  library,
  api
}: {
  readonly locale: ILocale
  readonly library: ILibrary
  readonly api: IApi | undefined
}) {
  if (!api) return null
  const learningSections = packageLearningSections(library.documentation, api)
  return (
    <div className="module-learning-path" aria-labelledby="module-guidance">
      <section className="module-guidance">
        <p className="eyebrow">{locale === 'zh' ? '阅读路径' : 'Learning path'}</p>
        <h2 id="module-guidance">
          {locale === 'zh' ? '从场景到生产组合' : 'From use case to production composition'}
        </h2>
        <ol className="guide-path-list">
          {(locale === 'zh'
            ? ['理解适用场景', '完成 Quick Start', '组合核心能力', '确认高阶边界', '按频率选择 API']
            : [
                'Understand the use case',
                'Complete the Quick Start',
                'Compose core capabilities',
                'Check advanced boundaries',
                'Choose APIs by frequency'
              ]
          ).map((heading) => (
            <li key={heading}>{heading}</li>
          ))}
        </ol>
      </section>
      {learningSections.map(({ kind, labelEn, labelZh, sections }) => (
        <section
          className="section-block compact learning-section"
          data-learning-kind={kind}
          id={`learning-${kind}`}
          key={`${labelEn}:${sections[0]?.id}`}
        >
          <p className="eyebrow">{locale === 'zh' ? labelZh : labelEn}</p>
          <h2>
            {kind === 'advanced'
              ? locale === 'zh'
                ? '高阶用法教程'
                : 'Advanced usage tutorials'
              : sections[0]?.heading}
          </h2>
          {kind === 'advanced' ? (
            <p>
              {locale === 'zh'
                ? '按真实场景完成组合，再结合代码确认生命周期、失败与性能边界。'
                : 'Compose a real scenario, then use the code to verify lifecycle, failure, and performance boundaries.'}
            </p>
          ) : null}
          {sections.map((section) =>
            kind === 'advanced' ? (
              <section className="advanced-tutorial" key={section.id}>
                <h3>{advancedTutorialTitle(section.heading)}</h3>
                <p>
                  {locale === 'zh'
                    ? `本教程演示“${advancedTutorialTitle(section.heading)}”。代码给出完整调用顺序；复制前先确认宿主、资源所有权和失败处理符合当前场景。`
                    : `This tutorial demonstrates “${advancedTutorialTitle(section.heading)}”. The code shows complete call order; verify host, resource ownership, and failure handling before adapting it.`}
                </p>
                {section.blocks.map((block, index) => (
                  <MaintainedBlock block={block} key={`${section.id}:${index}`} locale={locale} />
                ))}
              </section>
            ) : (
              section.blocks.map((block, index) => (
                <MaintainedBlock block={block} key={`${section.id}:${index}`} locale={locale} />
              ))
            )
          )}
        </section>
      ))}
      <p className="document-next-step">
        <Link className="text-link" to={`/${locale}/guides/${library.slug}`}>
          {locale === 'zh' ? '继续阅读完整任务指南 →' : 'Continue to the complete task guide →'}
        </Link>
      </p>
    </div>
  )
}

type ILearningSection = {
  readonly kind: 'advanced' | 'composition' | 'quick-start' | 'scenarios'
  readonly labelEn: string
  readonly labelZh: string
  readonly sections: readonly IMaintainedDocument['sections'][number][]
}

/** Selects a non-overlapping task-first reading path from package-maintained documentation. */
function packageLearningSections(
  documentation: ILibrary['documentation'],
  api: IApi
): readonly ILearningSection[] {
  const sections = [
    ...(documentation.guide?.sections ?? []),
    ...(documentation.readme?.sections ?? [])
  ]
  const selected = new Set<string>()
  const hasCode = (section: (typeof sections)[number]) =>
    section.blocks.some((block) => block.type === 'code')
  const pick = (pattern: RegExp, requireCode = false, excluded?: RegExp) => {
    const candidate = sections.find(
      (section) =>
        !selected.has(`${section.heading}:${section.id}`) &&
        pattern.test(section.heading) &&
        !excluded?.test(section.heading) &&
        (!requireCode || hasCode(section))
    )
    if (candidate) selected.add(`${candidate.heading}:${candidate.id}`)
    return candidate
  }
  const sectionText = (section: (typeof sections)[number]) =>
    section.blocks
      .flatMap((block) =>
        block.type === 'paragraph'
          ? [block.text]
          : block.type === 'list'
            ? block.items
            : block.type === 'code'
              ? [block.code]
              : [block.headers.join(' '), ...block.rows.map((row) => row.join(' '))]
      )
      .join('\n')
  /** Chooses a substantial task example, preferring sections that teach frequently used APIs. */
  const pickBestCode = (excluded?: RegExp) => {
    const candidate = sections
      .filter(
        (section) =>
          !selected.has(`${section.heading}:${section.id}`) &&
          hasCode(section) &&
          !excluded?.test(section.heading)
      )
      .map((section) => {
        const text = sectionText(section)
        const apiScore = api.symbols.reduce(
          (score, symbol) =>
            score +
            (new RegExp(`\\b${symbol.name}\\b`).test(text) ? Math.max(symbol.usageScore, 1) : 0),
          0
        )
        const headingBoost = /上手|快速|开始|创建|使用|overview|quick|start|usage/i.test(
          section.heading
        )
          ? 500
          : 0
        const navigationPenalty = /安装|目录|install|contents/i.test(section.heading) ? 500 : 0
        return {
          score: headingBoost + apiScore * 20 + Math.min(text.length, 1_500) - navigationPenalty,
          section
        }
      })
      .sort((left, right) => right.score - left.score)[0]?.section
    if (candidate) selected.add(`${candidate.heading}:${candidate.id}`)
    return candidate
  }
  const scenario =
    pick(/场景|定位|适用|概览|overview|motivation|why/i) ??
    sections.find((section) => section.blocks.some((block) => block.type === 'paragraph'))
  if (scenario) selected.add(`${scenario.heading}:${scenario.id}`)
  const advancedPattern =
    /高阶组合示例|高阶用法|进阶用法|性能特征|advanced usage|advanced composition|performance/i
  const advanced = sections
    .filter((section) => advancedPattern.test(section.heading) && hasCode(section))
    .map((section) => {
      const text = sectionText(section)
      return { length: text.length, section }
    })
    .sort((left, right) => left.length - right.length)
    .slice(0, 1)
    .map(({ section }) => section)
  for (const section of advanced) selected.add(`${section.heading}:${section.id}`)
  const quickStart =
    pick(/quick|快速|上手|入门|开始|最小|\d+\s*秒/i, true, advancedPattern) ??
    pickBestCode(advancedPattern)
  const composition =
    pick(/组合|协作|集成|工作流|composition|integration|workflow|plugin/i, true, advancedPattern) ??
    pickBestCode(advancedPattern)
  const learningSections: ILearningSection[] = []
  if (scenario)
    learningSections.push({
      kind: 'scenarios',
      labelEn: 'Use cases',
      labelZh: '使用场景',
      sections: [scenario]
    })
  if (quickStart)
    learningSections.push({
      kind: 'quick-start',
      labelEn: 'Quick Start',
      labelZh: '快速上手',
      sections: [quickStart]
    })
  if (composition && advanced.length === 0)
    learningSections.push({
      kind: 'composition',
      labelEn: 'Composition',
      labelZh: '组合用法',
      sections: [composition]
    })
  if (advanced.length > 0)
    learningSections.push({
      kind: 'advanced',
      labelEn: 'Advanced usage',
      labelZh: '高级用法',
      sections: advanced
    })
  return learningSections
}

/** Removes hierarchy prefixes while preserving the task-specific tutorial title. */
function advancedTutorialTitle(heading: string): string {
  return heading.replace(/^.*(?:高阶组合示例|高阶用法|进阶用法|性能特征) · /, '')
}

/** Renders maintained prose as semantic reading content instead of generated filler. */
function MaintainedDocument({
  document,
  headingLevel = 2,
  idPrefix = 'maintained-',
  locale
}: {
  readonly document: IMaintainedDocument
  readonly headingLevel?: 2 | 3
  readonly idPrefix?: string
  readonly locale: ILocale
}) {
  return (
    <div className="maintained-document">
      {document.sections.map((section) => (
        <section className="section-block compact" id={`${idPrefix}${section.id}`} key={section.id}>
          {headingLevel === 2 ? <h2>{section.heading}</h2> : <h3>{section.heading}</h3>}
          {section.blocks.map((block, index) => (
            <MaintainedBlock block={block} key={`${section.id}:${index}`} locale={locale} />
          ))}
        </section>
      ))}
    </div>
  )
}

/** Maps one maintained Markdown block to accessible HTML. */
function MaintainedBlock({
  block,
  locale
}: {
  readonly block: IMaintainedBlock
  readonly locale: ILocale
}) {
  if (block.type === 'paragraph')
    return (
      <p>
        <InlineText text={block.text} />
      </p>
    )
  if (block.type === 'list')
    return (
      <ul className="prose-list">
        {block.items.map((item, index) => (
          <li key={`${index}:${item}`}>
            <InlineText text={item} />
          </li>
        ))}
      </ul>
    )
  if (block.type === 'table')
    return (
      <div className="prose-table-wrap">
        <table className="prose-table">
          <thead>
            <tr>
              {block.headers.map((header) => (
                <th key={header} scope="col">
                  <InlineText text={header} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    <InlineText text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  return (
    <CodeBlock
      code={block.code}
      label={locale === 'zh' ? '维护示例' : 'Maintained example'}
      language={block.language}
    />
  )
}

/** Highlights inline code names without accepting raw HTML from maintained prose. */
function InlineText({ text }: { readonly text: string }) {
  return text
    .split(/(`[^`]+`)/g)
    .map((part, index) =>
      part.startsWith('`') && part.endsWith('`') ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      )
    )
}

/** Gives English readers a concise source-derived route while translation remains explicit. */
function EnglishDomainOverview({
  guide,
  library
}: {
  readonly guide: boolean
  readonly library: ILibrary
}) {
  return (
    <section className="section-block compact">
      <h2>{guide ? 'Choose by task' : 'Ownership and boundaries'}</h2>
      <p>
        {guide
          ? `Start with the outcome you need, then open the ${library.slug} API reference for concrete inputs, outputs, and related types.`
          : (library.description ??
            `${library.slug} owns this capability boundary and its public contracts.`)}
      </p>
    </section>
  )
}

/** Renders a guide or architecture library page with its fixed page-family order. */
function DomainLibrary({
  locale,
  domain,
  library,
  modulePath,
  journey
}: {
  locale: ILocale
  domain: IDomain
  library: ILibrary
  modulePath?: string
  journey?: IGuideJourney
}) {
  const topic = modulePath ?? 'index'
  const guide = domain === 'guides'
  const document = guide ? library.documentation.guide : library.documentation.readme
  /** Stable guide inventory makes every task page reachable from the left rail. */
  const guideTopics = guide ? listGuideJourneys(library.slug, locale) : []
  /** Visible guide headings back the right-side reading outline. */
  const guideSections = journey?.document.sections ?? []
  const article = (
    <article className={guide ? 'article-column' : 'article-column full-article'}>
      <p className="eyebrow">
        {guide ? (locale === 'zh' ? '指南' : 'Guide') : locale === 'zh' ? '架构' : 'Architecture'} ·{' '}
        {library.slug}
      </p>
      <h1>{journey?.title ?? (modulePath ? topic : library.slug)}</h1>
      <p className="lede">
        {journey?.lede ??
          (locale === 'zh'
            ? guide
              ? `使用 ${library.slug} 产出可验证结果的有限任务路径。`
              : `${library.slug} 的归属与边界模型。`
            : guide
              ? `A bounded task path for producing a verifiable result with ${library.slug}.`
              : `The ownership and boundary model for ${library.slug}.`)}
      </p>
      {journey ? (
        <GuideJourneyContent journey={journey} library={library.slug} locale={locale} />
      ) : locale === 'zh' && document ? (
        <MaintainedDocument document={document} locale={locale} />
      ) : (
        <EnglishDomainOverview guide={guide} library={library} />
      )}
      <p className="document-next-step">
        <Link className="text-link" to={docsModulePath(locale, library.slug, 'index')}>
          {locale === 'zh' ? '查看具体 API 与类型 →' : 'Explore concrete APIs and types →'}
        </Link>
      </p>
    </article>
  )
  return (
    <main id="main-content" className="page-shell content-page" lang={locale} data-pagefind-body>
      <Breadcrumb locale={locale} domain={domain} library={library.slug} moduleName={topic} />
      {guide ? (
        <div className="reading-layout">
          <ScrollArea className="left-rail">
            <aside className="left-rail-content" aria-label={copyFor(locale).taskGuides}>
              <strong>{library.slug}</strong>
              <span>{locale === 'zh' ? '任务指南' : 'Task guides'}</span>
              {guideTopics.map((entry) => (
                <Link
                  className={entry.topic === topic ? 'active' : ''}
                  key={entry.topic}
                  to={
                    entry.topic === 'index'
                      ? `/${locale}/guides/${library.slug}`
                      : `/${locale}/guides/${library.slug}/${entry.topic}`
                  }
                >
                  {entry.title}
                </Link>
              ))}
            </aside>
          </ScrollArea>
          <section className="mobile-module-nav" aria-label={copyFor(locale).taskGuides}>
            <h2>{locale === 'zh' ? '任务指南' : 'Task guides'}</h2>
            <nav aria-label={copyFor(locale).taskGuides}>
              {guideTopics.map((entry) => (
                <Link
                  className={entry.topic === topic ? 'active' : ''}
                  key={entry.topic}
                  to={
                    entry.topic === 'index'
                      ? `/${locale}/guides/${library.slug}`
                      : `/${locale}/guides/${library.slug}/${entry.topic}`
                  }
                >
                  {entry.title}
                </Link>
              ))}
            </nav>
          </section>
          {article}
          <aside className="right-rail" aria-label={copyFor(locale).onPage}>
            <strong>{copyFor(locale).onPage}</strong>
            {guideSections.map((section) => (
              <a href={`#${section.id}`} key={section.id}>
                {section.heading}
              </a>
            ))}
          </aside>
        </div>
      ) : (
        article
      )}
      <NextActions locale={locale} domain={domain} library={library.slug} />
    </main>
  )
}

/** Renders one independent task page and keeps API reference as an explicit next action. */
function GuideJourneyContent({
  journey,
  library,
  locale
}: {
  readonly journey: IGuideJourney
  readonly library: string
  readonly locale: ILocale
}) {
  return (
    <>
      <MaintainedDocument document={journey.document} idPrefix="" locale={locale} />
      <nav className="guide-journey-next" aria-label={copyFor(locale).continueReading}>
        {journey.next.map((next) => (
          <Link
            className="text-link"
            key={next.path}
            to={
              next.path.startsWith('docs/')
                ? `/${locale}/${next.path.replace(/^docs\/([^/]+)\/index(?=\/|$)/, 'docs/$1')}`
                : next.path === 'index'
                  ? `/${locale}/guides/${library}`
                  : `/${locale}/guides/${library}/${next.path}`
            }
          >
            {next.label} →
          </Link>
        ))}
      </nav>
    </>
  )
}

/** Keeps type declarations subordinate to runtime APIs and displays selected declarations in full. */
function RelatedTypes({
  api,
  locale,
  selectedFragment,
  standalone = false,
  symbols
}: {
  readonly api?: IApi
  readonly locale: ILocale
  readonly selectedFragment?: string
  readonly standalone?: boolean
  readonly symbols: readonly IApiSymbol[]
}) {
  /** Replaces legacy fragment-only type locations with their full semantic route. */
  const navigate = useNavigate()
  /** Owns the visible type group so fragment navigation can locate its matching entry. */
  const typeReferenceRef = useRef<HTMLElement>(null)
  useEffect(() => {
    /** Scrolls to a subordinate type when the current fragment identifies it. */
    const locateFragment = () => {
      /** Decoded public fragment used to match the generated declaration identity. */
      let fragment: string
      if (selectedFragment) fragment = selectedFragment
      else
        try {
          fragment = decodeURIComponent(window.location.hash.slice(1))
        } catch {
          return
        }
      /** Matching declaration; unrelated fragments must not change disclosure state. */
      const target = document.getElementById(fragment)
      if (!target || !typeReferenceRef.current?.contains(target)) return
      /** Compact index entries move to the route whose loader carries the complete declaration. */
      const selectedSymbol = symbols.find((symbol) => symbol.fragment === fragment)
      if (api && selectedSymbol && !selectedSymbol.signature) {
        navigate(
          docsModulePath(locale, api.library, api.module, symbolSlug(selectedSymbol, api.symbols)),
          { replace: true }
        )
        return
      }
      target.scrollIntoView({ block: 'start' })
    }
    locateFragment()
    window.addEventListener('hashchange', locateFragment)
    return () => window.removeEventListener('hashchange', locateFragment)
  }, [api, locale, navigate, selectedFragment, symbols])
  if (symbols.length === 0) return null
  return (
    <section
      className={standalone ? 'type-reference standalone' : 'type-reference'}
      ref={typeReferenceRef}
    >
      <h2>
        {standalone
          ? locale === 'zh'
            ? `类型参考（${symbols.length}）`
            : `Type reference (${symbols.length})`
          : locale === 'zh'
            ? `相关类型（${symbols.length}）`
            : `Related types (${symbols.length})`}
      </h2>
      <div className="type-reference-body">
        {symbols.map((symbol) => (
          <section className="type-declaration" id={symbol.fragment} key={symbol.fragment}>
            <h3>
              {api && !symbol.signature ? (
                <Link
                  to={docsModulePath(
                    locale,
                    api.library,
                    api.module,
                    symbolSlug(symbol, api.symbols)
                  )}
                >
                  <code>{symbol.name}</code>
                </Link>
              ) : (
                <code>{symbol.name}</code>
              )}
            </h3>
            {symbol.signature ? (
              <CodeBlock
                code={symbol.signature}
                label={locale === 'zh' ? '类型定义' : 'Type definition'}
              />
            ) : null}
            <p>{localizedSymbolPurpose(locale, symbol)}</p>
          </section>
        ))}
      </div>
    </section>
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
        <h2>{referenceSectionLabel(locale, section.id)}</h2>
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
                ? '返回值的完整泛型关系可在下方展开类型签名核对。'
                : 'Expand the type signature below to inspect the complete generic return relationship.'}
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
      <h2>{localizedSection(locale, section.id)}</h2>
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

/** Keeps prose localized while preserving precise API names and responsibility boundaries. */
function localizedSymbolPurpose(locale: ILocale, symbol: IApiSymbol): string {
  const purpose = readableSectionContent(locale, 'introduction', symbol.purpose, symbol)
  if (locale === 'en' || /[\u3400-\u9fff]/.test(purpose)) return purpose
  if (symbol.kind === 'type' || symbol.kind === 'interface')
    return `${symbol.name} 定义相关 API 使用的公开类型约束；展开后可查看完整字段与泛型关系。`
  if (symbol.kind === 'const' && symbol.name.endsWith('_SOURCE'))
    return `${symbol.name} 是附加在包边界错误上的稳定来源标识；捕获 unknown 错误时，用它比较 error.source 以确认错误归属。`
  const sourceConcern = symbol.source
    .split('/')
    .at(-1)
    ?.replace(/\.d\.ts$/, '')
  const descriptions: Readonly<Record<string, string>> = {
    channel: '用于 Channel 创建、订阅控制、分发快照或调用期诊断。',
    async: '用于按串行、并行或单任务策略执行订阅者，并明确返回与失败语义。',
    hub: '用于按事件键组织和分发多个 Channel。',
    style: '用于定义、校验或投影公开事件 API 的命名风格。',
    'error-code': '用于识别该能力边界内稳定、可处理的错误语义。',
    'state-constants': '用于比较稳定的状态、结果或分发策略，避免散写协议字符串。'
  }
  return `${symbol.name} ${descriptions[sourceConcern ?? ''] ?? '提供该模块的公开运行时能力。'}`
}

/** Presents source text as a labelled, horizontally scrollable Dracula code surface. */
function CodeBlock({
  code,
  label,
  language = 'typescript'
}: {
  readonly code: string
  readonly label: string
  readonly language?: string
}) {
  const normalizedLanguage = language.toLowerCase()
  const isTypeScript = ['ts', 'tsx', 'typescript'].includes(normalizedLanguage)
  /** Reader-facing source with each public symbol imported from its narrowest owner. */
  const displayCode = isTypeScript ? normalizeExampleImports(code) : code
  return (
    <figure className="code-frame">
      <figcaption className="code-toolbar">
        <span>{isTypeScript ? 'TypeScript' : language}</span>
        <span>{label}</span>
      </figcaption>
      <pre className="code-block">
        <code>{isTypeScript ? highlightTypeScript(displayCode) : displayCode}</code>
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
  apis: readonly IApi[]
}) {
  return (
    <nav className="api-nav" aria-label={copyFor(locale).apiModules}>
      {libraryApis.slice(0, 8).map((api) => (
        <Link key={api.id} to={docsModulePath(locale, library, api.module)}>
          {api.module}
        </Link>
      ))}
    </nav>
  )
}

/** Renders a compact source/version line without leaking repository terminology. */
function MetaLine({ locale, library }: { locale: ILocale; library: ILibrary }) {
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
    <main id="main-content" className="page-shell" data-pagefind-body>
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

/** Names the intentionally small reference outline used by each runtime API page. */
function referenceSectionLabel(locale: ILocale, section: string): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    overview: ['Purpose', '作用'],
    'quick-start': ['Minimal example', '最小示例'],
    configuration: ['Configuration', '配置参考'],
    signature: ['Type signature', '类型签名'],
    'core-usage': ['Contract', '参数、返回与边界']
  }
  const label = labels[section]
  return label ? label[locale === 'zh' ? 1 : 0] : localizedSection(locale, section)
}

export default Docs
