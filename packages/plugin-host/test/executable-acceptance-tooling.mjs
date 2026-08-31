import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const packageRoot = resolve(new URL('..', import.meta.url).pathname)
const workspaceRoot = resolve(packageRoot, '../..')
const toolRoot = resolve(workspaceRoot, 'node_modules/.pnpm')
const tsc = resolve(toolRoot, 'typescript@6.0.2/node_modules/typescript/bin/tsc')
const vite = resolve(packageRoot, 'node_modules/vite/bin/vite.js')

/** Run one local tool with inherited output so its exit status is attributable. */
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'inherit' })

/** Link package-local runtime dependencies into an extracted package without registry access. */
const linkDependencies = (packageDirectory) => {
  const scopeDirectory = join(packageDirectory, 'node_modules/@migaia')
  mkdirSync(scopeDirectory, { recursive: true })
  for (const dependency of ['lifecycle', 'middleware-pipeline', 'utils'])
    symlinkSync(join(workspaceRoot, 'packages', dependency), join(scopeDirectory, dependency))
}

/** Extract one packed package and supply only local dependency links to the consumer. */
const extractPackedPackage = (temporaryDirectory) => {
  const archive = resolve(packageRoot, '.pack/migaia-plugin-host-0.0.5.tgz')
  run('tar', ['-xzf', archive, '-C', temporaryDirectory], workspaceRoot)
  const packageDirectory = join(temporaryDirectory, 'package')
  linkDependencies(packageDirectory)
  const consumerScope = join(temporaryDirectory, 'consumer/node_modules/@migaia')
  mkdirSync(consumerScope, { recursive: true })
  symlinkSync(packageDirectory, join(consumerScope, 'plugin-host'))
  return packageDirectory
}

/** Compile and execute a packed Node ESM and TypeScript consumer outside workspace resolution. */
const runPackedConsumers = (temporaryDirectory, packageDirectory) => {
  const consumerDirectory = join(temporaryDirectory, 'consumer')
  const nodeConsumer = join(consumerDirectory, 'node-consumer.mjs')
  writeFileSync(
    nodeConsumer,
    "import * as root from '@migaia/plugin-host';\nimport * as defined from '@migaia/plugin-host/defined';\nimport * as structural from '@migaia/plugin-host/structural';\nif (typeof root.definePlugin !== 'function' || typeof root.setupHost !== 'function') throw new Error('packed root');\nif (typeof defined.definePlugin !== 'function' || typeof defined.setupHost !== 'function') throw new Error('packed defined');\nif ('definePlugin' in structural || 'setupHost' in structural) throw new Error('packed structural');\nconsole.log(JSON.stringify({ nodeEsm: true, root: true, defined: true, structural: true }));\n"
  )
  run(process.execPath, [nodeConsumer], consumerDirectory)

  const typeConsumer = join(consumerDirectory, 'type-consumer.mts')
  writeFileSync(
    typeConsumer,
    "import { definePlugin, setupHost } from '@migaia/plugin-host';\nimport type { IPluginConstraint } from '@migaia/plugin-host';\nconst plugin: IPluginConstraint<Record<string, never>> = definePlugin({ name: 'typed', install: () => ({}) });\nvoid plugin;\nvoid setupHost;\n"
  )
  const config = join(consumerDirectory, 'tsconfig.json')
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        target: 'ES2022',
        lib: ['ES2022', 'ESNext.Disposable'],
        outDir: './compiled',
        skipLibCheck: false
      },
      include: ['./type-consumer.mts']
    })
  )
  run(tsc, ['-p', config], consumerDirectory)
  run(process.execPath, [join(consumerDirectory, 'compiled/type-consumer.mjs')], consumerDirectory)
  return { packageDirectory, consumerDirectory }
}

/** Build a packed subpath consumer and return actual sourcemap source entries. */
const buildPackedGraph = (temporaryDirectory, packageDirectory, subpath, forbidden) => {
  const graphDirectory = join(temporaryDirectory, `graph-${subpath}`)
  mkdirSync(graphDirectory, { recursive: true })
  writeFileSync(
    join(graphDirectory, 'entry.ts'),
    subpath === 'functional'
      ? "import { definePlugin } from '@migaia/plugin-host/defined'; export const plugin = definePlugin({ name: 'graph', install: () => ({}) });\n"
      : "import { PluginHost } from '@migaia/plugin-host/structural'; console.log(PluginHost.name);\n"
  )
  writeFileSync(
    join(graphDirectory, 'vite.config.mjs'),
    `export default { resolve: { preserveSymlinks: true }, build: { outDir: ${JSON.stringify(join(graphDirectory, 'dist'))}, emptyOutDir: true, sourcemap: true, rollupOptions: { input: ${JSON.stringify(join(graphDirectory, 'entry.ts'))}, output: { entryFileNames: 'bundle.js' } } } }\n`
  )
  const dependencyDirectory = join(graphDirectory, 'node_modules/@migaia')
  mkdirSync(dependencyDirectory, { recursive: true })
  symlinkSync(packageDirectory, join(dependencyDirectory, 'plugin-host'))
  for (const dependency of ['lifecycle', 'middleware-pipeline', 'utils'])
    symlinkSync(join(workspaceRoot, 'packages', dependency), join(dependencyDirectory, dependency))
  run(
    process.execPath,
    [vite, 'build', '--config', join(graphDirectory, 'vite.config.mjs')],
    graphDirectory
  )
  const mapPath = join(graphDirectory, 'dist/bundle.js.map')
  const map = JSON.parse(readFileSync(mapPath, 'utf8'))
  const sources = map.sources.map((source) => source.replaceAll('\\', '/'))
  if (sources.some((source) => forbidden.some((token) => source.includes(token))))
    throw new Error(`${subpath} retained forbidden module: ${sources.join(',')}`)
  return { subpath, sources, mapPath }
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'migaia-plugin-host-v16-'))
const packageDirectory = extractPackedPackage(temporaryDirectory)
const consumers = runPackedConsumers(temporaryDirectory, packageDirectory)
const functionalGraph = buildPackedGraph(temporaryDirectory, packageDirectory, 'functional', [
  '/structural.js'
])
const structuralGraph = buildPackedGraph(temporaryDirectory, packageDirectory, 'structural', [
  '/defined.js',
  '/setup-host.js',
  '/define-plugin.js'
])
console.log(
  JSON.stringify({
    consumers: { nodeEsm: true, typescript: true },
    functionalGraph: { map: functionalGraph.mapPath, retainedModules: functionalGraph.sources },
    structuralGraph: { map: structuralGraph.mapPath, retainedModules: structuralGraph.sources },
    packageDirectory: consumers.packageDirectory
  })
)
