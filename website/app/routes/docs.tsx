import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, redirect, useNavigate, type MetaFunction as IMetaFunction } from 'react-router'
import {
  API_SEGMENT,
  README_SEGMENT,
  domainPath,
  guidePath,
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
import type { IGuideApiLink, ILibraryRouteContent } from '../content-loader.js'
import { apiKindLabel, copyFor, domainDescription, domainTitle, interfaceCopyFor } from '../copy.js'
import {
  LIBRARY_INDEX as librarySummaries,
  libraryReferenceDescription
} from '../library-descriptions.js'
import type { IApiGuide } from '../api-guides.js'
import type { IGuideJourney } from '../guide-journeys.js'
import { ScrollArea } from '../components/ui/scroll-area.js'
import { Separator } from '../components/ui/separator.js'
import { Button } from '../components/ui/button.js'
import { usePageNavigation } from '../components/page-navigation.js'
import { normalizeExampleImports } from '../example-imports.js'
import { commentExample, type IExampleCommentaryContext } from '../example-commentary.js'
import type {
  ILocalizedEnhancerDoc,
  ILocalizedMemberDoc,
  ILocalizedReference,
  ILocalizedSymbolDoc,
  ILocalizedTypeDoc,
  ILocalizedValue
} from '../reference/localize.js'
import { essentialApiParts, essentialApis } from '../essential-apis.js'
import {
  callableShape,
  constantMembers,
  instanceSurface,
  resolveFieldDoc,
  returnedInstances,
  type IInstanceSurface
} from '../reference/surface.js'

type IDocsLoaderData = ILibraryRouteContent & {
  readonly apiLinks?: readonly IGuideApiLink[]
  readonly guide?: IApiGuide
  /** Search metadata may use a guide purpose even when the article uses authored reference text. */
  readonly metaPurpose?: string
  readonly journey?: IGuideJourney
  readonly journeyTopics?: readonly { readonly title: string; readonly topic: string }[]
  readonly optionTranslations?: Readonly<Record<string, string>>
  readonly optionFallbacks?: Readonly<Record<string, string>>
  readonly selectedTypeFragment?: string
  /** Authored instance member descriptions for this library in the page locale. */
  readonly reference?: ILocalizedReference
}

type IDocsRouteProps = {
  readonly params: { readonly lang?: string; readonly '*'?: string }
  readonly loaderData: IDocsLoaderData | null
}

/** Loads only the library selected by this route; domain indexes need no API payload. */
export async function loader({ params }: { readonly params: IDocsRouteProps['params'] }) {
  const parts = (params['*'] ?? '').split('/').filter(Boolean)
  const librarySlug = parts[0]
  // The docs index merged into the language home; old `/<locale>/docs` links land there.
  if (!librarySlug) throw redirect(`/${params.lang === 'zh' ? 'zh' : 'en'}`)
  /** Keep manifest and reference registries inside prerendering; the browser receives page data. */
  const [contentModule, referenceModule, localizationModule] = await Promise.all([
    import('../content-loader.js'),
    import('../reference/index.js'),
    import('../reference/localize.js')
  ])
  const { loadLibraryApiLinks, loadLibraryRouteContent } = contentModule
  const { referenceFor } = referenceModule
  const { localizeReference, pageReference } = localizationModule
  /** Route params stay basename-relative, so a sub-path deployment cannot shift the locale segment. */
  const locale = params.lang
  const domain = pageKind(parts)
  const topic = parts.slice(1).join('/') || 'index'
  /** Guide registry stays loader-only so the client route does not ship every tutorial body. */
  const journeyModule = await import('../guide-journeys.js')
  const guideLocale = locale === 'zh' ? 'zh' : 'en'
  const journeyExists =
    domain === 'guides' && Boolean(journeyModule.findGuideJourney(librarySlug, topic, guideLocale))
  /**
   * A package home without a hand-written learning path falls back to the maintained README and
   * usage guide; a home with a learning path shows only that path.
   */
  const packageHome = domain === 'guides' && topic === 'index'
  /** The README page renders only the maintained package README. */
  const readmePage = domain === 'guides' && topic === README_SEGMENT
  const documentation =
    locale !== 'zh'
      ? 'none'
      : readmePage
        ? 'readme'
        : domain === 'docs' || (packageHome && !journeyExists)
          ? 'all'
          : !journeyExists
            ? 'guide'
            : 'none'
  /** Initial index projection supplies every public module path needed for longest-prefix routing. */
  const requestedSegments = domain === 'docs' ? parts.slice(2) : []
  let selectedModule = 'index'
  let selectedSymbolPath: string | undefined
  /** Guide pages also receive the light API index because they share the library sidebar. */
  let content = await loadLibraryRouteContent(librarySlug, {
    documentation,
    includeApiIndex: true,
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
  const apiLinks = await loadLibraryApiLinks(librarySlug)
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
  /** Guide pages only need reader-facing modules for the sidebar; internals stay on API pages. */
  if (domain === 'guides' && content)
    content = {
      ...content,
      library: {
        ...content.library,
        exports: content.library.exports.filter(
          (exportPath) => !/^\.\/(?:internals|node-internals)$/.test(exportPath)
        )
      },
      apis: content.apis.filter((api) => !/^(?:internals|node-internals)$/.test(api.module))
    }
  if (!content) return null
  /** The article's maintained reference owns its visible prose and configuration explanations. */
  const libraryReference = domain === 'docs' ? referenceFor(librarySlug) : undefined
  /** Keep the same two-layer reference projection used by the rendered article. */
  const reference = libraryReference
    ? pageReference(
        localizeReference(libraryReference, guideLocale),
        selectedModule,
        selectedApi?.symbols ?? [],
        [selectedSymbol?.name, selectedType?.name].filter(
          (name): name is string => name !== undefined
        ),
        content.apis.flatMap((entry) => entry.symbols)
      )
    : undefined
  /** Audited symbols never render fallback guides or the fallback field translation tables. */
  const hasAuthoredSymbol = Boolean(
    selectedSymbol && symbolDocFor(reference, selectedModule, selectedSymbol.name)
  )
  return {
    ...content,
    apiLinks,
    guide: hasAuthoredSymbol ? undefined : guide,
    metaPurpose: hasAuthoredSymbol ? guide?.purpose : undefined,
    journey: journeyExists
      ? journeyModule.findGuideJourney(librarySlug, topic, guideLocale)
      : undefined,
    journeyTopics: journeyModule.listGuideJourneys(librarySlug, guideLocale),
    optionTranslations: hasAuthoredSymbol ? undefined : optionTranslations,
    optionFallbacks: hasAuthoredSymbol ? undefined : optionFallbacks,
    selectedTypeFragment: selectedType?.fragment,
    // Runtime articles never render the module overview; module and type routes still need it.
    reference: selectedSymbol && reference ? { ...reference, modules: {} } : reference
  }
}

/** Uses the visible page purpose and canonical API identity for localized search metadata. */
export const meta: IMetaFunction<typeof loader> = ({ loaderData: data, params }) => {
  /** Locale determines prose, while package and API names stay identical in both languages. */
  const locale = params.lang === 'zh' ? 'zh' : 'en'
  /** Public subpath identifies the selected API without exposing the root entry filename. */
  const parts = (params['*'] ?? '').split('/').filter(Boolean)
  /** Page kind is shared with the route's rendered page. */
  const domain = pageKind(parts)
  /** Loader supplies exactly the selected library's content and maintained purpose. */
  const library = data?.library
  if (!library)
    return [
      // The library-less route is the docs home, whatever the path classifier says.
      { title: `${domainTitle(locale, 'docs')} · migaia` },
      { name: 'description', content: domainDescription(locale, 'docs') }
    ]
  /** Resolve nested modules before interpreting the final segment as an API name. */
  const selection = resolveDocsSelection(parts.slice(2), data.apis)
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
      : (data.journey?.title ??
        (parts[1] === README_SEGMENT
          ? `${library.slug} ${readmeTitle(locale)}`
          : parts.slice(1).join('/') || library.slug))
  /** Existing maintained ledes remain the source of search descriptions. */
  const purpose =
    domain === 'docs'
      ? symbol
        ? (data.metaPurpose ??
          data.guide?.purpose ??
          localizedSymbolPurpose(locale, symbol) ??
          libraryReferenceDescription(locale, library.slug))
        : libraryReferenceDescription(locale, library.slug)
      : (data.journey?.lede ?? libraryReferenceDescription(locale, library.slug))
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
  const parts = (params['*'] ?? '').split('/').filter(Boolean)
  const domain = pageKind(parts)
  const librarySlug = parts.shift()
  const library = loaderData?.library
  const libraryApis = loaderData?.apis ?? []
  /** API pages drop the `api` segment; guide pages keep their topic path. */
  const modulePath =
    domain === 'docs' ? parts.slice(1).join('/') || 'index' : parts.join('/') || undefined
  if (librarySlug && !library) return <NotFound locale={locale} domain={domain} />
  if (!library) return <NotFound locale={locale} domain={domain} />
  if (domain === 'docs' && parts[1] === 'index') return <NotFound locale={locale} domain={domain} />
  if (domain === 'docs')
    return (
      <DocsLibrary
        guide={loaderData?.guide}
        locale={locale}
        library={library}
        apiLinks={loaderData?.apiLinks ?? []}
        journeyTopics={loaderData?.journeyTopics ?? []}
        libraryApis={libraryApis}
        modulePath={modulePath}
        optionTranslations={loaderData?.optionTranslations}
        optionFallbacks={loaderData?.optionFallbacks}
        selectedTypeFragment={loaderData?.selectedTypeFragment}
        reference={loaderData?.reference}
      />
    )
  return (
    <DomainLibrary
      locale={locale}
      library={library}
      apiLinks={loaderData?.apiLinks ?? []}
      libraryApis={libraryApis}
      modulePath={modulePath}
      journey={loaderData?.journey}
      journeyTopics={loaderData?.journeyTopics ?? []}
    />
  )
}

/** Reader-facing name of the README page. */
function readmeTitle(locale: ILocale): string {
  return locale === 'zh' ? '包说明（README）' : 'Package README'
}

/**
 * Classifies a library path: `<library>/api/...` is API reference (`docs`); every other library
 * path, including the library root, is a learning-path or guide topic (`guides`).
 */
function pageKind(parts: readonly string[]): IDomain {
  return parts[1] === API_SEGMENT ? 'docs' : 'guides'
}

/** Builds a public docs path without leaking the repository root entry name. */
function docsModulePath(
  locale: ILocale,
  library: string,
  moduleName: string,
  symbol?: string
): string {
  const moduleSegment = moduleName === 'index' ? '' : `/${moduleName}`
  return `/${locale}/docs/${library}/${API_SEGMENT}${moduleSegment}${symbol ? `/${symbol}` : ''}`
}

/** Renders a library documentation root and its source-backed module map. */
function DocsLibrary({
  apiLinks,
  guide,
  journeyTopics,
  locale,
  library,
  libraryApis,
  modulePath,
  optionTranslations,
  optionFallbacks,
  selectedTypeFragment,
  reference
}: {
  apiLinks: readonly IGuideApiLink[]
  guide?: IApiGuide
  journeyTopics: readonly { readonly title: string; readonly topic: string }[]
  locale: ILocale
  library: ILibrary
  libraryApis: readonly IApi[]
  modulePath?: string
  optionTranslations?: Readonly<Record<string, string>>
  optionFallbacks?: Readonly<Record<string, string>>
  selectedTypeFragment?: string
  reference?: ILocalizedReference
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
      <LibraryNavigation
        api={api}
        apiLinks={apiLinks}
        journeyTopics={journeyTopics}
        libraryApis={libraryApis}
        librarySlug={library.slug}
        locale={locale}
        selectedSymbol={selectedSymbol}
      />
    ),
    [api, apiLinks, journeyTopics, library.slug, libraryApis, locale, selectedSymbol]
  )
  usePageNavigation(pageNavigation)
  if (!moduleName || moduleName === 'overview')
    return (
      <main id="main-content" className="page-shell content-page" lang={locale} data-pagefind-body>
        <div className="reading-layout">
          <article className="article-column">
            <Breadcrumb locale={locale} domain="docs" library={library.slug} />
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
            <NextActions locale={locale} domain="docs" library={library.slug} />
          </article>
          <div className="left-rail-sticky">
            <ScrollArea className="left-rail">
              <aside className="left-rail-content" aria-label={copy.libraryModules}>
                {pageNavigation}
              </aside>
            </ScrollArea>
          </div>
        </div>
      </main>
    )
  const selectedGuide = selectedSymbol ? guide : undefined
  /** Public label keeps repository entry filenames out of reader-facing copy. */
  const visibleModuleName = readerFacingModuleName(locale, moduleName)
  /** Exact section inventory shared by the desktop and mobile tables of contents. */
  const onPageSections = selectedSymbol
    ? referenceSections(selectedSymbol, api!, libraryApis, reference, selectedGuide)
    : api
      ? moduleReferenceSections(library.documentation, api, reference)
      : []
  return (
    <main id="main-content" className="page-shell content-page" lang={locale} data-pagefind-body>
      <div className="reading-layout">
        <article className="article-column">
          <Breadcrumb
            locale={locale}
            domain="docs"
            library={library.slug}
            moduleName={selectedSymbol?.name ?? (moduleName === 'index' ? undefined : moduleName)}
          />
          {selectedSymbol ? (
            <p className="eyebrow api-eyebrow">
              <span className="kind-badge" data-kind={selectedSymbol.kind}>
                {apiKindLabel(locale, selectedSymbol.kind)}
              </span>
              <span>
                {library.slug}
                {moduleName === 'index' ? '' : ` / ${moduleName}`}
              </span>
            </p>
          ) : (
            <p className="eyebrow">
              {locale === 'zh' ? '模块' : 'Module'} · {library.slug}
            </p>
          )}
          <h1 className={selectedSymbol ? 'api-title' : undefined}>
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
              reference={reference}
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
              reference={reference}
              selectedTypeFragment={selectedTypeFragment}
            />
          ) : (
            <EmptyState locale={locale} library={library.slug} />
          )}
          <NextActions locale={locale} domain="docs" library={library.slug} />
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
    </main>
  )
}

