import { redirect, type MetaFunction as IMetaFunction } from 'react-router'
import { preferredLocale } from '../locale-preference.js'

/** Shared page purpose for the neutral home introduction and its search description. */
const HOME_DESCRIPTION =
  'Move from a goal to the exact API, implementation path, and architectural boundary.'

/** Supplies the language-neutral home title and its existing one-sentence purpose. */
export const meta: IMetaFunction = () => [
  { title: 'migaia' },
  { name: 'description', content: HOME_DESCRIPTION }
]

/**
 * Sends the site root to a language home: the reader's last visited language, else the browser
 * language. Runs in the browser only; the prerendered root keeps the neutral introduction below.
 */
export async function clientLoader() {
  throw redirect(`/${await preferredLocale()}`)
}

/** Runs the redirect on the first page load, not only on client-side navigation to the root. */
clientLoader.hydrate = true as const

/** Describes the three documentation paths available from the global navigation. */
const DOCUMENTATION_PATHS = [
  {
    title: 'API reference',
    description: 'Inspect public entry points, signatures, options, return values, and boundaries.'
  },
  {
    title: 'Task guides',
    description: 'Start from a concrete goal and follow a complete, production-oriented example.'
  },
  {
    title: 'Architecture',
    description: 'Understand ownership, dependency direction, lifecycle, and library composition.'
  }
] as const

/** Renders the language-neutral entry without duplicating the header language control. */
function Home() {
  return (
    // No data-pagefind-body: the root only redirects, so search must never return it.
    <main id="main-content" className="page-shell home-shell">
      <p className="eyebrow">Migaia library documentation</p>
      <h1>Build with clear, composable libraries.</h1>
      <p className="lede">{HOME_DESCRIPTION}</p>
      <dl className="home-paths" aria-label="Documentation paths">
        {DOCUMENTATION_PATHS.map((path) => (
          <div key={path.title}>
            <dt>{path.title}</dt>
            <dd>{path.description}</dd>
          </div>
        ))}
      </dl>
    </main>
  )
}

/** Prerendered root markup shown until the redirect runs, and to readers without JavaScript. */
export const HydrateFallback = Home

export default Home
