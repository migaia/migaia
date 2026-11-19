import {
  hashBytes,
  isModuleName,
  parseSnapshot,
  type AuditAction,
  type IAuditTarget,
  type IChangeset,
  type IDescriptor,
  type IPartSnapshot
} from '@migaia/part-contract'
import type { AuditTrail } from './audit.ts'
import {
  draftView,
  loadDraft,
  processChangeset,
  rebaseDraft,
  snapshotOf,
  writeDraft
} from './drafts.ts'
import { ERROR_SOURCE, PartCatalogErrorCode, type IPartCatalogErrorCode } from './error-code.ts'
import type { CatalogStore } from './store.ts'
import {
  CatalogText,
  ENVIRONMENTS,
  StoreKey,
  WRITE_LIMIT_PER_MINUTE,
  type IEnvironment
} from './text.ts'
import {
  allows,
  tokenHash,
  tokenOf,
  TokenScope,
  WriteLimiter,
  type IProjectRecord,
  type ITokenRecord
} from './tokens.ts'
import { uploadIssues } from './validate.ts'

/** Options of a running server. */
export type ICatalogServerOptions = {
  readonly store: CatalogStore
  readonly audit: AuditTrail
  readonly projectDir: string | undefined
  readonly allowOrigins: readonly string[]
}

/** One history entry of an environment pointer. */
type IHistoryEntry = {
  readonly at: string
  readonly actor: string
  readonly action: string
  readonly snapshot: string
  readonly tag: string
}

/** Parsed request target. */
type IRoute = { readonly project: string; readonly rest: readonly string[] }

/** Thrown inside handlers to answer with an error status and code. */
class HttpFailure extends Error {
  /** HTTP status. */
  readonly status: number
  /** Catalog error code. */
  readonly code: IPartCatalogErrorCode
  /** Optional extra body fields (issues). */
  readonly extra: Readonly<Record<string, unknown>>

  /** Captures the answer; `cause` keeps the parse failure behind a 400. */
  constructor(
    status: number,
    code: IPartCatalogErrorCode,
    message: string,
    extra: Readonly<Record<string, unknown>> = {},
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.status = status
    this.code = code
    this.extra = extra
  }
}

/** JSON response. */
function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

/** A 400 REQUEST_INVALID for input that could not be read. */
function badRequest(cause: unknown): HttpFailure {
  return new HttpFailure(
    400,
    PartCatalogErrorCode.requestInvalid,
    CatalogText.requestInvalid,
    {},
    cause
  )
}

