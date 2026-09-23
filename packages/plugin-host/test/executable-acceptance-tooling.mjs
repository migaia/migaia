import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(new URL('..', import.meta.url).pathname)
const workspaceRoot = resolve(packageRoot, '../..')
const toolRoot = resolve(workspaceRoot, 'node_modules/.pnpm')
const tsc = resolve(toolRoot, 'typescript@6.0.2/node_modules/typescript/bin/tsc')
const vite = resolve(workspaceRoot, 'node_modules/vite/bin/vite.js')

/** Run one local tool with inherited output so its exit status is attributable. */
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'inherit' })

/** Execute isolated source guard mutations and require each mapped oracle to flip then restore. */
export const runRuntimeFaultProducer = () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'plugin-host-runtime-faults-'))
  const workspace = join(sandbox, 'workspace')
  const packageCopy = join(workspace, 'packages/plugin-host')
  mkdirSync(join(workspace, 'packages'), { recursive: true })
  cpSync(packageRoot, packageCopy, { recursive: true })
  cpSync(join(workspaceRoot, 'tsconfig.base.json'), join(workspace, 'tsconfig.base.json'))
  symlinkSync(join(workspaceRoot, 'node_modules'), join(workspace, 'node_modules'))
  for (const entry of readdirSync(join(workspaceRoot, 'packages')))
    if (entry !== 'plugin-host')
      symlinkSync(join(workspaceRoot, 'packages', entry), join(workspace, 'packages', entry))
  const vitest = join(workspaceRoot, 'node_modules/vitest/vitest.mjs')
  /** Retains each phase artifact so callers can audit exact baseline, fault and restoration results. */
  const results = []
  const cases = [
    [
      'src/define-plugin.ts',
      /install: \(\) => \(\{\}\)/,
      'install: args[1] as (core: object) => object',
      /descriptorFactory: args\[1\] as \(core: object\) => IPluginDescriptor/,
      'descriptorFactory: undefined',
      'test/plugin-host.test.ts',
      'YS23: keeps object extension members',
      /promise resolved/i
    ],
    [
      'src/admission-runtime.ts',
      /names\.add\(trusted\.name\)\n      return trusted/,
      'names.add(trusted.name)\n      trusted.descriptorFactory?.({} as never)\n      return trusted',
      null,
      null,
      'test/acceptance-contract.test.ts',
      'YS24: rejects a forged Feature batch',
      /AssertionError: expected 1 to be \+0/
    ],
    [
      'src/install-runtime.ts',
      /features: \{ configurable: true, get: rejectEarlyFeatureRead \}/,
      'features: { configurable: true, value: {} }',
      null,
      null,
      'test/plugin-host.test.ts',
      'YS25: rejects Feature-core reads',
      /promise resolved/i
    ],
    [
      'src/install-runtime.ts',
      /if \(Object\.hasOwn\(install, key\)\)\n        throw new PluginHostError\(\n          PluginHostErrorCode\.extensionDuplicate,\n          ERROR_TEXT\.EXTENSION_DUPLICATE\(registration\.name, key\)\n        \)/,
      'if (false) {}',
      null,
      null,
      'test/acceptance-contract.test.ts',
      'YS26: rejects equal install and expose keys',
      /promise resolved/i
    ],
    [
      'src/feature-runtime.ts',
      /Object\.freeze\(\{ featureExpose \}\)/,
      'Object.freeze({ featureExpose, getShared: () => undefined, own: () => undefined })',
      null,
      null,
      'test/acceptance-contract.test.ts',
      'YS27: injects only featureExpose',
      /AssertionError: expected \[.*featureExpose.*getShared.*own.*\] to deeply equal \[.*featureExpose.*\]/s
    ]
  ]
  for (const [
    relative,
    first,
    replacement,
    second,
    secondReplacement,
    test,
    name,
    causalFailure
  ] of cases) {
    const path = join(packageCopy, relative)
    const before = readFileSync(path, 'utf8')
    const runCase = (expectedStatus, phase) => {
      const outputFile = join(sandbox, `${name.replaceAll(/[^a-z0-9]+/gi, '-')}-${phase}.json`)
      let exitCode = 0
      let commandOutput = ''
      try {
        commandOutput = execFileSync(
          process.execPath,
          [
            vitest,
            'run',
            '--root',
            packageCopy,
            test,
            '--coverage=false',
            '--testNamePattern',
            name,
            '--reporter=json',
            '--outputFile',
            outputFile
          ],
          { cwd: packageCopy, encoding: 'utf8', stdio: 'pipe' }
        )
      } catch (error) {
        exitCode = error.status ?? 1
        commandOutput = `${error.stdout ?? ''}${error.stderr ?? ''}`
      }
      const result = JSON.parse(readFileSync(outputFile, 'utf8'))
      const assertions = result.testResults.flatMap((suite) => suite.assertionResults ?? [])
      const selected = assertions.filter((assertion) => assertion.title.startsWith(name))
      const otherAssertions = assertions.filter((assertion) => !selected.includes(assertion))
      if (
        selected.length !== 1 ||
        selected[0].status !== expectedStatus ||
        otherAssertions.some((assertion) => assertion.status !== 'skipped') ||
        result.testResults.some((suite) => suite.message) ||
        /Unhandled (?:Error|Rejection)/.test(commandOutput)
      )
        throw new Error(`unexpected Vitest JSON result: ${name}`)
      if (
        expectedStatus === 'failed' &&
        (selected[0].failureMessages.length === 0 ||
          !selected[0].failureMessages.some((message) => causalFailure.test(message)))
      )
        throw new Error(`fault did not produce an assertion failure: ${name}`)
      if ((expectedStatus === 'passed') !== (exitCode === 0))
        throw new Error(`unexpected Vitest exit: ${name}`)
      return outputFile
    }
    const baseline = runCase('passed', 'baseline')
    const count = (pattern) =>
      [
        ...before.matchAll(
          new RegExp(
            pattern.source,
            pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
          )
        )
      ].length
    if (count(first) !== 1 || (second && count(second) !== 1))
      throw new Error(`fault mutation match count is not one: ${name}`)
    let mutated = before.replace(first, replacement)
    if (second) mutated = mutated.replace(second, secondReplacement)
    try {
      writeFileSync(path, mutated)
      const fault = runCase('failed', 'fault')
      results.push({ name, baseline, fault })
    } finally {
      writeFileSync(path, before)
    }
    if (readFileSync(path, 'utf8') !== before) throw new Error(`fault restore drift: ${name}`)
    results.at(-1).restored = runCase('passed', 'restored')
  }
  return { sandbox, results }
}

