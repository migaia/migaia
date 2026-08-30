import { Link } from 'react-router'

/** Renders the language-neutral entry that routes visitors to a canonical locale. */
export default function Home() {
  return (
    <main id="main-content" className="page-shell home-shell">
      <p className="eyebrow">Migai library documentation</p>
      <h1>Build with clear, composable libraries.</h1>
      <p className="lede">
        Choose a language, then move from a goal to the exact API and implementation path.
      </p>
      <div className="actions">
        <Link className="button button-primary" to="/en">
          English
        </Link>
        <Link className="button button-secondary" to="/zh">
          中文
        </Link>
      </div>
    </main>
  )
}
