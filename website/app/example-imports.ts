import exampleImportManifest from '../src/generated/manifests/example-imports.json'

type IExampleImportManifest = {
  readonly packages: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** Current package-owned symbol-to-subpath projection generated from public exports. */
const exampleImports = (exampleImportManifest as IExampleImportManifest).packages

/** Formats one named import without hiding type-only bindings from readers. */
function formatNamedImport(packageName: string, bindings: readonly string[]): string {
  const compact = `import { ${bindings.join(', ')} } from '${packageName}'`
  if (compact.length <= 88) return compact
  return `import {\n${bindings.map((binding) => `  ${binding},`).join('\n')}\n} from '${packageName}'`
}

/** Rewrites documented root imports to their narrowest public symbol owner. */
export function normalizeExampleImports(code: string): string {
  return code.replace(
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"](@migaia\/[\w-]+)['"];?/gu,
    (_statement, typeOnly: string | undefined, body: string, packageName: string) => {
      const boundaries = exampleImports[packageName]
      if (!boundaries) return _statement
      const grouped = new Map<string, string[]>()
      for (const rawBinding of body.split(',')) {
        const binding = rawBinding.trim()
        if (!binding) continue
        const importedName = binding.replace(/^type\s+/u, '').split(/\s+as\s+/u)[0]
        const owner = boundaries[importedName] ?? packageName
        const values = grouped.get(owner) ?? []
        values.push(typeOnly ? binding.replace(/^type\s+/u, '') : binding)
        grouped.set(owner, values)
      }
      return [...grouped.entries()]
        .map(([owner, bindings]) => {
          const declaration = formatNamedImport(owner, bindings)
          return typeOnly ? declaration.replace(/^import /u, 'import type ') : declaration
        })
        .join('\n')
    }
  )
}
