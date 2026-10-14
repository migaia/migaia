import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, type MetaFunction as IMetaFunction } from 'react-router'
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
import { Button } from '../components/ui/button.js'
import { usePageNavigation } from '../components/page-navigation.js'
import { normalizeExampleImports } from '../example-imports.js'
import { commentExample, type IExampleCommentaryContext } from '../example-commentary.js'

type IDocsLoaderData = ILibraryRouteContent & {
  readonly apiLinks?: readonly IGuideApiLink[]
  readonly guide?: IApiGuide
  readonly journey?: IGuideJourney
  readonly journeyTopics?: readonly { readonly title: string; readonly topic: string }[]
  readonly optionTranslations?: Readonly<Record<string, string>>
  readonly optionFallbacks?: Readonly<Record<string, string>>
  readonly selectedTypeFragment?: string
}

type IDocsRouteProps = {
  readonly params: { readonly lang?: string; readonly '*'?: string }
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
  if (
    domain === 'docs' &&
    locale === 'zh' &&
    content &&
    selectedApi &&
    !selectedApi.symbols.some(
      (symbol) => symbolSlug(symbol, selectedApi!.symbols) === selectedSymbolPath
    )
  ) {
    /** Hydration carries only the maintained sections this module actually renders. */
    const selectedSections = new Set(
      packageLearningSections(content.library.documentation, selectedApi).flatMap(
        (entry) => entry.sections
      )
    )
    /** Preserve each document's order and provenance while omitting unused package-wide prose. */
    const documentation = content.library.documentation
    content = {
      ...content,
      library: {
        ...content.library,
        documentation: {
          readme: documentation.readme && {
            sections: documentation.readme.sections.filter((section) =>
              selectedSections.has(section)
            )
          },
          guide: documentation.guide && {
            sections: documentation.guide.sections.filter((section) =>
              selectedSections.has(section)
            )
          }
        }
      }
    }
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
    selectedApi = content?.apis.find((api) => api.module === selectedModule)
  }
  const selectedSymbol = selectedApi?.symbols.find(
    (symbol) =>
      symbolSlug(symbol, selectedApi!.symbols) === selectedSymbolPath &&
      symbol.kind !== 'type' &&
      symbol.kind !== 'interface'
  )
  /** Legacy direct type routes resolve to the owning module's subordinate type disclosure. */
  const selectedType = selectedApi?.symbols.find(
    (symbol) =>
      symbolSlug(symbol, selectedApi!.symbols) === selectedSymbolPath &&
      (symbol.kind === 'type' || symbol.kind === 'interface')
  )
  /** Reader routes receive lightweight navigation facts, never other APIs' documentation bodies. */
  const apiLinks =
    domain === 'guides' || domain === 'docs' || domain === 'architecture'
      ? await loadLibraryApiLinks(librarySlug)
      : undefined
  let guide: IApiGuide | undefined
  let optionTranslations: Readonly<Record<string, string>> | undefined
  /** Existing English field prose fills missing or duplicated Chinese extractor descriptions. */
  let optionFallbacks: Readonly<Record<string, string>> | undefined
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
    if (guideLocale === 'zh') {
      /** Reuse the maintained English contract rather than inventing renderer-owned field copy. */
      const englishGuide = guideModule.findApiGuide(
        librarySlug,
        selectedApi.module,
        selectedSymbol.name,
        'en'
      )
      optionFallbacks = Object.fromEntries(
        selectedSymbol.configuration.flatMap((field) => {
          /** Canonical field description already shown on the matching English page. */
          const description =
            englishGuide?.options.find((option) => option.name === field.name)?.description ??
            guideModule.findOptionTranslation(
              librarySlug,
              selectedApi.module,
              selectedSymbol.name,
              field.name,
              'en'
            ) ??
            field.descriptionEn
          return description ? [[field.name, description]] : []
        })
      )
    }
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
        optionFallbacks,
        selectedTypeFragment: selectedType?.fragment
      }
    : null
}

