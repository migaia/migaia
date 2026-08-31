import { Link } from 'react-router'
import { copyFor } from '../copy.js'
import { domainPath, type ILocale } from '../route-contract.js'

/** Lowest-dependency entry promoted by the first-use journey. */
const STARTER_LIBRARY = 'utils'

type ILanguageRouteProps = { readonly params: { readonly lang?: string } }

/** Renders the first-use journey: capability map, quickstart, goals, and architecture preview. */
function Language({ params }: ILanguageRouteProps) {
  const locale = (params.lang === 'zh' ? 'zh' : 'en') as ILocale
  const chinese = locale === 'zh'
  const copy = copyFor(locale)
  return (
    <main id="main-content" className="page-shell language-home" lang={locale} data-pagefind-body>
      <p className="eyebrow">{chinese ? 'Migaia 文档' : 'Migaia documentation'}</p>
      <h1>
        {chinese
          ? '用清晰、可组合的类库构建系统。'
          : 'Build with clear, composable libraries.'}
      </h1>
      <p className="lede">
        {chinese
          ? '从一个目标开始，沿着真实的类库、模块与 API 走到可验证结果。'
          : 'Start with a goal and follow a verified path through libraries, modules, and APIs.'}
      </p>
      <div className="actions">
        <Link className="button button-primary" to={domainPath(locale, 'docs')}>
          {chinese ? '开始查文档' : 'Start with Docs'}
        </Link>
        <Link className="button button-secondary" to={domainPath(locale, 'guides')}>
          {chinese ? '浏览指南' : 'Browse Guides'}
        </Link>
      </div>
      <section className="section-block" aria-labelledby="capabilities">
        <p className="eyebrow">{copy.capabilityMap}</p>
        <h2 id="capabilities">{copy.shortestPath}</h2>
        <div className="capability-grid">
          <Link className="capability-item" to={domainPath(locale, 'docs', STARTER_LIBRARY)}>
            <strong>{copy.foundation}</strong>
            <span>{copy.foundationText}</span>
          </Link>
          <Link className="capability-item" to={domainPath(locale, 'guides', STARTER_LIBRARY)}>
            <strong>{copy.runtime}</strong>
            <span>{copy.runtimeText}</span>
          </Link>
          <Link className="capability-item" to={domainPath(locale, 'docs', 'store-light')}>
            <strong>{copy.stateStorage}</strong>
            <span>{copy.stateStorageText}</span>
          </Link>
          <Link className="capability-item" to={domainPath(locale, 'architecture', 'web-rpc')}>
            <strong>{copy.integration}</strong>
            <span>{copy.integrationText}</span>
          </Link>
        </div>
      </section>
      <section className="section-block split-block" aria-labelledby="quickstart">
        <div>
          <p className="eyebrow">{copy.startFive}</p>
          <h2 id="quickstart">{copy.smallResult}</h2>
          <p>{copy.quickstartBody}</p>
        </div>
        <Link className="callout" to={domainPath(locale, 'docs', STARTER_LIBRARY)}>
          <span>{STARTER_LIBRARY}</span>
          <strong>
            {chinese
              ? `${STARTER_LIBRARY} 的源码契约与公开能力。`
              : 'Runtime-neutral reusable utility primitives.'}
          </strong>
          <span>{copy.readQuickstart}</span>
        </Link>
      </section>
      <section className="section-block" aria-labelledby="goals">
        <p className="eyebrow">{copy.chooseGoal}</p>
        <h2 id="goals">{copy.oneDestination}</h2>
        <div className="goal-list">
          <Link to={domainPath(locale, 'docs')}>{copy.apiQuestion}</Link>
          <Link to={domainPath(locale, 'guides')}>{copy.taskQuestion}</Link>
          <Link to={domainPath(locale, 'architecture')}>{copy.designQuestion}</Link>
        </div>
      </section>
      <section className="section-block architecture-preview">
        <p className="eyebrow">{copy.architecturePreview}</p>
        <h2>{copy.architectureTitle}</h2>
        <p>{copy.architectureBody}</p>
        <Link className="text-link" to={domainPath(locale, 'architecture')}>
          {copy.layerMap}
        </Link>
      </section>
    </main>
  )
}

export default Language
