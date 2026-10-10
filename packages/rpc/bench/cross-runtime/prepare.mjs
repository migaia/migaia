/** Freeze disposable TS source copies and exact diagnostic entry observations; no build occurs. */
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  readdirSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import { CrossRuntimeErrorText } from '../error-text.mjs'

/** All writes stay inside the handed-off fixture directory. */
const wt = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
/** The final owner supplies the exact current source commit before any fixture writes. */
const expected = process.env.FINAL_SOURCE_HEAD
if (!/^[0-9a-f]{40}$/.test(expected ?? ''))
  throw new Error(CrossRuntimeErrorText.sourceHeadRequired)
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim() !== expected)
  throw new Error(CrossRuntimeErrorText.sourceHeadMismatch)
if (execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim())
  throw new Error(CrossRuntimeErrorText.sourceDirty)
/** Only the explicit owner evidence directory receives generated source trees. */
const root = resolve(process.argv[2])
mkdirSync(resolve(root, '..'), { recursive: true })
mkdirSync(root)
/**
 * Bind each selected file and its actual loaded overlay to exact bytes.
 *
 * @param {string} value Complete source or deterministic manifest text.
 * @returns {string} SHA-256 used by the raw receipt.
 */
const hash = (value) => createHash('sha256').update(value).digest('hex')
/** These owners expose the requested N1/N2 costs without replacing their behavior. */
const observed = [
  'core/internal/request-replay-ledger.ts',
  'contract/normalize.ts',
  'contract/v1/normalize.ts',
  'contract/runtime-api/normalize.ts',
  'core/internal/outbound-envelope.ts',
  'core/internal/provider-executor.ts',
  'core/internal/provider-admission.ts',
  'core/internal/outbound-attachment.ts',
  'core/internal/time-port.ts',
  'core/internal/outbound-sender.ts',
  'core/internal/send-queue.ts',
  'bridge/jsonrpc/transport.ts',
  'bridge/jsonrpc/object-pipeline.ts',
  'contract/framing/stream.ts',
  'contract/framing/message-framer.ts',
  'remote/runtime-api/peer.ts',
  'remote/runtime-api/managed-peer.ts'
]
/**
 * Enumerate only selected source/declared dependency output files.
 *
 * @param {string} path Root for this source universe.
 * @returns {string[]} Complete TypeScript/JavaScript paths without installed dependency recursion.
 */
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(path, e.name))
      : /\.(ts|js)$/.test(e.name)
        ? [join(path, e.name)]
        : []
  )
}
/**
 * Bind the actual foreign build inputs copied for this finite matrix.
 *
 * @param {string} directory Frozen language fixture root.
 * @returns {{ path: string; sha256: string }[]} Exact regular files used by the native launcher.
 */
function foreignFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    /** Foreign fixtures contain only their delivered sources and launcher after copy filtering. */
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? foreignFiles(path)
      : entry.isFile()
        ? [{ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }]
        : []
  })
}
/**
 * Insert counters only in selected real owners, without modifying their decisions or limits.
 *
 * @param {string} path Package-relative canonical source path.
 * @param {string} source Complete selected source bytes.
 * @returns {string} Diagnostic-only source overlay, never used for timing.
 */