/**
 * Renders the one library sidebar shared by guide and API pages: guide topics first, then the API
 * tree whose leaves open each API's detail page (signature, parameters, examples).
 */
function LibraryNavigation({
  activeTopic,
  api,
  apiLinks,
  journeyTopics,
  libraryApis,
  librarySlug,
  locale,
  selectedSymbol
}: {
  readonly activeTopic?: string
  readonly api: IApi | undefined
  readonly apiLinks: readonly IGuideApiLink[]
  readonly journeyTopics: readonly { readonly title: string; readonly topic: string }[]
  readonly libraryApis: readonly IApi[]
  readonly librarySlug: string
  readonly locale: ILocale
  readonly selectedSymbol: IApiSymbol | undefined
}) {
  return (
    <nav aria-label={copyFor(locale).libraryModules}>
      <strong>{librarySlug}</strong>
      {journeyTopics.length > 0 ? (
        <div className="left-rail-group left-rail-primary">
          <span>{locale === 'zh' ? '指南' : 'Guides'}</span>
          <div className="left-rail-children">
            {journeyTopics.map((entry) => (
              <Link
                className={entry.topic === activeTopic ? 'active' : ''}
                key={entry.topic}
                to={guidePath(locale, librarySlug, entry.topic)}
              >
                {entry.title}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <div className="left-rail-group left-rail-primary">
        <Link
          className={api?.module === 'index' && !selectedSymbol ? 'active' : ''}
          to={docsModulePath(locale, librarySlug, 'index')}
        >
          {locale === 'zh' ? 'API 参考' : 'API reference'}
        </Link>
        {/* Maintained READMEs are Chinese only, so the English rail does not link an empty page. */}
        {locale === 'zh' ? (
          <Link
            className={activeTopic === README_SEGMENT ? 'active' : ''}
            to={guidePath(locale, librarySlug, README_SEGMENT)}
          >
            {readmeTitle(locale)}
          </Link>
        ) : null}
      </div>
      <LibraryModuleLinks
        api={api}
        apiLinks={apiLinks}
        libraryApis={libraryApis}
        librarySlug={librarySlug}
        locale={locale}
        selectedSymbol={selectedSymbol}
      />
    </nav>
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
  /** Curated entry points listed before the complete inventory; see `essential-apis.ts`. */
  const essentialLinks = (essentialApis[librarySlug] ?? []).flatMap((entry) => {
    const { module, name } = essentialApiParts(entry)
    /** The navigation projection supplies the entry's kind marker and stable route segment. */
    const link = apiLinks.find(
      (candidate) => candidate.module === module && candidate.name === name
    )
    return link ? [link] : []
  })
  /** A library with a curated first group folds its complete inventory into one disclosure. */
  const tiered = essentialLinks.length > 0 || primaryEntries.length > 0
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
      {rpcContractScenarioLinks.length > 0 ? (
        <div className="left-rail-group left-rail-primary">
          <span>{locale === 'zh' ? '场景应用' : 'Real-world scenarios'}</span>
          <div className="left-rail-children">
            <Link to={guidePath(locale, 'rpc-contract', 'real-world-bindings')}>
              {locale === 'zh' ? '同一 Contract 的完整数据流' : 'One Contract, complete data flow'}
            </Link>
            {rpcContractScenarioLinks.map(([labelZh, labelEn, anchor]) => (
              <Link
                key={labelEn}
                to={guidePath(locale, 'rpc-contract', anchor.replace('bindings-', ''))}
              >
                {locale === 'zh' ? labelZh : labelEn}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {essentialLinks.length > 0 ? (
        <div className="left-rail-group left-rail-primary left-rail-essentials">
          <span>{locale === 'zh' ? '常用 API' : 'Essentials'}</span>
          <div className="left-rail-children">
            {essentialLinks.map((link) => (
              <Link
                className={
                  link.module === api?.module && link.name === selectedSymbol?.name ? 'active' : ''
                }
                data-kind={link.kind}
                key={`${link.module}:${link.symbolPath}`}
                to={docsModulePath(locale, librarySlug, link.module, link.symbolPath)}
              >
                {link.name}
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
              <Link
                data-kind={apiLinks.find((link) => link.name === symbol)?.kind}
                key={label}
                to={docsModulePath(locale, librarySlug, moduleName, symbol)}
              >
                {label}
              </Link>
            ))}
          </div>
          <Link to={guidePath(locale, 'rpc-core', 'endpoint-composition')}>
            {locale === 'zh' ? '如何选择 Endpoint →' : 'How to choose an Endpoint →'}
          </Link>
          <Link to={guidePath(locale, 'rpc-core', 'transports-and-security')}>
            {locale === 'zh' ? 'Transport 选择与完整案例' : 'Transport selection and examples'}
          </Link>
        </div>
      ) : null}
      <RailInventory
        enabled={tiered}
        label={locale === 'zh' ? '全部 API' : 'All APIs'}
        count={apiLinks.length}
      >
        {storageWebGroups.map((group) => (
          <div className="left-rail-group" key={group.key}>
            <span>{group.label}</span>
            <div className="left-rail-children">
              {group.links.map((link) => (
                <Link
                  className={link.name === selectedSymbol?.name ? 'active' : ''}
                  data-kind={link.kind}
                  key={link.symbolPath}
                  to={docsModulePath(locale, librarySlug, link.module, link.symbolPath)}
                >
                  {link.name}
                </Link>
              ))}
            </div>
          </div>
        ))}
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
                      data-kind={link.kind}
                      key={link.symbolPath}
                      to={docsModulePath(locale, librarySlug, link.module, link.symbolPath)}
                    >
                      {link.name}
                    </Link>
                  ))}
                {librarySlug === 'logger' && candidate.module === 'plugins' ? (
                  <Link to={guidePath(locale, 'logger', 'custom-plugin')}>
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
                  data-kind={link.kind}
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
                  /**
                   * The module landing link is redundant when its only API has the same reader
                   * label.
                   */
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
                          data-kind={link.kind}
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
      </RailInventory>
    </>
  )
}

/**
 * Folds a library's complete API inventory under one disclosure once a curated first group exists.
 * Server markup is identical on every page (always closed) so the rail stays stable; after
 * hydration the disclosure opens when it holds the active page's link.
 */
function RailInventory({
  children,
  count,
  enabled,
  label
}: {
  readonly children: React.ReactNode
  /** Number of API links inside, shown beside the label. */
  readonly count: number
  /** False keeps the flat rail for small libraries without a curated group. */
  readonly enabled: boolean
  readonly label: string
}) {
  /** Disclosure element whose open state follows the active link after hydration. */
  const disclosureRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (disclosureRef.current?.querySelector('a.active')) disclosureRef.current.open = true
  })
  if (!enabled) return <>{children}</>
  return (
    <details className="left-rail-inventory" ref={disclosureRef}>
      <summary>
        {label}
        <small>{count}</small>
      </summary>
      {children}
    </details>
  )
}

/** Viewport width (px) from which the section outline sits beside the article, always open. */
const WIDE_OUTLINE_QUERY = '(min-width: 1280px)'

/**
 * Keeps an outline in sync with reading position: the link whose section most recently crossed the
 * upper reading line gets `.active` / `aria-current`, and URL fragments still win on direct loads.
 * On wide screens it also opens the enclosing `details.page-toc`, which is server-rendered closed
 * so narrow layouts keep it compact below the article.
 */
function useScrollSpy(railRef: React.RefObject<HTMLElement | null>, resetKey?: string) {
  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const disclosure = rail.closest('details')
    const wide = window.matchMedia(WIDE_OUTLINE_QUERY)
    /** Opens the outline beside the article; narrow layouts keep the reader's own toggle state. */
    const syncDisclosure = () => {
      if (disclosure && wide.matches) disclosure.open = true
    }
    syncDisclosure()
    wide.addEventListener('change', syncDisclosure)
    const anchors = Array.from(rail.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))
    /** Marks exactly one outline entry as the current location. */
    const mark = (href: string | undefined) => {
      for (const anchor of anchors) {
        const current = anchor.getAttribute('href') === href
        anchor.classList.toggle('active', current)
        if (current) anchor.setAttribute('aria-current', 'location')
        else anchor.removeAttribute('aria-current')
      }
    }
    const targets = anchors.flatMap((anchor) => {
      const id = decodeURIComponent(anchor.getAttribute('href')!.slice(1))
      const element = document.getElementById(id)
      return element ? [{ element, href: `#${id}` }] : []
    })
    /** Section tops above this line count as "read"; matches the sticky header plus breathing room. */
    const observer = new IntersectionObserver(
      () => {
        const line = 120
        let current: string | undefined = targets[0]?.href
        for (const target of targets)
          if (target.element.getBoundingClientRect().top <= line) current = target.href
        mark(current)
      },
      { rootMargin: '-96px 0px -55% 0px', threshold: [0, 1] }
    )
    for (const target of targets) observer.observe(target.element)
    /** Fragment navigation marks its own entry immediately. */
    const onHash = () => mark(window.location.hash || targets[0]?.href)
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => {
      observer.disconnect()
      wide.removeEventListener('change', syncDisclosure)
      window.removeEventListener('hashchange', onHash)
    }
  }, [railRef, resetKey])
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
  useScrollSpy(railRef, symbol?.fragment)
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
  api: IApi,
  reference?: ILocalizedReference
): readonly string[] {
  return [
    ...(reference
      ? reference.modules[api.module]
        ? ['module-overview']
        : []
      : packageLearningSections(documentation, api).map(({ kind }) => `learning-${kind}`)),
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
    'module-overview': ['Module overview', '模块说明'],
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
  symbol: IApiSymbol,
  api: IApi,
  libraryApis: readonly IApi[],
  reference?: ILocalizedReference,
  guide?: IApiGuide
): string[] {
  /** The outline uses the same projected declarations and visible instance content as the article. */
  const symbols = [...api.symbols, ...libraryApis.flatMap((entry) => entry.symbols)]
  const { ownSurface, instances, scenarios, symbolDoc } = referenceInstanceContent(
    symbol,
    api.module,
    symbols,
    reference
  )
  /** Authored enum details and installed capabilities each own one visible section. */
  const hasValueGuide = Boolean(
    reference?.enums[`${api.module}:${symbol.name}`] ?? reference?.enums[symbol.name]
  )
  /** An authored enhancer renders its own installation section. */
  const hasInstalledCapabilities = Boolean(reference?.enhancers[symbol.name])
  /** Audited pages derive their inventory from the reference doc alone. */
  if (symbolDoc)
    return [
      'overview',
      ...(symbolDoc.example ? ['quick-start'] : []),
      ...(Object.keys(symbolDoc.params).length > 0 || symbolDoc.returns ? ['contract'] : []),
      ...(constantMembers(symbol).length > 0 || hasValueGuide ? ['values'] : []),
      ...(symbol.configuration.length > 0 || Object.keys(symbolDoc.options).length > 0
        ? ['configuration']
        : []),
      ...(hasInstalledCapabilities ? ['installed'] : []),
      ...(ownSurface ? ['members'] : []),
      ...(instances.length > 0 ? ['instance'] : []),
      ...(scenarios.length > 0 || symbolDoc.avoid.length > 0 ? ['scenarios'] : []),
      'related-apis',
      'signature'
    ]
  return [
    'overview',
    ...(primaryExample(guide, symbol, api.library) ? ['quick-start'] : []),
    ...(hasInstalledCapabilities ? ['installed'] : []),
    ...(constantMembers(symbol).length > 0 ? ['values'] : []),
    ...(symbol.configuration.length > 0 || guide?.options.length ? ['configuration'] : []),
    ...(ownSurface ? ['members'] : []),
    ...(instances.length > 0 ? ['instance'] : []),
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
  reference,
  selectedTypeFragment
}: {
  readonly locale: ILocale
  readonly library: ILibrary
  readonly libraryApis: readonly IApi[]
  readonly api: IApi
  readonly reference?: ILocalizedReference
  readonly selectedTypeFragment?: string
}) {
  /** A type route documents that type's instance surface before the module overview. */
  const selectedType = selectedTypeFragment
    ? api.symbols.find((symbol) => symbol.fragment === selectedTypeFragment)
    : undefined
  /** Already-projected sibling declarations supply inherited and composed public members. */
  const surfaceSymbols = [...api.symbols, ...libraryApis.flatMap((entry) => entry.symbols)]
  /** Resolved members of the selected type, merged across the types it composes. */
  const selectedSurface = selectedType ? instanceSurface(selectedType, surfaceSymbols) : undefined
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
    const rawPurpose = reference
      ? (symbolDocFor(reference, api.module, symbol.name)?.purpose ??
        instanceGuideFor(reference, api.module, symbol.name)?.summary)
      : localizedSymbolPurpose(locale, symbol)
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
      {selectedType && selectedSurface ? (
        <ClassMemberReference
          api={api}
          bases={selectedSurface.bases}
          libraryApis={libraryApis}
          locale={locale}
          guide={surfaceGuideFor(reference, api.module, selectedType, surfaceSymbols)}
          memberDoc={memberDocResolver(reference, api.module, selectedSurface.owners)}
          members={selectedSurface.members}
          strict={Boolean(reference)}
          symbol={selectedType}
        />
      ) : null}
      {reference ? (
        reference.modules[api.module] ? (
          <section className="section-block compact module-reference" id="module-overview">
            <ReferenceParagraphs
              library={api.library}
              locale={locale}
              text={reference.modules[api.module]!.summary}
            />
            {reference.modules[api.module]!.example ? (
              <CodeBlock
                code={reference.modules[api.module]!.example!}
                label={readerFacingModuleName(locale, api.module)}
                locale={locale}
              />
            ) : null}
          </section>
        ) : null
      ) : (
        <ModuleGuidance locale={locale} library={library} api={api} />
      )}
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
/**
 * Removes `/** … *\/` source comments from a declaration or type text. Those comments are English
 * source notes; reader-facing prose comes from the localized reference, so leaving them inside a
 * type cell or member signature would put untranslated sentences on Chinese pages.
 */
function withoutDocComments(text: string): string {
  return text.replace(/\/\*\*[\s\S]*?\*\/\s*/g, '')
}

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
      {withoutDocComments(value)
        .split(/([A-Za-z_$][\w$]*)/u)
        .map((part, index) => {
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

/** Resolves a declaration's actual module before constructing its collision-aware public route. */
function symbolReferencePath(
  locale: ILocale,
  api: IApi,
  libraryApis: readonly IApi[],
  symbol: IApiSymbol
): string {
  /** Fragment identity distinguishes same-named declarations exported by different modules. */
  const owner =
    [api, ...libraryApis].find((candidate) =>
      candidate.symbols.some((entry) => entry.fragment === symbol.fragment)
    ) ?? api
  return docsModulePath(locale, api.library, owner.module, symbolSlug(symbol, owner.symbols))
}

/** Reader-facing label for each enhancer kind. */
const enhancerKindLabels: Readonly<
  Record<ILocalizedEnhancerDoc['kind'], readonly [string, string]>
> = {
  plugin: ['Plugin', '插件'],
  host: ['Host definition', 'Host 定义'],
  field: ['Store field', 'Store 字段'],
  middleware: ['Middleware', '中间件'],
  feature: ['Feature', 'Feature'],
  transport: ['Transport', 'Transport'],
  adapter: ['Adapter', '适配器'],
  policy: ['Policy', '策略']
}

/**
 * Renders what a host gains after an enhancer is installed: the install snippet, every granted API
 * with its parameters, result, when-to-use note and snippet, behavior changes of existing host
 * APIs, scenarios, and an end-to-end example.
 */
function InstalledCapabilities({
  api,
  guide,
  libraryApis,
  locale,
  memberDocs,
  purpose,
  shownExample,
  symbol
}: {
  readonly api: IApi
  readonly guide: ILocalizedEnhancerDoc
  readonly libraryApis: readonly IApi[]
  readonly locale: ILocale
  /** Returned instance methods own shared descriptions that enhancer grants reference. */
  readonly memberDocs: Readonly<Record<string, ILocalizedMemberDoc>>
  /** The overview already owns this description when the enhancer reuses it verbatim. */
  readonly purpose: string
  /** Complete primary program already rendered above this section. */
  readonly shownExample?: string
  readonly symbol: IApiSymbol
}) {
  /** Locale index into the bilingual label tuples. */
  const labelIndex = locale === 'zh' ? 1 : 0
  /** Behavior copied from the API overview is already explained before installation. */
  const behaviors = guide.behaviors.filter((behavior) => !sameProseIncluded(purpose, behavior))
  return (
    <section
      className="section-block compact installed-capabilities"
      id={`${symbol.fragment}--installed`}
    >
      <p className="eyebrow">
        {enhancerKindLabels[guide.kind][labelIndex]}
        {' → '}
        <TypeExpression api={api} libraryApis={libraryApis} locale={locale} value={guide.target} />
      </p>
      <h2>{locale === 'zh' ? '安装后能力' : 'After installation'}</h2>
      {!sameProseIncluded(purpose, guide.summary) ? (
        <ReferenceParagraphs library={api.library} locale={locale} text={guide.summary} />
      ) : null}
      {guide.install !== shownExample ? (
        <CodeBlock
          code={guide.install}
          label={locale === 'zh' ? `安装 ${symbol.name}` : `Install ${symbol.name}`}
          locale={locale}
        />
      ) : null}
      {guide.grants.length > 0 ? (
        <>
          <h3>{locale === 'zh' ? '新增 API' : 'Added APIs'}</h3>
          <div className="option-reference class-member-reference">
            {guide.grants.map((grant, index) => (
              <section
                className="option-entry class-member-entry"
                id={`${symbol.fragment}--installed-${optionAnchor(grant.signature)}-${index + 1}`}
                key={`${grant.signature}:${index}`}
              >
                <div className="option-heading">
                  <h4>
                    <code>{grant.signature}</code>
                  </h4>
                </div>
                {!sameProseIncluded(
                  memberDocs[grant.signature.match(/\.([\w$]+)(?:\(|$)/u)?.[1] ?? '']?.summary ??
                    '',
                  grant.summary
                ) ? (
                  <ReferenceParagraphs library={api.library} locale={locale} text={grant.summary} />
                ) : null}
                <ReferenceMemberDetails
                  api={api}
                  doc={grant}
                  libraryApis={libraryApis}
                  locale={locale}
                  name={grant.signature}
                />
              </section>
            ))}
          </div>
        </>
      ) : null}
      {behaviors.length > 0 ? (
        <>
          <h3>{locale === 'zh' ? '对已有 API 的影响' : 'Changes to existing APIs'}</h3>
          <ul>
            {behaviors.map((behavior) => (
              <li key={behavior}>
                <InlineText library={api.library} locale={locale} text={behavior} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {guide.scenarios.length > 0 ? (
        <>
          <h3>{locale === 'zh' ? '应用场景' : 'Use cases'}</h3>
          <ul>
            {guide.scenarios.map((scenario) => (
              <li key={scenario}>
                <InlineText library={api.library} locale={locale} text={scenario} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {guide.example !== shownExample && guide.example !== guide.install ? (
        <CodeBlock
          code={guide.example}
          label={locale === 'zh' ? `${symbol.name} 完整示例` : `${symbol.name} end-to-end example`}
          locale={locale}
        />
      ) : null}
    </section>
  )
}

/**
 * Renders every public instance method and property of one instance surface: a class, an
 * object-shaped type, or the result type a factory returns. For an audited library every sentence
 * comes from its reference (`memberDoc`); declaration comments are never shown in their place, so a
 * Chinese page carries no English fallback. Other libraries keep the declaration comment.
 */
function ClassMemberReference({
  api,
  bases = [],
  heading,
  id,
  libraryApis,
  locale,
  guide,
  memberDoc,
  members,
  strict = false,
  symbol
}: {
  readonly api: IApi
  /** Composed types whose members could not be resolved on this page; shown as links. */
  readonly bases?: readonly string[]
  /** Section heading; defaults to the generic instance API title. */
  readonly heading?: React.ReactNode
  /** Section anchor; defaults to `<fragment>--members`. */
  readonly id?: string
  readonly libraryApis: readonly IApi[]
  readonly locale: ILocale
  /** Reference doc of the instance type, when the library is audited. */
  readonly guide?: ILocalizedTypeDoc
  /** Resolves the reference doc of one member across the surface's composed types. */
  readonly memberDoc?: (name: string) => ILocalizedMemberDoc | undefined
  readonly members: readonly IApiMember[]
  /** True for audited libraries: never substitute declaration comments for reference text. */
  readonly strict?: boolean
  readonly symbol: IApiSymbol
}) {
  if (members.length === 0 && bases.length === 0 && !guide) return null
  /** Section anchor shared by the outline and member entry ids. */
  const sectionId = id ?? `${symbol.fragment}--members`
  /** Locale labels used by every member entry. */
  const label = (en: string, zh: string) => (locale === 'zh' ? zh : en)
  return (
    <section className="section-block compact api-class-members" id={sectionId}>
      <p className="eyebrow">{label('Instance capabilities', '实例能力')}</p>
      <h2>{heading ?? label('Instance API', '实例 API')}</h2>
      {guide ? (
        <div className="instance-guide">
          <ReferenceParagraphs library={api.library} locale={locale} text={guide.summary} />
          {guide.scenarios.length > 0 ? (
            <>
              <h3>{label('Use cases', '应用场景')}</h3>
              <ul>
                {guide.scenarios.map((scenario) => (
                  <li key={scenario}>
                    <InlineText library={api.library} locale={locale} text={scenario} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {guide.example ? (
            <CodeBlock
              code={guide.example}
              label={label(`${symbol.name} usage example`, `${symbol.name} 用法示例`)}
              locale={locale}
            />
          ) : null}
        </div>
      ) : null}
      {bases.length > 0 ? (
        <p className="instance-bases">
          {label('Also includes every member of: ', '同时具备以下类型的全部能力：')}
          {bases.map((base, index) => (
            <Fragment key={base}>
              {index > 0 ? ', ' : null}
              <TypeExpression api={api} libraryApis={libraryApis} locale={locale} value={base} />
            </Fragment>
          ))}
        </p>
      ) : null}
      <div className="option-reference class-member-reference">
        {members.map((member, index) => {
          /** Reference doc for this member; overloads share it. */
          const doc = memberDoc?.(member.name) ?? guide?.members[member.name]
          /** Usage notes and the snippet render once, on the first overload. */
          const firstOverload =
            members.findIndex((candidate) => candidate.name === member.name) === index
          /** Reference text, or the declaration comment only outside audited libraries. */
          const description = firstOverload
            ? (doc?.summary ?? (strict ? undefined : (member.description ?? undefined)))
            : undefined
          return (
            <section
              className="option-entry class-member-entry"
              id={`${id ? `${id}-` : `${symbol.fragment}--member-`}${optionAnchor(member.name)}-${index + 1}`}
              key={`${member.signature}:${index}`}
            >
              <div className="option-heading">
                <h3>
                  <code>{member.name}</code>
                </h3>
                <span className="option-requirement">
                  {member.kind === 'method'
                    ? label('Method', '方法')
                    : member.kind === 'property'
                      ? label('Property', '属性')
                      : member.kind}
                </span>
              </div>
              {description ? (
                <ReferenceParagraphs library={api.library} locale={locale} text={description} />
              ) : null}
              <CodeBlock
                code={withoutDocComments(member.signature)}
                signature
                label={label(`${member.name} signature`, `${member.name} 签名`)}
                locale={locale}
              />
              <ReferenceMemberDetails
                api={api}
                doc={doc}
                libraryApis={libraryApis}
                locale={locale}
                method={member.kind === 'method'}
                name={member.name}
                parameters={member.parameterDetails}
                resultType={member.returns}
                showUsage={firstOverload}
              />
            </section>
          )
        })}
        {Object.entries(guide?.members ?? {})
          .filter(([name]) => !members.some((member) => member.name === name))
          .map(([name, doc]) => (
            <section
              className="option-entry class-member-entry"
              id={`${sectionId}--documented-${optionAnchor(name)}`}
              key={name}
            >
              <div className="option-heading">
                <h3>
                  <code>{name}</code>
                </h3>
              </div>
              <ReferenceParagraphs library={api.library} locale={locale} text={doc.summary} />
              <ReferenceMemberDetails
                api={api}
                doc={doc}
                libraryApis={libraryApis}
                locale={locale}
                name={name}
              />
            </section>
          ))}
      </div>
    </section>
  )
}

/**
 * Renders the authored contract of a method, callback, options field or nested member. Declaration
 * metadata supplies types when available; reference-only paths keep their exact prose without
 * fabricating a signature or a parameter type for an unresolved composed surface.
 */
function ReferenceMemberDetails({
  api,
  doc,
  libraryApis,
  locale,
  method = false,
  name,
  parameters = [],
  resultType,
  showDefault = true,
  showValues = true,
  showUsage = true
}: {
  readonly api: IApi
  readonly doc?: ILocalizedMemberDoc
  readonly libraryApis: readonly IApi[]
  readonly locale: ILocale
  readonly method?: boolean
  readonly name: string
  readonly parameters?: IApiMember['parameterDetails']
  readonly resultType?: string
  readonly showDefault?: boolean
  readonly showValues?: boolean
  readonly showUsage?: boolean
}) {
  /** Declared names keep their order; authored callback arguments remain visible without types. */
  const parameterNames = Array.from(
    new Set([...parameters.map((parameter) => parameter.name), ...Object.keys(doc?.params ?? {})])
  )
  /** Localized labels shared by every member-contract panel. */
  const label = (en: string, zh: string) => (locale === 'zh' ? zh : en)
  return (
    <>
      <dl className="option-meta class-member-meta">
        {method || parameterNames.length > 0 ? (
          <div>
            <dt>{label('Parameters', '参数')}</dt>
            <dd>
              {parameterNames.length === 0 ? (
                label('None', '无')
              ) : (
                <ul className="member-parameters">
                  {parameterNames.map((parameterName) => {
                    /** Optionality and exact type come only from an extracted declaration. */
                    const parameter = parameters.find((entry) => entry.name === parameterName)
                    return (
                      <li key={parameterName}>
                        <code>
                          {parameterName}
                          {parameter?.optional ? '?' : ''}
                        </code>
                        {parameter ? (
                          <>
                            {': '}
                            <TypeExpression
                              api={api}
                              libraryApis={libraryApis}
                              locale={locale}
                              value={parameter.type}
                            />
                          </>
                        ) : null}
                        {doc?.params[parameterName] ? (
                          <>
                            {' — '}
                            <InlineText
                              library={api.library}
                              locale={locale}
                              text={doc.params[parameterName]!}
                            />
                          </>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </dd>
          </div>
        ) : null}
        {resultType || doc?.returns ? (
          <div>
            <dt>{resultType && !method ? label('Type', '类型') : label('Returns', '返回')}</dt>
            <dd>
              {resultType ? (
                <TypeExpression
                  api={api}
                  libraryApis={libraryApis}
                  locale={locale}
                  value={resultType}
                />
              ) : null}
              {resultType && doc?.returns ? ' — ' : null}
              {doc?.returns ? (
                <InlineText library={api.library} locale={locale} text={doc.returns} />
              ) : null}
            </dd>
          </div>
        ) : null}
        {showDefault && doc?.default ? (
          <div>
            <dt>{label('Default', '默认值')}</dt>
            <dd>
              <InlineText library={api.library} locale={locale} text={doc.default} />
            </dd>
          </div>
        ) : null}
        {showValues && doc && doc.values.length > 0 ? (
          <div>
            <dt>{label('Values', '可选值')}</dt>
            <dd>
              <ValueList
                library={api.library}
                locale={locale}
                symbols={api.symbols}
                values={doc.values}
              />
            </dd>
          </div>
        ) : null}
        {showUsage && doc?.whenToUse ? (
          <div>
            <dt>{label('When to use', '何时使用')}</dt>
            <dd>
              <InlineText library={api.library} locale={locale} text={doc.whenToUse} />
            </dd>
          </div>
        ) : null}
      </dl>
      {showUsage && doc?.example ? (
        <CodeBlock
          code={doc.example}
          label={label(`${name} example`, `${name} 示例`)}
          locale={locale}
        />
      ) : null}
    </>
  )
}

/**
 * Splits dense prose at the existing sentence/clause boundaries. Inline code and Markdown links
 * remain whole, so punctuation in a signature or URL cannot turn into a paragraph break.
 */
function readableProseParagraphs(
  text: string,
  locale: ILocale,
  library?: string
): readonly string[] {
  /** The reading width used by maintained documentation before code spans needed protection. */
  const maximumLength = 420
  /** Inline library explanations contribute to the rendered reading width as well. */
  const readableLength = (value: string) =>
    inlineTextParts(value).reduce((length, part) => {
      /** Maintained links display their label rather than the destination URL. */
      const linkLabel = part.match(/^\[([^\]]+)\]\([^)]+\)$/u)?.[1]
      if (linkLabel) return length + linkLabel.length
      /** Inline code keeps its contents while dropping only the visible Markdown delimiters. */
      const literal = part.startsWith('`') && part.endsWith('`') ? part.slice(1, -1) : part
      /** The same library lookup used by InlineText determines the inserted explanation. */
      const target = crossLibraryReference(literal, library)
      return (
        length +
        literal.length +
        (target
          ? target.length +
            libraryReferenceDescription(locale, target).length +
            (locale === 'zh' ? '查看该类库 →' : 'Open library →').length
          : 0)
      )
    }, 0)
  if (readableLength(text) <= maximumLength) return [text]
  /** Protected Markdown tokens are copied as one unit, including their internal punctuation. */
  const protectedTokens = [...text.matchAll(/(`+)[\s\S]*?\1|\[[^\]]+\]\([^)]+\)/gu)]
  /** Safe offsets follow complete prose sentences, clauses, or words. */
  const boundaries: number[] = []
  /** Next protected token; advancing it avoids rechecking prior code spans. */
  let protectedIndex = 0
  for (let index = 0; index < text.length; index++) {
    /** Skip the complete next code/link token so none of its punctuation can become a boundary. */
    const token = protectedTokens[protectedIndex]
    if (token && index === token.index) {
      index += token[0].length - 1
      protectedIndex++
      continue
    }
    if (
      /[。！？，、；;,\s]/u.test(text[index]!) ||
      (/[.!?]/u.test(text[index]!) && /\s|^$/u.test(text[index + 1] ?? ''))
    )
      boundaries.push(index + 1)
  }
  boundaries.push(text.length)
  /** Output paragraphs retain every authored token in source order. */
  const paragraphs: string[] = []
  /** Start of the next unread portion of the maintained paragraph. */
  let start = 0
  while (start < text.length) {
    /** Only boundaries that fit the rendered reading width may end this paragraph. */
    const fitting = boundaries.filter(
      (boundary) => boundary > start && readableLength(text.slice(start, boundary)) <= maximumLength
    )
    /** Choose the last fitting boundary; an indivisible token stays whole even when long. */
    const end = fitting.at(-1) ?? boundaries.find((boundary) => boundary > start) ?? text.length
    /** Preserve source order and content, removing only outer layout whitespace. */
    const paragraph = text.slice(start, end).trim()
    if (paragraph) paragraphs.push(paragraph)
    start = end
  }
  return paragraphs
}

/** Compares two projections of the same authored explanation without Markdown styling. */
function sameProseIncluded(owner: string, candidate: string): boolean {
  /** Formatting markers cannot create a second meaning for the same authored explanation. */
  const visible = (value: string) => value.replace(/[`*]/gu, '').replace(/\s+/gu, ' ').trim()
  return visible(owner).includes(visible(candidate))
}

/** Shares prose token boundaries between rendering and paragraph width calculation. */
function inlineTextParts(text: string): readonly string[] {
  return (
    text
      // Reader terminology says "library"; identifiers such as `package.json`, `read:packages`
      // and the product name "GitHub Packages" keep their literal spelling.
      .replace(/(?<!GitHub |[\w.:/-])packages(?![\w.:/-])/gi, 'libraries')
      .replace(/(?<![\w.:/-])package(?![\w.:/-])/gi, 'library')
      .split(
        /(\[[^\]\n]+\]\((?:\/(?:zh|en)\/docs\/[A-Za-z0-9_./#-]+|#[A-Za-z0-9_-]+)\)|`[^`]+`|@migai(?:a)?\/[a-z0-9-]+(?:\/[a-z0-9-]+)*|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b(?:Capability Graph|Lifecycle|PluginHost|Reactive|Resource|Storage Host|Tray|WASM|RPC)\b)/g
      )
  )
}

/** Renders reference prose without truncation; blank lines separate paragraphs. */
function ReferenceParagraphs({
  className,
  library,
  locale,
  text
}: {
  /** Optional emphasis belongs to the first paragraph, not a wrapper around nested paragraphs. */
  readonly className?: string
  readonly library: string
  readonly locale: ILocale
  readonly text: string
}) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .flatMap((paragraph) => readableProseParagraphs(paragraph, locale, library))
        .filter((paragraph) => paragraph.trim())
        .map((paragraph, index) => (
          <p className={index === 0 ? className : undefined} key={paragraph}>
            <InlineText library={library} locale={locale} text={paragraph.trim()} />
          </p>
        ))}
    </>
  )
}

/**
 * Renders the allowed values of a field, each with its meaning. A value taken from an enum-like
 * constant shows its literal and the constant member (`'listener-all'` ·
 * `EventRemovalPolicy.listenerAll`).
 */
function ValueList({
  library,
  locale,
  symbols,
  values
}: {
  readonly library: string
  readonly locale: ILocale
  /** Module declarations used to resolve constant keys to their literals. */
  readonly symbols: readonly IApiSymbol[]
  readonly values: readonly ILocalizedValue[]
}) {
  return (
    <ul className="value-list">
      {values.map((entry) => {
        /** Literal of a constant-backed value, read from the constant's declaration. */
        const literal = entry.constant
          ? constantMembers(
              symbols.find((symbol) => symbol.name === entry.constant) ?? ({} as IApiSymbol)
            ).find((member) => member.key === entry.value)?.value
          : undefined
        return (
          <li key={entry.value}>
            <code>{literal ?? entry.value}</code>
            {entry.constant ? (
              <>
                {' · '}
                <code>{`${entry.constant}.${entry.value}`}</code>
              </>
            ) : null}
            {' — '}
            <InlineText library={library} locale={locale} text={entry.meaning} />
          </li>
        )
      })}
    </ul>
  )
}

/** Maximum declaration headlines shown in the API hero before collapsing into an overload count. */
const MAX_HERO_DECLARATIONS = 3

/**
 * Reduces a generated declaration to the one-line shape a reader scans first: functions keep their
 * full call signature, classes keep their heading, and object-typed constants collapse the literal
 * body to `{ … }`. The complete text stays in the "Full type signature" disclosure.
 */
function signatureHeadlines(signature: string): readonly string[] {
  return signature
    .split(/(?=export declare )/)
    .map((declaration) =>
      declaration
        .replace(/^export declare /, '')
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .map((declaration) => {
      if (/^(?:abstract )?class /.test(declaration))
        return `${declaration.split('{')[0]!.trim()} { … }`
      if (/^const [\w$]+: \{/.test(declaration))
        return `${declaration.slice(0, declaration.indexOf('{'))}{ … }`
      return declaration.replace(/;$/, '')
    })
}

/**
 * Returns the first sentence of `text` that `shown` does not contain yet, and records it. Codes of
 * one family often open with the same classifier ("Diagnostic code that is reported, never
 * thrown."), so each row shows the sentence that tells it apart instead of repeating the opener.
 * Returns `undefined` when every sentence was already shown on the page.
 */
function freshSentence(text: string | undefined, shown: Set<string>): string | undefined {
  /** Unread tail of the description, consumed one sentence at a time. */
  let rest = text?.trim() ?? ''
  while (rest) {
    const sentence = openingSentence(rest)
    rest = rest.slice(sentence.length).trim()
    if (!shown.has(sentence)) {
      shown.add(sentence)
      return sentence
    }
  }
  return undefined
}

/** Public npm specifier of one module, e.g. `@migaia/rpc-core/client`. */
function publicPackagePath(api: IApi): string {
  return api.exportPath === '.'
    ? `@migaia/${api.library}`
    : `@migaia/${api.library}/${api.exportPath.replace(/^\.\//u, '')}`
}

/** Declarations longer than this many characters put each parameter on its own line. */
const HEADLINE_WRAP_LENGTH = 72

/**
 * Lays out one declaration headline for the API hero. Short declarations stay on one line; long
 * callables break at top-level parameter commas so each parameter reads as one row, the way an
 * editor's formatter would print it. Generic, object, and tuple brackets are respected.
 */
function layoutHeadline(headline: string): string {
  if (headline.length <= HEADLINE_WRAP_LENGTH) return headline
  /** Bracket depth while scanning; parameters split only at depth 1 of the call parentheses. */
  let depth = 0
  /** Index of the call's opening parenthesis, found at generic depth 0. */
  let open = -1
  for (let index = 0; index < headline.length; index++) {
    const character = headline[index]
    if (character === '<' || character === '[' || character === '{') depth++
    else if (character === '>' && headline[index - 1] !== '=') depth--
    else if (character === ']' || character === '}') depth--
    else if (character === '(' && depth === 0) {
      open = index
      break
    }
  }
  if (open < 0) return headline
  /** Top-level parameter texts and the index of the matching close parenthesis. */
  const parameters: string[] = []
  let start = open + 1
  let close = -1
  depth = 0
  for (let index = open + 1; index < headline.length; index++) {
    const character = headline[index]
    if ('<([{'.includes(character!)) depth++
    else if (character === '>' && headline[index - 1] !== '=') depth--
    else if (')]}'.includes(character!)) {
      if (character === ')' && depth === 0) {
        close = index
        break
      }
      depth--
    } else if (character === ',' && depth === 0) {
      parameters.push(headline.slice(start, index).trim())
      start = index + 1
    }
  }
  if (close < 0) return headline
  parameters.push(headline.slice(start, close).trim())
  const visible = parameters.filter(Boolean)
  if (visible.length === 0) return headline
  return `${headline.slice(0, open + 1)}\n${visible.map((parameter) => `  ${parameter}`).join(',\n')}\n${headline.slice(close)}`
}

/** Builds the narrowest public import statement for one runtime symbol. */
function importStatement(api: IApi, symbol: IApiSymbol): string {
  return `import { ${symbol.name} } from '${publicPackagePath(api)}'`
}

/** Small clipboard control shared by the API hero; reports failures instead of hiding them. */
function CopyText({ locale, text }: { readonly locale: ILocale; readonly text: string }) {
  /** Clipboard result for this control only. */
  const [state, setState] = useState<'ready' | 'copied' | 'failed'>('ready')
  /** Copies the exact text and returns to the ready label after a short confirmation. */
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch (error) {
      console.error(error)
      setState('failed')
    }
    window.setTimeout(() => setState('ready'), 1600)
  }
  return (
    <button className="copy-text" data-state={state} onClick={copy} type="button">
      <span aria-live="polite">{CODE_COPY_LABELS[locale][state]}</span>
    </button>
  )
}

/**
 * Visual centre of every API detail page: the kind, the copyable import, and the declaration
 * headline(s) on one ink surface, so a reader sees how to import and call the API before reading
 * any prose.
 */
function ApiHero({
  api,
  library,
  locale,
  symbol
}: {
  readonly api: IApi
  readonly library: ILibrary
  readonly locale: ILocale
  readonly symbol: IApiSymbol
}) {
  const ui = interfaceCopyFor(locale)
  /** One-line declarations; overloads beyond the visible limit become a count. */
  const headlines = signatureHeadlines(symbol.signature)
  const importLine = importStatement(api, symbol)
  return (
    <section className="api-hero" data-kind={symbol.kind} aria-label={symbol.name}>
      <div className="api-hero-row">
        <span className="api-hero-label">{ui.importLabel}</span>
        <code className="api-hero-import">{highlightTypeScript(importLine)}</code>
        <CopyText locale={locale} text={importLine} />
      </div>
      {headlines.length ? (
        <pre className="api-hero-signature">
          <code>
            {headlines.slice(0, MAX_HERO_DECLARATIONS).map((headline, index) => (
              <span className="api-hero-line" key={`${index}:${headline}`}>
                {highlightTypeScript(layoutHeadline(headline))}
              </span>
            ))}
          </code>
        </pre>
      ) : null}
      <p className="api-hero-meta">
        {headlines.length > MAX_HERO_DECLARATIONS ? (
          <span>
            +{headlines.length - MAX_HERO_DECLARATIONS} {ui.overloads}
          </span>
        ) : null}
        {library.version ? <span>v{library.version}</span> : null}
        <span>{publicPackagePath(api)}</span>
      </p>
    </section>
  )
}

/**
 * Drops a leading "`name`: optional," preamble from a field description. The option row already
 * shows the name and its optional/required pill, so repeating them in the prose costs a line and
 * reads as noise. Text without that exact preamble is returned unchanged.
 */
function withoutFieldPreamble(name: string, text: string): string {
  /** Escaped field name, so names such as `$schema` match literally. */
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(
    new RegExp(
      `^\`(?:options\\.)?${escaped}\`\\s*[:：]\\s*(?:(?:可选|必填|optional|required)\\s*[,，;；]\\s*)?`,
      'i'
    ),
    ''
  )
}

/** Shares visible instance ownership and scenarios between the article and its outline. */
function referenceInstanceContent(
  symbol: IApiSymbol,
  module: string,
  symbols: readonly IApiSymbol[],
  reference?: ILocalizedReference
) {
  /** Factories may own lifecycle guidance that belongs with their first returned instance. */
  const ownGuide = instanceGuideFor(reference, module, symbol.name)
  /** Resolve the same class or aliased object surface without expanding the loader projection. */
  const declaredSurface =
    symbol.kind === 'class'
      ? instanceSurface(symbol, symbols)
      : (aliasedInstanceSurface(symbol, symbols, reference) ??
        (symbol.kind === 'const' && ownGuide ? instanceSurface(symbol, symbols) : undefined))
  /** Each returned surface carries the guide the article actually displays. */
  const instances = returnedInstances(symbol, symbols)
    .map((instance, index) => ({
      ...instance,
      guide:
        index === 0 && ownGuide
          ? ownGuide
          : surfaceGuideFor(reference, module, instance.type, symbols)
    }))
    .filter(({ surface, guide }) => surface.members.length > 0 || surface.bases.length > 0 || guide)
  /** Callable factories show their instance once; identical object surfaces share that owner. */
  const ownSurface =
    declaredSurface &&
    (declaredSurface.members.length > 0 || declaredSurface.bases.length > 0 || ownGuide) &&
    !(isCallableApiSymbol(symbol) && instances.length > 0) &&
    !instances.some(
      ({ surface }) =>
        surface.owners.length === declaredSurface.owners.length &&
        surface.owners.every((owner, index) => owner === declaredSurface.owners[index]) &&
        surface.bases.length === declaredSurface.bases.length &&
        surface.bases.every((base, index) => base === declaredSurface.bases[index]) &&
        surface.members.length === declaredSurface.members.length &&
        surface.members.every(
          (member, index) => member.signature === declaredSurface.members[index]?.signature
        )
    )
      ? declaredSurface
      : undefined
  /** Only scenarios in a visible guide can replace the corresponding API explanation. */
  const instanceScenarios = [
    ...(ownSurface ? (ownGuide?.scenarios ?? []) : []),
    ...instances.flatMap(({ guide }) => guide?.scenarios ?? [])
  ]
  /** Maintained API scenarios remain available when no displayed instance owns them. */
  const symbolDoc = symbolDocFor(reference, module, symbol.name)
  /** Different API scenarios retain their own section instead of disappearing with a hidden guide. */
  const scenarios =
    symbolDoc?.scenarios.filter(
      (scenario) =>
        !instanceScenarios.some((instanceScenario) => sameProseIncluded(instanceScenario, scenario))
    ) ?? []
  return { ownGuide, ownSurface, instances, scenarios, symbolDoc }
}

/** Renders one runtime API as a focused reference article with subordinate typing. */
function SingleApiReference({
  guide,
  reference,
  locale,
  library,
  libraryApis,
  api,
  optionTranslations,
  optionFallbacks,
  symbol
}: {
  readonly guide?: IApiGuide
  /** Authored member descriptions by instance type name, then member name. */
  readonly reference?: ILocalizedReference
  readonly locale: ILocale
  readonly library: ILibrary
  readonly libraryApis: readonly IApi[]
  readonly api: IApi
  readonly optionTranslations?: Readonly<Record<string, string>>
  readonly optionFallbacks?: Readonly<Record<string, string>>
  readonly symbol: IApiSymbol
}) {
  /** Public result types can be exported from a sibling entry; local declarations take precedence. */
  const symbols = [...api.symbols, ...libraryApis.flatMap((entry) => entry.symbols)]
  /** Generated declarations remain the source of related types and exact option types. */
  const typingSymbols = symbols.filter(
    (candidate) => candidate.kind === 'type' || candidate.kind === 'interface'
  )
  /**
   * The signature disclosure lists the declarations the loader carried: directly referenced types
   * in full, and the types they name as compact links (their empty signature ends the walk).
   */
  const relatedTypes = collectRelatedTypes(symbol, typingSymbols)
  /** Article and outline share the final visible instance and scenario inventory. */
  const { ownGuide, ownSurface, instances, scenarios, symbolDoc } = referenceInstanceContent(
    symbol,
    api.module,
    symbols,
    reference
  )
  /** Only the maintained opening sentence introduces the API outside audited libraries. */
  const purpose = symbolDoc
    ? symbolDoc.purpose
    : openingSentence(guide?.purpose ?? localizedSymbolPurpose(locale, symbol) ?? symbol.purpose)
  /** Preserve the authored minimal example and its public import paths. */
  const rawQuickExample = symbolDoc ? symbolDoc.example : primaryExample(guide, symbol, api.library)
  /** Copyable imports resolve to the canonical public module. */
  const quickExample = rawQuickExample
    ? exampleWithPrimaryImport(rawQuickExample, api, symbol)
    : undefined
  /** Root option aliases refer to the same documented field, not a second option. */
  const fieldIdentity = (name: string) => name.replace(/^options\./, '')
  /** Maintained options fill only fields absent from the extracted declaration. */
  const configuration: readonly IApiSymbol['configuration'][number][] = [
    ...symbol.configuration,
    ...(symbolDoc ? [] : (guide?.options ?? []))
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
    /** Audited libraries render the reference field doc verbatim (nested paths resolved). */
    const fieldDoc =
      symbolDoc?.options[fieldIdentity(field.name)] ??
      (symbolDoc?.optionsType
        ? resolveFieldDoc(
            symbolDoc.optionsType,
            fieldIdentity(field.name),
            (name) => instanceGuideFor(reference, api.module, name)?.members,
            symbols
          )
        : undefined)
    if (symbolDoc)
      return {
        ...field,
        description: fieldDoc?.summary ?? '',
        defaultValue: undefined,
        defaultText: fieldDoc?.default,
        values: fieldDoc?.values ?? [],
        example: fieldDoc?.example,
        referenceDoc: fieldDoc
      }
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
    const behavior = withoutFieldPreamble(
      fieldIdentity(field.name),
      openingSentence(needsFallback ? (optionFallbacks?.[field.name] ?? rawBehavior) : rawBehavior)
    )
    /** Reused function JSDoc is not an independent explanation of a second field. */
    const description = described.has(behavior) ? '' : behavior
    if (description) described.add(description)
    return {
      ...field,
      description,
      defaultValue: optionGuide?.defaultValue,
      defaultText: undefined as string | undefined,
      values: [] as readonly ILocalizedValue[],
      example: optionGuide?.example,
      referenceDoc: undefined
    }
  })
  /** Nested anonymous fields retain their authored contracts when extraction lists only the parent. */
  const unlistedOptions = Object.entries(symbolDoc?.options ?? {}).filter(
    ([name]) => !options.some((field) => fieldIdentity(field.name) === fieldIdentity(name))
  )
  /** Omit the default column when the content supplies no defaults for this API. */
  const hasDefaults = options.some((option) => option.defaultValue?.trim() || option.defaultText)
  /** Only explicit package errors belong in the reference; generator placeholders are omitted. */
  const errors = symbolDoc
    ? []
    : [
        ...new Set(
          symbol.errors.filter(
            (error) => error.trim() && !error.startsWith('No documented errors are declared for ')
          )
        )
      ]
  /** Shell labels for field flags and defaults. */
  const ui = interfaceCopyFor(locale)
  /** Authored constant meanings also cover numeric fields whose declarations widen to `number`. */
  const enumGuide =
    reference?.enums[`${api.module}:${symbol.name}`] ?? reference?.enums[symbol.name]
  /** Literal rows retain their declaration values when every member is a literal. */
  const literalConstants = constantMembers(symbol)
  /**
   * Prefer literal values; otherwise retain the exact declared field type without inventing a
   * value.
   */
  const constants = literalConstants.length
    ? literalConstants
    : enumGuide
      ? symbol.members.map((member) => ({
          key: member.name,
          value: member.returns,
          description: member.description ?? undefined
        }))
      : []
  /** Opening sentences shared by several members classify a family; they never identify a row. */
  const sharedOpeners = constants
    .map((member) => (member.description ? openingSentence(member.description) : ''))
    .filter((opener, index, all) => opener && all.indexOf(opener) !== index)
  /** Sentences already on the page (the lede included) or shared openers that rows must skip. */
  const valueShown = new Set<string>([purpose, ...sharedOpeners])
  /** Each member with one sentence that identifies it and is not repeated on the page. */
  const values = constants.map((member) => ({
    ...member,
    description: symbolDoc
      ? enumGuide?.values[member.key]
      : freshSentence(member.description, valueShown)
  }))
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
      <ApiHero api={api} library={library} locale={locale} symbol={symbol} />
      {purpose ? (
        <section className="api-overview" id={`${symbol.fragment}--overview`}>
          {symbolDoc ? (
            <>
              <ReferenceParagraphs
                className="lede"
                library={library.slug}
                locale={locale}
                text={purpose}
              />
              {enumGuide && !sameProseIncluded(purpose, enumGuide.summary) ? (
                <ReferenceParagraphs
                  library={library.slug}
                  locale={locale}
                  text={enumGuide.summary}
                />
              ) : null}
            </>
          ) : (
            <p className="lede">
              <InlineText library={library.slug} locale={locale} text={purpose} />
            </p>
          )}
        </section>
      ) : null}
      {quickExample ? (
        <section
          className="section-block compact"
          data-primary-api-example={symbol.name}
          id={`${symbol.fragment}--quick-start`}
        >
          <h2>{locale === 'zh' ? '最小示例' : 'Minimal example'}</h2>
          {symbolDoc?.exampleIntro ? (
            <ReferenceParagraphs
              library={library.slug}
              locale={locale}
              text={symbolDoc.exampleIntro}
            />
          ) : null}
          <CodeBlock code={quickExample} label={symbol.name} locale={locale} />
          {symbolDoc?.exampleResult ? (
            <ReferenceParagraphs
              library={library.slug}
              locale={locale}
              text={symbolDoc.exampleResult}
            />
          ) : null}
        </section>
      ) : null}
      {symbolDoc && (Object.keys(symbolDoc.params).length > 0 || symbolDoc.returns) ? (
        <section className="section-block compact" id={`${symbol.fragment}--contract`}>
          <h2>{locale === 'zh' ? '参数与返回' : 'Parameters and result'}</h2>
          <dl className="option-meta class-member-meta">
            {Object.keys(symbolDoc.params).length > 0 ? (
              <div>
                <dt>{locale === 'zh' ? '参数' : 'Parameters'}</dt>
                <dd>
                  <ul className="member-parameters">
                    {Object.entries(symbolDoc.params).map(([name, text]) => {
                      /**
                       * Constructor constants can document parameters without a callable
                       * projection.
                       */
                      const parameter = callableShape(symbol)?.parameters.find(
                        (entry) => entry.name === name
                      )
                      return (
                        <li key={name}>
                          <code>
                            {name}
                            {parameter?.optional ? '?' : ''}
                          </code>
                          {parameter ? (
                            <>
                              {': '}
                              <TypeExpression
                                api={api}
                                libraryApis={libraryApis}
                                locale={locale}
                                value={parameter.type}
                              />
                            </>
                          ) : null}
                          {' — '}
                          <InlineText library={library.slug} locale={locale} text={text} />
                        </li>
                      )
                    })}
                  </ul>
                </dd>
              </div>
            ) : null}
            {symbolDoc.returns ? (
              <div>
                <dt>{locale === 'zh' ? '返回' : 'Returns'}</dt>
                <dd>
                  <TypeExpression
                    api={api}
                    libraryApis={libraryApis}
                    locale={locale}
                    value={callableShape(symbol)?.returns ?? symbol.returns}
                  />
                  {' — '}
                  <InlineText library={library.slug} locale={locale} text={symbolDoc.returns} />
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
      {values.length ? (
        <section
          className="section-block compact api-configuration"
          id={`${symbol.fragment}--values`}
        >
          <h2>{ui.valuesTitle}</h2>
          <div className="table-scroll">
            <table className="option-reference constant-values">
              <thead>
                <tr>
                  <th>{locale === 'zh' ? '名称' : 'Name'}</th>
                  <th>{ui.valueLabel}</th>
                  <th>{locale === 'zh' ? '说明' : 'Description'}</th>
                </tr>
              </thead>
              <tbody>
                {values.map((member) => (
                  <tr
                    className="option-entry"
                    id={`${symbol.fragment}--value-${optionAnchor(member.key)}`}
                    key={member.key}
                  >
                    <th scope="row">
                      <code>{member.key}</code>
                    </th>
                    <td className="option-type">
                      <code className="constant-literal">{member.value}</code>
                    </td>
                    <td className="option-behavior">
                      {member.description ? (
                        <p>
                          <InlineText
                            library={library.slug}
                            locale={locale}
                            text={member.description}
                          />
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {options.length > 0 || unlistedOptions.length > 0 ? (
        <section
          className="section-block compact api-configuration"
          id={`${symbol.fragment}--configuration`}
        >
          <h2>{locale === 'zh' ? '选项' : 'Options'}</h2>
          {options.length > 0 ? (
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
                        <code>{field.name}</code>
                        <span
                          className="field-flag"
                          data-optional={field.optional ? 'true' : 'false'}
                        >
                          {field.optional ? ui.optional : ui.required}
                        </span>
                      </th>
                      <td className="option-type">
                        <TypeExpression
                          api={api}
                          libraryApis={libraryApis}
                          locale={locale}
                          value={field.type}
                        />
                      </td>
                      {hasDefaults ? (
                        <td
                          className="option-default"
                          data-empty={field.defaultValue ? undefined : 'true'}
                          data-label={ui.defaultLabel}
                        >
                          {field.defaultText ? (
                            <InlineText
                              library={library.slug}
                              locale={locale}
                              text={field.defaultText}
                            />
                          ) : field.defaultValue ? (
                            <code>{field.defaultValue}</code>
                          ) : (
                            '—'
                          )}
                        </td>
                      ) : null}
                      <td className="option-behavior">
                        {field.description ? (
                          symbolDoc ? (
                            <ReferenceParagraphs
                              library={library.slug}
                              locale={locale}
                              text={field.description}
                            />
                          ) : (
                            <p>
                              <InlineText
                                library={library.slug}
                                locale={locale}
                                text={field.description}
                              />
                            </p>
                          )
                        ) : null}
                        {field.values.length > 0 ? (
                          <ValueList
                            library={library.slug}
                            locale={locale}
                            symbols={api.symbols}
                            values={field.values}
                          />
                        ) : null}
                        {field.referenceDoc ? (
                          <ReferenceMemberDetails
                            api={api}
                            doc={field.referenceDoc}
                            libraryApis={libraryApis}
                            locale={locale}
                            name={field.name}
                            showDefault={false}
                            showValues={false}
                          />
                        ) : null}
                        {!field.referenceDoc && field.example ? (
                          <CodeBlock code={field.example} label={field.name} locale={locale} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {unlistedOptions.length > 0 ? (
            <div className="option-reference">
              {unlistedOptions.map(([name, doc]) => (
                <section
                  className="option-entry"
                  id={`${symbol.fragment}--option-${optionAnchor(name)}`}
                  key={name}
                >
                  <div className="option-heading">
                    <h3>
                      <code>{name}</code>
                    </h3>
                  </div>
                  <ReferenceParagraphs library={library.slug} locale={locale} text={doc.summary} />
                  <ReferenceMemberDetails
                    api={api}
                    doc={doc}
                    libraryApis={libraryApis}
                    locale={locale}
                    name={name}
                  />
                </section>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {reference?.enhancers[symbol.name] ? (
        <InstalledCapabilities
          api={api}
          guide={reference.enhancers[symbol.name]!}
          libraryApis={libraryApis}
          locale={locale}
          memberDocs={Object.fromEntries(
            instances.flatMap(({ surface }) =>
              surface.members.flatMap((member) => {
                /** The returned instance owns this exact member description when grants reuse it. */
                const doc = memberDocResolver(reference, api.module, surface.owners)?.(member.name)
                return doc ? [[member.name, doc]] : []
              })
            )
          )}
          purpose={purpose}
          shownExample={rawQuickExample}
          symbol={symbol}
        />
      ) : null}
      {ownSurface ? (
        <ClassMemberReference
          api={api}
          bases={ownSurface.bases}
          libraryApis={libraryApis}
          locale={locale}
          guide={ownGuide}
          memberDoc={memberDocResolver(reference, api.module, [symbol.name, ...ownSurface.owners])}
          members={ownSurface.members}
          strict={Boolean(reference)}
          symbol={symbol}
        />
      ) : null}
      {instances.map(({ type, surface, guide }, index) => (
        <ClassMemberReference
          api={api}
          bases={surface.bases}
          heading={
            <>
              {locale === 'zh' ? '返回的实例：' : 'Returned instance: '}
              <Link to={symbolReferencePath(locale, api, libraryApis, type)}>
                <code>{type.name}</code>
              </Link>
            </>
          }
          id={`${symbol.fragment}--instance${index === 0 ? '' : `-${index + 1}`}`}
          key={type.name}
          libraryApis={libraryApis}
          locale={locale}
          guide={guide}
          memberDoc={memberDocResolver(reference, api.module, [symbol.name, ...surface.owners])}
          members={surface.members}
          strict={Boolean(reference)}
          symbol={symbol}
        />
      ))}
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
      {symbolDoc && (scenarios.length > 0 || symbolDoc.avoid.length > 0) ? (
        <section className="section-block compact" id={`${symbol.fragment}--scenarios`}>
          <h2>{locale === 'zh' ? '适用场景' : 'When to use'}</h2>
          {scenarios.length > 0 ? (
            <ul>
              {scenarios.map((scenario) => (
                <li key={scenario}>
                  <InlineText library={library.slug} locale={locale} text={scenario} />
                </li>
              ))}
            </ul>
          ) : null}
          {symbolDoc.avoid.length > 0 ? (
            <>
              <h3>{locale === 'zh' ? '不适用' : 'Avoid when'}</h3>
              <ul>
                {symbolDoc.avoid.map((item) => (
                  <li key={item}>
                    <InlineText library={library.slug} locale={locale} text={item} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
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
        <Link to={guidePath(locale, api.library)}>
          {locale === 'zh' ? `${api.library} 入门指南` : `Get started with ${api.library}`}
        </Link>
      </section>
      <section className="api-signature" id={`${symbol.fragment}--signature`}>
        <h2>{locale === 'zh' ? '完整类型签名' : 'Full type signature'}</h2>
        <details>
          <summary>{locale === 'zh' ? '公开类型签名' : 'Public type signature'}</summary>
          <CodeBlock code={symbol.signature} signature label={symbol.name} locale={locale} />
          <RelatedTypes
            api={api}
            libraryApis={libraryApis}
            locale={locale}
            symbols={relatedTypes}
          />
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
  const packagePath = publicPackagePath(api)
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

/** Reads a runtime symbol's reference doc by module-qualified key first. */
function symbolDocFor(
  reference: ILocalizedReference | undefined,
  module: string,
  name: string
): ILocalizedSymbolDoc | undefined {
  return reference?.symbols[`${module}:${name}`] ?? reference?.symbols[name]
}

/** Builds a member-doc lookup that searches the surface's declarations in order. */
function memberDocResolver(
  reference: ILocalizedReference | undefined,
  module: string,
  owners: readonly string[]
): ((name: string) => ILocalizedMemberDoc | undefined) | undefined {
  if (!reference) return undefined
  return (name) => {
    for (const owner of owners) {
      const doc = instanceGuideFor(reference, module, owner)?.members[name]
      if (doc) return doc
    }
    return undefined
  }
}

/** Reads an instance guide by its module-qualified key first, then by bare type name. */
function instanceGuideFor(
  guides: ILocalizedReference | undefined,
  module: string,
  name: string
): ILocalizedTypeDoc | undefined {
  return guides?.types[`${module}:${name}`] ?? guides?.types[name]
}

/**
 * Reads the guide of an instance type, falling back to the nearest composed type that has one, so a
 * styled or branded alias (`IStyledEventChannel` → `IEventChannel`) shares its base guide.
 */
function surfaceGuideFor(
  guides: ILocalizedReference | undefined,
  module: string,
  type: IApiSymbol,
  symbols: readonly IApiSymbol[]
): ILocalizedTypeDoc | undefined {
  /** Types already inspected; guards recursive compositions. */
  const seen = new Set<string>()
  /** Breadth-first queue of type names, starting with the instance type itself. */
  const queue = [type.name]
  while (queue.length > 0) {
    const name = queue.shift()!
    if (seen.has(name)) continue
    seen.add(name)
    const guide = instanceGuideFor(guides, module, name)
    if (guide) return guide
    queue.push(...(symbols.find((candidate) => candidate.name === name)?.composes ?? []))
  }
  return undefined
}

/**
 * Resolves the instance surface an authored guide assigns to a non-class entry (a constructor
 * constant typed by a static constructor interface), or `undefined` when the guide names none.
 */
function aliasedInstanceSurface(
  symbol: IApiSymbol,
  symbols: readonly IApiSymbol[],
  guides: ILocalizedReference | undefined
): IInstanceSurface | undefined {
  /** Declared type named by the guide as this entry's instance surface. */
  const surfaceName = symbol.kind === 'class' ? undefined : guides?.types[symbol.name]?.surface
  const declaration = surfaceName
    ? symbols.find((candidate) => candidate.name === surfaceName)
    : undefined
  return declaration ? instanceSurface(declaration, symbols) : undefined
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
        <Link className="text-link" to={guidePath(locale, library.slug)}>
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
  const sections = uniqueDocumentProse(document.sections).map((section) => ({
    ...section,
    blocks: section.blocks.flatMap((block): IMaintainedBlock[] =>
      block.type === 'paragraph'
        ? readableProseParagraphs(block.text, locale, library).map((text) => ({ ...block, text }))
        : [block]
    )
  }))
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
    if (/^(?:输出|输出结果|运行输出|运行结果|Output)\s*[:：]?$/i.test(normalizedText))
      return <p className="output-caption">{block.text.replace(/[:：]\s*$/, '')}</p>
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
  if (library === 'storage-web')
    return docsModulePath(locale, 'storage-web', 'index', 'StorageError')
  return undefined
}

/** Architecture-page summaries explain the pain, core capability, and governing design up front. */
const LIBRARY_ARCHITECTURE_LEDES_ZH = {
  supervision:
    '用于可靠地管理进程、线程和协程：它们可能意外退出、启动失败、健康检查不通过，或在被替换时与新实例同时存在。监督器负责启动、观察和停止这些单元，它通过平台对应的启动器创建单元，并用预算限制同时运行的数量；每个单元在真正退出之前都占着一个名额。新单元报告准备就绪后才被当作可用；每次启动的实例都带一个代次编号，用来区分重启或替换前后的新旧实例。停止、等待手头工作完成和强制结束，都交给启动这个单元的启动器去做。启动器做不到的操作会被明确报告，监督器不会仅凭平台名称就假定有严格隔离或不占资源。',
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
  'rpc-browser':
    '用于 Window、共享 Worker、ServiceWorker、BroadcastChannel、WebTransport 或 RTCDataChannel 两端需要 RPC 的场景。各适配器持有实际浏览器通道及其监听器，保留来源校验、传输能力与关闭边界；Endpoint 和协议工具由 Core、Contract 复用，应用按实际通道选择适配器。',
  'rpc-devtools':
    '当应用需要追踪 RPC 失败、调用耗时或跨宿主事件时使用。createRpcDevtools 作为 Probe 接入已有宿主，按有界事件环提供查询、统计、录制、暂停与 service；createRpcDevtoolsHub 聚合已有 service client 和离线录制，对齐时钟并关联 timeline 与 interactions。默认只采集元数据，内容捕获必须显式启用；录制使用版本 1 的 NDJSON，错误链复用 RPC Contract，连接与持久化由调用方管理。'
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

/** Highlights inline code and links public errors and explicit cross-library references. */
function InlineText({
  // Cross-library links open the target library's learning path, whatever the page kind.
  domain: _domain = 'docs',
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
  return inlineTextParts(text).map((part, index) => {
    /** Maintained API tables link to existing local guides without accepting external URLs. */
    const maintainedLink = part.match(
      /^\[([^\]\n]+)\]\((\/(?:zh|en)\/docs\/[A-Za-z0-9_./#-]+|#[A-Za-z0-9_-]+)\)$/
    )
    if (maintainedLink) {
      const [, label, target] = maintainedLink
      /** In-page anchors stay plain fragment links so the browser scrolls without routing. */
      if (target!.startsWith('#'))
        return (
          <a className="text-link" href={target} key={index}>
            {label}
          </a>
        )
      return (
        <Link className="text-link" key={index} to={target!}>
          {label}
        </Link>
      )
    }
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
          to={domainPath(locale, referencedLibrary)}
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

/** Renders a library learning path or guide topic beside the shared library sidebar. */
function DomainLibrary({
  locale,
  library,
  apiLinks,
  libraryApis,
  modulePath,
  journey,
  journeyTopics
}: {
  locale: ILocale
  library: ILibrary
  apiLinks: readonly IGuideApiLink[]
  libraryApis: readonly IApi[]
  modulePath?: string
  journey?: IGuideJourney
  journeyTopics: readonly { readonly title: string; readonly topic: string }[]
}) {
  const topic = modulePath ?? 'index'
  /** Maintained usage guide shown in Chinese when a topic has no hand-written journey yet. */
  const document = library.documentation.guide
  /** Visible guide headings back the right-side reading outline. */
  const guideSections = journey?.document.sections ?? []
  /** The library sidebar is identical on guide and API pages; only the active entry differs. */
  const pageNavigation = useMemo(
    () => (
      <LibraryNavigation
        activeTopic={topic}
        api={undefined}
        apiLinks={apiLinks}
        journeyTopics={journeyTopics}
        libraryApis={libraryApis}
        librarySlug={library.slug}
        locale={locale}
        selectedSymbol={undefined}
      />
    ),
    [apiLinks, journeyTopics, library.slug, libraryApis, locale, topic]
  )
  usePageNavigation(pageNavigation)
  return (
    <main id="main-content" className="page-shell content-page" lang={locale} data-pagefind-body>
      <div className="reading-layout">
        <article className="article-column">
          <Breadcrumb
            locale={locale}
            domain="guides"
            library={library.slug}
            moduleName={
              topic === 'index'
                ? undefined
                : topic === README_SEGMENT
                  ? readmeTitle(locale)
                  : (journey?.title ?? topic)
            }
          />
          <p className="eyebrow">
            {locale === 'zh' ? '指南' : 'Guide'} · {library.slug}
          </p>
          <h1>
            {journey?.title ??
              (topic === README_SEGMENT
                ? `${library.slug} ${readmeTitle(locale)}`
                : modulePath
                  ? topic
                  : library.slug)}
          </h1>
          <p className="lede">
            <InlineText
              library={library.slug}
              locale={locale}
              text={
                journey?.lede ??
                (locale === 'zh'
                  ? (LIBRARY_ARCHITECTURE_LEDES_ZH[
                      library.slug as keyof typeof LIBRARY_ARCHITECTURE_LEDES_ZH
                    ] ?? libraryReferenceDescription(locale, library.slug))
                  : libraryReferenceDescription(locale, library.slug))
              }
            />
          </p>
          {topic === 'index' ? <LibraryBand library={library} locale={locale} /> : null}
          {journey ? (
            <GuideJourneyContent journey={journey} library={library.slug} locale={locale} />
          ) : locale === 'zh' && document ? (
            <MaintainedDocument
              document={document}
              domain="guides"
              library={library.slug}
              locale={locale}
            />
          ) : null}
          {(topic === README_SEGMENT || (topic === 'index' && !journey)) &&
          locale === 'zh' &&
          library.documentation.readme ? (
            <section className="section-block" aria-labelledby="package-readme">
              <h2 id="package-readme">包说明</h2>
              <MaintainedDocument
                document={library.documentation.readme}
                domain="guides"
                headingLevel={3}
                idPrefix="readme-"
                library={library.slug}
                locale={locale}
              />
            </section>
          ) : null}
          <p className="document-next-step">
            <Link className="text-link" to={docsModulePath(locale, library.slug, 'index')}>
              {locale === 'zh'
                ? `查看 ${library.slug} API 参考 →`
                : `${library.slug} API reference →`}
            </Link>
          </p>
          <NextActions locale={locale} domain="guides" library={library.slug} />
        </article>
        <div className="left-rail-sticky">
          <ScrollArea className="left-rail">
            <aside className="left-rail-content" aria-label={copyFor(locale).libraryModules}>
              {pageNavigation}
            </aside>
          </ScrollArea>
        </div>
        {guideSections.length ? (
          <details className="page-toc">
            <summary>{copyFor(locale).onPage}</summary>
            <GuideOutline locale={locale} sections={guideSections} topic={topic} />
          </details>
        ) : null}
      </div>
    </main>
  )
}

/** Section outline for guide pages; shares scroll tracking with the API outline. */
function GuideOutline({
  locale,
  sections,
  topic
}: {
  readonly locale: ILocale
  readonly sections: readonly { readonly id: string; readonly heading: string }[]
  readonly topic: string
}) {
  /** Outline root observed by the shared scroll tracker. */
  const navRef = useRef<HTMLElement>(null)
  useScrollSpy(navRef, topic)
  return (
    <nav aria-label={copyFor(locale).onPage} ref={navRef}>
      {sections.map((section) => (
        <a href={`#${section.id}`} key={section.id}>
          {section.heading.replaceAll('`', '')}
        </a>
      ))}
    </nav>
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
            to={journeyNextPath(locale, library, next.path)}
          >
            {next.label} →
          </Link>
        ))}
      </nav>
    </>
  )
}

/**
 * Resolves a journey `next` path. `docs/<library>/<api path>` names an API page (an `index` module
 * segment means the root module); any other value is a guide topic of this library.
 */
function journeyNextPath(locale: ILocale, library: string, path: string): string {
  /** `../<library>/<topic>` names a guide topic of another library. */
  if (path.startsWith('../')) return `/${locale}/docs/${path.slice(3)}`
  const apiTarget = path.match(/^docs\/([^/]+)(?:\/(.*))?$/)
  if (!apiTarget) return guidePath(locale, library, path)
  const [, targetLibrary, rest = ''] = apiTarget
  const apiPath = rest.replace(/^index(?=\/|$)\/?/, '')
  return `/${locale}/docs/${targetLibrary}/${API_SEGMENT}${apiPath ? `/${apiPath}` : ''}`
}

/** Keeps type declarations subordinate to runtime APIs and displays selected declarations in full. */
function RelatedTypes({
  api,
  libraryApis,
  locale,
  selectedFragment,
  standalone = false,
  symbols
}: {
  readonly api?: IApi
  /** Every loaded module; a compact entry links to the module that declares it. */
  readonly libraryApis?: readonly IApi[]
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
      /** Module that declares the compact entry. */
      const owner = selectedSymbol
        ? (libraryApis?.find((entry) => entry.symbols.includes(selectedSymbol)) ?? api)
        : api
      if (owner && selectedSymbol && !selectedSymbol.signature) {
        navigate(
          docsModulePath(
            locale,
            owner.library,
            owner.module,
            symbolSlug(selectedSymbol, owner.symbols)
          ),
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
  }, [api, libraryApis, locale, navigate, selectedFragment, symbols])
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
          /** Module that declares this entry; its route carries the complete declaration. */
          const owner = libraryApis?.find((entry) => entry.symbols.includes(symbol)) ?? api
          return (
            <section className="type-declaration" id={symbol.fragment} key={symbol.fragment}>
              <h3>
                {owner && !symbol.signature ? (
                  <Link
                    to={docsModulePath(
                      locale,
                      owner.library,
                      owner.module,
                      symbolSlug(symbol, owner.symbols)
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
  /** Example colors enhance the complete server text without serializing one span per token. */
  const [highlightReady, setHighlightReady] = useState(false)
  /** Keep the first hydration render identical to the server, then restore example colors. */
  useEffect(() => {
    setHighlightReady(true)
  }, [])
  const normalizedLanguage = language.toLowerCase()
  const isTypeScript = ['ts', 'tsx', 'typescript'].includes(normalizedLanguage)
  /** Plain-text blocks in maintained docs are program output, styled as a terminal pane. */
  const isOutput = normalizedLanguage === 'text'
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
      data-output={isOutput ? 'true' : undefined}
      data-code-kind={
        signature || commentaryContext?.kind === 'signature' ? 'signature' : 'example'
      }
    >
      <figure className="code-frame">
        <figcaption className="code-toolbar">
          <span className="code-language">
            {isOutput
              ? interfaceCopyFor(locale).outputLabel
              : isTypeScript
                ? 'TypeScript'
                : language}
          </span>
          {isOutput ? null : <span className="code-file">{`${fileLabel} · ${label}`}</span>}
          <Button type="button" variant="quiet" className="code-copy-button" onClick={copyCode}>
            <span aria-live="polite">{CODE_COPY_LABELS[locale][copyState]}</span>
          </Button>
        </figcaption>
        <pre className="code-block">
          <code>
            {isTypeScript &&
            (signature || commentaryContext?.kind === 'signature' || highlightReady)
              ? highlightTypeScript(commentary.code)
              : isOutput
                ? highlightOutputComments(commentary.code)
                : commentary.code}
          </code>
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

/**
 * Output blocks print real values plainly and explain them in trailing `//` comments; only those
 * comments are tinted so the printed values stay the strongest text.
 */
function highlightOutputComments(code: string) {
  return code.split(/(\/\/[^\n]*)/g).map((part, index) =>
    part.startsWith('//') ? (
      <span className="syntax-comment" key={index}>
        {part}
      </span>
    ) : (
      part
    )
  )
}

/** Returns the next non-whitespace token after `index`, scanning only as far as needed. */
function nextSignificantToken(tokens: readonly string[], index: number): string | undefined {
  for (let next = index + 1; next < tokens.length; next++)
    if (tokens[next]?.trim()) return tokens[next]
  return undefined
}

/** Tokenizes formatted TypeScript into safe React spans using the brand code palette. */
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
  for (const [index, token] of tokens.entries()) {
    if (!token) continue
    /** Only semantic tokens need wrappers; punctuation remains readable as ordinary text. */
    let tokenClass: string | undefined
    if (token.startsWith('//') || token.startsWith('/*')) tokenClass = 'syntax-comment'
    else if (/^['"`]/.test(token)) tokenClass = 'syntax-string'
    else if (/^\d/.test(token)) tokenClass = 'syntax-number'
    else if (keywords.has(token)) tokenClass = 'syntax-keyword'
    else if (/^[A-Z]/.test(token)) tokenClass = 'syntax-type'
    else if (/^[a-z_$][\w$]*$/.test(token) && nextSignificantToken(tokens, index)?.startsWith('('))
      tokenClass = 'syntax-function'
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

/**
 * Library home strip: the npm name, current version, and a copyable install command, so a reader
 * landing on the learning path can install the package before the first example.
 */
function LibraryBand({
  library,
  locale
}: {
  readonly library: ILibrary
  readonly locale: ILocale
}) {
  const ui = interfaceCopyFor(locale)
  /** Published package name; every library ships under the `@migaia` scope. */
  const packageName = `@migaia/${library.slug}`
  /** Install command in the package manager the maintained examples use. */
  const install = `pnpm add ${packageName}`
  return (
    <div className="library-band">
      <span className="library-band-name">{packageName}</span>
      {library.version ? <span className="library-band-version">v{library.version}</span> : null}
      <span className="library-band-install">
        <span className="api-hero-label">{ui.installLabel}</span>
        <code>{install}</code>
        <CopyText locale={locale} text={install} />
      </span>
    </div>
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
  domain: _domain,
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
      <Link to={domainPath(locale)}>docs</Link>
      {library ? (
        <>
          <span>/</span>
          <Link to={domainPath(locale, library)}>{library}</Link>
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

/** Provides at most three meaningful continuation actions inside one library. */
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
  if (!library)
    return (
      <nav className="next-actions" aria-label={copy.continueReading}>
        <Link to={domainPath(locale)}>{copy.browseLibraries} →</Link>
      </nav>
    )
  return (
    <nav className="next-actions" aria-label={copy.continueReading}>
      <Link to={guidePath(locale, library)}>
        {library} · {locale === 'zh' ? '学习路径' : 'Learning path'} →
      </Link>
      <Link to={guidePath(locale, library, 'getting-started')}>
        {library} · {locale === 'zh' ? '快速开始' : 'Quick start'} →
      </Link>
      <Link to={docsModulePath(locale, library, 'index')}>{library} API →</Link>
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
      <Link className="text-link" to={domainPath(locale, library)}>
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
      <Link className="button button-primary" to={domainPath(locale)}>
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
    values: ['Values', '取值'],
    configuration: ['Configuration', '配置参考'],
    errors: ['Errors', '错误'],
    'related-apis': ['Related APIs', '相关 API'],
    members: ['Instance API', '实例 API'],
    installed: ['After installation', '安装后能力'],
    contract: ['Parameters and result', '参数与返回'],
    scenarios: ['When to use', '适用场景'],
    instance: ['Returned instance', '返回的实例'],
    signature: ['Type signature', '类型签名'],
    'core-usage': ['Contract', '参数、返回与边界']
  }
  const label = labels[section]
  return label ? label[locale === 'zh' ? 1 : 0] : localizedSection(locale, section)
}

export default Docs
