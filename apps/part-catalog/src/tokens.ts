import { ENVIRONMENTS, StoreKey, type IEnvironment } from './text.ts'
import type { CatalogStore } from './store.ts'

/** Access scope of a token; `write` includes `read`. */
export const TokenScope = { read: 'read', write: 'write' } as const

/** One scope. */
export type TokenScope = keyof typeof TokenScope

/** What the catalog stores for a token: never the token itself. */
export type ITokenRecord = {
  readonly project: string
  readonly envs: readonly IEnvironment[]
  readonly scope: TokenScope
  readonly actor: string
}

/** Per-environment state of a project. */
export type IEnvState = {
  readonly snapshot?: string
  readonly tag?: string
  readonly publicRead: boolean
}

/** Project record: the three environments. */
export type IProjectRecord = { readonly envs: Readonly<Record<IEnvironment, IEnvState>> }

/** Hex SHA-256 of a token, the only form stored. */
export function tokenHash(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex')
}

/** New random token: 32 bytes as base64url. */
export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
}

/** Empty project record with every environment unpublished and private. */
export function emptyProject(): IProjectRecord {
  /** Environments by name. */
  const envs = {} as Record<IEnvironment, IEnvState>
  for (const env of ENVIRONMENTS) envs[env] = { publicRead: false }
  return { envs }
}

/** Creates a token, its project when new, and returns the token text (shown once). */
export async function createToken(store: CatalogStore, record: ITokenRecord): Promise<string> {
  /** New token. */
  const token = newToken()
  await store.putJson(StoreKey.token(tokenHash(token)), record)
  if ((await store.json<IProjectRecord | null>(StoreKey.project(record.project), null)) === null)
    await store.putJson(StoreKey.project(record.project), emptyProject())
  return token
}

/** Token record of an `Authorization` header value, or undefined. */
export async function tokenOf(
  store: CatalogStore,
  header: string | null
): Promise<ITokenRecord | undefined> {
  if (header === null || !header.startsWith('Bearer ')) return undefined
  return (
    (await store.json<ITokenRecord | null>(StoreKey.token(tokenHash(header.slice(7))), null)) ??
    undefined
  )
}

/** True when a token covers a project, environment and scope. */
export function allows(
  token: ITokenRecord,
  project: string,
  env: IEnvironment,
  scope: TokenScope
): boolean {
  return (
    token.project === project &&
    token.envs.includes(env) &&
    (scope === TokenScope.read || token.scope === TokenScope.write)
  )
}

/** Sliding one-minute write counter per token hash. */
export class WriteLimiter {
  /** Request times per token, oldest first. */
  readonly #times = new Map<string, number[]>()

  /**
   * Admits a write unless the token already made `limit` writes in the last minute. Only admitted
   * writes are recorded, so a client retrying after a refusal is admitted again once a minute has
   * passed since its earlier writes.
   */
  admit(token: string, limit: number, now: number): boolean {
    /** Recent admitted times of the token. */
    const times = (this.#times.get(token) ?? []).filter((time) => now - time < 60000)
    if (times.length >= limit) {
      this.#times.set(token, times)
      return false
    }
    times.push(now)
    this.#times.set(token, times)
    return true
  }
}
