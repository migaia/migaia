import { Fragment, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import {
  domainPath,
  isCallableApiSymbol,
  resolveDocsSelection,
  symbolSlug,
  type IApi,
  type IApiMember,
  type IApiSymbol,
  type IDomain,
  type ILibrary,
  type IMaintainedBlock,
  type IMaintainedDocument,
  type ILocale
} from '../content-contract.js'
import {
  librarySummaries,
  loadLibraryApiLinks,
  loadLibraryRouteContent,
  type IGuideApiLink,
  type ILibraryRouteContent
} from '../content-loader.js'
import { copyFor, domainDescription, domainTitle } from '../copy.js'
import type { IApiGuide } from '../api-guides.js'
import type { IGuideJourney } from '../guide-journeys.js'
import { ScrollArea } from '../components/ui/scroll-area.js'
import { Separator } from '../components/ui/separator.js'
import { normalizeExampleImports } from '../example-imports.js'
import { commentExample, type IExampleCommentaryContext } from '../example-commentary.js'

type IDocsLoaderData = ILibraryRouteContent & {
  readonly apiLinks?: readonly IGuideApiLink[]
  readonly guide?: IApiGuide
  readonly journey?: IGuideJourney
  readonly journeyTopics?: readonly { readonly title: string; readonly topic: string }[]
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
  /** Guide registry stays loader-only so the client route does not ship every tutorial body. */
  const journeyModule = domain === 'guides' ? await import('../guide-journeys.js') : undefined
  const guideLocale = locale === 'zh' ? 'zh' : 'en'
  const journeyExists = Boolean(journeyModule?.findGuideJourney(librarySlug, topic, guideLocale))
  const documentation =
    domain === 'docs' && locale === 'zh'
      ? 'all'
      : domain === 'architecture' && locale === 'zh'
        ? 'readme'
        : domain === 'guides' && locale === 'zh' && !journeyExists
          ? 'guide'
          : 'none'
  /** Initial index projection supplies every public module path needed for longest-prefix routing. */
  const requestedSegments = domain === 'docs' ? parts.slice(1) : []
  let selectedModule = 'index'
  let selectedSymbolPath: string | undefined
  let content = await loadLibraryRouteContent(librarySlug, {
    documentation,
    includeApiIndex: domain === 'docs',
    selectedModule: domain === 'docs' ? 'index' : undefined
  })
  if (domain === 'docs' && content) {
    /** Canonical route selection supports arbitrary public subpath depth. */
    const selection = resolveDocsSelection(requestedSegments, content.apis)
    selectedModule = selection.moduleName
    selectedSymbolPath = selection.symbolPath
    content = await loadLibraryRouteContent(librarySlug, {
      documentation,
      includeApiIndex: true,
      selectedModule,
      selectedSymbol: selectedSymbolPath
    })
  }
  let selectedApi = content?.apis.find((api) => api.module === selectedModule)
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
    selectedApi = content?.apis.find((api) => api.module === selectedModule)
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
  /** Reader routes receive lightweight navigation facts, never other APIs' documentation bodies. */
  const apiLinks =
    domain === 'guides' || domain === 'docs' || domain === 'architecture'
      ? await loadLibraryApiLinks(librarySlug)
      : undefined
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
        apiLinks,
        guide,
        journey: journeyExists
          ? journeyModule?.findGuideJourney(librarySlug, topic, guideLocale)
          : undefined,
        journeyTopics: journeyModule?.listGuideJourneys(librarySlug, guideLocale),
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
  /** Docs keeps the full public subpath so nested exports remain addressable. */
  const modulePath = domain === 'docs' ? parts.join('/') || 'index' : parts.join('/') || undefined
  if (librarySlug && !library) return <NotFound locale={locale} domain={domain} />
  if (!library) return <DomainIndex locale={locale} domain={domain} />
  if (domain === 'docs' && parts[0] === 'index') return <NotFound locale={locale} domain={domain} />
  if (domain === 'docs')
    return (
      <DocsLibrary
        guide={loaderData?.guide}
        locale={locale}
        library={library}
        apiLinks={loaderData?.apiLinks ?? []}
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
      apiLinks={loaderData?.apiLinks ?? []}
      modulePath={modulePath}
      journey={loaderData?.journey}
      journeyTopics={loaderData?.journeyTopics ?? []}
    />
  )
}

/** Displays a domain index with one discoverable entry for every current library. */
function DomainIndex({ locale, domain }: { locale: ILocale; domain: IDomain }) {
  if (domain === 'guides') return <GuidesIndex locale={locale} />
  if (domain === 'architecture') return <ArchitectureIndex locale={locale} />
  return <DocsIndex locale={locale} />
}

/** Curated outcome-first routes that keep task discovery independent of package inventory. */
const GUIDE_STARTERS = [
  {
    library: 'utils',
    titleEn: 'Control async work',
    titleZh: '控制异步工作',
    bodyEn: 'Choose cancellation, deadlines, retries, concurrency, and error identity.',
    bodyZh: '选择取消、截止时间、重试、并发与错误身份方案。'
  },
  {
    library: 'lifecycle',
    titleEn: 'Own and release resources',
    titleZh: '管理并释放资源',
    bodyEn: 'Model scopes, cleanup order, quiescence, and terminal shutdown.',
    bodyZh: '处理作用域、清理顺序、静默期与终态关闭。'
  },
  {
    library: 'capability',
    titleEn: 'Compose runtime capabilities',
    titleZh: '组合运行时能力',
    bodyEn: 'Build gates and graphs that can be inspected, replaced, and rolled back.',
    bodyZh: '构建可检查、可替换、可回退的能力门与能力图。'
  },
  {
    library: 'plugin-host',
    titleEn: 'Install and coordinate plugins',
    titleZh: '安装并协调插件',
    bodyEn: 'Choose registration, pipeline, rollback, and Host ownership boundaries.',
    bodyZh: '选择注册、管线、回滚与 Host 所有权边界。'
  },
  {
    library: 'storage-web',
    titleEn: 'Persist browser data',
    titleZh: '持久化浏览器数据',
    bodyEn: 'Select a backend, records, transactions, codecs, and live queries.',
    bodyZh: '选择后端、记录、事务、编解码与 live query。'
  },
  {
    library: 'web-rpc',
    titleEn: 'Connect browser runtimes',
    titleZh: '连接浏览器运行时',
    bodyEn: 'Create endpoints across windows, workers, channels, and transports.',
    bodyZh: '跨窗口、Worker、Channel 与 Transport 创建 endpoint。'
  },
  {
    library: 'store-light',
    titleEn: 'Build reactive application state',
    titleZh: '构建响应式应用状态',
    bodyEn: 'Start with local state, then add keyed, persistent, React, or worker layers.',
    bodyZh: '从本地状态开始，再组合 keyed、持久化、React 或 Worker 层。'
  },
  {
    library: 'wasm',
    titleEn: 'Cross the WebAssembly boundary',
    titleZh: '跨越 WebAssembly 边界',
    bodyEn: 'Choose initialization, memory ownership, conversion, and cleanup patterns.',
    bodyZh: '选择初始化、内存所有权、转换与清理模式。'
  }
] as const

/** Library families group packages by the architectural role readers use to discover them. */
const ARCHITECTURE_FAMILIES = [
  {
    titleEn: 'Store family',
    titleZh: 'Store 家族',
    bodyEn: 'Application state, persistence, framework bindings, workers, and diagnostics.',
    bodyZh: '应用状态、持久化、框架绑定、Worker、WASM 与诊断工具。',
    libraries: [
      'store-light',
      'store-keyed',
      'store-indexed',
      'store-middleware',
      'store-persist',
      'store-react',
      'store-ssr',
      'store-worker',
      'store-wasm',
      'store-devtools',
      'store-shared'
    ]
  },
  {
    titleEn: 'Pipeline and composition',
    titleZh: 'Pipeline 与组合',
    bodyEn:
      'Event flow, middleware, capabilities, plugins, reactive derivation, and resource ownership.',
    bodyZh: '事件流、中间件、能力图、插件、响应式推导与资源所有权。',
    libraries: [
      'event-subscriber',
      'middleware-pipeline',
      'capability',
      'plugin-host',
      'tray',
      'reactive',
      'resource',
      'lifecycle'
    ]
  },
  {
    titleEn: 'Browser and platform',
    titleZh: 'Browser 与平台',
    bodyEn: 'Browser storage, cross-runtime communication, and WebAssembly boundaries.',
    bodyZh: '浏览器存储、跨运行时通信以及 WebAssembly 边界。',
    libraries: ['storage-contract', 'storage-web', 'web-rpc', 'wasm']
  },
  {
    titleEn: 'Other foundations',
    titleZh: '其他基础能力',
    bodyEn: 'General utilities, serialization contracts, and observability shared across families.',
    bodyZh: '由多个家族共同复用的通用工具、序列化契约与可观测能力。',
    libraries: ['utils', 'serialize', 'logger']
  }
] as const

/** Renders the source-backed API catalogue and nothing task- or topology-specific. */
function DocsIndex({ locale }: { locale: ILocale }) {
  const copy = copyFor(locale)
  return (
    <main
      id="main-content"
      className="page-shell content-page domain-index-page"
      lang={locale}
      data-pagefind-body
    >
      <p className="eyebrow">docs</p>
      <h1>{domainTitle(locale, 'docs')}</h1>
      <p className="lede">{domainDescription(locale, 'docs')}</p>
      <section className="section-block" aria-labelledby="library-index">
        <h2 id="library-index">{copy.libraryIndex}</h2>
        <div className="library-grid">
          {librarySummaries.map((library) => (
            <Link
              className="library-item"
              key={library.slug}
              to={domainPath(locale, 'docs', library.slug)}
            >
              <strong>{library.slug}</strong>
              <span>{libraryReferenceDescription(locale, library.slug)}</span>
              <small>
                {locale === 'zh'
                  ? `${library.exports.length} 个公开模块`
                  : `${library.exports.length} public module${library.exports.length === 1 ? '' : 's'}`}
              </small>
            </Link>
          ))}
        </div>
      </section>
      <NextActions locale={locale} domain="docs" />
    </main>
  )
}

/** Renders outcome-first guide choices instead of mirroring the library catalogue. */
function GuidesIndex({ locale }: { locale: ILocale }) {
  return (
    <main
      id="main-content"
      className="page-shell content-page domain-index-page"
      lang={locale}
      data-pagefind-body
    >
      <p className="eyebrow">guides</p>
      <h1>{domainTitle(locale, 'guides')}</h1>
      <p className="lede">{domainDescription(locale, 'guides')}</p>
      <section className="section-block" aria-labelledby="task-index">
        <h2 id="task-index">
          {locale === 'zh' ? '你现在想完成什么？' : 'What do you need to accomplish?'}
        </h2>
        <p>
          {locale === 'zh'
            ? '先选结果，再进入包含步骤、解释、代码与验收方式的任务指南。'
            : 'Choose an outcome first, then follow a task guide with steps, rationale, code, and verification.'}
        </p>
        <div className="journey-grid">
          {GUIDE_STARTERS.map((guide) => (
            <Link
              className="journey-item"
              key={guide.library}
              to={domainPath(locale, 'guides', guide.library)}
            >
              <small>{guide.library}</small>
              <strong>{locale === 'zh' ? guide.titleZh : guide.titleEn}</strong>
              <span>{locale === 'zh' ? guide.bodyZh : guide.bodyEn}</span>
              <b>{locale === 'zh' ? '开始任务 →' : 'Start task →'}</b>
            </Link>
          ))}
        </div>
      </section>
      <NextActions locale={locale} domain="guides" />
    </main>
  )
}

/** Renders architecture-oriented library families instead of a flat package catalogue. */
function ArchitectureIndex({ locale }: { locale: ILocale }) {
  return (
    <main
      id="main-content"
      className="page-shell content-page domain-index-page"
      lang={locale}
      data-pagefind-body
    >
      <p className="eyebrow">architecture</p>
      <h1>{domainTitle(locale, 'architecture')}</h1>
      <p className="lede">{domainDescription(locale, 'architecture')}</p>
      <section className="section-block" aria-labelledby="dependency-map">
        <h2 id="dependency-map">
          {locale === 'zh' ? '按架构职责浏览类库' : 'Browse libraries by architectural role'}
        </h2>
        <p>
          {locale === 'zh'
            ? '同一家族解决相邻问题；选择类库前，先确认它属于状态、组合、平台还是通用基础能力。'
            : 'Packages in one family solve adjacent problems; identify state, composition, platform, or shared foundation concerns before choosing one.'}
        </p>
        <div className="architecture-stack">
          {ARCHITECTURE_FAMILIES.map((family, index) => (
            <article className="architecture-layer" key={family.titleEn}>
              <span className="architecture-layer-number">0{index + 1}</span>
              <div>
                <h3>{locale === 'zh' ? family.titleZh : family.titleEn}</h3>
                <p>{locale === 'zh' ? family.bodyZh : family.bodyEn}</p>
                <nav
                  aria-label={
                    locale === 'zh' ? `${family.titleZh}类库` : `${family.titleEn} libraries`
                  }
                >
                  {family.libraries.map((library) => (
                    <Link key={library} to={domainPath(locale, 'architecture', library)}>
                      {library}
                    </Link>
                  ))}
                </nav>
              </div>
            </article>
          ))}
        </div>
      </section>
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
  apiLinks,
  guide,
  locale,
  library,
  libraryApis,
  modulePath,
  optionTranslations,
  selectedTypeFragment
}: {
  apiLinks: readonly IGuideApiLink[]
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
  const selection = resolveDocsSelection(routeParts, libraryApis)
  const moduleName = selection.moduleName
  const symbolName = selection.symbolPath
  if (!moduleName || moduleName === 'overview')
    return (
      <main id="main-content" className="page-shell content-page" lang={locale} data-pagefind-body>
        <Breadcrumb locale={locale} domain="docs" library={library.slug} />
        <p className="eyebrow">
          {locale === 'zh' ? '类库' : 'Library'} · {library.slug}
        </p>
        <h1>{library.slug}</h1>
        <p className="lede">{libraryReferenceDescription(locale, library.slug)}</p>
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
                <span>{readerFacingModuleName(locale, api.module)}</span>
                <small>{api.exportPath}</small>
              </Link>
            ))}
          </div>
        </section>
        <NextActions locale={locale} domain="docs" library={library.slug} />
      </main>
    )
  const api = libraryApis.find((candidate) => candidate.module === moduleName)
  const selectedSymbol = api?.symbols.find(
    (symbol) =>
      symbolSlug(symbol, api.symbols) === symbolName &&
      symbol.kind !== 'type' &&
      symbol.kind !== 'interface'
  )
  const selectedGuide = selectedSymbol ? guide : undefined
  /** Public label keeps repository entry filenames out of reader-facing copy. */
  const visibleModuleName = readerFacingModuleName(locale, moduleName)
  /** Exact section inventory shared by the desktop and mobile tables of contents. */
  const onPageSections = selectedSymbol
    ? referenceSections(
        locale,
        selectedSymbol,
        Boolean(selectedGuide),
        Boolean(selectedGuide?.options.length),
        Boolean(selectedGuide?.examples?.length)
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
        <div className="left-rail-sticky">
          <ScrollArea className="left-rail">
            <aside className="left-rail-content" aria-label={copy.libraryModules}>
              <strong>{library.slug}</strong>
              <LibraryModuleLinks
                api={api}
                apiLinks={apiLinks}
                libraryApis={libraryApis}
                librarySlug={library.slug}
                locale={locale}
                selectedSymbol={selectedSymbol}
              />
            </aside>
          </ScrollArea>
        </div>
        <section className="mobile-module-nav" aria-label={copy.libraryModules}>
          <h2>
            {locale === 'zh' ? '模块与 API' : 'Modules and APIs'} ·{' '}
            {selectedSymbol?.name ?? visibleModuleName}
          </h2>
          <nav aria-label={copy.libraryModules}>
            <LibraryModuleLinks
              api={api}
              apiLinks={apiLinks}
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
                  ? `${library.slug} 参考`
                  : `${library.slug} reference`
                : visibleModuleName)}
          </h1>
          {!selectedSymbol ? (
            <p className="lede">
              {locale === 'zh'
                ? `${visibleModuleName} 解决什么问题、何时使用，以及可选择的公开 API。`
                : `What ${visibleModuleName} solves, when to use it, and which public API to choose.`}
            </p>
          ) : null}
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
  apiLinks,
  libraryApis,
  librarySlug,
  locale,
  selectedSymbol
}: {
  readonly api: IApi | undefined
  readonly apiLinks: readonly IGuideApiLink[]
  readonly libraryApis: readonly IApi[]
  readonly librarySlug: string
  readonly locale: ILocale
  readonly selectedSymbol: IApiSymbol | undefined
}) {
  /** Root-exported WebRPC middleware are plugins even though their public paths omit `middleware/`. */
  const webRpcMiddlewareNames = new Set([
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
  /** Complete middleware-plugin links are separated from general root APIs for reader clarity. */
  const middlewarePluginLinks =
    librarySlug === 'web-rpc'
      ? apiLinks.filter((link) => link.module === 'index' && webRpcMiddlewareNames.has(link.name))
      : []
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
  /** Navigation links are the complete lightweight inventory for every public runtime entry. */
  const rootApis = libraryApis.filter(
    (candidate) =>
      !candidate.module.includes('/') && apiLinks.some((link) => link.module === candidate.module)
  )
  /** Nested public modules are grouped by their owning export-path prefix. */
  const nestedGroupMap = new Map<string, IApi[]>()
  for (const candidate of libraryApis.filter((entry) => entry.module.includes('/'))) {
    /** The first public path segment owns the visible navigation group. */
    const groupName = candidate.module.split('/')[0]
    if (groupName)
      nestedGroupMap.set(groupName, [...(nestedGroupMap.get(groupName) ?? []), candidate])
  }
  /** Insertion order preserves the package manifest's intended navigation order. */
  const nestedGroups = Array.from(nestedGroupMap)
  /** Storage Web spans backends, schema, Host composition, and plugins; public-path buckets hide those decisions. */
  const storageWebGroups =
    librarySlug === 'storage-web' ? groupStorageWebApiLinks(apiLinks, locale) : []
  return (
    <>
      {storageWebGroups.map((group) => (
        <div className="left-rail-group" key={group.key}>
          <span>{group.label}</span>
          <div className="left-rail-children">
            {group.links.map((link) => (
              <Link
                className={link.name === selectedSymbol?.name ? 'active' : ''}
                key={link.symbolPath}
                to={docsModulePath(locale, librarySlug, link.module, link.symbolPath)}
              >
                {link.name}
              </Link>
            ))}
          </div>
        </div>
      ))}
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
          <Link to={`/${locale}/guides/web-rpc/endpoint-composition`}>
            {locale === 'zh' ? '如何选择 Endpoint →' : 'How to choose an Endpoint →'}
          </Link>
          <Link to={`/${locale}/guides/web-rpc/transports-and-security`}>
            {locale === 'zh' ? 'Transport 选择与完整案例' : 'Transport selection and examples'}
          </Link>
        </div>
      ) : null}
      {librarySlug !== 'storage-web' && rootApis.map((candidate) => (
        <div className="left-rail-group" key={candidate.id}>
          <Link
            className={candidate === api && !selectedSymbol ? 'active' : ''}
            to={docsModulePath(locale, librarySlug, candidate.module)}
          >
            {candidate.module === 'index'
              ? locale === 'zh'
                ? '根包 API'
                : 'Root APIs'
              : candidate.module}
          </Link>
          <div className="left-rail-children">
            {apiLinks
              .filter(
                (link) =>
                  link.module === candidate.module &&
                  !(candidate.module === 'index' && webRpcMiddlewareNames.has(link.name))
              )
              .map((link) => (
                <Link
                  className={link.name === selectedSymbol?.name ? 'active' : ''}
                  key={link.symbolPath}
                  to={docsModulePath(locale, librarySlug, link.module, link.symbolPath)}
                >
                  {link.name}
                </Link>
              ))}
            {librarySlug === 'logger' && candidate.module === 'plugins' ? (
              <Link to={`/${locale}/guides/logger/custom-plugin`}>
                {locale === 'zh' ? '编写自定义插件 →' : 'Author a custom plugin →'}
              </Link>
            ) : null}
          </div>
          {candidate === api &&
          candidate.symbols.some(
            (symbol) => symbol.kind === 'type' || symbol.kind === 'interface'
          ) ? (
            <div className="left-rail-children">
              {runtimeSymbolGroups(
                candidate.symbols.filter(
                  (symbol) => symbol.kind === 'type' || symbol.kind === 'interface'
                )
              ).map((group) => (
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
      {middlewarePluginLinks.length > 0 ? (
        <div className="left-rail-group">
          <span>{locale === 'zh' ? '中间件插件' : 'Middleware plugins'}</span>
          <div className="left-rail-children">
            {middlewarePluginLinks.map((link) => (
              <Link
                className={link.name === selectedSymbol?.name ? 'active' : ''}
                key={link.symbolPath}
                to={docsModulePath(locale, librarySlug, link.module, link.symbolPath)}
              >
                {link.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {librarySlug !== 'storage-web' && nestedGroups.map(([groupName, candidates]) => (
        <div className="left-rail-group" key={groupName}>
          <span>{moduleGroupLabel(locale, groupName)}</span>
          <div className="left-rail-children">
            {candidates.map((candidate) => {
              /** Public API links are authoritative for the nested module's expanded children. */
              const candidateLinks = apiLinks.filter((link) => link.module === candidate.module)
              /**
               * A module such as `features/control` needs one `control` link, not two identical
               * rows.
               */
              const moduleLabel = candidate.module.split('/').slice(1).join(' / ')
              /** The module landing link is redundant when its only API has the same reader label. */
              const showModuleLink =
                candidateLinks.length !== 1 || candidateLinks[0]?.name !== moduleLabel
              return (
                <div className="left-rail-symbol-group" key={candidate.id}>
                  {showModuleLink ? (
                    <Link
                      className={candidate === api && !selectedSymbol ? 'active' : ''}
                      to={docsModulePath(locale, librarySlug, candidate.module)}
                    >
                      {moduleLabel}
                    </Link>
                  ) : null}
                  {candidateLinks.map((link) => (
                    <Link
                      className={link.name === selectedSymbol?.name ? 'active' : ''}
                      key={link.symbolPath}
                      to={docsModulePath(locale, librarySlug, link.module, link.symbolPath)}
                    >
                      {link.name}
                    </Link>
                  ))}
                </div>
              )
            })}
          </div>
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
  hasGuideOptions = false,
  hasGuideExamples = false
): string[] {
  return [
    'overview',
    ...(symbol.examples.length > 0 ? ['quick-start'] : []),
    ...(hasGuideExamples ? ['examples'] : []),
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
  const moduleSymbols = Array.from(
    new Map(api.symbols.map((symbol) => [symbol.fragment, symbol])).values()
  )
  const runtimeSymbols = moduleSymbols.filter(
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
  const typingSymbols = moduleSymbols.filter(
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
                  </Link>
                  <span>
                    <SymbolPurpose library={library.slug} locale={locale} symbol={symbol} />
                  </span>
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
                  </Link>
                  <span>
                    <SymbolPurpose library={library.slug} locale={locale} symbol={symbol} />
                  </span>
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
                  </Link>
                  <span>
                    <SymbolPurpose library={library.slug} locale={locale} symbol={symbol} />
                  </span>
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

/** Renders every public instance method and property extracted from a class declaration. */
function ClassMemberReference({
  api,
  libraryApis,
  locale,
  members,
  symbol
}: {
  readonly api: IApi
  readonly libraryApis: readonly IApi[]
  readonly locale: ILocale
  readonly members: readonly IApiMember[]
  readonly symbol: IApiSymbol
}) {
  if (members.length === 0) return null
  return (
    <section className="section-block compact api-class-members" id={`${symbol.fragment}--members`}>
      <p className="eyebrow">{locale === 'zh' ? '实例能力' : 'Instance capabilities'}</p>
      <h2>{locale === 'zh' ? '实例 API' : 'Instance API'}</h2>
      <p>
        {locale === 'zh'
          ? '下面逐项列出这个类公开的属性与方法。每项给出真实签名、作用、输入与返回值；构造完成后通过实例调用。'
          : 'Every public property and method is listed below with its declaration signature, purpose, inputs, and return value. Call these members on the constructed instance.'}
      </p>
      <div className="option-reference class-member-reference">
        {members.map((member, index) => (
          <section
            className="option-entry class-member-entry"
            id={`${symbol.fragment}--member-${optionAnchor(member.name)}-${index + 1}`}
            key={`${member.signature}:${index}`}
          >
            <div className="option-heading">
              <h3>
                <code>{member.name}</code>
              </h3>
              <span className="option-requirement">
                {member.kind === 'method'
                  ? locale === 'zh'
                    ? '方法'
                    : 'Method'
                  : member.kind === 'property'
                    ? locale === 'zh'
                      ? '属性'
                      : 'Property'
                    : member.kind}
              </span>
            </div>
            <p>
              <InlineText
                library={api.library}
                locale={locale}
                text={
                  member.description ||
                  (locale === 'zh'
                    ? `${member.name} 是 ${symbol.name} 实例公开的${member.kind === 'method' ? '操作方法' : '状态属性'}。`
                    : `${member.name} is a public ${member.kind} on ${symbol.name} instances.`)
                }
              />
            </p>
            <CodeBlock
              code={member.signature}
              commentaryContext={{
                apiName: `${symbol.name}.${member.name}`,
                kind: 'signature',
                parameterNames: member.parameterDetails.map((parameter) => parameter.name),
                purpose: member.description ?? member.name
              }}
              explain
              label={locale === 'zh' ? `${member.name} 签名` : `${member.name} signature`}
              locale={locale}
            />
            <dl className="option-meta class-member-meta">
              <div>
                <dt>{locale === 'zh' ? '参数' : 'Parameters'}</dt>
                <dd>
                  {member.parameterDetails.length === 0
                    ? locale === 'zh'
                      ? '无'
                      : 'None'
                    : member.parameterDetails.map((parameter, parameterIndex) => (
                        <Fragment key={`${parameter.name}:${parameterIndex}`}>
                          {parameterIndex > 0 ? ', ' : null}
                          <code>{parameter.name}</code>
                          {parameter.optional ? '?' : ''}:{' '}
                          <TypeExpression
                            api={api}
                            libraryApis={libraryApis}
                            locale={locale}
                            value={parameter.type}
                          />
                        </Fragment>
                      ))}
                </dd>
              </div>
              <div>
                <dt>
                  {member.kind === 'property'
                    ? locale === 'zh'
                      ? '类型'
                      : 'Type'
                    : locale === 'zh'
                      ? '返回'
                      : 'Returns'}
                </dt>
                <dd>
                  <TypeExpression
                    api={api}
                    libraryApis={libraryApis}
                    locale={locale}
                    value={member.returns}
                  />
                </dd>
              </div>
            </dl>
          </section>
        ))}
      </div>
    </section>
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
  const rawQuickExample =
    guide?.quickStart ??
    diagnosticSourceExample(symbol, api.library) ??
    runnableExample(symbol.examples)
  const quickExample = rawQuickExample
    ? exampleWithPrimaryImport(rawQuickExample, api, symbol)
    : undefined
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
  const purpose = guide?.purpose ?? localizedSymbolPurpose(locale, symbol) ?? symbol.purpose
  return (
    <div
      className="single-api-reference"
      data-api-kind={symbol.kind}
      data-api-name={symbol.name}
      id={symbol.fragment}
    >
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
        {purpose ? (
          <>
            <h2>{locale === 'zh' ? '作用' : 'Purpose'}</h2>
            <p>
              <InlineText library={library.slug} locale={locale} text={purpose} />
            </p>
          </>
        ) : null}
        {guide ? <ApiDecisionGuide guide={guide} locale={locale} /> : null}
      </section>
      {quickExample ? (
        <section
          className="section-block compact"
          data-primary-api-example={symbol.name}
          id={`${symbol.fragment}--quick-start`}
        >
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
            commentaryContext={{
              apiName: symbol.name,
              purpose,
              scenario: guide?.scenarios[0]
            }}
            explain
            label={locale === 'zh' ? '维护示例' : 'Maintained example'}
            locale={locale}
          />
        </section>
      ) : null}
      {guide?.examples?.length ? (
        <section
          className="section-block compact api-scenario-examples"
          id={`${symbol.fragment}--examples`}
        >
          <p className="eyebrow">{locale === 'zh' ? '场景实战' : 'Production scenarios'}</p>
          <h2>{locale === 'zh' ? '在不同宿主中使用' : 'Use it across different hosts'}</h2>
          <p>
            {locale === 'zh'
              ? '下面的示例分别展示宿主创建、插件安装、能力消费与资源释放；每段代码都标明运行位置。'
              : 'Each example identifies where it runs and shows Host creation, plugin installation, capability consumption, and cleanup.'}
          </p>
          {guide.examples.map((example) => (
            <article
              className="api-scenario-example"
              id={`${symbol.fragment}--example-${example.id}`}
              key={example.id}
            >
              <h3>{example.title}</h3>
              <p>
                <InlineText library={library.slug} locale={locale} text={example.description} />
              </p>
              <CodeBlock
                code={example.code}
                commentaryContext={{
                  apiName: symbol.name,
                  purpose: example.description,
                  scenario: example.title
                }}
                explain
                label={example.title}
                locale={locale}
              />
            </article>
          ))}
        </section>
      ) : null}
      <ClassMemberReference
        api={api}
        libraryApis={libraryApis}
        locale={locale}
        members={symbol.members}
        symbol={symbol}
      />
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
                    <InlineText
                      library={library.slug}
                      locale={locale}
                      text={
                        optionGuide?.description ??
                        translatedDescription ??
                        (locale === 'zh' ? field.descriptionZh : field.descriptionEn) ??
                        field.description
                      }
                    />
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
                      commentaryContext={{
                        apiName: symbol.name,
                        purpose: optionGuide.description,
                        scenario: optionGuide.whenToUse
                      }}
                      explain
                      label={locale === 'zh' ? `${field.name} 示例` : `${field.name} example`}
                      locale={locale}
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
        <SymbolDetailSection
          library={api.library}
          locale={locale}
          section={coreUsage}
          symbol={symbol}
        />
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
          commentaryContext={{
            apiName: symbol.name,
            kind: 'signature',
            parameterNames: symbol.parameterDetails.map((parameter) => parameter.name),
            purpose
          }}
          explain
          label={locale === 'zh' ? '公开类型签名' : 'Public type signature'}
          locale={locale}
        />
      </section>
      <RelatedTypes api={api} locale={locale} symbols={relatedTypes} />
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

/** Makes a detail-page example independently copyable by importing its primary public API. */
function exampleWithPrimaryImport(code: string, api: IApi, symbol: IApiSymbol): string {
  const escapedName = symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!new RegExp(`\\b${escapedName}\\b`).test(code)) return code
  const importedBindings = Array.from(code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}/gu)).flatMap(
    (match) => match[1].split(',').map((binding) => binding.trim().replace(/^type\s+/u, ''))
  )
  if (importedBindings.some((binding) => binding.split(/\s+as\s+/u)[0] === symbol.name)) return code
  const packagePath =
    api.exportPath === '.'
      ? `@migaia/${api.library}`
      : `@migaia/${api.library}/${api.exportPath.replace(/^\.\//u, '')}`
  const typeOnly = symbol.kind === 'type' || symbol.kind === 'interface' ? 'type ' : ''
  return `import ${typeOnly}{ ${symbol.name} } from '${packagePath}'\n\n${code}`
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
    /** Semantic categories replace repository filenames in reader-facing navigation. */
    const category = runtimeSymbolGroupKey(symbol)
    const group = groups.get(category) ?? []
    group.push(symbol)
    groups.set(category, group)
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

/** Classifies one public runtime symbol by how a developer uses it. */
function runtimeSymbolGroupKey(symbol: IApiSymbol): string {
  /** Normalized source paths make generated Windows and POSIX manifests equivalent. */
  const sourcePath = symbol.source.replaceAll('\\', '/')
  /** The declaration owner is used only to infer a stable reader-facing concern. */
  const sourceName = sourcePath
    .split('/')
    .at(-1)
    ?.replace(/\.d\.ts$/, '')
  if (sourcePath.includes('/features/') || sourcePath.includes('/plugins/'))
    return 'feature-plugins'
  if (sourcePath.includes('/adapters/') || /(?:adapter|transport)/iu.test(sourceName ?? ''))
    return 'host-adapters'
  if (/hooks?/iu.test(sourceName ?? '') || /hooks?/iu.test(symbol.name)) return 'hooks'
  if (sourcePath.includes('/middleware/')) {
    if (/(?:contract|protocol|codec|framer)/iu.test(sourceName ?? '')) return 'protocol-contracts'
    return 'middleware-plugins'
  }
  if (/(?:contract|protocol|schema|codec|framer)/iu.test(sourceName ?? ''))
    return 'protocol-contracts'
  if (
    /^create.*Endpoint$/u.test(symbol.name) ||
    /^(?:client|provider|full|core)$/u.test(sourceName ?? '')
  )
    return 'endpoint-apis'
  return sourceName ?? 'operations'
}

/** Gives source-owned groups reader-facing names without exposing repository paths. */
function symbolGroupLabel(locale: ILocale, key: string): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    index: ['Primary entry points', '主要入口'],
    'endpoint-apis': ['Endpoint APIs', '端点 API'],
    'feature-plugins': ['Feature plugins', '功能插件'],
    'middleware-plugins': ['Middleware plugins', '中间件插件'],
    'protocol-contracts': ['Protocols and data contracts', '协议与数据规范'],
    hooks: ['Hooks and lifecycle', 'Hooks 与生命周期'],
    'host-adapters': ['Host and transport adapters', '宿主与传输适配器'],
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

/** Converts repository module identifiers into labels intended for documentation readers. */
function readerFacingModuleName(locale: ILocale, moduleName: string): string {
  if (moduleName === 'index') return locale === 'zh' ? '根包 API' : 'Root APIs'
  const [groupName, ...moduleParts] = moduleName.split('/')
  if (groupName && moduleParts.length > 0)
    return `${moduleGroupLabel(locale, groupName)} · ${moduleParts.join(' / ')}`
  return moduleName
}

/** Gives nested export families a usage-oriented label instead of a path prefix. */
function moduleGroupLabel(locale: ILocale, groupName: string): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    adapters: ['Host adapters', '宿主适配器'],
    features: ['Feature plugins', '功能插件'],
    middleware: ['Middleware plugins', '中间件插件'],
    plugins: ['Plugins', '插件'],
    hooks: ['Hooks and lifecycle', 'Hooks 与生命周期'],
    contracts: ['Protocols and contracts', '协议与规范'],
    protocol: ['Protocols and contracts', '协议与规范']
  }
  const label = labels[groupName]
  return label ? label[locale === 'zh' ? 1 : 0] : groupName.replaceAll('-', ' ')
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
    .sort((left, right) => right.length - left.length)
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
  domain = 'docs',
  headingLevel = 2,
  idPrefix = 'maintained-',
  library,
  locale
}: {
  readonly document: IMaintainedDocument
  readonly domain?: IDomain
  readonly headingLevel?: 2 | 3
  readonly idPrefix?: string
  readonly library?: string
  readonly locale: ILocale
}) {
  return (
    <div className="maintained-document">
      {document.sections.map((section) => (
        <section className="section-block compact" id={`${idPrefix}${section.id}`} key={section.id}>
          {headingLevel === 2 ? (
            <h2>
              <InlineText
                domain={domain}
                library={library}
                locale={locale}
                text={section.heading}
              />
            </h2>
          ) : (
            <h3>
              <InlineText
                domain={domain}
                library={library}
                locale={locale}
                text={section.heading}
              />
            </h3>
          )}
          {section.blocks.map((block, index) => (
            <Fragment key={`${section.id}:${index}`}>
              {index > 0 && isApiBoundaryBlock(block) ? (
                <Separator className="contract-separator" />
              ) : null}
              <MaintainedBlock block={block} domain={domain} library={library} locale={locale} />
            </Fragment>
          ))}
        </section>
      ))}
    </div>
  )
}

/** Maps one maintained Markdown block to accessible HTML. */
function MaintainedBlock({
  block,
  domain = 'docs',
  library,
  locale
}: {
  readonly block: IMaintainedBlock
  readonly domain?: IDomain
  readonly library?: string
  readonly locale: ILocale
}) {
  if (block.type === 'paragraph') {
    /** Plain text is used only to select a semantic presentation for maintained prose. */
    const normalizedText = block.text.replaceAll('`', '').replaceAll('**', '').trim()
    if (/^(?:签名|Signature)\s*[：:]/.test(normalizedText)) {
      /** Captures the first maintained code span as the callable contract. */
      const signatureParts = block.text.match(/^(?:签名|Signature)\s*[：:]\s*`([^`]+)`([\s\S]*)$/)
      /** Remaining prose explains runtime validation separately from the type shape. */
      const behavior = signatureParts?.[2].replace(/^[。．.\s]+/, '').trim()
      return (
        <div className="contract-signature">
          <span>{locale === 'zh' ? '调用形式' : 'Call shape'}</span>
          {signatureParts ? (
            <div className="contract-signature-content">
              <code className="contract-signature-code">{signatureParts[1]}</code>
              {behavior ? (
                <p className="contract-signature-description">
                  <InlineText domain={domain} library={library} locale={locale} text={behavior} />
                </p>
              ) : null}
            </div>
          ) : (
            <div className="contract-signature-content">
              <InlineText domain={domain} library={library} locale={locale} text={block.text} />
            </div>
          )}
        </div>
      )
    }
    if (/(?:全部字段|All fields)/i.test(normalizedText))
      return (
        <p className="contract-fields-heading">
          <InlineText domain={domain} library={library} locale={locale} text={block.text} />
        </p>
      )
    if (
      /^(?:options?|config|参数|返回值)\b/i.test(normalizedText) &&
      /(?:必须|若提供|must|throws?)/i.test(normalizedText)
    )
      return (
        <aside className="contract-validation">
          <InlineText domain={domain} library={library} locale={locale} text={block.text} />
        </aside>
      )
    return (
      <p>
        <InlineText domain={domain} library={library} locale={locale} text={block.text} />
      </p>
    )
  }
  if (block.type === 'list' && block.items.every((item) => /\s(?:——|—)\s/.test(item)))
    return (
      <dl className="contract-field-list">
        {block.items.map((item, index) => {
          /** The first dash separates the field declaration from its reader-facing contract. */
          const [field, ...descriptionParts] = item.split(/\s(?:——|—)\s/)
          /** Descriptions may contain additional punctuation that must remain untouched. */
          const description = descriptionParts.join(' —— ')
          return (
            <div className="contract-field" key={`${index}:${item}`}>
              <dt>
                <InlineText domain={domain} library={library} locale={locale} text={field} />
              </dt>
              <dd>
                <InlineText domain={domain} library={library} locale={locale} text={description} />
              </dd>
            </div>
          )
        })}
      </dl>
    )
  if (block.type === 'list')
    return (
      <ul className="prose-list">
        {block.items.map((item, index) => (
          <li key={`${index}:${item}`}>
            <InlineText domain={domain} library={library} locale={locale} text={item} />
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
                  <InlineText domain={domain} library={library} locale={locale} text={header} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    <InlineText domain={domain} library={library} locale={locale} text={cell} />
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
      explain
      label={locale === 'zh' ? '维护示例' : 'Maintained example'}
      language={block.language}
      locale={locale}
    />
  )
}

/** Identifies the start of another public API walkthrough inside one maintained section. */
function isApiBoundaryBlock(block: IMaintainedBlock): boolean {
  if (block.type !== 'paragraph') return false
  return /[｜|]\s*\d+\s*(?:秒|分钟)上手|\b(?:second|minute) quick start\b/i.test(
    block.text.replaceAll('`', '').replaceAll('**', '')
  )
}

/** Maps package-owned error-code tokens to the public error reference page. */
function errorReferencePath(locale: ILocale, library: string | undefined): string | undefined {
  if (library === 'storage-web') return `/${locale}/docs/storage-web/StorageError`
  return undefined
}

/** Chinese role summaries shown wherever prose explicitly references another public library. */
const LIBRARY_REFERENCE_DESCRIPTIONS_ZH = {
  capability: '管理功能开关、能力依赖图及其启动和替换生命周期。',
  'event-subscriber': '提供事件订阅、发布、取消订阅与监听器错误隔离。',
  lifecycle: '提供资源所有权、释放顺序、静默期和终态关闭原语。',
  logger: '提供结构化日志、日志级别以及诊断输出边界。',
  'middleware-pipeline': '按确定顺序组合中间件阶段，并处理转换和错误传播。',
  'plugin-host': '负责插件定义、安装、管线组合、回滚与释放。',
  reactive: '提供响应式依赖追踪、派生值和 effect 调度。',
  resource: '把异步资源的创建、读取、刷新和释放统一成生命周期契约。',
  serialize: '提供文本、结构化数据和二进制数据的编解码契约。',
  'storage-contract': '定义与具体平台无关的存储通道和适配器边界。',
  'storage-web': '提供浏览器内存、Web Storage、Cookie 与 IndexedDB 后端。',
  'store-devtools': '为 Store 提供调试快照、检查和诊断集成。',
  'store-indexed': '提供按索引组织和查询的响应式状态容器。',
  'store-keyed': '提供按业务键创建、缓存和释放状态实例的 Store 家族。',
  'store-light': '提供轻量响应式状态、派生值与资源组合入口。',
  'store-middleware': '把 Store 的读写过程接入可组合中间件。',
  'store-persist': '负责 Store 状态的持久化、恢复与水合时序。',
  'store-react': '把 Store 状态和生命周期接入 React。',
  'store-shared': '提供 Store 家族共同复用的底层类型与运行时原语。',
  'store-ssr': '处理服务端渲染期间的状态隔离、快照与水合边界。',
  'store-wasm': '把 Store 状态与 WebAssembly 内存和转换边界连接起来。',
  'store-worker': '把 Store 操作投射到 Worker，并管理消息与关闭边界。',
  tray: '组合条目定义、适配器与 Host 安装流程。',
  utils: '提供取消、并发、错误、集合、字符串等通用基础工具。',
  wasm: '管理 WebAssembly 初始化、内存所有权、值转换与清理。',
  'web-rpc': '在窗口、Worker、Channel 等运行时之间建立 RPC endpoint。'
} as const satisfies Readonly<Record<string, string>>

/** Architecture-page summaries explain the pain, core capability, and governing design up front. */
const LIBRARY_ARCHITECTURE_LEDES_ZH = {
  capability:
    '用于把可选功能从零散的 if 判断提升为可治理的能力：统一处理开关、依赖、启停、替换和资源释放。核心设计是由 Host 持有能力定义与上下文，只有满足 flag 和依赖的能力才能启用，并通过句柄消费和关闭；它不是业务状态容器。',
  docs: '用于生成和维护仓库的文档清单、公开 API 索引与站点内容，让源码契约能够被稳定检索和校验。核心设计是从包元数据与源码生成结构化清单，再由网站按路由投影；它不承载运行时业务逻辑。',
  'event-subscriber':
    '用于进程内的一对多事件通知，以及一次性、截止时间、对象订阅者和并行/串行发布等场景。它用显式订阅句柄管理退订和监听器失败，解决手写 listener 数组容易泄漏、重入和错误相互污染的问题；它不是持久化消息队列或跨进程总线。',
  lifecycle:
    '用于一组资源必须随同一 owner 关闭、旧代工作必须失效，或释放过程需要静默期、超时降级和错误聚合的场景。它把“谁拥有资源、何时不再接收工作、按什么顺序释放”建模为 scope、generation、terminal controller 与 dispose transaction，避免散落的 try/finally 在竞态中漏清理；它不负责事件分发、业务排队或依赖图。',
  logger:
    '用于生产环境的结构化日志、稳定级别、上下文字段、批量写出和最终 flush。核心设计把日志记录、过滤、传输和故障上报分开，使调用方不依赖具体控制台或后端；它不是指标系统，也不替代业务错误处理。',
  'middleware-pipeline':
    '用于多个阶段必须按确定顺序包裹一次调用，并在阶段间传值、短路或传播错误的场景。它分别提供 sync、async、generator 执行契约，约束 next 的调用时机和次数，解决手写嵌套链难以验证顺序与重复调用的问题；插件注册和生命周期由上层 Host 负责。',
  'plugin-host':
    '用于插件需要动态安装、扩展宿主能力、参与处理管线，并在失败或卸载时完整回滚的系统。核心设计把定义、admission、setup、commit、使用和 dispose 分阶段，以 revision、owner 和 receipt 防止并发安装发布半成品；它不是通用依赖注入容器。',
  reactive:
    '用于状态变化后自动重算派生值并调度副作用，而不是手工维护订阅关系。Signal、Computed 和 Effect 由同一 Runtime 记录依赖、批处理失效并统一释放，解决重复计算、更新顺序和监听泄漏；跨请求、测试或 Worker 应各自持有 Runtime，避免全局状态串扰。',
  resource:
    '当异步结果依赖 Signal/Computed，且需要自动刷新、取消、竞态隔离、重试、TTL 或快照时使用；相比直接 await，它把一次请求提升为可观察、可复用的状态机。一次性且没有这些需求的请求仍应直接 await。',
  serialize:
    '用于数据必须分块编码、跨边界传输，或按类型选择 codec 的场景。它把格式识别、codec 注册、流式编码和错误语义集中管理，避免各包重复实现不兼容的 JSON/二进制协议；它不负责存储、网络重试或对象生命周期。',
  'storage-contract':
    '用于定义不绑定浏览器、Node 或具体数据库的键值存储边界，使业务和适配器共享同一套 key、codec、capability、context 与错误契约。它解决后端替换时接口和语义漂移的问题，只规定协议，不提供具体持久化实现。',
  'storage-web':
    '用于浏览器内存、localStorage、sessionStorage、Cookie 和 IndexedDB 的统一访问，并在实体、schema、序列化和事务需求间选择后端。核心设计以共享 storage contract 隔离平台差异，同时保留各后端真实的容量、同步性和事务边界；它不会把所有后端伪装成能力完全相同。',
  'store-devtools':
    '用于开发期追踪 Store 依赖、检查快照和回放状态变化，定位“谁触发了更新”和“状态何时偏离”。它通过诊断适配器观察 Store，而不改变生产状态语义；不应把调试记录当作业务持久化。',
  'store-indexed':
    '用于需要按索引组织、局部订阅和惰性物化单元格的大型响应式集合。它让读取和更新只触达相关索引，减少整表复制与无关重算；简单的小数组没有索引查询或细粒度订阅需求时无需使用。',
  'store-keyed':
    '用于按业务键创建相互隔离、可缓存且可释放的 Store 实例，例如按用户、文档或实体 ID 管理状态。核心设计用 definition、family 与 optics 统一实例身份和局部访问，避免调用方自行维护 Map、缓存和生命周期。',
  'store-light':
    '用于需要最小 API 管理对象状态、派生读取和资源组合，但不需要完整索引或跨线程能力的应用。它以轻量 facade 暴露常用 Store 能力，并把响应式与生命周期交给底层规范实现；普通局部变量足够时不必引入。',
  'store-middleware':
    '用于写入 Store 前后执行校验、审计、转换或策略控制，并保证中间件顺序和错误传播一致。它把 mutation 作为显式管线处理，避免在每个 action 中复制横切逻辑；它不拥有状态，也不应承担业务队列调度。',
  'store-persist':
    '用于 Store 状态需要保存、恢复和水合，同时必须区分初始值、持久化快照与运行中更新的场景。核心设计用快照协议和 storage adapter 隔离具体后端，并明确恢复时序与失败边界；它不替代数据库事务或服务端数据同步。',
  'store-react':
    '用于让 React 组件按需订阅 Store，并把实例所有权绑定到 Provider 或组件生命周期。hooks 只重渲染实际读取的状态，Provider 负责隔离应用/请求上下文和释放；它不是新的状态内核，也不应绕过 Store 直接复制状态。',
  'store-shared':
    '用于多个 Worker 必须通过 SharedArrayBuffer 与 Atomics 共享低延迟 Store 状态的场景。它围绕内存布局、原子读写和可见性建立协议，避免普通对象跨线程复制；仅在隔离策略、浏览器支持和并发成本都已评估时使用。',
  'store-ssr':
    '用于服务端渲染时按请求隔离 Store，并把可序列化快照安全地脱水到客户端再水合。它解决全局单例串请求、重复请求和首屏状态不一致的问题；请求结束必须释放作用域，且快照不是长期缓存。',
  'store-wasm':
    '用于 Store 的特定字段需要由 WebAssembly 内存承载或执行高成本转换，同时仍保留 Store 的订阅接口。它通过可选适配层管理 JS/WASM 值边界和内存所有权；普通字段没有测得瓶颈时应继续使用纯 TypeScript。',
  'store-worker':
    '用于把 Store 操作、Resource 请求或序列化工作移到 Worker，同时让主线程保留可订阅的调用接口。核心设计以消息协议和适配器管理请求关联、错误、取消与关闭，解决手写 postMessage 容易丢失类型和生命周期的问题。',
  tray: '当应用启动时必须先准备配置，再用配置创建 logger、API client 或数据库连接，并在退出时按相反顺序关闭它们，可以用 Tray 代替散落的启动脚本。调用方一次声明每个 entry 的 key、依赖、start 和 release；Tray 按依赖顺序启动，只有全部成功后 ready() 才完成，随后通过 get(key) 读取结果，任一步失败都不会暴露半初始化对象，dispose() 会逆序释放已启动项。它适合启动前集合已确定的同进程组合，不是运行期增删服务的 DI 容器，也不负责跨 Worker 传输。',
  utils:
    '用于多个包共同需要、且不应绑定 Store、DOM 或具体运行时的基础能力，包括取消、并发、错误、集合、对象路径、字节与字符串处理。每个子路径拥有独立契约和错误语义，调用方应按能力导入；它不是无边界的杂物箱。',
  wasm: '用于统一 WebAssembly 模块初始化、实例复用、线性内存分配、JS/WASM 值转换和确定性释放。它把平台加载与内存所有权封装在明确边界内，避免每个消费者重复处理指针、视图失效和清理；没有 WASM 模块时无需使用。',
  'web-rpc':
    '用于窗口、Worker 或 MessagePort 两端进行类型安全的双向 RPC，并统一请求、响应、错误、取消和端点关闭。schema 定义方法、参数与结果，transport adapter 只负责传输，避免业务协议与 postMessage 细节耦合；单向广播事件应使用事件通道。'
} as const satisfies Readonly<Record<string, string>>

/** Missing English package descriptions are explicit instead of slogan fallbacks. */
const LIBRARY_REFERENCE_DESCRIPTIONS_EN = {
  logger:
    'Structured logging with stable levels, diagnostic context, sinks, batching, and flush ownership.',
  tray: 'Composes entry definitions and adapters into explicit Host installation, mutation, and cleanup flows.',
  wasm: 'Owns WebAssembly initialization, memory allocation, value conversion, and deterministic cleanup.'
} as const satisfies Readonly<Record<string, string>>

/** Unambiguous public product names that may appear without an npm package path. */
const LIBRARY_REFERENCE_ALIASES = {
  'Capability Graph': 'capability',
  Lifecycle: 'lifecycle',
  PluginHost: 'plugin-host',
  Reactive: 'reactive',
  Resource: 'resource',
  'Storage Host': 'storage-web',
  Tray: 'tray',
  WASM: 'wasm',
  WebRPC: 'web-rpc'
} as const satisfies Readonly<Record<string, string>>

/** Resolves an explicit package reference only when it points outside the current library. */
function crossLibraryReference(value: string, library: string | undefined) {
  const match = value.match(/^@migai(?:a)?\/([a-z0-9-]+)/)
  const slug =
    match?.[1] ?? LIBRARY_REFERENCE_ALIASES[value as keyof typeof LIBRARY_REFERENCE_ALIASES]
  if (!slug || slug === library || !librarySummaries.some((entry) => entry.slug === slug))
    return undefined
  return slug
}

/** Returns reader-facing ownership context for a linked library reference. */
function libraryReferenceDescription(locale: ILocale, slug: string): string {
  if (locale === 'zh')
    return LIBRARY_REFERENCE_DESCRIPTIONS_ZH[slug as keyof typeof LIBRARY_REFERENCE_DESCRIPTIONS_ZH]
  return (
    librarySummaries.find((entry) => entry.slug === slug)?.description ??
    LIBRARY_REFERENCE_DESCRIPTIONS_EN[slug as keyof typeof LIBRARY_REFERENCE_DESCRIPTIONS_EN]
  )
}

/** Highlights inline code and links public errors and explicit cross-library references. */
function InlineText({
  domain = 'docs',
  library,
  locale,
  text
}: {
  readonly domain?: IDomain
  readonly library?: string
  readonly locale: ILocale
  readonly text: string
}) {
  const errorPath = errorReferencePath(locale, library)
  return text
    .split(
      /(`[^`]+`|@migai(?:a)?\/[a-z0-9-]+(?:\/[a-z0-9-]+)*|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|Capability Graph|Lifecycle|PluginHost|Reactive|Resource|Storage Host|Tray|WASM|WebRPC)/g
    )
    .map((part, index) => {
      const inlineCode = part.startsWith('`') && part.endsWith('`')
      const value = inlineCode ? part.slice(1, -1) : part
      const errorCode = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value)
      const referencedLibrary = crossLibraryReference(value, library)
      if (referencedLibrary) {
        const description = libraryReferenceDescription(locale, referencedLibrary)
        return (
          <Link
            aria-label={`${value}：${description}`}
            className="library-reference"
            key={index}
            title={description}
            to={domainPath(locale, domain, referencedLibrary)}
          >
            {inlineCode ? <code>{value}</code> : value}
            <span className="library-reference-popover" role="note">
              <strong>{referencedLibrary}</strong>
              <span>{description}</span>
              <b>{locale === 'zh' ? '查看该类库 →' : 'Open library →'}</b>
            </span>
          </Link>
        )
      }
      if (errorCode && errorPath)
        return (
          <Link className="text-link" key={index} to={errorPath}>
            <code>{value}</code>
          </Link>
        )
      if (inlineCode) return <code key={index}>{value}</code>
      return <Fragment key={index}>{part}</Fragment>
    })
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
          : libraryReferenceDescription('en', library.slug)}
      </p>
    </section>
  )
}

type IGuideApiGroup = {
  readonly key: string
  readonly label?: string
  readonly links: readonly IGuideApiLink[]
  readonly module: string
}

/** Groups lightweight API links by their public module while preserving export order. */
function groupGuideApiLinks(
  apiLinks: readonly IGuideApiLink[],
  library: string,
  locale: ILocale
): readonly IGuideApiGroup[] {
  if (library === 'web-rpc') return groupWebRpcGuideApiLinks(apiLinks, locale)
  if (library === 'storage-web') return groupStorageWebApiLinks(apiLinks, locale)
  /** Ordered module buckets keep generated public export order stable in navigation. */
  const groups = new Map<string, IGuideApiLink[]>()
  for (const link of apiLinks) {
    const links = groups.get(link.module) ?? []
    links.push(link)
    groups.set(link.module, links)
  }
  return [...groups].map(([module, links]) => ({ key: module, links, module }))
}

/** Groups Storage Web by the decision a caller is making, independent of export-path layout. */
function groupStorageWebApiLinks(
  apiLinks: readonly IGuideApiLink[],
  locale: ILocale
): readonly IGuideApiGroup[] {
  /** Backend factories provide stores directly; backend plugins instead add them to a Host. */
  const isDirectBackend = (link: IGuideApiLink) =>
    ['cookies', 'indexed-db', 'local-storage', 'memory', 'session-storage'].includes(link.module)
  /** Stable category order follows the normal path from consuming storage to extending a Host. */
  const definitions = [
    {
      key: 'backends',
      label: locale === 'zh' ? '存储后端' : 'Storage backends',
      matches: isDirectBackend
    },
    {
      key: 'entities',
      label: locale === 'zh' ? '实体、Schema 与序列化' : 'Entities, schema, and serialization',
      matches: (link: IGuideApiLink) => ['entity', 'schema', 'serialize'].includes(link.module)
    },
    {
      key: 'host',
      label: locale === 'zh' ? '宿主创建与运行' : 'Host creation and runtime',
      matches: (link: IGuideApiLink) =>
        link.module === 'host' &&
        ['assertStorageBackendId', 'createStorageHost', 'StorageHostFacade'].includes(link.name)
    },
    {
      key: 'features',
      label: locale === 'zh' ? 'Feature 定义与拓扑' : 'Feature authoring and topology',
      matches: (link: IGuideApiLink) =>
        link.module === 'reactive-adapter' ||
        (link.module === 'host' && ['defineFeature'].includes(link.name))
    },
    {
      key: 'plugin-authoring',
      label: locale === 'zh' ? '插件定义与命名' : 'Plugin authoring and naming',
      matches: (link: IGuideApiLink) =>
        link.module === 'host' &&
        [
          'definePlugin',
          'pluginNameFromBackendId',
          'reactiveAdapterNameFromBackendId'
        ].includes(link.name)
    },
    {
      key: 'backend-plugins',
      label: locale === 'zh' ? 'Backend 插件' : 'Backend plugins',
      matches: (link: IGuideApiLink) =>
        link.module.startsWith('plugins/') && !link.module.startsWith('plugins/reactive/')
    },
    {
      key: 'reactive-plugins',
      label: locale === 'zh' ? '响应式适配插件' : 'Reactive adapter plugins',
      matches: (link: IGuideApiLink) => link.module.startsWith('plugins/reactive/')
    },
    {
      key: 'errors-contracts',
      label: locale === 'zh' ? '错误与基础契约' : 'Errors and base contracts',
      matches: (link: IGuideApiLink) => link.module === 'index'
    }
  ] as const
  return definitions
    .map(({ key, label, matches }) => ({
      key,
      label,
      links: apiLinks.filter(matches),
      module: key
    }))
    .filter((group) => group.links.length > 0)
}

/** Separates WebRPC APIs, plugins, specifications, adapters, and errors by public role. */
function groupWebRpcGuideApiLinks(
  apiLinks: readonly IGuideApiLink[],
  locale: ILocale
): readonly IGuideApiGroup[] {
  /** Root-exported factories below are middleware plugins, not ordinary utility APIs. */
  const middlewareNames = new Set([
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
  /** Error helpers and constructors form one recovery-oriented navigation group. */
  const isErrorEntry = (link: IGuideApiLink) =>
    link.name === 'WEBRPC_SOURCE' ||
    link.name.endsWith('Error') ||
    ['deserializeError', 'isWebRpcError', 'reachError', 'serializeError'].includes(link.name)
  /** Stable category order matches the decisions developers make while reading. */
  const definitions = [
    {
      key: 'api',
      label: locale === 'zh' ? 'API' : 'APIs',
      matches: (link: IGuideApiLink) =>
        !middlewareNames.has(link.name) &&
        !link.module.startsWith('features/') &&
        !link.module.startsWith('adapters/') &&
        link.module !== 'transport-constants' &&
        !isErrorEntry(link)
    },
    {
      key: 'plugins',
      label: locale === 'zh' ? '插件' : 'Plugins',
      matches: (link: IGuideApiLink) =>
        middlewareNames.has(link.name) || link.module.startsWith('features/')
    },
    {
      key: 'contracts',
      label: locale === 'zh' ? '规范' : 'Specifications',
      matches: (link: IGuideApiLink) => link.module === 'transport-constants'
    },
    {
      key: 'adapters',
      label: locale === 'zh' ? '宿主适配器' : 'Host adapters',
      matches: (link: IGuideApiLink) => link.module.startsWith('adapters/')
    },
    {
      key: 'errors',
      label: locale === 'zh' ? '错误与诊断' : 'Errors and diagnostics',
      matches: isErrorEntry
    }
  ] as const
  return definitions
    .map(({ key, label, matches }) => ({
      key,
      label,
      links: apiLinks.filter(matches),
      module: key
    }))
    .filter((group) => group.links.length > 0)
}

/** Renders the first Guide menu: every callable API grouped under its owning public module. */
function GuideApiNavigation({
  apiLinks,
  library,
  locale,
  placement
}: {
  readonly apiLinks: readonly IGuideApiLink[]
  readonly library: string
  readonly locale: ILocale
  readonly placement: 'desktop' | 'mobile'
}) {
  /** One shared projection backs both desktop and mobile navigation surfaces. */
  const groups = groupGuideApiLinks(apiLinks, library, locale)
  return (
    <section
      className={`guide-api-menu ${placement}`}
      aria-label={locale === 'zh' ? 'API 列表' : 'API list'}
    >
      <h2>{locale === 'zh' ? '分类导航' : 'Reference navigation'}</h2>
      <p>
        {locale === 'zh'
          ? 'API、插件、规范、宿主适配器和错误各自独立列出。'
          : 'APIs, plugins, specifications, host adapters, and errors are listed separately.'}
      </p>
      <div className="guide-api-groups">
        {groups.map((group) => (
          <section className="guide-api-group" key={group.key}>
            <header>
              <h3>
                {group.label ? (
                  group.label
                ) : (
                  <code>
                    {group.module === 'index'
                      ? `${library} · ${readerFacingModuleName(locale, group.module)}`
                      : readerFacingModuleName(locale, group.module)}
                  </code>
                )}
              </h3>
              <span>{group.links.length}</span>
            </header>
            <nav aria-label={`${group.label ?? group.module}${locale === 'zh' ? '列表' : ' list'}`}>
              {group.links.map((link) => (
                <Link
                  key={link.symbolPath}
                  to={docsModulePath(locale, library, link.module, link.symbolPath)}
                >
                  <code>{link.name}</code>
                </Link>
              ))}
            </nav>
          </section>
        ))}
      </div>
      <Link className="guide-api-all" to={docsModulePath(locale, library, 'index')}>
        {locale === 'zh' ? '查看全部 API →' : 'Browse all APIs →'}
      </Link>
    </section>
  )
}

/** Renders a guide or architecture library page with its fixed page-family order. */
function DomainLibrary({
  locale,
  domain,
  library,
  apiLinks,
  modulePath,
  journey,
  journeyTopics
}: {
  locale: ILocale
  domain: IDomain
  library: ILibrary
  apiLinks: readonly IGuideApiLink[]
  modulePath?: string
  journey?: IGuideJourney
  journeyTopics: readonly { readonly title: string; readonly topic: string }[]
}) {
  const topic = modulePath ?? 'index'
  const guide = domain === 'guides'
  const document = guide ? library.documentation.guide : library.documentation.readme
  /** Loader-provided guide inventory keeps every task reachable without bundling all guide bodies. */
  const guideTopics = guide ? journeyTopics : []
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
              ? `按实际任务学习 ${library.slug}：先完成最小闭环，再处理失败、资源释放与生产边界。`
              : (LIBRARY_ARCHITECTURE_LEDES_ZH[
                  library.slug as keyof typeof LIBRARY_ARCHITECTURE_LEDES_ZH
                ] ?? libraryReferenceDescription(locale, library.slug))
            : guide
              ? `Learn ${library.slug} through concrete tasks, then handle failures, cleanup, and production boundaries.`
              : libraryReferenceDescription(locale, library.slug))}
      </p>
      {journey ? (
        <GuideJourneyContent journey={journey} library={library.slug} locale={locale} />
      ) : locale === 'zh' && document ? (
        <MaintainedDocument
          document={document}
          domain={domain}
          library={library.slug}
          locale={locale}
        />
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
          <div className="left-rail-sticky">
            <ScrollArea className="left-rail">
              <aside className="left-rail-content" aria-label={copyFor(locale).taskGuides}>
                <strong>{library.slug}</strong>
                <GuideApiNavigation
                  apiLinks={apiLinks}
                  library={library.slug}
                  locale={locale}
                  placement="desktop"
                />
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
          </div>
          <section className="mobile-module-nav" aria-label={copyFor(locale).taskGuides}>
            <GuideApiNavigation
              apiLinks={apiLinks}
              library={library.slug}
              locale={locale}
              placement="mobile"
            />
            <section className="mobile-guide-menu">
              <h2>{locale === 'zh' ? '任务指南' : 'Task guides'}</h2>
              <nav className="mobile-guide-links" aria-label={copyFor(locale).taskGuides}>
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
        <div className="architecture-reading-layout">
          <section
            className="mobile-module-nav"
            aria-label={locale === 'zh' ? 'API 列表' : 'API list'}
          >
            <GuideApiNavigation
              apiLinks={apiLinks}
              library={library.slug}
              locale={locale}
              placement="mobile"
            />
          </section>
          {article}
          <ScrollArea className="architecture-api-rail">
            <aside className="architecture-api-rail-content">
              <GuideApiNavigation
                apiLinks={apiLinks}
                library={library.slug}
                locale={locale}
                placement="desktop"
              />
            </aside>
          </ScrollArea>
        </div>
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
      <MaintainedDocument
        document={journey.document}
        domain="guides"
        idPrefix=""
        library={library}
        locale={locale}
      />
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
        {symbols.map((symbol) => {
          const purpose = localizedSymbolPurpose(locale, symbol)
          return (
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
              {purpose ? (
                <p>
                  <InlineText library={api?.library} locale={locale} text={purpose} />
                </p>
              ) : null}
            </section>
          )
        })}
      </div>
    </section>
  )
}

/** Renders one generated contract section as bounded, reader-oriented content. */
function SymbolDetailSection({
  library,
  locale,
  section,
  symbol
}: {
  readonly library: string
  readonly locale: ILocale
  readonly section: IApiSymbol['sections'][number]
  readonly symbol: IApiSymbol
}) {
  const sectionId = `${symbol.fragment}--${section.id}`
  if (
    section.id === 'when-to-use' &&
    /^Use .+ when its .+ contract and declared inputs match the result you need\./.test(
      section.content
    )
  )
    return null
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
                ? parameterNames.map((name) => (
                    <code key={name}>
                      <InlineText library={library} locale={locale} text={name} />
                    </code>
                  ))
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
  if (!content) return null
  return (
    <section className="api-section symbol-api-section" data-api-part={section.id} id={sectionId}>
      <h2>{localizedSection(locale, section.id)}</h2>
      <p>
        <InlineText library={library} locale={locale} text={content} />
      </p>
      {section.example ? (
        <CodeBlock
          code={section.example}
          explain
          label={locale === 'zh' ? '示例' : 'Example'}
          locale={locale}
        />
      ) : null}
    </section>
  )
}

/** Removes generator provenance and bounds prose that cannot serve as public documentation. */
function readableSectionContent(
  locale: ILocale,
  sectionId: string,
  content: string,
  _symbol: IApiSymbol
): string | undefined {
  if (sectionId === 'when-to-use') return undefined
  const withoutProvenance = content
    .replace(/\s+Declaration:.*$/s, '')
    .replace(/ · [a-f0-9]{8}\b/g, '')
    .trim()
  if (/\.d\.ts:\d+/.test(withoutProvenance) || withoutProvenance.length > 420) return undefined
  return withoutProvenance
}

/** Keeps prose localized while preserving precise API names and responsibility boundaries. */
function localizedSymbolPurpose(locale: ILocale, symbol: IApiSymbol): string | undefined {
  const purpose = readableSectionContent(locale, 'introduction', symbol.purpose, symbol)
  if (!purpose) return undefined
  if (/^.+ is part of this module's public (?:type|function|const|class) contract\.$/.test(purpose))
    return undefined
  if (locale === 'en' || /[\u3400-\u9fff]/.test(purpose)) return purpose
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
  const description = descriptions[sourceConcern ?? '']
  return description ? `${symbol.name} ${description}` : undefined
}

/** Renders a symbol summary only when source or maintained guidance says something concrete. */
function SymbolPurpose({
  library,
  locale,
  symbol
}: {
  readonly library: string
  readonly locale: ILocale
  readonly symbol: IApiSymbol
}) {
  const purpose = localizedSymbolPurpose(locale, symbol)
  return purpose ? <InlineText library={library} locale={locale} text={purpose} /> : null
}

/** Presents source text as a labelled, horizontally scrollable Dracula code surface. */
function CodeBlock({
  code,
  commentaryContext,
  explain = false,
  label,
  language = 'typescript',
  locale = 'en'
}: {
  readonly code: string
  readonly commentaryContext?: IExampleCommentaryContext
  readonly explain?: boolean
  readonly label: string
  readonly language?: string
  readonly locale?: ILocale
}) {
  const normalizedLanguage = language.toLowerCase()
  const isTypeScript = ['ts', 'tsx', 'typescript'].includes(normalizedLanguage)
  /** Reader-facing source with each public symbol imported from its narrowest owner. */
  const normalizedCode = isTypeScript ? normalizeExampleImports(code) : code
  /** Examples include inline intent plus a walkthrough; signatures stay byte-focused. */
  const commentary = explain
    ? commentExample(normalizedCode, language, locale, commentaryContext)
    : { code: normalizedCode, notes: [] }
  return (
    <div
      className={explain ? 'explained-code annotated' : 'explained-code'}
      data-comment-count={explain ? commentary.notes.length : undefined}
    >
      <figure className="code-frame">
        <figcaption className="code-toolbar">
          <span>{isTypeScript ? 'TypeScript' : language}</span>
          <span>{label}</span>
        </figcaption>
        <pre className="code-block">
          <code>{isTypeScript ? highlightTypeScript(commentary.code) : commentary.code}</code>
        </pre>
      </figure>
      {commentary.notes.length > 0 ? (
        <aside
          className="code-walkthrough"
          aria-label={locale === 'zh' ? '代码说明' : 'Code explanation'}
        >
          <div className="code-walkthrough-notes">
            {commentary.notes.map((note, index) => (
              <p key={`${index}-${note}`}>{note}</p>
            ))}
          </div>
        </aside>
      ) : null}
    </div>
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
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[{}()[\]<>?:=|&;,.])/g
  )
  return tokens.map((token, index) => {
    let tokenClass: string | undefined
    if (token.startsWith('//') || token.startsWith('/*')) tokenClass = 'syntax-comment'
    else if (/^['"`]/.test(token)) tokenClass = 'syntax-string'
    else if (/^\d/.test(token)) tokenClass = 'syntax-number'
    else if (keywords.has(token)) tokenClass = 'syntax-keyword'
    else if (/^[A-Z]/.test(token)) tokenClass = 'syntax-type'
    else if (/^[{}()[\]<>?:=|&;,.]$/.test(token)) tokenClass = 'syntax-punctuation'
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
    examples: ['Production scenarios', '场景实战'],
    configuration: ['Configuration', '配置参考'],
    signature: ['Type signature', '类型签名'],
    'core-usage': ['Contract', '参数、返回与边界']
  }
  const label = labels[section]
  return label ? label[locale === 'zh' ? 1 : 0] : localizedSection(locale, section)
}

export default Docs