function instrument(path, source) {
  const edits = [],
    tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (path === 'core/internal/request-replay-ledger.ts') {
    /** Capacity comes from the existing canonical numeric reader after the actual decision. */
    const capacity = (node, owner) => {
      if (ts.isMethodDeclaration(node)) owner = node.name.getText(tree)
      if (
        owner === 'admit' &&
        ts.isReturnStatement(node) &&
        node.expression?.kind === ts.SyntaxKind.TrueKeyword
      )
        edits.push({
          pos: node.getStart(tree),
          text: 'globalThis.__XRT_LEDGER?.(this,peerKey,this.readCapacity(peerKey),this.#active.size,this.#completed.size,1);'
        })
      if (
        owner === 'reserveMany' &&
        ts.isReturnStatement(node) &&
        ts.isCallExpression(node.expression ?? {}) &&
        node.expression.expression.getText(tree) === 'Object.freeze'
      )
        edits.push({
          pos: node.getStart(tree),
          text: 'globalThis.__XRT_LEDGER?.(this,peerKey,this.readCapacity(peerKey),this.#active.size,this.#completed.size,keys.length);'
        })
      if (ts.isMethodDeclaration(node) && owner === 'releaseActive')
        edits.push({
          pos: node.body.end - 1,
          text: 'globalThis.__XRT_LEDGER?.(this,entry.peerKey,this.readCapacity(entry.peerKey),this.#active.size,this.#completed.size,0);'
        })
      ts.forEachChild(node, (child) => capacity(child, owner))
    }
    capacity(tree, undefined)
  }

  const walk = (node) => {
    if (
      node.body &&
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node)) &&
      ts.isBlock(node.body)
    ) {
      const name = node.name?.getText(tree) ?? node.parent?.name?.getText(tree) ?? 'anonymous'
      const key = path + ':' + name
      edits.push({
        pos: node.body.getStart(tree) + 1,
        text: 'globalThis.__XRT_COUNT(' + JSON.stringify(key) + ');'
      })
    }
    ts.forEachChild(node, walk)
  }
  walk(tree)
  for (const e of edits.sort((a, b) => b.pos - a.pos))
    source = source.slice(0, e.pos) + e.text + source.slice(e.pos)
  if (path === 'core/internal/provider-admission.ts') {
    source = source.replace(
      'this.#leases.set(taskKey, peerKey)',
      'this.#leases.set(taskKey, peerKey);globalThis.__XRT_LEASE?.(this,this.#leases.size)'
    )
    source = source.replace(
      'for (const key of taskKeys) this.#leases.set(key, peerKey)',
      'for (const key of taskKeys) this.#leases.set(key, peerKey);globalThis.__XRT_LEASE?.(this,this.#leases.size)'
    )
    source = source.replace(
      'this.#leases.delete(taskKey)',
      'this.#leases.delete(taskKey);globalThis.__XRT_LEASE?.(this,this.#leases.size)'
    )
  }
  return source
}
/** Plain timing and diagnostic trees have the same pinned RPC source and existing dependency graph. */
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim()
const manifest = { sourceCommit: head, built: false, trees: {}, foreign: [] }
/** BC14 is already product code; final plain/count use the same actual final source. */
for (const mode of ['plain', 'count']) {
  const pkg = join(root, 'fixture', mode, 'packages', 'rpc'),
    target = join(pkg, 'src')
  mkdirSync(target, { recursive: true })
  cpSync(join(wt, 'packages/rpc/package.json'), join(pkg, 'package.json'))
  const serialize = join(root, 'fixture', mode, 'packages', 'serialize'),
    serializeExports = JSON.parse(
      readFileSync(join(wt, 'packages/serialize/package.json'), 'utf8')
    ).exports
  mkdirSync(serialize, { recursive: true })
  cpSync(join(wt, 'packages/serialize/package.json'), join(serialize, 'package.json'))
  cpSync(join(wt, 'packages/serialize/dist'), join(serialize, 'dist'), { recursive: true })
  if (!existsSync(join(serialize, 'node_modules')))
    symlinkSync(join(wt, 'packages/serialize/node_modules'), join(serialize, 'node_modules'))
  const dependencyLink = join(pkg, 'node_modules')
  if (!existsSync(dependencyLink))
    symlinkSync(join(wt, 'packages/rpc/node_modules'), dependencyLink)
  const rows = []
  for (const from of files(join(wt, 'packages/rpc/src'))) {
    const relative = from.slice(join(wt, 'packages/rpc/src').length + 1),
      original = readFileSync(from, 'utf8')
    let effective = original
    effective = effective.replace(
      /(['"])@migaia\/serialize(\/[^'"]*)?\1/g,
      (_all, quote, suffix) => {
        const entry = serializeExports[suffix ? '.' + suffix : '.'],
          value = typeof entry === 'string' ? entry : entry.default
        return quote + new URL('file://' + join(serialize, value)).href + quote
      }
    )
    const targetSHA256 = hash(effective)
    if (mode.endsWith('count') && observed.includes(relative))
      effective = instrument(relative, effective)
    const row = {
      path: relative,
      originalSHA256: hash(original),
      targetSHA256,
      effectiveSHA256: hash(effective),
      diagnosticOverlay: mode.endsWith('count') && effective !== original
    }
    effective +=
      '\n;globalThis.__XRT_LOADED?.(' +
      JSON.stringify({ ...row, actualSourcePath: join(target, relative) }) +
      ');\n'
    row.loadedSHA256 = hash(effective)
    const to = join(target, relative)
    mkdirSync(resolve(to, '..'), { recursive: true })
    writeFileSync(to, effective)
    rows.push(row)
  }
  for (const from of files(join(serialize, 'dist'))) {
    const relative = 'serialize/' + from.slice(join(serialize, 'dist').length + 1),
      original = readFileSync(from, 'utf8')
    let effective =
      mode.endsWith('count') && relative === 'serialize/codec.js'
        ? instrument(relative, original)
        : original
    const row = {
      path: relative,
      originalSHA256: hash(original),
      targetSHA256: hash(original),
      effectiveSHA256: hash(effective),
      diagnosticOverlay: effective !== original
    }
    effective +=
      '\n;globalThis.__XRT_LOADED?.(' + JSON.stringify({ ...row, actualSourcePath: from }) + ');\n'
    row.loadedSHA256 = hash(effective)
    writeFileSync(from, effective)
    rows.push(row)
  }
  manifest.trees[mode] = { root: target, items: rows, manifestSHA256: hash(JSON.stringify(rows)) }
}
for (const runtime of ['python', 'go', 'rust']) {
  const from = join(wt, 'packages/rpc/test/process/peers', runtime),
    to = join(root, 'fixture/foreign', runtime)
  cpSync(from, to, {
    recursive: true,
    filter: (path) => !path.includes('/target/') && !path.includes('/__pycache__/')
  })
  manifest.foreign.push({ runtime, originalRoot: from, copyRoot: to, files: foreignFiles(to) })
}
writeFileSync(join(root, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(
  JSON.stringify({
    trees: Object.fromEntries(
      Object.entries(manifest.trees).map(([k, v]) => [
        k,
        { modules: v.items.length, manifestSHA256: v.manifestSHA256 }
      ])
    ),
    foreign: manifest.foreign.map((v) => v.runtime)
  })
)
