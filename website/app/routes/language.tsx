import { Link, type MetaFunction as IMetaFunction } from 'react-router'
import { copyFor } from '../copy.js'
import { domainPath, type ILocale } from '../route-contract.js'

/** Lowest-dependency entry promoted by the first-use journey. */
const STARTER_LIBRARY = 'utils'

type ILanguageRouteProps = { readonly params: { readonly lang?: string } }

/** Reuses the reviewed localized home purpose in the search description. */
export const meta: IMetaFunction = ({ params }) => [
  { title: 'migaia' },
  {
    name: 'description',
    content: copyFor(params.lang === 'zh' ? 'zh' : 'en').homeDescription
  }
]

/** Connects application scenarios to package references and common library combinations. */
function Language({ params }: ILanguageRouteProps) {
  /** Selects the canonical locale for page copy and all documentation links. */
  const locale = (params.lang === 'zh' ? 'zh' : 'en') as ILocale
  /** Chooses the existing localized navigation labels. */
  const chinese = locale === 'zh'
  /** Reviewed home data is the single source for the hero and scenario cards. */
  const copy = copyFor(locale)
  return (
    <main id="main-content" className="page-shell language-home" lang={locale} data-pagefind-body>
      <p className="eyebrow">{copy.homeEyebrow}</p>
      <h1>{copy.homeTitle}</h1>
      <p className="lede">{copy.homeDescription}</p>
      <div className="actions">
        <Link className="button button-primary" to={domainPath(locale, 'docs')}>
          {chinese ? '开始查文档' : 'Start with Docs'}
        </Link>
        <Link className="button button-secondary" to={domainPath(locale, 'guides')}>
          {chinese ? '浏览指南' : 'Browse Guides'}
        </Link>
      </div>
      <section className="section-block" aria-labelledby="capabilities">
        <p className="eyebrow">{copy.scenarios}</p>
        <h2 id="capabilities">{copy.scenarioTitle}</h2>
        <div className="capability-grid home-scenarios">
          {copy.homeScenarios.map((scenario) => (
            <article className="capability-item" key={scenario.title}>
              <strong>{scenario.title}</strong>
              <p>{scenario.body}</p>
              <nav className="actions home-scenario-links" aria-label={scenario.title}>
                {scenario.libraries.map((library) => (
                  <Link
                    className="text-link"
                    key={library}
                    to={domainPath(locale, 'docs', library)}
                  >
                    {library}
                  </Link>
                ))}
              </nav>
            </article>
          ))}
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
      <section className="section-block" aria-labelledby="combinations">
        <p className="eyebrow">{copy.commonCombinations}</p>
        <h2 id="combinations">{copy.combinationTitle}</h2>
        <div className="capability-grid">
          <Link className="capability-item" to={domainPath(locale, 'architecture', 'resource')}>
            <strong>{copy.reactiveResource}</strong>
            <span>{copy.reactiveResourceText}</span>
          </Link>
          <Link className="capability-item" to={domainPath(locale, 'architecture', 'plugin-host')}>
            <strong>{copy.capabilityPluginHost}</strong>
            <span>{copy.capabilityPluginHostText}</span>
          </Link>
          <Link className="capability-item" to={domainPath(locale, 'architecture', 'rpc-core')}>
            <strong>{copy.rpcPeerSerialize}</strong>
            <span>{copy.rpcPeerSerializeText}</span>
          </Link>
          <Link className="capability-item" to={domainPath(locale, 'architecture', 'tray')}>
            <strong>{copy.traySupervision}</strong>
            <span>{copy.traySupervisionText}</span>
          </Link>
        </div>
      </section>
    </main>
  )
}

export default Language
