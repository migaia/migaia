#!/usr/bin/env bun
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AuditTrail } from './audit.ts'
import { CatalogServer } from './server.ts'
import { CatalogStore } from './store.ts'
import { CatalogText, ENVIRONMENTS, StoreKey, type IEnvironment } from './text.ts'
import { createToken, emptyProject, TokenScope, type IProjectRecord } from './tokens.ts'

/** Parsed command line: positional words and repeatable `--flag value` pairs. */
type IArgs = {
  readonly positional: readonly string[]
  readonly flags: ReadonlyMap<string, readonly string[]>
}

/** Parses argv; every flag takes one value and may repeat. */
function parseArgs(argv: readonly string[]): IArgs {
  /** Positional words. */
  const positional: string[] = []
  /** Flag values. */
  const flags = new Map<string, string[]>()
  for (let index = 0; index < argv.length; index += 1) {
    /** Current token. */
    const token = argv[index] as string
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    flags.set(token, [...(flags.get(token) ?? []), argv[index + 1] ?? ''])
    index += 1
  }
  return { positional, flags }
}

/** First value of a flag. */
function flag(args: IArgs, name: string): string | undefined {
  return args.flags.get(name)?.[0]
}

/** Opens the store of `--data`. */
async function openStore(args: IArgs): Promise<CatalogStore> {
  /** Data directory. */
  const data = resolve(flag(args, '--data') ?? '.')
  mkdirSync(data, { recursive: true })
  return CatalogStore.open(join(data, 'catalog.sqlite'))
}

/** `serve`: starts the server on 127.0.0.1 and prints `{ url }`; stops on SIGINT/SIGTERM. */
async function serve(args: IArgs): Promise<void> {
  /** Store. */
  const store = await openStore(args)
  /** Audit trail. */
  const audit = new AuditTrail(store)
  /** Project directory for remote builds. */
  const projectDir = flag(args, '--project-dir')
  /** Service. */
  const service = new CatalogServer({
    store,
    audit,
    projectDir: projectDir === undefined ? undefined : resolve(projectDir),
    allowOrigins: args.flags.get('--allow-origin') ?? []
  })
  /** HTTP server. */
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(flag(args, '--port') ?? 0),
    fetch: (request) => service.handle(request)
  })
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.port}` }))
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => void stop(server, audit, store))
}

/** Stops accepting requests, waits for running ones, then closes audit and storage. */
async function stop(
  server: ReturnType<typeof Bun.serve>,
  audit: AuditTrail,
  store: CatalogStore
): Promise<void> {
  await server.stop(false)
  await audit.close()
  await store.close()
  process.exit(0)
}

/** `token create`: prints a new token once. */
async function tokenCreate(args: IArgs): Promise<void> {
  /** Store. */
  const store = await openStore(args)
  try {
    /** Scope. */
    const scope = flag(args, '--scope') === 'write' ? TokenScope.write : TokenScope.read
    /** Environments. */
    const envs = (flag(args, '--envs') ?? 'dev')
      .split(',')
      .filter((env): env is IEnvironment => ENVIRONMENTS.includes(env as IEnvironment))
    console.log(
      await createToken(store, {
        project: flag(args, '--project') ?? '',
        envs,
        scope,
        actor: flag(args, '--actor') ?? 'unknown'
      })
    )
  } finally {
    await store.close()
  }
}

/** `env set`: sets whether an environment's snapshot is readable without a token. */
async function envSet(args: IArgs): Promise<void> {
  /** Store. */
  const store = await openStore(args)
  try {
    /** Project. */
    const project = flag(args, '--project') ?? ''
    /** Environment. */
    const env = (flag(args, '--env') ?? 'dev') as IEnvironment
    /** Project record. */
    const record =
      (await store.json<IProjectRecord | null>(StoreKey.project(project), null)) ?? emptyProject()
    await store.putJson(StoreKey.project(project), {
      envs: {
        ...record.envs,
        [env]: { ...record.envs[env], publicRead: flag(args, '--public-read') === 'true' }
      }
    })
  } finally {
    await store.close()
  }
}

/** Dispatches a command. */
async function main(argv: readonly string[]): Promise<number> {
  /** Parsed arguments. */
  const args = parseArgs(argv)
  /** Command words. */
  const [first, second] = args.positional
  if (first === 'serve') await serve(args)
  else if (first === 'token' && second === 'create') await tokenCreate(args)
  else if (first === 'env' && second === 'set') await envSet(args)
  else {
    console.error(CatalogText.usage)
    return 2
  }
  return 0
}

if (import.meta.main) {
  /** Exit code of a one-shot command; `serve` keeps running. */
  const code = await main(process.argv.slice(2))
  if (code !== 0 || process.argv[2] !== 'serve') process.exit(code)
}
