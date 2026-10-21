import { Link, type MetaFunction as IMetaFunction } from 'react-router'
import { copyFor, domainDescription, domainTitle, interfaceCopyFor } from '../copy.js'
import { LIBRARY_INDEX, libraryReferenceDescription } from '../library-descriptions.js'
import { domainPath, type ILocale } from '../route-contract.js'
import { requestSearch } from '../search.js'

type ILanguageRouteProps = { readonly params: { readonly lang?: string } }

/** The language home is the docs home, so it carries the docs title and purpose. */
export const meta: IMetaFunction = ({ params }) => {
  const locale = params.lang === 'zh' ? 'zh' : 'en'
  return [
    { title: `${domainTitle(locale, 'docs')} · migaia` },
    { name: 'description', content: domainDescription(locale, 'docs') }
  ]
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
      'rpc-devtools'
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

/**
 * Renders the single docs home, which is also the language home. The hero (title, search entry,
 * library counts over the shared background field) leads into large outcome-first starter cards,
 * then a compact list of every library grouped by architectural role. Each entry opens that
 * library's learning path.
 */
function DocsIndex({ locale }: { locale: ILocale }) {
  const ui = interfaceCopyFor(locale)
  /** Public entry-point count shown beside the library count. */
  const entryPoints = LIBRARY_INDEX.reduce((total, library) => total + library.exports.length, 0)
  return (
    <main
      id="main-content"
      className="page-shell content-page domain-index-page"
      lang={locale}
      data-pagefind-body
    >
      <section className="docs-hero" aria-labelledby="docs-hero-title">
        <div className="docs-hero-field" aria-hidden="true" />
        <p className="eyebrow" data-reveal="0">
          {ui.heroEyebrow}
        </p>
        <h1 id="docs-hero-title" data-reveal="1">
          {domainTitle(locale, 'docs')}
        </h1>
        <p className="lede" data-reveal="2">
          {domainDescription(locale, 'docs')}
        </p>
        <div className="docs-hero-actions" data-reveal="3">
          <button className="docs-hero-search" onClick={requestSearch} type="button">
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <circle cx="7" cy="7" r="4.75" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <span>{ui.heroSearch}</span>
            <kbd>⌘K</kbd>
          </button>
        </div>
        <dl className="docs-hero-stats" data-reveal="4">
          <div>
            <dt>{LIBRARY_INDEX.length}</dt>
            <dd>{ui.heroLibraries}</dd>
          </div>
          <div>
            <dt>{entryPoints}</dt>
            <dd>{ui.heroModules}</dd>
          </div>
        </dl>
      </section>
      <section className="section-block" aria-labelledby="task-index">
        <h2 id="task-index">
          {locale === 'zh' ? '你现在想完成什么？' : 'What do you need to accomplish?'}
        </h2>
        <div className="journey-grid">
          {GUIDE_STARTERS.map((guide) => (
            <Link
              className="journey-item"
              key={guide.library}
              to={domainPath(locale, guide.library)}
            >
              <small>{guide.library}</small>
              <strong>{locale === 'zh' ? guide.titleZh : guide.titleEn}</strong>
              <span>{locale === 'zh' ? guide.bodyZh : guide.bodyEn}</span>
              <b aria-hidden="true">→</b>
            </Link>
          ))}
        </div>
      </section>
      <section className="section-block" aria-labelledby="library-index">
        <h2 id="library-index">{copyFor(locale).libraryIndex}</h2>
        <div className="architecture-stack">
          {ARCHITECTURE_FAMILIES.map((family, index) => (
            <article className="architecture-layer" key={family.titleEn}>
              <header className="architecture-layer-header">
                <span className="architecture-layer-number">0{index + 1}</span>
                <h3>{locale === 'zh' ? family.titleZh : family.titleEn}</h3>
                <p>{locale === 'zh' ? family.bodyZh : family.bodyEn}</p>
              </header>
              <nav
                aria-label={
                  locale === 'zh' ? `${family.titleZh}类库` : `${family.titleEn} libraries`
                }
              >
                {family.libraries.map((library) => (
                  <Link className="library-item" key={library} to={domainPath(locale, library)}>
                    <strong>{library}</strong>
                    <span>{libraryReferenceDescription(locale, library)}</span>
                    <small>
                      v{LIBRARY_INDEX.find((entry) => entry.slug === library)?.version ?? '—'}
                    </small>
                  </Link>
                ))}
              </nav>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

/** Resolves the route locale and renders the docs home. */
function Language({ params }: ILanguageRouteProps) {
  return <DocsIndex locale={params.lang === 'zh' ? 'zh' : 'en'} />
}

export default Language