/** JSON request body as an object, or a 400 REQUEST_INVALID when it is not a JSON object. */
async function bodyOf<T extends object>(request: Request): Promise<Partial<T>> {
  /** Parsed body. */
  let body: unknown
  try {
    body = await request.json()
  } catch (error) {
    throw badRequest(error)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest(body)
  return body as Partial<T>
}

/** Decoded path segments, or a 400 REQUEST_INVALID for a malformed escape. */
function segmentsOf(url: string): string[] {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch (error) {
    throw badRequest(error)
  }
}

/** Environment name or REQUEST_INVALID. */
function envOf(value: string | undefined): IEnvironment {
  if (!ENVIRONMENTS.includes(value as IEnvironment))
    throw new HttpFailure(404, PartCatalogErrorCode.requestInvalid, CatalogText.requestInvalid)
  return value as IEnvironment
}

/**
 * The catalog HTTP service: routing, CORS, authorization, write limiting, per-project write
 * serialization and audit. Storage and validation live in their own modules.
 */
export class CatalogServer {
  /** Options. */
  readonly #options: ICatalogServerOptions
  /** Write limiter per token. */
  readonly #limiter = new WriteLimiter()
  /** Tail of the write queue per project. */
  readonly #queues = new Map<string, Promise<unknown>>()

  /** Binds the server to its store and audit trail. */
  constructor(options: ICatalogServerOptions) {
    this.#options = options
  }

  /** Handles one request, adding CORS headers for allowed origins. */
  async handle(request: Request): Promise<Response> {
    /** Request origin. */
    const origin = request.headers.get('origin')
    /** Whether the origin is allowed. */
    const allowed = origin !== null && this.#options.allowOrigins.includes(origin)
    /** Response before CORS headers. */
    const response =
      request.method === 'OPTIONS'
        ? new Response(null, {
            status: 204,
            headers: allowed
              ? {
                  'access-control-allow-methods': 'GET, PUT, POST',
                  'access-control-allow-headers': 'Authorization, Content-Type, If-None-Match'
                }
              : {}
          })
        : await this.#answer(request)
    if (allowed) {
      response.headers.set('access-control-allow-origin', origin)
      response.headers.set('access-control-expose-headers', 'ETag')
      response.headers.append('vary', 'Origin')
    }
    return response
  }

  /** Routes a request and maps failures to error bodies. */
  async #answer(request: Request): Promise<Response> {
    try {
      return await this.#route(request)
    } catch (error) {
      if (!(error instanceof HttpFailure)) throw error
      return json(
        {
          error: { source: ERROR_SOURCE, code: error.code, message: error.message },
          ...error.extra
        },
        error.status
      )
    }
  }

  /** Authorizes a caller for a project environment and scope; writes also pass the limiter. */
  async #authorize(
    request: Request,
    project: string,
    env: IEnvironment,
    scope: TokenScope
  ): Promise<ITokenRecord> {
    /** Header value. */
    const header = request.headers.get('authorization')
    /** Token record. */
    const token = await tokenOf(this.#options.store, header)
    if (token === undefined)
      throw new HttpFailure(401, PartCatalogErrorCode.authRequired, CatalogText.authRequired)
    if (!allows(token, project, env, scope))
      throw new HttpFailure(403, PartCatalogErrorCode.authForbidden, CatalogText.authForbidden)
    if (
      scope === TokenScope.write &&
      !this.#limiter.admit(
        tokenHash((header as string).slice(7)),
        WRITE_LIMIT_PER_MINUTE,
        Date.now()
      )
    )
      throw new HttpFailure(429, PartCatalogErrorCode.rateLimited, CatalogText.rateLimited)
    return token
  }

  /** Runs write work after earlier writes of the same project. */
  #serial<T>(project: string, work: () => Promise<T>): Promise<T> {
    /** This step. */
    const step = (this.#queues.get(project) ?? Promise.resolve()).then(work)
    this.#queues.set(
      project,
      step.catch(() => undefined)
    )
    return step
  }

  /** Project record or an empty one. */
  async #project(project: string): Promise<IProjectRecord> {
    return (
      (await this.#options.store.json<IProjectRecord | null>(StoreKey.project(project), null)) ?? {
        envs: {} as IProjectRecord['envs']
      }
    )
  }

  /** Writes an audit record for a write request. */
  #audit(
    caller: ITokenRecord,
    project: string,
    action: AuditAction,
    targets: readonly IAuditTarget[],
    outcome: 'ok' | 'rejected',
    extra: { env?: string; provenance?: IChangeset['provenance'] } = {}
  ): Promise<void> {
    return this.#options.audit.write({
      at: new Date().toISOString(),
      actor: caller.actor,
      project,
      action,
      targets,
      outcome,
      ...extra
    })
  }

  /** Dispatches by path. */
  async #route(request: Request): Promise<Response> {
    /** Path segments. */
    const segments = segmentsOf(request.url)
    if (segments[0] !== 'p' || segments[1] === undefined)
      throw new HttpFailure(404, PartCatalogErrorCode.requestInvalid, CatalogText.requestInvalid)
    /** Route parts. */
    const route: IRoute = { project: segments[1], rest: segments.slice(2) }
    /** Remaining path segments. */
    const [first, second, third] = route.rest
    if (first === 'm' && second !== undefined)
      return request.method === 'PUT'
        ? this.#putModule(request, route.project, second)
        : this.#getModule(route.project, second)
    if (first === 'snapshots' && second !== undefined && third === 'sources')
      return this.#putSources(request, route.project, second)
    if (first === 'snapshots' && second !== undefined)
      return this.#putSnapshot(request, route.project, second)
    if (first === 'env' && third === 'snapshot')
      return this.#getSnapshot(request, route.project, envOf(second))
    if (first === 'env' && third === 'history')
      return this.#history(request, route.project, envOf(second))
    if (first === 'env' && (third === 'publish' || third === 'promote' || third === 'rollback'))
      return this.#move(request, route.project, envOf(second), third)
    if (first === 'drafts' && second === undefined) return this.#getDraft(request, route.project)
    if (first === 'drafts' && second === 'changesets')
      return this.#changeset(request, route.project)
    if (first === 'drafts' && second === 'm' && third !== undefined)
      return this.#getDraftModule(request, route.project, third)
    if (first === 'catalog') return this.#catalog(request, route.project)
    if (first === 'audit') return this.#auditList(request, route.project)
    throw new HttpFailure(404, PartCatalogErrorCode.requestInvalid, CatalogText.requestInvalid)
  }

  /** `PUT /p/:project/m/:file`: stores module bytes whose hash names the file. */
  async #putModule(request: Request, project: string, file: string): Promise<Response> {
    /** Caller. */
    const caller = await this.#authorize(request, project, 'dev', TokenScope.write)
    /** Uploaded bytes. */
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (`${(await hashBytes(bytes)).slice('sha256-'.length)}.js` !== file) {
      await this.#audit(caller, project, 'upload', [{ module: file }], 'rejected')
      throw new HttpFailure(
        422,
        PartCatalogErrorCode.snapshotMismatch,
        CatalogText.snapshotMismatch(file)
      )
    }
    await this.#serial(project, async () => {
      if ((await this.#options.store.bytes(StoreKey.module(project, file))) === null)
        await this.#options.store.putBytes(StoreKey.module(project, file), bytes)
    })
    await this.#audit(caller, project, 'upload', [{ module: file }], 'ok')
    return json({ ok: true })
  }

  /** `GET /p/:project/m/:file`: public immutable module bytes. */
  async #getModule(project: string, file: string): Promise<Response> {
    /** Stored bytes. */
    const bytes = await this.#options.store.bytes(StoreKey.module(project, file))
    if (bytes === null)
      throw new HttpFailure(404, PartCatalogErrorCode.requestInvalid, CatalogText.requestInvalid)
    return new Response(bytes, {
      headers: {
        'content-type': 'text/javascript',
        'cache-control': 'public, max-age=31536000, immutable'
      }
    })
  }

  /** Checks every module of a snapshot is stored with matching hashes; returns mismatch names. */
  async #moduleMismatches(project: string, snapshot: IPartSnapshot): Promise<string[]> {
    /** Problems. */
    const problems: string[] = []
    for (const module of snapshot.lock.modules) {
      /** File named by the URL. */
      const file = module.url.startsWith('m/') ? module.url.slice(2) : undefined
      /** Stored bytes. */
      const bytes =
        file === undefined ? null : await this.#options.store.bytes(StoreKey.module(project, file))
      if (bytes === null) {
        problems.push(module.name)
        continue
      }
      /** SRI of the stored bytes. */
      const sri = `sha384-${Buffer.from(new Bun.CryptoHasher('sha384').update(bytes).digest()).toString('base64')}`
      if ((await hashBytes(bytes)) !== module.id || sri !== module.integrity)
        problems.push(module.name)
    }
    return problems
  }

  /** `PUT /p/:project/snapshots/:hash`: raw snapshot bytes, checked and stored once. */
  async #putSnapshot(request: Request, project: string, hash: string): Promise<Response> {
    /** Caller. */
    const caller = await this.#authorize(request, project, 'dev', TokenScope.write)
    /** Uploaded bytes. */
    const bytes = new Uint8Array(await request.arrayBuffer())
    return this.#serial(project, async () => {
      if ((await hashBytes(bytes)) !== hash) {
        await this.#audit(caller, project, 'upload', [], 'rejected')
        throw new HttpFailure(
          422,
          PartCatalogErrorCode.snapshotMismatch,
          CatalogText.snapshotMismatch(hash)
        )
      }
      /** Parsed snapshot; a shape error is a rejection. */
      let snapshot: IPartSnapshot
      try {
        snapshot = parseSnapshot(bytes)
      } catch (error) {
        await this.#audit(caller, project, 'upload', [], 'rejected')
        throw new HttpFailure(422, PartCatalogErrorCode.snapshotRejected, (error as Error).message)
      }
      /** Missing or mismatching modules. */
      const mismatches = await this.#moduleMismatches(project, snapshot)
      if (mismatches.length > 0) {
        await this.#audit(caller, project, 'upload', [], 'rejected')
        throw new HttpFailure(
          422,
          PartCatalogErrorCode.snapshotMismatch,
          CatalogText.snapshotMismatch(mismatches.join(', ')),
          { modules: mismatches }
        )
      }
      /** Validation issues. */
      const issues = uploadIssues(snapshot)
      if (issues.length > 0) {
        await this.#audit(caller, project, 'upload', [], 'rejected')
        throw new HttpFailure(
          422,
          PartCatalogErrorCode.snapshotRejected,
          CatalogText.snapshotRejected,
          { issues }
        )
      }
      if ((await this.#options.store.bytes(StoreKey.snapshot(project, hash))) === null)
        await this.#options.store.putBytes(StoreKey.snapshot(project, hash), bytes)
      await this.#audit(
        caller,
        project,
        'upload',
        snapshot.blueprints.map((blueprint) => ({ blueprint: blueprint.id })),
        'ok'
      )
      return json({ ok: true, snapshot: hash })
    })
  }

  /** `PUT /p/:project/snapshots/:hash/sources`: module sources of an uploaded snapshot. */
  async #putSources(request: Request, project: string, hash: string): Promise<Response> {
    /** Caller. */
    const caller = await this.#authorize(request, project, 'dev', TokenScope.write)
    /** Body. */
    const body = await bodyOf<{ modules: { name: string; source: string }[] }>(request)
    if (body.modules !== undefined && !Array.isArray(body.modules)) throw badRequest(body.modules)
    /** Stored snapshot bytes. */
    const bytes = await this.#options.store.bytes(StoreKey.snapshot(project, hash))
    if (bytes === null)
      throw new HttpFailure(
        404,
        PartCatalogErrorCode.snapshotUnknown,
        CatalogText.snapshotUnknown(hash)
      )
    /** Module names of the snapshot. */
    const names = new Set(parseSnapshot(bytes).lock.modules.map((module) => module.name))
    /** Entries. */
    const entries = body.modules ?? []
    /** Entries that do not belong. */
    const bad = entries
      .filter((entry) => !isModuleName(entry.name) || !names.has(entry.name))
      .map((entry) => entry.name)
    if (bad.length > 0) {
      await this.#audit(caller, project, 'upload', [], 'rejected')
      throw new HttpFailure(
        422,
        PartCatalogErrorCode.snapshotMismatch,
        CatalogText.snapshotMismatch(bad.join(', '))
      )
    }
    await this.#options.store.putJson(StoreKey.sources(project, hash), entries)
    await this.#audit(
      caller,
      project,
      'upload',
      entries.map((entry) => ({ module: entry.name })),
      'ok'
    )
    return json({ ok: true })
  }

  /** `GET /p/:project/env/:env/snapshot`: raw bytes of the pointer, ETag = snapshot hash. */
  async #getSnapshot(request: Request, project: string, env: IEnvironment): Promise<Response> {
    /** Environment state. */
    const state = (await this.#project(project)).envs[env]
    if (state?.publicRead !== true) await this.#authorize(request, project, env, TokenScope.read)
    if (state?.snapshot === undefined)
      throw new HttpFailure(
        404,
        PartCatalogErrorCode.envUnpublished,
        CatalogText.envUnpublished(env)
      )
    /** Quoted ETag. */
    const etag = `"${state.snapshot}"`
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers: { etag } })
    return new Response(
      await this.#options.store.bytes(StoreKey.snapshot(project, state.snapshot)),
      {
        headers: { 'content-type': 'application/json', etag }
      }
    )
  }

  /** `GET …/history`: newest first. */
  async #history(request: Request, project: string, env: IEnvironment): Promise<Response> {
    await this.#authorize(request, project, env, TokenScope.read)
    return json(
      (
        await this.#options.store.json<IHistoryEntry[]>(StoreKey.history(project, env), [])
      ).toReversed()
    )
  }

  /** `POST …/publish|promote|rollback`: moves an environment pointer and records history. */
  async #move(
    request: Request,
    project: string,
    env: IEnvironment,
    action: 'publish' | 'promote' | 'rollback'
  ): Promise<Response> {
    /** Caller. */
    const caller = await this.#authorize(request, project, env, TokenScope.write)
    /** Body. */
    const body = await bodyOf<{ snapshot: string; from: string }>(request)
    return this.#serial(project, async () => {
      /** Project record. */
      const record = await this.#project(project)
      /** Target snapshot. */
      let target = body.snapshot
      if (action === 'promote') {
        /** Source environment. */
        const from = envOf(body.from)
        if (!allows(caller, project, from, TokenScope.read))
          throw new HttpFailure(403, PartCatalogErrorCode.authForbidden, CatalogText.authForbidden)
        target = record.envs[from]?.snapshot
        if (target === undefined)
          throw new HttpFailure(
            404,
            PartCatalogErrorCode.envUnpublished,
            CatalogText.envUnpublished(from)
          )
      }
      if (
        target === undefined ||
        (await this.#options.store.bytes(StoreKey.snapshot(project, target))) === null
      ) {
        await this.#audit(caller, project, action, [], 'rejected', { env })
        throw new HttpFailure(
          404,
          PartCatalogErrorCode.snapshotUnknown,
          CatalogText.snapshotUnknown(String(target))
        )
      }
      /** Tag of the target. */
      const tag = (await snapshotOf(this.#options.store, project, target)).lock.tag
      /** Previous dev pointer. */
      const previous = record.envs.dev?.snapshot
      await this.#options.store.putJson(StoreKey.project(project), {
        envs: { ...record.envs, [env]: { ...record.envs[env], snapshot: target, tag } }
      })
      /** History of the environment. */
      const history = await this.#options.store.json<IHistoryEntry[]>(
        StoreKey.history(project, env),
        []
      )
      history.push({
        at: new Date().toISOString(),
        actor: caller.actor,
        action,
        snapshot: target,
        tag
      })
      await this.#options.store.putJson(StoreKey.history(project, env), history)
      if (env === 'dev' && previous !== target)
        await rebaseDraft(this.#options.store, project, target)
      await this.#audit(caller, project, action, [], 'ok', { env })
      return json({ ok: true, snapshot: target, tag })
    })
  }

  /** `GET /p/:project/drafts`. */
  async #getDraft(request: Request, project: string): Promise<Response> {
    await this.#authorize(request, project, 'dev', TokenScope.read)
    /** Draft. */
    const draft = await loadDraft(this.#options.store, project)
    if (draft === undefined)
      throw new HttpFailure(
        404,
        PartCatalogErrorCode.envUnpublished,
        CatalogText.envUnpublished('dev')
      )
    return json(await draftView(draft))
  }

  /** `POST /p/:project/drafts/changesets`. */
  async #changeset(request: Request, project: string): Promise<Response> {
    /** Caller. */
    const caller = await this.#authorize(request, project, 'dev', TokenScope.write)
    /** Changeset body; the author comes from the token. */
    const body = await bodyOf<IChangeset>(request)
    if (!Array.isArray(body.artifacts)) throw badRequest(body.artifacts)
    /** Changeset with its artifact list checked. */
    const changeset = body as IChangeset
    return this.#serial(project, async () => {
      /** Draft. */
      const draft = await loadDraft(this.#options.store, project)
      if (draft === undefined)
        throw new HttpFailure(
          404,
          PartCatalogErrorCode.envUnpublished,
          CatalogText.envUnpublished('dev')
        )
      /** Outcome. */
      const outcome = await processChangeset(
        this.#options.store,
        project,
        draft,
        changeset,
        this.#options.projectDir
      )
      if (outcome.draft !== undefined) {
        await writeDraft(this.#options.store, project, outcome.draft, outcome.bytes)
        if (outcome.draft.conflicts.length > 0) {
          /** Dev pointer, for retrying the rebase. */
          const dev = (await this.#project(project)).envs.dev?.snapshot
          if (dev !== undefined) await rebaseDraft(this.#options.store, project, dev)
        }
      }
      await this.#audit(
        caller,
        project,
        'changeset',
        outcome.targets,
        outcome.result.ok ? 'ok' : 'rejected',
        { provenance: changeset.provenance }
      )
      return json(outcome.result)
    })
  }

  /** `GET /p/:project/drafts/m/:file`. */
  async #getDraftModule(request: Request, project: string, file: string): Promise<Response> {
    await this.#authorize(request, project, 'dev', TokenScope.read)
    /** Stored bytes, or the published module of the same file. */
    const bytes =
      (await this.#options.store.bytes(StoreKey.draftModule(project, file))) ??
      (await this.#options.store.bytes(StoreKey.module(project, file)))
    if (bytes === null)
      throw new HttpFailure(404, PartCatalogErrorCode.requestInvalid, CatalogText.requestInvalid)
    return new Response(bytes, { headers: { 'content-type': 'text/javascript' } })
  }

  /** `GET /p/:project/catalog`: descriptors of an environment (plus draft module exports). */
  async #catalog(request: Request, project: string): Promise<Response> {
    /** Query parameters. */
    const query = new URL(request.url).searchParams
    /** Environment. */
    const env = envOf(query.get('env') ?? 'dev')
    await this.#authorize(request, project, env, TokenScope.read)
    /** Environment pointer. */
    const pointer = (await this.#project(project)).envs[env]?.snapshot
    if (pointer === undefined)
      throw new HttpFailure(
        404,
        PartCatalogErrorCode.envUnpublished,
        CatalogText.envUnpublished(env)
      )
    /** Descriptors of the snapshot. */
    const descriptors: IDescriptor[] = [
      ...(await snapshotOf(this.#options.store, project, pointer)).descriptors
    ]
    if (query.get('draft') === '1') {
      /** Known ids. */
      const known = new Set(descriptors.map((descriptor) => descriptor.id))
      for (const module of (await loadDraft(this.#options.store, project))?.modules ?? [])
        for (const entry of module.built.exports)
          if (!known.has(entry.id)) {
            known.add(entry.id)
            descriptors.push({ kind: entry.kind, id: entry.id })
          }
    }
    /** Exact id filter. */
    const ids = new Set((query.get('ids') ?? '').split(',').filter(Boolean))
    /** Tag filter. */
    const tags = new Set((query.get('tags') ?? '').split(',').filter(Boolean))
    /** Filtered descriptors in snapshot order. */
    const result = descriptors.filter(
      (descriptor) =>
        (ids.size === 0 || ids.has(descriptor.id)) &&
        (tags.size === 0 ||
          [
            ...(descriptor.targets ?? []),
            ...((descriptor.meta?.['part.tags'] as string[] | undefined) ?? []),
            descriptor.id.split('@')[0] as string
          ].some((tag) => tags.has(tag)))
    )
    /** Response bytes. */
    const bytes = new TextEncoder().encode(JSON.stringify(result))
    /** Quoted ETag. */
    const etag = `"${await hashBytes(bytes)}"`
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers: { etag } })
    return new Response(bytes, { headers: { 'content-type': 'application/json', etag } })
  }

  /** `GET /p/:project/audit?since=`. */
  async #auditList(request: Request, project: string): Promise<Response> {
    await this.#authorize(request, project, 'dev', TokenScope.write)
    return json(
      await this.#options.audit.since(
        project,
        new URL(request.url).searchParams.get('since') ?? undefined
      )
    )
  }
}
