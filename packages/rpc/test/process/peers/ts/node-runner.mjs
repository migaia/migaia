import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Worktree-specific output avoids sharing compiled fixtures between independent lanes. */
const source = import.meta.dirname
/** Source-path hash keeps temporary filenames stable without encoding user workspace paths. */
const key = createHash('sha256').update(source).digest('hex').slice(0, 12)
/** Stripped files and public-package links stay outside the repository. */
const output = join(tmpdir(), `rpc-public-ts-${key}`)
mkdirSync(join(output, 'node_modules/@migaia'), { recursive: true })
for (const name of ['runtime.ts', 'text.ts', 'peer.mts']) {
  /** Type erasure changes no protocol behavior and requires no compiler dependency. */
  const contents = stripTypeScriptTypes(readFileSync(join(source, name), 'utf8'))
  /** Emitted peers retain their source-owned vector root when launched directly by fixtures. */
  const prefix =
    name === 'peer.mts'
      ? `process.env.RPC_PEERS_VECTOR_ROOT ??= ${JSON.stringify(resolve(source, '../../../../schema/vectors'))}\n`
      : ''
  writeFileSync(
    join(output, name.replace(/\.mts$/, '.mjs').replace(/\.ts$/, '.js')),
    prefix + contents
  )
}
for (const name of ['rpc', 'plugin-host']) {
  /** Package imports continue through package.json exports rather than internal dist paths. */
  const link = join(output, 'node_modules/@migaia', name)
  if (!existsSync(link)) symlinkSync(resolve(source, '../../../../../', name), link)
}
/** Preparation exits before launching either runtime, keeping compilation outside measurement. */
if (process.argv.includes('--executable')) {
  console.log(join(output, 'peer.mjs'))
} else {
  /** Loading into this PID preserves inherited authentication descriptors and launcher ownership. */
  process.env.RPC_PEERS_VECTOR_ROOT = resolve(source, '../../../../schema/vectors')
  await import(pathToFileURL(join(output, 'peer.mjs')).href)
}
