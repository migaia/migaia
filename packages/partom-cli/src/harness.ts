import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import { PartCliErrorCode } from './error-code.ts'
import { createPartCliError, PartCliText } from './errors.ts'
import { scopedResolver, type Project } from './project.ts'

/** Usual macOS, Linux and Windows locations of a locally installed Chrome. */
const LOCAL_CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
] as const

/**
 * Picks the browser executable: explicit path, then PARTOM_BROWSER, then local Chrome, then the
 * installed Chromium.
 */
export function browserPath(explicit: string | undefined): string {
  /** Explicit choice from the flag or the environment; it never falls back. */
  const chosen = explicit ?? process.env.PARTOM_BROWSER
  if (chosen !== undefined) {
    if (existsSync(chosen)) return chosen
    throw createPartCliError(PartCliErrorCode.browserNotFound, PartCliText.browserNotFound)
  }
  for (const candidate of LOCAL_CHROME) if (existsSync(candidate)) return candidate
  /** Chromium installed by `partom browser install`. */
  const installed = chromium.executablePath()
  if (existsSync(installed)) return installed
  throw createPartCliError(PartCliErrorCode.browserNotFound, PartCliText.browserNotFound)
}

/** Environment variables inlined into browser bundles: only this public prefix, never the rest. */
const PUBLIC_ENV = 'PARTOM_PUBLIC_*'

/** Source of the page entry: it imports the project's packages and exposes check functions. */
function entrySource(configPath: string, extraImports: string): string {
  return `
import config from ${JSON.stringify(configPath)}
import { createPartHost } from '@migaia/part-host'
import { domPlugin } from '@migaia/part-plugin-dom'
import { reactPlugin } from '@migaia/part-plugin-react'
import { checkPattern } from '@ui-sdk/core/testing'
${extraImports}
function focusProblems(phase) {
  const active = document.activeElement
  if (active === null || active === document.body) return ['after ' + phase + ', focus fell to the body']
  if (active.closest('[inert], [aria-hidden="true"]') !== null) return ['after ' + phase + ', focus is inside inert or aria-hidden content']
  return []
}
window.__partom = { config, createPartHost, domPlugin, reactPlugin, checkPattern, focusProblems }
`
}

/**
 * Bundles a generated browser entry from the project directory: writes `entry.tsx` into `dir` and
 * builds it into `outDir`, so project packages resolve from the project. Doctor's check page and
 * `partom preview` share this. Environment variables named `PARTOM_PUBLIC_*` are inlined so a
 * config can read them in the browser; no other variable reaches the bundle. Throws an
 * `AggregateError` of the build logs on failure. `conditions` are export conditions tried before
 * `import`/`default`; `partom preview --editor` passes `development`.
 */
export async function bundleEntry(
  dir: string,
  outDir: string,
  source: string,
  conditions: readonly string[] = []
): Promise<void> {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'entry.tsx'), source)
  /** Bundle result. */
  const result = await Bun.build({
    entrypoints: [join(dir, 'entry.tsx')],
    outdir: outDir,
    target: 'browser',
    sourcemap: 'linked',
    plugins: [scopedResolver(conditions)],
    conditions: [...conditions],
    define: { 'process.env.NODE_ENV': '"development"' },
    env: PUBLIC_ENV
  })
  if (!result.success) throw new AggregateError(result.logs, PartCliText.harnessFailed)
}

/**
 * Check page: an entry bundled by Bun from the project directory, served on loopback, and opened in
 * a headless browser. Resources close in reverse order: browser, server, temporary directory.
 */
export class Harness {
  /** Open page. */
  readonly page: Page
  /** Browser process. */
  readonly #browser: Browser
  /** Loopback server. */
  readonly #server: ReturnType<typeof Bun.serve>
  /** Temporary build directory inside the project. */
  readonly #dir: string

  /** Captures opened resources. */
  private constructor(
    page: Page,
    browser: Browser,
    server: ReturnType<typeof Bun.serve>,
    dir: string
  ) {
    this.page = page
    this.#browser = browser
    this.#server = server
    this.#dir = dir
  }

  /** Builds and opens the check page; `extraImports` adds modules such as extracted components. */
  static async open(
    project: Project,
    configPath: string,
    browser: string | undefined,
    extraImports = ''
  ): Promise<Harness> {
    /** Executable chosen before any build work. */
    const executable = browserPath(browser)
    /** Temporary directory inside the project so the bundler resolves project packages. */
    const dir = join(project.dir, '.partom-check')
    mkdirSync(dir, { recursive: true })
    try {
      await bundleEntry(dir, join(dir, 'out'), entrySource(configPath, extraImports))
      writeFileSync(
        join(dir, 'out', 'index.html'),
        '<!doctype html><html><body><script type="module" src="./entry.js"></script></body></html>'
      )
      /** Loopback static server of the bundle. */
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: (request) => serveFile(join(dir, 'out'), request)
      })
      /** Headless browser. */
      const launched = await chromium.launch({ executablePath: executable, headless: true })
      /** Page with the bundle loaded. */
      const page = await launched.newPage()
      await page.goto(`http://127.0.0.1:${server.port}/index.html`)
      await page.waitForFunction('window.__partom !== undefined')
      return new Harness(page, launched, server, dir)
    } catch (cause) {
      rmSync(dir, { recursive: true, force: true })
      if ((cause as { code?: unknown }).code === PartCliErrorCode.browserNotFound) throw cause
      throw createPartCliError(PartCliErrorCode.harnessFailed, PartCliText.harnessFailed, cause)
    }
  }

  /** Closes browser, server and temporary directory; later failures do not hide earlier ones. */
  async close(): Promise<void> {
    await this.#browser.close().catch(() => undefined)
    this.#server.stop(true)
    rmSync(this.#dir, { recursive: true, force: true })
  }
}

/** Serves one file of the bundle directory. */
function serveFile(root: string, request: Request): Response {
  /** Requested path without query. */
  const path = new URL(request.url).pathname
  /** File on disk. */
  const file = Bun.file(join(root, path === '/' ? 'index.html' : path))
  return existsSync(join(root, path)) ? new Response(file) : new Response(null, { status: 404 })
}
