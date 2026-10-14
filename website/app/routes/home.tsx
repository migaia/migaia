import type { MetaFunction as IMetaFunction } from 'react-router'

/** Shared page purpose for the neutral home introduction and its search description. */
const HOME_DESCRIPTION =
  'Move from a goal to the exact API, implementation path, and architectural boundary.'

/** Supplies the language-neutral home title and its existing one-sentence purpose. */
export const meta: IMetaFunction = () => [
  { title: 'migaia' },
  { name: 'description', content: HOME_DESCRIPTION }
]

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
    <main id="main-content" className="page-shell home-shell" data-pagefind-body>
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

export default Home