/** Link package-local runtime dependencies into an extracted package without registry access. */
const linkDependencies = (packageDirectory) => {
  const scopeDirectory = join(packageDirectory, 'node_modules/@migaia')
  mkdirSync(scopeDirectory, { recursive: true })
  for (const dependency of ['capability', 'lifecycle', 'middleware-pipeline', 'utils'])
    symlinkSync(join(workspaceRoot, 'packages', dependency), join(scopeDirectory, dependency))
}

/** Extract one packed package and supply only local dependency links to the consumer. */
export const extractPackedPackage = (temporaryDirectory, archive) => {
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
    "import * as root from '@migaia/plugin-host';\nimport * as composition from '@migaia/plugin-host/composition';\nif (typeof root.definePlugin !== 'function' || typeof root.defineHost !== 'function' || typeof root.PluginHost !== 'function') throw new Error('packed root');\nif (typeof composition.openComposition !== 'function') throw new Error('packed composition');\nconsole.log(JSON.stringify({ nodeEsm: true, root: true, composition: true }));\n"
  )
  run(process.execPath, [nodeConsumer], consumerDirectory)

  const typeConsumer = join(consumerDirectory, 'type-consumer.mts')
  writeFileSync(
    typeConsumer,
    "import { defineHost, definePlugin } from '@migaia/plugin-host';\nimport type { IPluginConstraint } from '@migaia/plugin-host';\nconst plugin: IPluginConstraint<Record<string, never>> = definePlugin({ name: 'typed', install: () => ({}) });\nconst host = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } });\nvoid plugin;\nvoid host;\n"
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

/** Build a packed entry consumer and return actual sourcemap source entries. */
const buildPackedGraph = (temporaryDirectory, packageDirectory, graphName, source, forbidden) => {
  const graphDirectory = join(temporaryDirectory, `graph-${graphName}`)
  mkdirSync(graphDirectory, { recursive: true })
  writeFileSync(join(graphDirectory, 'entry.ts'), source)
  writeFileSync(
    join(graphDirectory, 'vite.config.mjs'),
    `export default { resolve: { preserveSymlinks: true }, build: { outDir: ${JSON.stringify(join(graphDirectory, 'dist'))}, emptyOutDir: true, sourcemap: true, rollupOptions: { input: ${JSON.stringify(join(graphDirectory, 'entry.ts'))}, output: { entryFileNames: 'bundle.js' } } } }\n`
  )
  const dependencyDirectory = join(graphDirectory, 'node_modules/@migaia')
  mkdirSync(dependencyDirectory, { recursive: true })
  symlinkSync(packageDirectory, join(dependencyDirectory, 'plugin-host'))
  for (const dependency of ['capability', 'lifecycle', 'middleware-pipeline', 'utils'])
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
    throw new Error(`${graphName} retained forbidden module: ${sources.join(',')}`)
  return { graphName, sources, mapPath }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const archive = process.argv[2]
  if (!archive) throw new Error('packed archive path required')
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'migaia-plugin-host-v16-'))
  const packageDirectory = extractPackedPackage(temporaryDirectory, resolve(archive))
  const consumers = runPackedConsumers(temporaryDirectory, packageDirectory)
  const pluginGraph = buildPackedGraph(
    temporaryDirectory,
    packageDirectory,
    'define-plugin',
    "import { definePlugin } from '@migaia/plugin-host'; export const plugin = definePlugin({ name: 'graph', install: () => ({}) });\n",
    ['/host-runtime.js', '/composition-entry.js']
  )
  const bareRootGraph = buildPackedGraph(
    temporaryDirectory,
    packageDirectory,
    'bare-root',
    "import '@migaia/plugin-host'; export const loaded = true;\n",
    ['/composition-entry.js']
  )
  console.log(
    JSON.stringify({
      consumers: { nodeEsm: true, typescript: true },
      pluginGraph: { map: pluginGraph.mapPath, retainedModules: pluginGraph.sources },
      bareRootGraph: { map: bareRootGraph.mapPath, retainedModules: bareRootGraph.sources },
      packageDirectory: consumers.packageDirectory
    })
  )
}
