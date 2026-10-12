/** Check maintained TypeScript examples through built package exports, then execute marked groups. */
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * @typedef {{
 *   path: string
 *   package: string
 *   section: string
 *   sectionLine: number
 *   line: number
 *   language: string
 *   code: string
 *   mode: string
 *   file?: string
 *   group?: string
 *   entry?: string
 *   reason?: string
 *   errors: string[]
 * }} IExample
 */
/** @typedef {{ key: string; directory: string; examples: IExample[]; entries: string[] }} IExampleGroup */
/** @typedef {{ example: IExample; start: number; length: number }} ISourceSegment */
/** @typedef {{ example: IExample; segments: ISourceSegment[]; group: IExampleGroup }} ISource */
/**
 * @typedef {{
 *   example: IExample
 *   status: string
 *   diagnostics: string[]
 *   execution?: { entry: string; code: number; stdout: string; stderr: string }[]
 * }} IExampleResult
 */

/** Every invocation resolves packages and ignored evidence relative to this checkout. */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** An example must terminate and release its resources instead of holding CI indefinitely. */
const executionTimeoutMs = 30_000
/** Interrupting this invocation prevents it from starting another example after owned cleanup. */
let interrupted = false
/** Only these explicit modes alter the default TypeScript compilation behavior. */
const modes = new Set(['check', 'fragment', 'run', 'skip'])
/** Result names distinguish compilation, execution and explicitly unavailable coverage. */
const Status = Object.freeze({
  checkPass: 'TYPECHECK-PASS',
  checkFail: 'TYPECHECK-FAIL',
  checkBlocked: 'TYPECHECK-BLOCKED',
  runPass: 'RUN-PASS',
  runFail: 'RUN-FAIL',
  configFail: 'CONFIG-FAIL',
  skip: 'SKIP',
  skipWarning: 'SKIP-WARN',
  resource: 'RESOURCE'
})
/** Metadata diagnostics remain stable across CLI output and saved evidence. */
const Text = Object.freeze({
  skipReason: 'doc-test=skip requires a one-line reason or an adjacent doc-test-skip comment.',
  filename: 'file must be a relative path without empty, dot, parent or node_modules segments.',
  tsFilename: 'A ts fence file must end in .ts, .tsx, .mts or .cts.',
  resourceFilename: 'A Python run resource requires file=<name>.py.',
  unclosed: 'The fenced example has no closing fence.',
  entry: 'A multi-file run group requires main.ts, parent.ts, index.ts or explicit entry=<file>.',
  blockedRun:
    'Execution was not reached because this group failed compilation or metadata admission.',
  pythonMissing: 'python3 is unavailable; Python execution was not reached.',
  timeout: 'The example exceeded its 30000 ms execution deadline.'
})

/**
 * Read one-line metadata without changing the first language word consumed by the website.
 *
 * @param {string} info Fence text after the language.
 * @returns {Record<string, string>} Explicit key/value attributes.
 */
