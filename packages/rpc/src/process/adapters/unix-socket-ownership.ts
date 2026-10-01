import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { constants } from 'node:fs'
import { link, lstat, open, readFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'

/** A service's own inode evidence is persisted beside its protected Unix socket. */
export type IUnixSocketRecord = Readonly<{
  serviceId: string
  path: string
  dev: number
  ino: number
  uid: number
  gid: number
}>

/** The sidecar name never depends on a caller's secret or a peer-provided value. */
function recordPath(path: string): string {
  return `${path}.owner.json`
}

/** Read only a complete regular-file record; missing or hostile records confer no ownership. */
async function readRecord(path: string): Promise<IUnixSocketRecord | undefined> {
  try {
    const stat = await lstat(recordPath(path))
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) return undefined
    const value: unknown = JSON.parse(await readFile(recordPath(path), 'utf8'))
    if (!value || typeof value !== 'object') return undefined
    const record = value as Record<string, unknown>
    if (
      typeof record.serviceId !== 'string' ||
      typeof record.path !== 'string' ||
      typeof record.dev !== 'number' ||
      typeof record.ino !== 'number' ||
      typeof record.uid !== 'number' ||
      typeof record.gid !== 'number'
    )
      return undefined
    return record as IUnixSocketRecord
  } catch {
    return undefined
  }
}

/** A successful connection proves an active listener without sending protocol bytes. */
async function hasListener(path: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ path })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy()
      if (error.code === 'ECONNREFUSED') resolve(false)
      else reject(error)
    })
  })
}

/** Compare identity and inode before deleting an abandoned path. */
function matches(
  record: IUnixSocketRecord,
  path: string,
  stat: Awaited<ReturnType<typeof lstat>>
): boolean {
  return (
    record.path === path &&
    stat.isSocket() &&
    !stat.isSymbolicLink() &&
    record.dev === stat.dev &&
    record.ino === stat.ino &&
    record.uid === stat.uid &&
    record.gid === stat.gid
  )
}

/** Only a private directory owned by this user can hold a recoverable socket record. */
async function assertPrivateDirectory(path: string): Promise<void> {
  const stat = await lstat(dirname(path))
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  )
    throw createProcessError(RpcProcessErrorCode.listenFailed)
}

/** Delete only a stale socket whose complete sidecar belongs to this exact service. */
export async function prepareUnixSocketPath(path: string, serviceId: string): Promise<void> {
  if (typeof serviceId !== 'string' || serviceId.length === 0)
    throw createProcessError(RpcProcessErrorCode.listenFailed)
  await assertPrivateDirectory(path)
  let stat: Awaited<ReturnType<typeof lstat>>
  try {
    stat = await lstat(path)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      try {
        await lstat(recordPath(path))
      } catch (recordError) {
        if (
          recordError &&
          typeof recordError === 'object' &&
          'code' in recordError &&
          recordError.code === 'ENOENT'
        )
          return
      }
      throw createProcessError(RpcProcessErrorCode.listenFailed)
    }
    throw createProcessError(RpcProcessErrorCode.listenFailed, error)
  }
  const record = await readRecord(path)
  if (!record || record.serviceId !== serviceId || !matches(record, path, stat))
    throw createProcessError(RpcProcessErrorCode.listenFailed)
  if (await hasListener(path)) throw createProcessError(RpcProcessErrorCode.listenFailed)
  const current = await lstat(path)
  if (!matches(record, path, current)) throw createProcessError(RpcProcessErrorCode.listenFailed)
  await unlink(path)
  await unlink(recordPath(path))
}

/** Write a complete record atomically before a listener is returned to its caller. */
export async function recordUnixSocketOwner(
  path: string,
  serviceId: string
): Promise<IUnixSocketRecord> {
  await assertPrivateDirectory(path)
  const stat = await lstat(path)
  if (!stat.isSocket() || stat.isSymbolicLink())
    throw createProcessError(RpcProcessErrorCode.listenFailed)
  const record: IUnixSocketRecord = {
    serviceId,
    path,
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid
  }
  const temporary = `${recordPath(path)}.${randomUUID()}`
  const file = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600
  )
  try {
    await file.writeFile(JSON.stringify(record))
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    await link(temporary, recordPath(path))
  } catch (error) {
    await unlink(temporary)
    throw error
  }
  await unlink(temporary)
  return record
}

/** Remove this listener's sidecar only if the record still names its original inode. */
export async function removeUnixSocketOwner(path: string, owner: IUnixSocketRecord): Promise<void> {
  const record = await readRecord(path)
  if (
    !record ||
    record.serviceId !== owner.serviceId ||
    record.path !== path ||
    record.dev !== owner.dev ||
    record.ino !== owner.ino
  )
    return
  await unlink(recordPath(path))
}