/** Uses the visible page purpose and canonical API identity for localized search metadata. */
export const meta: IMetaFunction<typeof loader> = ({ loaderData: data, location, params }) => {
  /** Domain and public selection are shared with the route's rendered page. */
  const domain = (location.pathname.split('/')[2] || 'docs') as IDomain
  /** Locale determines prose, while package and API names stay identical in both languages. */
  const locale = params.lang === 'zh' ? 'zh' : 'en'
  /** Public subpath identifies the selected API without exposing the root entry filename. */
  const parts = (params['*'] ?? '').split('/').filter(Boolean)
  /** Loader supplies exactly the selected library's content and maintained purpose. */
  const library = data?.library
  if (!library)
    return [
      { title: `${domainTitle(locale, domain)} · migaia` },
      { name: 'description', content: domainDescription(locale, domain) }
    ]
  /** Resolve nested modules before interpreting the final segment as an API name. */
  const selection = resolveDocsSelection(parts.slice(1), data.apis)
  /** Selected runtime declaration owns the API title and its one-sentence purpose. */
  const api = data.apis.find((candidate) => candidate.module === selection.moduleName)
  /** Legacy type pages use their declaration identity even when rendered under the module. */
  const symbol = api?.symbols.find(
    (candidate) => symbolSlug(candidate, api.symbols) === selection.symbolPath
  )
  /** Page header is reused for guide and architecture titles. */
  const title =
    domain === 'docs'
      ? symbol
        ? `${symbol.name} · ${library.slug}`
        : library.slug
      : (data.journey?.title ?? (parts.slice(1).join('/') || library.slug))
  /** Existing maintained ledes remain the source of search descriptions. */
  const purpose =
    domain === 'docs'
      ? symbol
        ? (data.guide?.purpose ??
          localizedSymbolPurpose(locale, symbol) ??
          libraryReferenceDescription(locale, library.slug))
        : libraryReferenceDescription(locale, library.slug)
      : (data.journey?.lede ??
        (domain === 'guides'
          ? libraryReferenceDescription(locale, library.slug)
          : locale === 'zh'
            ? (LIBRARY_ARCHITECTURE_LEDES_ZH[
                library.slug as keyof typeof LIBRARY_ARCHITECTURE_LEDES_ZH
              ] ?? libraryReferenceDescription(locale, library.slug))
            : libraryReferenceDescription(locale, library.slug)))
  /** Metadata has plain prose and only the opening purpose sentence. */
  const description = purpose.replace(/[`*]/g, '').trim()
  return [
    { title: `${title} · migaia` },
    {
      name: 'description',
      content: description.match(/^.*?(?:[。！？]|[.!?](?=\s|$))/s)?.[0] ?? description
    }
  ]
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
        optionFallbacks={loaderData?.optionFallbacks}
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
    library: 'rpc-core',
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
    titleEn: 'Utilities, serialization, and logging',
    titleZh: '通用工具、序列化与日志',
    bodyEn:
      'Reuse common operations, encode values for storage or transport, and compose log output.',
    bodyZh: '复用通用操作，将值编码为可存储或传输的数据，并组合日志输出。',
    libraries: ['utils', 'serialize', 'logger']
  },
  {
    titleEn: 'Lifecycle, reactivity, and events',
    titleZh: '生命周期、响应式与事件',
    bodyEn:
      'Own and release resources, update derived values, cancel stale async work, and notify local listeners.',
    bodyZh: '明确资源归属与释放，更新派生值，取消过期异步工作，并通知本地监听器。',
    libraries: ['lifecycle', 'reactive', 'resource', 'event-subscriber']
  },
  {
    titleEn: 'Storage and WebAssembly',
    titleZh: '存储与 WebAssembly',
    bodyEn:
      'Access browser storage through shared contracts and use WASM byte buffers and transcoding.',
    bodyZh: '通过共享契约访问浏览器存储，并使用 WASM 字节暂存区与转码能力。',
    libraries: ['storage-contract', 'storage-web', 'wasm']
  },
  {
    titleEn: 'Store family',
    titleZh: 'Store 家族',
    bodyEn:
      'Manage application state, subscribe to relevant changes, persist snapshots, and connect React, SSR, Workers, and WASM.',
    bodyZh: '管理应用状态，按需订阅变化，持久化快照，并接入 React、SSR、Worker 与 WASM。',
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
    titleEn: 'RPC family',
    titleZh: 'RPC 家族',
    bodyEn:
      'Call functions across windows, Workers, processes, and other languages with shared protocols, bounded pools, and diagnostics.',
    bodyZh: '用统一协议跨窗口、Worker、进程与语言调用函数，并组合有限并发池与诊断工具。',
    libraries: [
      'rpc-contract',
      'rpc-core',
      'rpc-browser',
      'rpc-threads',
      'rpc-process',
      'rpc-pool',
      'rpc-devtools',
      'rpc-bridge-jsonrpc'
    ]
  },
  {
    titleEn: 'Capabilities and pipelines',
    titleZh: '能力与中间件管线',
    bodyEn:
      'Enable optional features, order capability dependencies, and compose reusable processing steps.',
    bodyZh: '启停可选功能，安排能力依赖顺序，并组合可复用的处理步骤。',
    libraries: ['capability', 'middleware-pipeline']
  },
  {
    titleEn: 'Plugin hosts and execution management',
    titleZh: '插件宿主与执行治理',
    bodyEn:
      'Install plugins, supervise execution budgets and health, and manage discoverable host instances with ordered startup and cleanup.',
    bodyZh: '安装插件，监督执行预算与健康，并按依赖启动、发现、调用和释放宿主实例。',
    libraries: ['plugin-host', 'supervision', 'tray']
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
            : 'Libraries in one family solve adjacent problems; identify state, composition, platform, or shared foundation concerns before choosing one.'}
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
  optionFallbacks,
  selectedTypeFragment
}: {
  apiLinks: readonly IGuideApiLink[]
  guide?: IApiGuide
  locale: ILocale
  library: ILibrary
  libraryApis: readonly IApi[]
  modulePath?: string
  optionTranslations?: Readonly<Record<string, string>>
  optionFallbacks?: Readonly<Record<string, string>>
  selectedTypeFragment?: string
}) {
  const copy = copyFor(locale)
  const routeParts = modulePath?.split('/').filter(Boolean) ?? []
  const selection = resolveDocsSelection(routeParts, libraryApis)
  const moduleName = selection.moduleName
  const symbolName = selection.symbolPath
  /** Selected declarations keep sidebar and mobile menu links aligned with the active article. */
  const api = libraryApis.find((candidate) => candidate.module === moduleName)
  /** Runtime symbols have independent references; type definitions stay on their owner page. */
  const selectedSymbol = api?.symbols.find(
    (symbol) =>
      symbolSlug(symbol, api.symbols) === symbolName &&
      symbol.kind !== 'type' &&
      symbol.kind !== 'interface'
  )
  /** One stable category tree supplies both the desktop sidebar and the existing mobile menu. */
  const pageNavigation = useMemo(
    () => (
      <nav aria-label={copy.libraryModules}>
        <strong>{library.slug}</strong>
        <LibraryModuleLinks
          api={api}
          apiLinks={apiLinks}
          libraryApis={libraryApis}
          librarySlug={library.slug}
          locale={locale}
          selectedSymbol={selectedSymbol}
        />
      </nav>
    ),
    [api, apiLinks, copy.libraryModules, library.slug, libraryApis, locale, selectedSymbol]
  )
  usePageNavigation(pageNavigation)
  if (!moduleName || moduleName === 'overview')
    return (
      <main id="main-content" className="page-shell content-page" lang={locale} data-pagefind-body>
        <Breadcrumb locale={locale} domain="docs" library={library.slug} />
        <div className="reading-layout">
          <article className="article-column">
            <p className="eyebrow">
              {locale === 'zh' ? '类库' : 'Library'} · {library.slug}
            </p>
            <h1>{library.slug}</h1>
            <p className="lede">{libraryReferenceDescription(locale, library.slug)}</p>
            <MetaLine locale={locale} library={library} />
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
          </article>
          <div className="left-rail-sticky">
            <ScrollArea className="left-rail">
              <aside className="left-rail-content" aria-label={copy.libraryModules}>
                {pageNavigation}
              </aside>
            </ScrollArea>
          </div>
        </div>
        <NextActions locale={locale} domain="docs" library={library.slug} />
      </main>
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
        Boolean(selectedGuide?.examples?.length),
        Boolean(primaryExample(selectedGuide, selectedSymbol, api!.library))
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
        <article className="article-column">
          <p className="eyebrow">
            {locale === 'zh' ? '模块' : 'Module'} · {library.slug}
          </p>
          <h1>
            {selectedSymbol?.name ??
              api?.symbols.find((symbol) => symbol.fragment === selectedTypeFragment)?.name ??
              (moduleName === 'index'
                ? locale === 'zh'
                  ? `${library.slug} 参考`
                  : `${library.slug} reference`
                : visibleModuleName)}
          </h1>
          {!selectedSymbol ? (
            <p className="lede">
              {openingSentence(libraryReferenceDescription(locale, library.slug))}
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
              optionFallbacks={optionFallbacks}
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
        <div className="left-rail-sticky">
          <ScrollArea className="left-rail">
            <aside className="left-rail-content" aria-label={copy.libraryModules}>
              {pageNavigation}
            </aside>
          </ScrollArea>
        </div>
        {api ? (
          <details className="page-toc">
            <summary>{copy.onPage}</summary>
            <RightRail locale={locale} sections={onPageSections} symbol={selectedSymbol} />
          </details>
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
  /** Root-exported RPC middleware are plugins even though their public paths omit `middleware/`. */
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
    librarySlug === 'rpc-core'
      ? apiLinks.filter((link) => link.module === 'index' && webRpcMiddlewareNames.has(link.name))
      : []
  /** Primary RPC entry points must not be buried under generated module names. */
  const primaryEntries =
    librarySlug === 'rpc-core'
      ? ([
          ['createEndpoint', 'index', 'createEndpoint'],
          ['createComposedEndpoint', 'composed', 'createComposedEndpoint']
        ] as const)
      : librarySlug === 'rpc-process'
        ? ([
            ['createProcessPeer', 'index', 'createProcessPeer'],
            ['createProcessPlugin', 'index', 'createProcessPlugin']
          ] as const)
        : librarySlug === 'rpc-threads'
          ? ([
              ['createThreadPeer', 'index', 'createThreadPeer'],
              ['createThreadPlugin', 'index', 'createThreadPlugin']
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
    const groupName = candidate.module.startsWith('core/features/')
      ? 'features'
      : candidate.module.split('/')[0]
    if (groupName)
      nestedGroupMap.set(groupName, [...(nestedGroupMap.get(groupName) ?? []), candidate])
  }
  /** Insertion order preserves the package manifest's intended navigation order. */
  const nestedGroups = Array.from(nestedGroupMap)
  /**
   * Storage Web spans backends, schema, Host composition, and plugins; public-path buckets hide
   * those decisions.
   */
  const storageWebGroups =
    librarySlug === 'storage-web' ? groupStorageWebApiLinks(apiLinks, locale) : []
  /** Real-world bindings keep transport-specific examples discoverable beside the contract APIs. */
  const rpcContractScenarioLinks =
    librarySlug === 'rpc-contract'
      ? [
          ['进程 IPC', 'Process IPC', 'bindings-process'],
          ['WebSocket', 'WebSocket', 'bindings-websocket'],
          ['SSE 服务端推送', 'SSE server push', 'bindings-sse'],
          ['fetch 请求响应', 'fetch request/response', 'bindings-fetch']
        ]
      : []
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
      {rpcContractScenarioLinks.length > 0 ? (
        <div className="left-rail-group left-rail-primary">
          <span>{locale === 'zh' ? '场景应用' : 'Real-world scenarios'}</span>
          <div className="left-rail-children">
            <Link to={`/${locale}/guides/rpc-contract/real-world-bindings`}>
              {locale === 'zh' ? '同一 Contract 的完整数据流' : 'One Contract, complete data flow'}
            </Link>
            {rpcContractScenarioLinks.map(([labelZh, labelEn, anchor]) => (
              <Link
                key={labelEn}
                to={`/${locale}/guides/rpc-contract/${anchor.replace('bindings-', '')}`}
              >
                {locale === 'zh' ? labelZh : labelEn}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
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
          <Link to={`/${locale}/guides/rpc-core/endpoint-composition`}>
            {locale === 'zh' ? '如何选择 Endpoint →' : 'How to choose an Endpoint →'}
          </Link>
          <Link to={`/${locale}/guides/rpc-core/transports-and-security`}>
            {locale === 'zh' ? 'Transport 选择与完整案例' : 'Transport selection and examples'}
          </Link>
        </div>
      ) : null}
      {librarySlug !== 'storage-web' &&
        rootApis.map((candidate) => (
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
      {librarySlug !== 'storage-web' &&
        nestedGroups.map(([groupName, candidates]) => (
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
    ...packageLearningSections(documentation, api).map(({ kind }) => `learning-${kind}`),
    ...(api.aliases.length > 0 ||
    api.symbols.some((symbol) => symbol.kind !== 'type' && symbol.kind !== 'interface') ||
    (api.library === 'rpc-contract' && api.module === 'schema/wire-error')
      ? ['api-index']
      : [])
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
  _locale: ILocale,
  symbol: IApiSymbol,
  _curated: boolean,
  hasGuideOptions = false,
  _hasGuideExamples = false,
  hasQuickExample = false
): string[] {
  return [
    'overview',
    ...(hasQuickExample ? ['quick-start'] : []),
    ...(symbol.configuration.length > 0 || hasGuideOptions ? ['configuration'] : []),
    ...(symbol.errors.some(
      (error) => error.trim() && !error.startsWith('No documented errors are declared for ')
    )
      ? ['errors']
      : []),
    'related-apis',
    'signature'
  ]
}

/** Selects an observable maintained example shared by rendering and its section inventory. */
function primaryExample(guide: IApiGuide | undefined, symbol: IApiSymbol, library: string) {
  return (
    (guide?.quickStart && isObservableExample(guide.quickStart) ? guide.quickStart : undefined) ??
    diagnosticSourceExample(symbol, library) ??
    runnableExample(symbol.examples)
  )
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
  /** Module cards share a description when several aliases document the same operation. */
  const seenPurposes = new Set<string>()
  /** Only the first card renders a shared sentence; every API link remains visible. */
  const purposes = new Map<string, string>()
  for (const symbol of runtimeSymbols) {
    /** Concrete source-backed card description, excluding generator provenance. */
    const rawPurpose = localizedSymbolPurpose(locale, symbol)
    /** Cards need one concise purpose rather than a repeated API contract paragraph. */
    const purpose = rawPurpose ? openingSentence(rawPurpose) : undefined
    if (purpose && !seenPurposes.has(purpose)) {
      seenPurposes.add(purpose)
      purposes.set(symbol.fragment, purpose)
    }
  }
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
  /** The wire-error entry is an actual JSON resource, so it has no callable declarations. */
  const isWireErrorSchema = api.library === 'rpc-contract' && api.module === 'schema/wire-error'
  return (
    <>
      <ModuleGuidance locale={locale} library={library} api={api} />
      {isWireErrorSchema || runtimeSymbols.length > 0 || api.aliases.length > 0 ? (
        <section className="section-block compact" id="api-index">
          <p className="eyebrow">{locale === 'zh' ? 'API 参考' : 'API reference'}</p>
          <h2>
            {isWireErrorSchema
              ? 'JSON Schema'
              : locale === 'zh'
                ? '选择一个入口'
                : 'Choose an entry point'}
          </h2>
          {isWireErrorSchema ? (
            <p>
              {locale === 'zh'
                ? '协议实现者可导入此 schema 校验 wire 错误树。错误图的编码、规范化与 JSON-RPC 映射使用 errors 入口的公开操作。'
                : 'Protocol implementers import this schema to validate wire error trees. Use the public errors entry for encoding, normalization, and JSON-RPC mapping.'}
            </p>
          ) : null}
          {isWireErrorSchema ? (
            <CodeBlock
              code="import wireErrorSchema from '@migaia/rpc-contract/schema/wire-error' with { type: 'json' }"
              label="wire-error schema"
              locale={locale}
            />
          ) : null}
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
                      <SymbolPurpose
                        library={library.slug}
                        locale={locale}
                        purpose={purposes.get(symbol.fragment)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {supportingSymbols.length > 0 ? (
            <section className="api-reference-group supporting-contracts">
              <h3>{locale === 'zh' ? '常量与诊断契约' : 'Constants and diagnostic contracts'}</h3>
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
                      <SymbolPurpose
                        library={library.slug}
                        locale={locale}
                        purpose={purposes.get(symbol.fragment)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {errorSymbols.length > 0 ? (
            <section className="api-reference-group error-contracts">
              <h3>{locale === 'zh' ? '错误与诊断' : 'Errors and diagnostics'}</h3>
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
                      <SymbolPurpose
                        library={library.slug}
                        locale={locale}
                        purpose={purposes.get(symbol.fragment)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {api.aliases.length > 0 ? (
            <div className="reexport-list">
              <h3>{locale === 'zh' ? '重新导出的符号' : 'Re-exported symbols'}</h3>
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
      ) : null}
      {typingSymbols.length > 0 ? (
        <section className="api-signature">
          <h2>{locale === 'zh' ? '完整类型签名' : 'Full type signature'}</h2>
          <details>
            <summary>{locale === 'zh' ? '类型定义' : 'Type definitions'}</summary>
            <RelatedTypes
              api={api}
              locale={locale}
              selectedFragment={selectedTypeFragment}
              standalone
              symbols={typingSymbols}
            />
          </details>
        </section>
      ) : null}
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
  /** Overloads share one authored description while retaining their exact signatures. */
  const describedMembers = new Set<string>()
  return (
    <section className="section-block compact api-class-members" id={`${symbol.fragment}--members`}>
      <p className="eyebrow">{locale === 'zh' ? '实例能力' : 'Instance capabilities'}</p>
      <h2>{locale === 'zh' ? '实例 API' : 'Instance API'}</h2>
      <div className="option-reference class-member-reference">
        {members.map((member, index) => {
          /** Repeated extraction prose belongs to the first overload that declares it. */
          const description =
            member.description && !describedMembers.has(member.description)
              ? member.description
              : undefined
          if (description) describedMembers.add(description)
          /** Introduces the operation before its source-authored lifecycle and failure details. */
          const purpose = description ? openingSentence(description) : undefined
          /** Keeps the remaining contract intact in a separate reading paragraph. */
          const detail = purpose ? description?.trim().slice(purpose.length).trim() : undefined
          return (
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
              {purpose ? (
                <p>
                  <InlineText library={api.library} locale={locale} text={purpose} />
                </p>
              ) : null}
              {detail ? (
                <p>
                  <InlineText library={api.library} locale={locale} text={detail} />
                </p>
              ) : null}
              <CodeBlock
                code={member.signature}
                commentaryContext={{
                  library: api.library,
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
          )
        })}
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
  optionFallbacks,
  symbol
}: {
  readonly guide?: IApiGuide
  readonly locale: ILocale
  readonly library: ILibrary
  readonly libraryApis: readonly IApi[]
  readonly api: IApi
  readonly optionTranslations?: Readonly<Record<string, string>>
  readonly optionFallbacks?: Readonly<Record<string, string>>
  readonly symbol: IApiSymbol
}) {
  /** Generated declarations remain the source of related types and exact option types. */
  const typingSymbols = api.symbols.filter(
    (candidate) => candidate.kind === 'type' || candidate.kind === 'interface'
  )
  /** The signature disclosure owns all transitive supporting definitions. */
  const relatedTypes = collectRelatedTypes(symbol, typingSymbols)
  /** Only the maintained opening sentence introduces the API. */
  const purpose = openingSentence(
    guide?.purpose ?? localizedSymbolPurpose(locale, symbol) ?? symbol.purpose
  )
  /** Preserve the authored minimal example and its public import paths. */
  const rawQuickExample = primaryExample(guide, symbol, api.library)
  /** Copyable imports resolve to the canonical public module. */
  const quickExample = rawQuickExample
    ? exampleWithPrimaryImport(rawQuickExample, api, symbol)
    : undefined
  /** Root option aliases refer to the same documented field, not a second option. */
  const fieldIdentity = (name: string) => name.replace(/^options\./, '')
  /** Maintained options fill only fields absent from the extracted declaration. */
  const configuration: readonly IApiSymbol['configuration'][number][] = [
    ...symbol.configuration,
    ...(guide?.options ?? [])
      .filter(
        (option) =>
          !symbol.configuration.some(
            (field) => fieldIdentity(field.name) === fieldIdentity(option.name)
          )
      )
      .map((option) => ({
        name: option.name,
        type: option.type ?? '',
        optional: option.optional ?? true,
        description: option.description
      }))
  ]
  /** One shared declaration comment is displayed once, rather than copied to every field. */
  const described = new Set([purpose])
  /** Maintained option copy takes precedence over a reused function-level declaration comment. */
  const fieldDescription = (field: IApiSymbol['configuration'][number]) =>
    guide?.options.find((option) => fieldIdentity(option.name) === fieldIdentity(field.name))
      ?.description ??
    optionTranslations?.[field.name] ??
    (locale === 'zh' ? field.descriptionZh : field.descriptionEn) ??
    field.description
  /** Prefer field-specific maintained text; retain snippets without added commentary. */
  const options = configuration.map((field) => {
    /** Field guide uses the same option identity as the declaration projection. */
    const optionGuide = guide?.options.find(
      (option) => fieldIdentity(option.name) === fieldIdentity(field.name)
    )
    /** Opening behavior sentence stays concise and cannot repeat the API introduction. */
    const rawBehavior = openingSentence(fieldDescription(field))
    /** Repeated extractor prose does not describe this field; reuse its existing English copy. */
    const needsFallback =
      rawBehavior === purpose ||
      configuration.filter(
        (candidate) => openingSentence(fieldDescription(candidate)) === rawBehavior
      ).length > 1
    /**
     * A language fallback preserves the contract and stays visible for the content owner to
     * translate.
     */
    const behavior = openingSentence(
      needsFallback ? (optionFallbacks?.[field.name] ?? rawBehavior) : rawBehavior
    )
    /** Reused function JSDoc is not an independent explanation of a second field. */
    const description = described.has(behavior) ? '' : behavior
    if (description) described.add(description)
    return {
      ...field,
      description,
      defaultValue: optionGuide?.defaultValue,
      example: optionGuide?.example
    }
  })
  /** Omit the default column when the content supplies no defaults for this API. */
  const hasDefaults = options.some((option) => option.defaultValue?.trim())
  /** Only explicit package errors belong in the reference; generator placeholders are omitted. */
  const errors = [
    ...new Set(
      symbol.errors.filter(
        (error) => error.trim() && !error.startsWith('No documented errors are declared for ')
      )
    )
  ]
  /** The owning module supplies concrete next API choices without repeating every signature. */
  const relatedApis = api.symbols
    .filter((candidate) => candidate.fragment !== symbol.fragment && isCallableApiSymbol(candidate))
    .slice(0, 6)
  return (
    <div
      className="single-api-reference"
      data-api-kind={symbol.kind}
      data-api-name={symbol.name}
      id={symbol.fragment}
    >
      {purpose ? (
        <section className="api-overview" id={`${symbol.fragment}--overview`}>
          <p className="lede">
            <InlineText library={library.slug} locale={locale} text={purpose} />
          </p>
        </section>
      ) : null}
      {quickExample ? (
        <section
          className="section-block compact"
          data-primary-api-example={symbol.name}
          id={`${symbol.fragment}--quick-start`}
        >
          <h2>{locale === 'zh' ? '最小示例' : 'Minimal example'}</h2>
          <CodeBlock code={quickExample} label={symbol.name} locale={locale} />
        </section>
      ) : null}
      {options.length ? (
        <section
          className="section-block compact api-configuration"
          id={`${symbol.fragment}--configuration`}
        >
          <h2>{locale === 'zh' ? '选项' : 'Options'}</h2>
          <div className="table-scroll">
            <table className="option-reference">
              <thead>
                <tr>
                  <th>{locale === 'zh' ? '名称' : 'Name'}</th>
                  <th>{locale === 'zh' ? '类型' : 'Type'}</th>
                  {hasDefaults ? <th>{locale === 'zh' ? '默认值' : 'Default'}</th> : null}
                  <th>{locale === 'zh' ? '行为' : 'Behavior'}</th>
                </tr>
              </thead>
              <tbody>
                {options.map((field) => (
                  <tr
                    className="option-entry"
                    id={`${symbol.fragment}--option-${optionAnchor(field.name)}`}
                    key={field.name}
                  >
                    <th scope="row">
                      <code>
                        {field.name}
                        {field.optional ? '?' : ''}
                      </code>
                    </th>
                    <td>
                      <TypeExpression
                        api={api}
                        libraryApis={libraryApis}
                        locale={locale}
                        value={field.type}
                      />
                    </td>
                    {hasDefaults ? (
                      <td>{field.defaultValue ? <code>{field.defaultValue}</code> : '—'}</td>
                    ) : null}
                    <td>
                      {field.description ? (
                        <p>
                          <InlineText
                            library={library.slug}
                            locale={locale}
                            text={field.description}
                          />
                        </p>
                      ) : null}
                      {field.example ? (
                        <CodeBlock code={field.example} label={field.name} locale={locale} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {errors.length ? (
        <section className="section-block compact" id={`${symbol.fragment}--errors`}>
          <h2>{locale === 'zh' ? '错误' : 'Errors'}</h2>
          <ul>
            {errors.map((error) => (
              <li key={error}>
                <InlineText library={library.slug} locale={locale} text={error} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="section-block compact" id={`${symbol.fragment}--related-apis`}>
        <h2>{locale === 'zh' ? '相关 API' : 'Related APIs'}</h2>
        <ul>
          {relatedApis.map((candidate) => (
            <li key={candidate.fragment}>
              <Link
                to={docsModulePath(
                  locale,
                  api.library,
                  api.module,
                  symbolSlug(candidate, api.symbols)
                )}
              >
                {candidate.name}
              </Link>
            </li>
          ))}
        </ul>
        <Link to={`/${locale}/guides/${api.library}`}>
          {locale === 'zh' ? `${api.library} 入门指南` : `Get started with ${api.library}`}
        </Link>
      </section>
      <section className="api-signature" id={`${symbol.fragment}--signature`}>
        <h2>{locale === 'zh' ? '完整类型签名' : 'Full type signature'}</h2>
        <details>
          <summary>{locale === 'zh' ? '公开类型签名' : 'Public type signature'}</summary>
          <CodeBlock code={symbol.signature} signature label={symbol.name} locale={locale} />
          <ClassMemberReference
            api={api}
            libraryApis={libraryApis}
            locale={locale}
            members={symbol.members}
            symbol={symbol}
          />
          <RelatedTypes api={api} locale={locale} symbols={relatedTypes} />
        </details>
      </section>
    </div>
  )
}

/** Selects one authored sentence without adding renderer commentary. */
function openingSentence(text: string): string {
  return text.trim().match(/^.*?(?:[。！？]|[.!?](?=\s|$))/s)?.[0] ?? text.trim()
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

/** Rejects snippets that only declare names and never demonstrate an observable API step. */
function runnableExample(examples: readonly string[]): string | undefined {
  return examples.find(isObservableExample)
}

/** Detects whether a maintained snippet reaches an API, result, branch, or lifecycle action. */
function isObservableExample(example: string): boolean {
  const body = example
    .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*/gmu, '')
    .replace(/^\s*(?:type|interface)\s+[\s\S]*?(?:\n|$)/gmu, '')
    .replace(/^\s*\/\/.*$/gmu, '')
  return /\b(?:await|throw|return|if|for|while)\b|\bconsole\.|\.[A-Za-z_$][\w$]*\s*\(/u.test(body)
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
  if (learningSections.length === 0) return null
  /** Shared prose is shown once across the package's selected lessons. */
  const originalSections = learningSections.flatMap((lesson) => lesson.sections)
  /** Presentation changes preserve the original section order and grouping. */
  const visibleSections = uniqueDocumentProse(originalSections)
  return (
    <div className="module-learning-path">
      {learningSections.map(({ kind, labelEn, labelZh, sections }) => (
        <section
          className="section-block compact learning-section"
          data-learning-kind={kind}
          id={`learning-${kind}`}
          key={`${labelEn}:${sections[0]?.id}`}
        >
          <p className="eyebrow">{locale === 'zh' ? labelZh : labelEn}</p>
          <h2>
            {kind === 'advanced' ? (
              locale === 'zh' ? (
                '高阶用法教程'
              ) : (
                'Advanced usage tutorials'
              )
            ) : (
              <InlineText
                library={library.slug}
                locale={locale}
                text={sections[0]?.heading ?? ''}
              />
            )}
          </h2>
          {sections.map((sourceSection) => {
            /** Projection order matches the original lesson inventory. */
            const section =
              visibleSections[originalSections.indexOf(sourceSection)] ?? sourceSection
            return kind === 'advanced' ? (
              <section className="advanced-tutorial" key={section.id}>
                <h3>
                  <InlineText
                    library={library.slug}
                    locale={locale}
                    text={advancedTutorialTitle(section.heading)}
                  />
                </h3>
                {section.blocks.map((block, index) => (
                  <MaintainedBlock block={block} key={`${section.id}:${index}`} locale={locale} />
                ))}
              </section>
            ) : (
              section.blocks.map((block, index) => (
                <MaintainedBlock block={block} key={`${section.id}:${index}`} locale={locale} />
              ))
            )
          })}
        </section>
      ))}
      <p className="document-next-step">
        <Link className="text-link" to={`/${locale}/guides/${library.slug}`}>
          {locale === 'zh' ? `${library.slug} 入门指南 →` : `Get started with ${library.slug} →`}
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
  /**
   * Selected prose and code identify a lesson even when README and USEGUIDE give it different
   * headings.
   */
  const selected = new Set<string>()
  const hasCode = (section: (typeof sections)[number]) =>
    section.blocks.some((block) => block.type === 'code')
  const pick = (pattern: RegExp, requireCode = false, excluded?: RegExp) => {
    const candidate = sections.find(
      (section) =>
        !selected.has(sectionText(section)) &&
        pattern.test(section.heading) &&
        !excluded?.test(section.heading) &&
        (!requireCode || hasCode(section))
    )
    if (candidate) selected.add(sectionText(candidate))
    return candidate
  }
  /** The authored block content is also the identity used to keep the first selected lesson. */
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
          !selected.has(sectionText(section)) &&
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
    if (candidate) selected.add(sectionText(candidate))
    return candidate
  }
  const scenario =
    pick(/场景|定位|适用|概览|overview|motivation|why/i) ??
    sections.find((section) => section.blocks.some((block) => block.type === 'paragraph'))
  if (scenario) selected.add(sectionText(scenario))
  const advancedPattern =
    /高阶组合示例|高阶用法|进阶用法|性能特征|advanced usage|advanced composition|performance/i
  const advanced = sections
    .filter(
      (section) =>
        !selected.has(sectionText(section)) &&
        advancedPattern.test(section.heading) &&
        hasCode(section)
    )
    .map((section) => {
      const text = sectionText(section)
      return { length: text.length, section }
    })
    .sort((left, right) => right.length - left.length)
    .slice(0, 1)
    .map(({ section }) => section)
  for (const section of advanced) selected.add(sectionText(section))
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

/** Removes repeated prose from one rendered document while preserving all authored code. */
function uniqueDocumentProse(
  sections: IMaintainedDocument['sections']
): IMaintainedDocument['sections'] {
  /** A sentence's first occurrence owns its explanation within this document. */
  const seen = new Set<string>()
  /** Markdown markers do not make an otherwise identical sentence different. */
  const uniqueText = (text: string) =>
    text
      .split(/(?<=[。！？])|(?<=[.!?])(?=\s|$)/u)
      .filter((sentence) => {
        /** Only complete prose sentences participate; identifiers and short data values remain. */
        const key = sentence.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim()
        if (Array.from(key).length < 12 || !/[。！？.!?]$/.test(key)) return true
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .join('')
      .trim()
  return sections.map((section) => ({
    ...section,
    blocks: section.blocks.flatMap((block): IMaintainedBlock[] => {
      if (block.type === 'paragraph') {
        /** Empty paragraphs are removed instead of leaving blank contract fields. */
        const text = uniqueText(block.text)
        return text ? [{ ...block, text }] : []
      }
      if (block.type === 'list') {
        /** List structure keeps only items with a remaining explanation. */
        const items = block.items.map(uniqueText).filter(Boolean)
        return items.length ? [{ ...block, items }] : []
      }
      return [block]
    })
  }))
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
  /** Repeated parameter facts are presented once without modifying the maintained document. */
  const sections = uniqueDocumentProse(document.sections)
  return (
    <div className="maintained-document">
      {sections.map((section) => (
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
              <div
                id={
                  section.id === 'bindings'
                    ? ['bindings-fetch', 'bindings-websocket', 'bindings-sse', 'bindings-process'][
                        index - 1
                      ]
                    : undefined
                }
              >
                <MaintainedBlock block={block} domain={domain} library={library} locale={locale} />
              </div>
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

/** README-backed Chinese summaries explain what each library helps readers accomplish. */
const LIBRARY_REFERENCE_DESCRIPTIONS_ZH = {
  capability: '按开关启停可选功能，为不同租户隔离功能开关，并按依赖启动和释放功能。',
  'event-subscriber': '在本地模块间订阅和广播事件，并协调同步或异步监听器的执行。',
  lifecycle: '将多项资源交给同一作用域管理，并在退出时等待任务结束和释放资源。',
  logger: '将日志输出到控制台或服务，按需要过滤和格式化，并等待异步输出完成。',
  'middleware-pipeline':
    '把处理步骤组合为同步、异步或生成器中间件管线，并在需要时提前结束或取消处理。',
  'plugin-host': '为库或应用安装和卸载插件，配置共享能力与处理步骤，并在安装失败时回滚。',
  reactive: '让状态变化自动更新派生值和副作用，并为不同使用场景隔离状态。',
  resource: '随输入变化加载异步数据，取消过期请求、重试失败请求并刷新缓存。',
  'rpc-bridge-jsonrpc': '通过 JSON-RPC 调用 Python、Go、Rust 等语言实现的子进程或本机服务。',
  'rpc-browser': '在浏览器窗口、iframe、SharedWorker 与可靠有序的 WebRTC 通道之间调用函数。',
  'rpc-contract': '为自定义 RPC 实现校验和编解码消息，让不同对端按同一协议通信。',
  'rpc-core': '跨运行时调用远程函数，并为调用设置超时、取消和流式结果处理。',
  'rpc-devtools': '采集、查询和录制 RPC 元数据，并查看多个宿主的时间线与调用统计。',
  'rpc-pool': '将 RPC 调用分配到线程池或进程池，并用有限队列承接繁忙时的请求。',
  'rpc-process': '在子进程或本机服务中运行隔离任务，并通过 RPC 调用和管理它们。',
  'rpc-threads': '把重计算移到 Worker，并通过 RPC 调用、管理和重启线程。',
  serialize: '把应用数据编码为可存储或传输的格式，并在读取时解码。',
  'storage-contract': '为键值和记录存储定义统一接口，让应用可以接入不同存储后端。',
  'storage-web': '通过统一接口读写 Web Storage、cookie、IndexedDB 和内存中的数据。',
  'store-devtools': '查看 Store 的状态与 action 历史，通过时间旅行和依赖树定位状态变化。',
  'store-indexed': '在对象、数组、Map 和 Set 中按键或索引订阅变化，让相关计算随集合更新。',
  'store-keyed': '在独立作用域中按业务 key 管理状态，并只订阅需要的部分。',
  'store-light': '管理对象状态、异步数据和更新操作，让相关计算随字段变化自动更新。',
  'store-middleware': '跟踪 Store 的状态与 action、约束写入规则，并接入 Redux DevTools。',
  'store-persist': '自动保存和恢复对象、按键管理的状态与集合，并在版本变化时迁移已保存数据。',
  'store-react': '在 React 组件中使用 Store、Atom 与异步资源，并管理订阅和退出时的清理。',
  'store-shared': '让主线程与 Worker 共同读写同一组响应式 32 位整数状态。',
  'store-ssr': '隔离每个 SSR 请求的 Store 与 Resource，并将服务端初始状态恢复到浏览器。',
  'store-wasm': '在 WASM 中管理可订阅的数值、字符串、数组和记录状态。',
  'store-worker': '把耗时计算和数据编解码移到 Worker，并为请求使用取消、去重和缓存功能。',
  supervision: '限制执行单元数量，检查健康状态，重启故障单元，并按时限管理关闭过程。',
  tray: '启动、查找、调用和重启一组插件宿主，包括 Node Worker 与子进程，并在退出时释放它们。',
  utils: '为代码添加超时、取消与错误追踪，并处理常见的数据转换和对象更新。',
  wasm: '分配可复用的字节缓冲区，并在 JSON 与 MessagePack 之间转码。'
} as const satisfies Readonly<Record<string, string>>

/** Architecture-page summaries explain the pain, core capability, and governing design up front. */
const LIBRARY_ARCHITECTURE_LEDES_ZH = {
  supervision:
    '用于应用需要在进程、线程或协程退出、启动失败、健康异常与替换竞态中可靠管理原生执行单元的场景。监督器通过原 launcher/profile 取得真实 handle，用共享 budget 持有 lease，按 readiness 与 generation 控制准入，退出后才归还容量；stop、drain 与强制终止由原适配器执行，缺能力明确报告，不能从平台名伪造强隔离或零资源使用。',
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
  tray: '当应用需要按依赖准备启动资源，或启动、调用和重启插件宿主时使用。静态资源用 createTrayGraph 声明完整 entry 集合，ready() 后读取结果，dispose() 按依赖逆序释放；宿主实例用 defineTrayHost 与 createTray({ hosts }) 管理，可选择 coroutine、Node Worker 或子进程。Tray 复用 RPC 和 supervision 的连接、执行与重启能力，并在停止实例前清理子 PluginHost；跨机器发现、browser Worker 与持久消息不在当前范围。',
  utils:
    '用于多个包共同需要、且不应绑定 Store、DOM 或具体运行时的基础能力，包括取消、并发、错误、集合、对象路径、字节与字符串处理。每个子路径拥有独立契约和错误语义，调用方应按能力导入；它不是无边界的杂物箱。',
  wasm: '用于统一 WebAssembly 模块初始化、实例复用、线性内存分配、JS/WASM 值转换和确定性释放。它把平台加载与内存所有权封装在明确边界内，避免每个消费者重复处理指针、视图失效和清理；没有 WASM 模块时无需使用。',
  'rpc-core':
    '用于进程、Worker、Window 或 MessagePort 两端进行类型安全的双向调用。四个 Peer/Plugin 工厂根据真实 provide/expose 自动生成 v2 目录，复用原连接、鉴权、重放窗口、deadline 与 drain owner；业务不用复制手写消息协议。spawn 拥有执行单元，connect/listen 只借用连接，批量帧接收是握手基线，未支持的可选能力显式拒绝。事务与业务回滚仍由调用方负责。',
  'rpc-contract':
    '用于独立协议实现或自定义载体需要共享 RPC 数据规则的场景。它提供 envelope 校验、握手协商、帧编码与解析、二进制数据准备和错误链转换，使不同实现按同一套 wire 契约交换数据；平台连接与原生执行资源由适配器持有。',
  'rpc-process':
    '用于父子进程或已有进程连接需要双向 RPC 的场景。应用通过 Peer 或 Plugin 共享实际方法，再按平台选择启动器与字节或消息通道；spawn 持有实际执行单元，connect/listen 保留借用连接的边界，关闭和失败清理沿原资源 owner 执行。',
  'rpc-threads':
    '用于把业务方法放入 Worker 或线程执行，同时保留双向调用和原生资源生命周期的场景。适配器取得实际线程 handle 与消息端口，Peer 或 Plugin 共享方法，并通过原监督器处理启动、退出、替换和关闭；平台未提供的能力保持明确不可用。',
  /** The pool architecture page explains which scheduling and native resources each layer owns. */
  'rpc-pool':
    '用于把多个公开线程或进程 Peer 组成有限并发池。池管理客户端调用槽、有限 FIFO、惰性 stream、扩缩容和闲置成员回收；原 Peer 负责原生启动、崩溃恢复与关闭。stats 记录池内派发，失败的业务调用交给调用方处理。',
  'rpc-bridge-jsonrpc':
    '用于与 Python、Go、Rust 等外部语言 peer 进行 JSON-RPC 调用的场景。桥接器使用 Process 提供的实际有序字节通道，完成原握手、帧解析、请求相关与取消规则，并传递有界错误链；业务按已协商的能力调用，不为对端缺失的模式增加隐式降级。',
  'rpc-browser':
    '用于 Window、共享 Worker、ServiceWorker、BroadcastChannel、WebTransport 或 RTCDataChannel 两端需要 RPC 的场景。各适配器持有实际浏览器通道及其监听器，保留来源校验、传输能力与关闭边界；Endpoint 和协议工具由 Core、Contract 复用，应用按实际通道选择适配器。',
  'rpc-devtools':
    '当应用需要追踪 RPC 失败、调用耗时或跨宿主事件时使用。createRpcDevtools 作为 Probe 接入已有宿主，按有界事件环提供查询、统计、录制、暂停与 service；createRpcDevtoolsHub 聚合已有 service client 和离线录制，对齐时钟并关联 timeline 与 interactions。默认只采集元数据，内容捕获必须显式启用；录制使用版本 1 的 NDJSON，错误链复用 RPC Contract，连接与持久化由调用方管理。'
} as const satisfies Readonly<Record<string, string>>

/** README-backed English summaries mirror the same user-facing responsibilities. */
const LIBRARY_REFERENCE_DESCRIPTIONS_EN = {
  capability:
    'Enable or disable optional features, keep tenant feature settings separate, and start and release features in dependency order.',
  'event-subscriber':
    'Subscribe to and broadcast events between local modules and coordinate synchronous or asynchronous listeners.',
  lifecycle:
    'Manage resources within a shared scope and wait for ongoing work and cleanup when shutting down.',
  logger:
    'Send logs to a console or service, filter and format them as needed, and wait for asynchronous output to finish.',
  'middleware-pipeline':
    'Combine processing steps into synchronous, asynchronous, or generator middleware pipelines and stop or cancel processing when needed.',
  'plugin-host':
    'Install and remove plugins for libraries or applications, configure shared features and processing steps, and roll back failed installations.',
  reactive:
    'Update derived values and effects when state changes and keep state separate across contexts.',
  resource:
    'Load asynchronous data as inputs change, cancel stale requests, retry failures, and refresh cached results.',
  'rpc-bridge-jsonrpc':
    'Call child processes or local services implemented in Python, Go, Rust, and other languages through JSON-RPC.',
  'rpc-browser':
    'Call functions across browser windows, iframes, SharedWorkers, and reliable ordered WebRTC channels.',
  'rpc-contract':
    'Validate, encode, and decode messages for custom RPC implementations so peers can communicate through the same protocol.',
  'rpc-core':
    'Call remote functions across runtimes with timeouts, cancellation, and streaming results.',
  'rpc-devtools':
    'Collect, query, and record RPC metadata and inspect timelines and call statistics across hosts.',
  'rpc-pool':
    'Distribute RPC calls across thread or process pools and queue requests within bounded limits when busy.',
  'rpc-process':
    'Run isolated work in child processes or local services and call and manage them through RPC.',
  'rpc-threads':
    'Move heavy computation into Workers and call, manage, and restart threads through RPC.',
  serialize: 'Encode application data for storage or transmission and decode it when reading.',
  'storage-contract':
    'Define common interfaces for key-value and record storage so applications can use different backends.',
  'storage-web':
    'Read and write data in Web Storage, cookies, IndexedDB, and memory through a common interface.',
  'store-devtools':
    'Inspect Store state and action history and use time travel and dependency trees to investigate changes.',
  'store-indexed':
    'Subscribe to keys or indices in objects, arrays, Maps, and Sets so related computations respond to collection updates.',
  'store-keyed':
    'Manage state by business key in separate scopes and subscribe only to the parts you need.',
  'store-light':
    'Manage object state, asynchronous data, and updates so related computations respond to field changes.',
  'store-middleware':
    'Trace Store state and actions, enforce write rules, and connect to Redux DevTools.',
  'store-persist':
    'Automatically save and restore object, keyed, and collection state and migrate saved data when versions change.',
  'store-react':
    'Use Stores, Atoms, and asynchronous resources in React components and manage subscriptions and cleanup.',
  'store-shared':
    'Read and write the same reactive 32-bit integer state from the main thread and Workers.',
  'store-ssr':
    "Keep Stores and Resources separate for each SSR request and restore the server's initial state in the browser.",
  'store-wasm': 'Manage observable numbers, strings, arrays, and records in WASM.',
  'store-worker':
    'Move expensive computation and data encoding and decoding into Workers and use cancellation, deduplication, and caching for requests.',
  supervision:
    'Limit execution units, check their health, restart failures, and manage shutdown within a time budget.',
  tray: 'Start, find, call, and restart plugin hosts, including Node Workers and child processes, and release them on shutdown.',
  utils:
    'Add deadlines, cancellation, and error tracing to code and handle common data conversions and object updates.',
  wasm: 'Allocate reusable byte buffers and transcode between JSON and MessagePack.'
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
  RPC: 'rpc-core'
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
    LIBRARY_REFERENCE_DESCRIPTIONS_EN[slug as keyof typeof LIBRARY_REFERENCE_DESCRIPTIONS_EN] ??
    librarySummaries.find((entry) => entry.slug === slug)?.description
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
    .replace(/\bpackages\b/gi, 'libraries')
    .replace(/\bpackage\b/gi, 'library')
    .split(
      /(`[^`]+`|@migai(?:a)?\/[a-z0-9-]+(?:\/[a-z0-9-]+)*|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b(?:Capability Graph|Lifecycle|PluginHost|Reactive|Resource|Storage Host|Tray|WASM|RPC)\b)/g
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
  if (library === 'rpc-core') return groupWebRpcGuideApiLinks(apiLinks, locale)
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
        ['definePlugin', 'pluginNameFromBackendId', 'reactiveAdapterNameFromBackendId'].includes(
          link.name
        )
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

/** Separates RPC APIs, plugins, specifications, adapters, and errors by public role. */
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
    link.name === 'RPC_CORE_ERROR_SOURCE' ||
    link.name.endsWith('Error') ||
    ['deserializeRpcError', 'isRpcError', 'reachRpcError', 'serializeRpcError'].includes(link.name)
  /** Stable category order matches the decisions developers make while reading. */
  const definitions = [
    {
      key: 'api',
      label: locale === 'zh' ? 'API' : 'APIs',
      matches: (link: IGuideApiLink) =>
        !middlewareNames.has(link.name) &&
        !link.module.startsWith('features/') &&
        !link.module.startsWith('adapters/') &&
        !link.module.startsWith('adapter/') &&
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
      matches: (link: IGuideApiLink) =>
        link.module.startsWith('adapters/') || link.module.startsWith('adapter/')
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
  /** Category links remain one page-owned projection in the sidebar and mobile menu. */
  const pageNavigation = useMemo(
    () => (
      <div className="page-category-navigation">
        <strong>{library.slug}</strong>
        <GuideApiNavigation
          apiLinks={apiLinks}
          library={library.slug}
          locale={locale}
          placement="desktop"
        />
        {guide ? (
          <section className="guide-topic-navigation">
            <h2>{locale === 'zh' ? '任务指南' : 'Task guides'}</h2>
            <nav aria-label={copyFor(locale).taskGuides}>
              {guideTopics.map((entry) => (
                <Link
                  className={`guide-topic-link${entry.topic === topic ? ' active' : ''}`}
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
        ) : null}
      </div>
    ),
    [apiLinks, guide, guide ? journeyTopics : undefined, library.slug, locale, topic]
  )
  usePageNavigation(pageNavigation)
  const article = (
    <article className={guide ? 'article-column' : 'article-column full-article'}>
      <p className="eyebrow">
        {guide ? (locale === 'zh' ? '指南' : 'Guide') : locale === 'zh' ? '架构' : 'Architecture'} ·{' '}
        {library.slug}
      </p>
      <h1>{journey?.title ?? (modulePath ? topic : library.slug)}</h1>
      <p className="lede">
        <InlineText
          library={library.slug}
          locale={locale}
          text={
            journey?.lede ??
            (locale === 'zh'
              ? guide
                ? libraryReferenceDescription(locale, library.slug)
                : (LIBRARY_ARCHITECTURE_LEDES_ZH[
                    library.slug as keyof typeof LIBRARY_ARCHITECTURE_LEDES_ZH
                  ] ?? libraryReferenceDescription(locale, library.slug))
              : guide
                ? libraryReferenceDescription(locale, library.slug)
                : libraryReferenceDescription(locale, library.slug))
          }
        />
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
      ) : null}
      <p className="document-next-step">
        <Link className="text-link" to={docsModulePath(locale, library.slug, 'index')}>
          {locale === 'zh'
            ? `查看 ${library.slug} API 与类型 →`
            : `${library.slug} API reference →`}
        </Link>
      </p>
    </article>
  )
  return (
    <main id="main-content" className="page-shell content-page" lang={locale} data-pagefind-body>
      <Breadcrumb locale={locale} domain={domain} library={library.slug} moduleName={topic} />
      {guide ? (
        <div className="reading-layout">
          {article}
          <div className="left-rail-sticky">
            <ScrollArea className="left-rail">
              <aside className="left-rail-content" aria-label={copyFor(locale).taskGuides}>
                {pageNavigation}
              </aside>
            </ScrollArea>
          </div>
          {guideSections.length ? (
            <details className="page-toc">
              <summary>{copyFor(locale).onPage}</summary>
              <nav aria-label={copyFor(locale).onPage}>
                {guideSections.map((section) => (
                  <a href={`#${section.id}`} key={section.id}>
                    {section.heading}
                  </a>
                ))}
              </nav>
            </details>
          ) : null}
        </div>
      ) : (
        <div className="architecture-reading-layout">
          {article}
          <ScrollArea className="architecture-api-rail">
            <aside className="architecture-api-rail-content">{pageNavigation}</aside>
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
      // Type routes start collapsed; an explicit fragment opens the requested declaration.
      if (!window.location.hash) return
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
      /** Explicit type links reveal the declaration before scrolling to its anchor. */
      const disclosure = target.closest('details')
      if (disclosure) disclosure.open = true
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
            ? '类型参考'
            : 'Type reference'
          : locale === 'zh'
            ? '相关类型'
            : 'Related types'}
      </h2>
      <div className="type-reference-body">
        {symbols.map((symbol) => {
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
                  signature
                />
              ) : null}
            </section>
          )
        })}
      </div>
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
  if (
    /^.+ is part of this module's public (?:type|interface|function|const|class) contract\.$/.test(
      purpose
    )
  )
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
  purpose
}: {
  readonly library: string
  readonly locale: ILocale
  readonly purpose?: string
}) {
  return purpose ? <InlineText library={library} locale={locale} text={purpose} /> : null
}

/** Expands declaration delimiters without changing tokens or the generated signature source. */
function formatTypeSignature(code: string): string {
  /** Strings and comments are indivisible so punctuation inside them cannot change the layout. */
  const tokens =
    code.match(
      /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*|=>|[{}()<>,;]|\s+|[^\s{}()<>,;'"`]+/g
    ) ?? []
  /** Nonempty declaration groups own one indentation level. */
  const groups: string[] = []
  /** Completed lines retain declaration order, including overloads. */
  const lines: string[] = []
  /** Current line accumulates original tokens with normalized whitespace. */
  let line = ''
  /** Emits one line using the indentation of its owning declaration group. */
  const newline = () => {
    if (line.trim()) lines.push(`${'  '.repeat(groups.length)}${line.trim()}`)
    line = ''
  }
  for (let index = 0; index < tokens.length; index++) {
    /** Current token remains unchanged except for whitespace between declaration members. */
    const token = tokens[index]!
    if (/^\s+$/.test(token)) {
      if (line && !line.endsWith(' ')) line += ' '
      continue
    }
    /** Delimiter pair determines whether this group needs separate member lines. */
    const closing = ({ '{': '}', '(': ')', '<': '>' } as Readonly<Record<string, string>>)[token]
    if (closing) {
      /** Empty parameter or generic groups remain compact. */
      const next = tokens.slice(index + 1).find((candidate) => candidate.trim())
      if (next === closing) {
        line += token + closing
        while (tokens[++index] !== closing) {
          /* Skip only whitespace in this empty pair. */
        }
      } else {
        line += token
        newline()
        groups.push(closing)
      }
    } else if (token === groups.at(-1)) {
      newline()
      groups.pop()
      line = token
    } else if (token === ';' || (token === ',' && groups.length > 0)) {
      line = line.trimEnd() + token
      newline()
    } else if (token.startsWith('//')) {
      line += token
      newline()
    } else if (token === '|' || token === '&') {
      newline()
      line = `${token} `
    } else {
      if (line.endsWith(' ') && line.length + token.length > 100) newline()
      line += token
    }
  }
  newline()
  return lines.join('\n')
}

/** Presents source text as a labelled, horizontally scrollable Dracula code surface. */
/** Stable code toolbar labels report clipboard outcomes without changing authored examples. */
const CODE_COPY_LABELS = {
  zh: { ready: '复制', copied: '已复制', failed: '复制失败' },
  en: { ready: 'Copy', copied: 'Copied', failed: 'Copy failed' }
} as const

/** Shows a copyable source file with its authored comments and local scrolling boundary. */
function CodeBlock({
  code,
  commentaryContext,
  explain = false,
  label,
  language = 'typescript',
  locale = 'en',
  signature = false
}: {
  readonly code: string
  readonly commentaryContext?: IExampleCommentaryContext
  readonly explain?: boolean
  readonly label: string
  readonly language?: string
  readonly locale?: ILocale
  readonly signature?: boolean
}) {
  /** Each code surface owns its clipboard result independently. */
  const [copyState, setCopyState] = useState<'ready' | 'copied' | 'failed'>('ready')
  const normalizedLanguage = language.toLowerCase()
  const isTypeScript = ['ts', 'tsx', 'typescript'].includes(normalizedLanguage)
  /** Reader-facing source with each public symbol imported from its narrowest owner. */
  const normalizedCode = isTypeScript ? normalizeExampleImports(code) : code
  /** Type layout changes whitespace only; examples keep their authored comments. */
  const documentedCode =
    signature || commentaryContext?.kind === 'signature'
      ? formatTypeSignature(normalizedCode)
      : normalizedCode
  /** Authored example text is preserved without synthesized annotations. */
  const commentary = explain
    ? commentExample(documentedCode, language, locale, commentaryContext)
    : { code: documentedCode, notes: [] }
  /** Prefer an authored file label; unnamed TypeScript examples are copyable example.ts snippets. */
  const fileLabel =
    code.match(/^\s*\/\/\s*([^\s:：]+\.(?:tsx?|mts|js|mjs|sh))(?:\s|[:：]|$)/m)?.[1] ??
    (signature || commentaryContext?.kind === 'signature'
      ? `${label}.d.ts`
      : isTypeScript
        ? 'example.ts'
        : language)
  /** Copies the exact displayed source; clipboard errors remain visible and reported. */
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(commentary.code)
      setCopyState('copied')
    } catch (error) {
      console.error(error)
      setCopyState('failed')
    }
  }
  return (
    <div
      className={explain ? 'explained-code annotated' : 'explained-code'}
      data-comment-count={explain ? commentary.notes.length : undefined}
    >
      <figure className="code-frame">
        <figcaption className="code-toolbar">
          <span>{isTypeScript ? 'TypeScript' : language}</span>
          <span>
            {fileLabel} · {label}
          </span>
          <Button type="button" variant="quiet" className="code-copy-button" onClick={copyCode}>
            <span aria-live="polite">{CODE_COPY_LABELS[locale][copyState]}</span>
          </Button>
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
            {commentary.notes.flatMap((note, index) =>
              note.split(/(?<=[。！？.!?])\s+/u).map((sentence, part) => (
                <p key={`${index}-${part}`}>
                  <InlineText
                    library={commentaryContext?.library}
                    locale={locale}
                    text={sentence}
                  />
                </p>
              ))
            )}
          </div>
        </aside>
      ) : null}
    </div>
  )
}