function metadata(info) {
  /** Quoted reasons may contain spaces; other attributes use their literal token. */
  const values = {}
  for (const match of info.matchAll(/([\w-]+)=(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(\S+))/g))
    values[match[1]] = (match[2] ?? match[3] ?? match[4]).replace(/\\(["'\\])/g, '$1')
  return values
}

/**
 * Extract maintained ts fences and explicitly marked Python resources with exact document lines.
 * Every Markdown heading begins a section; explicit groups can connect sections in one package.
 *
 * @param {string} markdown Maintained README or USEGUIDE text.
 * @param {string} path Repository-relative document path.
 * @returns {IExample[]} Selected examples, including invalid metadata for honest failure reporting.
 * @throws {TypeError} When Markdown or the repository-relative path is not text.
 */
export function extractExamples(markdown, path) {
  /** Source lines provide both context labels and reproducible fence locations. */
  const lines = markdown.split(/\r?\n/)
  /** Heading ancestry names the exact current section without merging repeated headings. */
  const headings = []
  /** All selected blocks retain their original code without rewriting imports or declarations. */
  const examples = []
  /** Introduction is a real grouping boundary before the first heading. */
  let sectionLine = 0
  for (let index = 0; index < lines.length; index++) {
    /** A fenced block owns its contents, so headings inside it never split a group. */
    const opening = lines[index].match(/^ {0,3}(`{3,}|~{3,})([^\s`]*)\s*(.*)$/)
    if (!opening) {
      /** The current heading path is presentation; its line owns section membership. */
      const heading = lines[index].match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*$/)
      if (heading) {
        headings.length = heading[1].length - 1
        headings.push(heading[2])
        sectionLine = index + 1
      }
      continue
    }
    /** The opening line remains stable while the loop consumes this complete fence. */
    const openingIndex = index
    /** A matching closer must use the opening marker and at least its marker count. */
    const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`)
    /** Retain code lines exactly; scratch modules add only a module boundary. */
    const code = []
    while (++index < lines.length && !closing.test(lines[index])) code.push(lines[index])
    /** Attributes are separate from the website's unchanged first language word. */
    const attributes = metadata(opening[3])
    /** Python is a resource only when the author explicitly marks it to run. */
    const language = opening[2]
    if (
      language !== 'ts' &&
      !(['py', 'python'].includes(language) && attributes['doc-test'] === 'run')
    )
      continue
    /** Invalid blocks are retained instead of being silently excluded from the gate. */
    const errors = []
    /** Unmarked TypeScript remains checked; a missing import may select earlier section context. */
    const mode = attributes['doc-test'] ?? 'auto'
    if (mode !== 'auto' && !modes.has(mode)) errors.push(`Unknown doc-test mode: ${mode}.`)
    if (index >= lines.length) errors.push(Text.unclosed)
    /** An immediately adjacent one-line comment is also explicit skip evidence. */
    const comment = [lines[openingIndex - 1], lines[index + 1]]
      .map((line) => line?.match(/^\s*<!--\s*doc-test-skip:\s*(.+?)\s*-->\s*$/)?.[1])
      .find(Boolean)
    /** Skip reasons belong to the authored fence, never inferred from a compiler failure. */
    const reason = attributes.reason ?? comment
    if (mode === 'skip' && (!reason?.trim() || /[\r\n]/.test(reason))) errors.push(Text.skipReason)
    /** Scratch paths are local module names, never a way to write into package or user files. */
    const file = attributes.file
    if (
      file &&
      (file.startsWith('/') ||
        file.includes('\\') ||
        file
          .split('/')
          .some((part) => !part || part === '.' || part === '..' || part === 'node_modules'))
    )
      errors.push(Text.filename)
    if (file && language === 'ts' && !/\.(?:ts|tsx|mts|cts)$/.test(file))
      errors.push(Text.tsFilename)
    if (language !== 'ts' && (!file || !file.endsWith('.py'))) errors.push(Text.resourceFilename)
    examples.push({
      path,
      package: path.split('/')[1],
      section: headings.filter(Boolean).join(' > ') || 'Introduction',
      sectionLine,
      line: openingIndex + 1,
      language,
      code: code.join('\n'),
      mode,
      file,
      group: attributes.group,
      entry: attributes.entry,
      reason,
      errors
    })
  }
  return examples
}

/**
 * Group named modules and resources without sharing names across workspace packages.
 *
 * @param {IExample[]} examples Selected maintained examples.
 * @returns {IExampleGroup[]} Groups in maintained document order.
 * @throws {TypeError} When the input does not contain extracted example records.
 */
export function groupExamples(examples) {
  /** Explicit package-local keys support a README parent using its USEGUIDE child resource. */
  const groups = new Map()
  for (const example of examples) {
    /** An unnamed independent block cannot collide with another complete example. */
    const key = example.group
      ? `${example.package}:group:${example.group}`
      : example.file
        ? `${example.path}:section:${example.sectionLine}`
        : `${example.path}:block:${example.line}`
    if (!groups.has(key))
      groups.set(key, { key, directory: `group-${groups.size}`, examples: [], entries: [] })
    groups.get(key).examples.push(example)
  }
  for (const group of groups.values()) {
    /** Duplicate names would overwrite a real example; fail the authors' blocks instead. */
    const names = new Map()
    for (const example of group.examples) {
      if (example.mode === 'skip' || !example.file) continue
      if (names.has(example.file)) {
        example.errors.push(`Duplicate example file: ${example.file}.`)
        names.get(example.file).errors.push(`Duplicate example file: ${example.file}.`)
      } else names.set(example.file, example)
    }
    /** Only TypeScript entry modules execute; Python files are resources of their actual parent. */
    const running = group.examples.filter(
      (example) => example.language === 'ts' && example.mode === 'run'
    )
    if (!running.length) continue
    /** Multiple explicit parents may exercise the same actual named child module. */
    const explicit = [...new Set(running.map((example) => example.entry).filter(Boolean))]
    if (explicit.length) group.entries = explicit
    else {
      /** Conventional parent names avoid accidentally executing a child-only resource forever. */
      const conventional = ['main.ts', 'parent.ts', 'index.ts'].find((name) => names.has(name))
      if (conventional) group.entries = [conventional]
      else if (running.length === 1)
        group.entries = [running[0].file ?? `block-${running[0].line}.ts`]
      else for (const example of running) example.errors.push(Text.entry)
    }
    for (const entry of group.entries)
      if (!running.some((example) => (example.file ?? `block-${example.line}.ts`) === entry))
        for (const example of running)
          example.errors.push(`Run entry is not a marked TypeScript file: ${entry}.`)
  }
  return [...groups.values()]
}

/**
 * Link actual package roots and installed external dependencies inside this invocation's scratch.
 * Package exports remain authoritative; no TypeScript paths map can substitute package source.
 *
 * @param {string} scratch Invocation-owned directory.
 * @param {string} root Checkout containing built packages and installed dependencies.
 * @param {string[]} packages Manifest-bearing package roots.
 * @returns {void}
 */
function linkPackages(scratch, root, packages) {
  /** Every link lives inside the new scratch; no existing workspace link is changed. */
  const modules = join(scratch, 'node_modules')
  mkdirSync(modules)
  for (const packageRoot of packages) {
    /** The published name selects the ordinary Node/TypeScript package resolution path. */
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    const link = join(modules, manifest.name)
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(packageRoot, link, 'dir')
  }
  for (const directory of [
    join(root, 'node_modules'),
    ...packages.map((packageRoot) => join(packageRoot, 'node_modules')),
    // Installed transitive types remain visible after logical consumer resolution preserves symlinks.
    join(root, 'node_modules/.pnpm/node_modules')
  ]) {
    if (!existsSync(directory)) continue
    for (const name of readdirSync(directory)) {
      if (name.startsWith('.') || name === '@migaia') continue
      /** Scoped external dependencies are linked by member so one scope cannot hide another. */
      const members = name.startsWith('@')
        ? readdirSync(join(directory, name)).map((member) => `${name}/${member}`)
        : [name]
      for (const member of members) {
        const link = join(modules, member)
        if (existsSync(link)) continue
        mkdirSync(dirname(link), { recursive: true })
        symlinkSync(join(directory, member), link, 'dir')
      }
    }
  }
}

/**
 * Emit isolated modules in one compiler program, mapping every diagnostic back to maintained text.
 *
 * @param {IExampleGroup[]} groups Package-local module groups.
 * @param {IExample[]} examples Ordered examples used for section fragment context.
 * @param {string} scratch Invocation-owned directory.
 * @param {Map<IExample, IExampleResult>} results Mutable per-example evidence records.
 * @returns {string[]} Shared compiler diagnostics, which also block execution.
 */
function compileExamples(groups, examples, scratch, results) {
  /** Actual scratch modules retain provenance segments for earlier fragment context. */
  const sources = new Map()
  for (const group of groups) {
    /** Owner-specific installed dependencies take precedence over the root toolchain fallback. */
    const ownerModules = join(repositoryRoot, 'packages', group.examples[0].package, 'node_modules')
    for (const tree of ['src', 'out']) {
      const directory = join(scratch, tree, group.directory)
      mkdirSync(directory, { recursive: true })
      if (existsSync(ownerModules))
        symlinkSync(ownerModules, join(directory, 'node_modules'), 'dir')
    }
    for (const example of group.examples) {
      if (example.errors.length || example.mode === 'skip') continue
      /** Resource paths and TypeScript module paths share the same emitted group directory. */
      const filename = example.file ?? `block-${example.line}.ts`
      const input = join(scratch, 'src', group.directory, filename)
      const output = join(scratch, 'out', group.directory, filename)
      mkdirSync(dirname(input), { recursive: true })
      mkdirSync(dirname(output), { recursive: true })
      if (example.language !== 'ts') {
        writeFileSync(output, `${example.code}\n`, { flag: 'wx' })
        continue
      }
      /** Explicit check/run modules stay independent even if their complete code has no imports. */
      const earlier = examples.filter(
        (previous) =>
          previous.path === example.path &&
          previous.sectionLine === example.sectionLine &&
          previous.line < example.line &&
          previous.language === 'ts' &&
          previous.mode !== 'skip' &&
          !previous.errors.length
      )
      const fragment =
        example.mode === 'fragment' ||
        (example.mode === 'auto' &&
          earlier.length > 0 &&
          !/^\s*(?:import\s|import\{|export\s|export\{)/m.test(example.code))
      /** Fragment modules contain real earlier text rather than invented ambient declarations. */
      const context = fragment ? [...earlier, example] : [example]
      const segments = []
      let line = 0
      let code = ''
      for (const member of context) {
        const length = member.code.split('\n').length
        segments.push({ example: member, start: line, length })
        code += `${member.code}\n`
        line += length
      }
      code += 'export {}\n'
      writeFileSync(input, code, { flag: 'wx' })
      /** Keep original .ts resources beside emitted .js so documented TS entry URLs run unchanged. */
      writeFileSync(output, code, { flag: 'wx' })
      sources.set(input, { example, segments, group })
    }
  }
  /** NodeNext follows real package exports; DOM covers browser examples without fake globals. */
  const program = ts.createProgram([...sources.keys()], {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    // Keep the complete isolated consumer visible when imported declarations resolve dependencies.
    // This changes only logical location; package.json exports still select actual built declarations.
    preserveSymlinks: true,
    strict: true,
    skipLibCheck: false,
    types: ['node'],
    typeRoots: [join(scratch, 'node_modules', '@types')],
    lib: ['lib.es2024.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.esnext.disposable.d.ts'],
    jsx: ts.JsxEmit.ReactJSX,
    rootDir: join(scratch, 'src'),
    outDir: join(scratch, 'out'),
    noEmitOnError: false
  })
  /** Type errors remain visible even when unrelated modules are executable. */
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics]
  const shared = []
  for (const diagnostic of diagnostics) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue
    const message = `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`
    const source = diagnostic.file && sources.get(diagnostic.file.fileName)
    if (!source) {
      const location = diagnostic.file
        ? `${relative(repositoryRoot, realpathSync(diagnostic.file.fileName))}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}`
        : 'compiler'
      shared.push(`${location}: ${message}`)
      continue
    }
    /** A diagnostic in inherited text names that original block rather than a scratch line. */
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
    const segment = source.segments.find(
      (entry) => position.line >= entry.start && position.line < entry.start + entry.length
    )
    const origin = segment?.example ?? source.example
    const line = origin.line + 1 + position.line - (segment?.start ?? 0)
    results
      .get(source.example)
      .diagnostics.push(`${origin.path}:${line}:${position.character + 1}: ${message}`)
  }
  for (const source of sources.values()) {
    const result = results.get(source.example)
    result.status = result.diagnostics.length
      ? Status.checkFail
      : shared.length
        ? Status.checkBlocked
        : Status.checkPass
  }
  return shared
}

/**
 * Execute one emitted parent with captured output and terminate only its owned process group.
 *
 * @param {string} entry Absolute emitted entry path.
 * @returns {Promise<{ entry: string; code: number; stdout: string; stderr: string }>}
 */
function executeExample(entry) {
  return new Promise((finish) => {
    /** A detached local group lets timeout cleanup reach descendants belonging to this example. */
    const child = spawn(process.execPath, [entry], {
      cwd: dirname(entry),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let killTimer
    /** Cancellation never targets another invocation or a global process inventory. */
    const terminate = (signal) => {
      if (!child.pid) return
      try {
        process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal)
      } catch (error) {
        if (error.code !== 'ESRCH') stderr += `${error.stack ?? error}\n`
      }
    }
    const cancel = () => {
      interrupted = true
      terminate('SIGTERM')
      killTimer ??= setTimeout(() => terminate('SIGKILL'), 1000)
    }
    process.once('SIGINT', cancel)
    process.once('SIGTERM', cancel)
    const timer = setTimeout(() => {
      timedOut = true
      stderr += `${Text.timeout}\n`
      terminate('SIGTERM')
      killTimer = setTimeout(() => terminate('SIGKILL'), 1000)
    }, executionTimeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      stderr += `${error.stack ?? error}\n`
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      process.removeListener('SIGINT', cancel)
      process.removeListener('SIGTERM', cancel)
      finish({ entry, code: timedOut ? 124 : (code ?? 1), stdout, stderr })
    })
  })
}

/**
 * Check every maintained ts block and execute only explicitly marked package-local groups. Requires
 * packages to be built first; never installs dependencies or mutates package outputs.
 *
 * @returns {Promise<number>} Nonzero for metadata, compilation or execution failures.
 * @throws {Error} When installed tools or invocation-owned scratch resources cannot be read or
 *   created.
 */
export async function runDocumentationExamples() {
  /** Fresh scratch ownership is the only recursive cleanup authority held by this command. */
  const evidence = join(repositoryRoot, 'docs/rpc/scratch/dx-roadmap/doc-examples')
  mkdirSync(evidence, { recursive: true })
  const scratch = mkdtempSync(join(evidence, 'run-'))
  try {
    /** Ordinary module resolution treats both source and emitted scratch files as ESM. */
    writeFileSync(join(scratch, 'package.json'), '{"type":"module"}\n', { flag: 'wx' })
    const packages = readdirSync(join(repositoryRoot, 'packages'))
      .sort()
      .map((name) => join(repositoryRoot, 'packages', name))
      .filter((path) => existsSync(join(path, 'package.json')))
    linkPackages(scratch, repositoryRoot, packages)
    /** Maintained document order is deterministic across platforms and repeated invocations. */
    const examples = packages.flatMap((packageRoot) =>
      ['README.md', 'USEGUIDE.md'].flatMap((name) => {
        const document = join(packageRoot, name)
        return existsSync(document)
          ? extractExamples(
              readFileSync(document, 'utf8'),
              relative(repositoryRoot, document).split('\\').join('/')
            )
          : []
      })
    )
    const groups = groupExamples(examples)
    /** A skip has its authored reason; no compiler failure can change it into a skip. */
    const results = new Map(
      examples.map((example) => [
        example,
        {
          example,
          status: example.errors.length
            ? Status.configFail
            : example.mode === 'skip'
              ? Status.skip
              : example.language === 'ts'
                ? Status.checkFail
                : Status.resource,
          diagnostics: [...example.errors]
        }
      ])
    )
    const shared = compileExamples(groups, examples, scratch, results)
    /** Presence is checked once against the actual inherited toolchain, never assumed. */
    const python = groups.some(
      (group) =>
        group.entries.length && group.examples.some((example) => example.file?.endsWith('.py'))
    )
      ? spawnSync('python3', ['--version'], { encoding: 'utf8' })
      : undefined
    for (const group of groups) {
      if (!group.entries.length) continue
      const running = group.examples.filter((example) => example.mode === 'run')
      if (interrupted) {
        for (const example of running) {
          results.get(example).status = Status.runFail
          results
            .get(example)
            .diagnostics.push('Execution was not reached because this invocation was interrupted.')
        }
        continue
      }
      if (
        shared.length ||
        group.examples.some((example) =>
          [Status.configFail, Status.checkFail].includes(results.get(example).status)
        )
      ) {
        for (const example of running) results.get(example).diagnostics.push(Text.blockedRun)
        continue
      }
      if (
        group.examples.some((example) => example.file?.endsWith('.py')) &&
        python?.error?.code === 'ENOENT'
      ) {
        for (const example of running) {
          results.get(example).status = Status.skipWarning
          results.get(example).diagnostics.push(Text.pythonMissing)
        }
        continue
      }
      /** Each explicitly selected parent executes once; named child modules stay beside it. */
      const executions = []
      for (const entry of group.entries) {
        if (interrupted) break
        const emitted = entry
          .replace(/\.(?:ts|tsx)$/, '.js')
          .replace(/\.mts$/, '.mjs')
          .replace(/\.cts$/, '.cjs')
        executions.push(await executeExample(join(scratch, 'out', group.directory, emitted)))
      }
      for (const example of running) {
        const result = results.get(example)
        result.execution = executions
        result.status =
          interrupted || executions.some(({ code }) => code !== 0) ? Status.runFail : Status.runPass
      }
    }
    /** The saved report survives cleanup of generated modules and records every maintained location. */
    const report = join(evidence, `${basename(scratch)}.json`)
    const rows = [...results.values()]
    const counts = Object.fromEntries(
      Object.values(Status).map((status) => [
        status,
        rows.filter((result) => result.status === status).length
      ])
    )
    writeFileSync(
      report,
      `${JSON.stringify({ date: new Date().toISOString(), typescriptBlocks: examples.filter((example) => example.language === 'ts').length, counts, sharedDiagnostics: shared, results: rows }, null, 2)}\n`,
      { flag: 'wx' }
    )
    /** A shared declaration failure is one prerequisite defect, never every example's own defect. */
    for (const diagnostic of shared) console.log(`TYPECHECK-PREREQUISITE-FAIL | ${diagnostic}`)
    for (const result of rows) {
      console.log(
        `${result.status} | ${result.example.path}:${result.example.line} | ${result.example.section}${result.example.reason ? ` | ${result.example.reason}` : ''}`
      )
      for (const diagnostic of result.diagnostics) console.log(`  ${diagnostic}`)
      if (result.status === Status.runFail)
        for (const execution of result.execution ?? [])
          console.log(
            `  entry=${relative(scratch, execution.entry)} exit=${execution.code}\n${execution.stderr}${execution.stdout}`
          )
    }
    console.log(
      `docs-examples | ts=${examples.filter((example) => example.language === 'ts').length} | ${Object.entries(
        counts
      )
        .map(([status, count]) => `${status}=${count}`)
        .join(' ')} | report=${relative(repositoryRoot, report)}`
    )
    return shared.length ||
      rows.some((result) =>
        [Status.configFail, Status.checkFail, Status.checkBlocked, Status.runFail].includes(
          result.status
        )
      )
      ? 1
      : 0
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Imports expose the extraction helpers without executing or creating scratch artifacts. */
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runDocumentationExamples()
