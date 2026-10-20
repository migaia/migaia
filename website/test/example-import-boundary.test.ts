import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSync } from 'oxc-parser'
import exampleImportManifest from '../src/generated/manifests/example-imports.json'
import { normalizeExampleImports } from '../app/example-imports.js'

const websiteRoot = fileURLToPath(new URL('../', import.meta.url))
const workspaceRoot = join(websiteRoot, '..')

type IManifest = {
  readonly packages: Readonly<Record<string, Readonly<Record<string, string>>>>
}

type ICodeExample = {
  readonly code: string
  readonly location: string
}

/** Returns maintained Markdown code fences that feed public website documentation. */
function markdownExamples(): ICodeExample[] {
  const examples: ICodeExample[] = []
  for (const entry of readdirSync(join(workspaceRoot, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const name of ['README.md', 'USEGUIDE.md']) {
      const path = join(workspaceRoot, 'packages', entry.name, name)
      if (!existsSync(path)) continue
      const source = readFileSync(path, 'utf8')
      for (const match of source.matchAll(/```(?:ts|tsx|typescript)\s*\n([\s\S]*?)```/giu)) {
        const line = source.slice(0, match.index).split('\n').length
        examples.push({ code: match[1], location: `${path}:${line}` })
      }
    }
  }
  return examples
}

/** Returns code-bearing string literals from the website's authored guide registries. */
function authoredGuideExamples(): ICodeExample[] {
  const examples: ICodeExample[] = []
  for (const name of ['api-guides.ts', 'guide-journeys.ts']) {
    const path = join(websiteRoot, 'app', name)
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(
      /(?:code|quickStart):\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`)/gu
    )) {
      const encoded = match[1] ?? match[2] ?? match[3] ?? ''
      const quote = match[1] !== undefined ? '"' : match[2] !== undefined ? "'" : '`'
      /** Oxc decodes the authored literal without evaluating its contents or substitutions. */
      const parsed = parseSync(path, `${quote}${encoded}${quote}`)
      assert.deepEqual(parsed.errors, [], `${path}: invalid authored example literal`)
      /** Both quoted strings and templates appear as one expression statement. */
      const statement = parsed.program.body[0]
      /** Preserve the scanner's first static template segment when substitutions are present. */
      const expression =
        statement?.type === 'ExpressionStatement' ? statement.expression : undefined
      /** Decoded static example text owns the import spellings inspected below. */
      const code =
        expression?.type === 'Literal' && typeof expression.value === 'string'
          ? expression.value
          : expression?.type === 'TemplateLiteral'
            ? (expression.quasis[0]?.value.cooked ?? '')
            : ''
      if (!code.includes('import ') || !code.includes('@migaia/')) continue
      const line = source.slice(0, match.index).split('\n').length
      examples.push({ code, location: `${path}:${line}` })
    }
  }
  return examples
}

/** Parses named imports while preserving their package root for subpath validation. */
function namedRootImports(code: string): readonly {
  readonly packageName: string
  readonly symbols: readonly string[]
}[] {
  return [
    ...code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"](@migaia\/[\w-]+)['"]/gu)
  ].map((match) => ({
    packageName: match[2],
    symbols: match[1]
      .split(',')
      .map(
        (part) =>
          part
            .trim()
            .replace(/^type\s+/u, '')
            .split(/\s+as\s+/u)[0]
      )
      .filter(Boolean)
  }))
}

test('uses the narrowest public subpath for documented symbols', () => {
  const manifest = exampleImportManifest as IManifest

  const violations: string[] = []
  for (const example of [...markdownExamples(), ...authoredGuideExamples()]) {
    for (const imported of namedRootImports(normalizeExampleImports(example.code))) {
      for (const symbol of imported.symbols) {
        const importPath = manifest.packages[imported.packageName]?.[symbol]
        if (importPath) violations.push(`${example.location}: ${symbol} -> ${importPath}`)
      }
    }
  }
  assert.deepEqual(violations, [])
})

test('splits mixed root imports and resolves public entries', () => {
  const lifecycle = normalizeExampleImports(
    "import { createLifecycleScope, createGenerationController, boundedWait } from '@migaia/lifecycle'"
  )
  assert.match(lifecycle, /from '@migaia\/lifecycle\/scope'/u)
  assert.match(lifecycle, /from '@migaia\/lifecycle\/generation'/u)
  assert.match(lifecycle, /import \{ boundedWait \} from '@migaia\/lifecycle'/u)

  const reactive = normalizeExampleImports(
    "import { claimOwnership, createRuntime } from '@migaia/reactive'"
  )
  assert.match(reactive, /from '@migaia\/reactive\/extension'/u)
  assert.doesNotMatch(reactive, /\*/u)
})