/** Tokenizes formatted TypeScript into safe React spans using the Dracula palette. */
function highlightTypeScript(code: string) {
  const keywords = new Set([
    'async',
    'as',
    'await',
    'const',
    'declare',
    'export',
    'extends',
    'false',
    'for',
    'from',
    'function',
    'import',
    'infer',
    'keyof',
    'never',
    'new',
    'null',
    'of',
    'in',
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
  /** Adjacent plain tokens share one text node, avoiding SSR separators between every character. */
  const highlighted: { readonly text: string; readonly className?: string }[] = []
  for (const token of tokens) {
    if (!token) continue
    /** Only semantic tokens need wrappers; punctuation remains readable as ordinary text. */
    let tokenClass: string | undefined
    if (token.startsWith('//') || token.startsWith('/*')) tokenClass = 'syntax-comment'
    else if (/^['"`]/.test(token)) tokenClass = 'syntax-string'
    else if (/^\d/.test(token)) tokenClass = 'syntax-number'
    else if (keywords.has(token)) tokenClass = 'syntax-keyword'
    else if (/^[A-Z]/.test(token)) tokenClass = 'syntax-type'
    /** Plain runs are coalesced without changing the code or highlighted token boundaries. */
    const previous = highlighted.at(-1)
    if (!tokenClass && previous && !previous.className)
      highlighted[highlighted.length - 1] = { text: previous.text + token }
    else highlighted.push({ text: token, className: tokenClass })
  }
  return highlighted.map((token, index) =>
    token.className ? (
      <span className={token.className} key={index}>
        {token.text}
      </span>
    ) : (
      token.text
    )
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
  domain: _domain,
  library
}: {
  locale: ILocale
  domain: IDomain
  library?: string
}) {
  const copy = copyFor(locale)
  return (
    <nav className="next-actions" aria-label={copy.continueReading}>
      <Link to={domainPath(locale, 'docs', library)}>
        {library ? `${library} API` : copy.browseLibraries} →
      </Link>
      <Link to={domainPath(locale, 'guides', library)}>
        {library ? `${library} · ${copy.taskGuides}` : copy.taskGuides} →
      </Link>
      <Link to={domainPath(locale, 'architecture', library)}>
        {library ? `${library} · ${copy.architecture}` : copy.architecture} →
      </Link>
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
    errors: ['Errors', '错误'],
    'related-apis': ['Related APIs', '相关 API'],
    signature: ['Type signature', '类型签名'],
    'core-usage': ['Contract', '参数、返回与边界']
  }
  const label = labels[section]
  return label ? label[locale === 'zh' ? 1 : 0] : localizedSection(locale, section)
}

export default Docs
