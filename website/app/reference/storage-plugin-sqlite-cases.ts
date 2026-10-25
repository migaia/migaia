import type { ICaseDoc, IText } from './contract.js'
/** Each example keeps its two languages attached to one actual public-entry scenario. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** SQLite examples use caller-owned builtin connections and the real storage host. */
export const storagePluginSqliteCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  sqliteBackendPlugin: [
    {
      title: t('Undo through the original native transaction', '沿原生事务撤销'),
      problem: t(
        'Restore a committed value with complete revision checks and the existing WAL.',
        '经完整修订校验与既有 WAL 恢复已提交值。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'
import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'

await using connection = nodeSqliteDriver(':memory:')
await using changes = memoryLogStore()
await using intents = memoryLogStore()
await using images = memoryLogStore()
const logger = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  plugins: [binlog({ store: changes }), wal({ store: intents }), undoLog({ store: images })]
})
try {
  await using host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: connection })] as const,
    journal: { logger, namespace: 'application' }
  })
  const store = host.backend('sqlite')
  await store.set('theme', 'before')
  await store.set('theme', 'after')
  const entry = (await logger.binlog.read(await logger.binlog.lastSeq()))[0]!
  await store.undo((entry.payload as { txId: string }).txId)
  console.log(await store.get('theme'))
} finally {
  await logger.shutdown('manual')
}`,
      result: t(
        'Prints before. The host borrows the logger; the caller releases it before the three log stores.',
        '输出 before。宿主借用 Logger，调用方在三个日志载体之前释放 Logger。'
      )
    },
    {
      title: t('Keep native logs outside business keys', '原生日志独立于业务键'),
      problem: t(
        'Clearing application values must preserve the private native log sequence.',
        '清空应用值需要保留原生私有日志序号。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'
import { storageLogStore } from '@migaia/storage-host/journal'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'

await using connection = nodeSqliteDriver(':memory:')
await using host = await createStorageHost({ plugins: [sqliteBackendPlugin({ driver: connection })] as const })
await using history = await storageLogStore(host, 'sqlite', { prefix: 'history' })
await history.append([{ kind: 'application', payload: { count: 1 } }])
await host.backend('sqlite').clearAll()
console.log(await history.lastSeq(), await host.backend('sqlite').keys())`,
      result: t(
        'Prints 1 []. The memory connection reserves this private namespace. File connections keep no cross-operation index cache and reread lastSeq and states inside each native transaction.',
        '输出 1 []。内存连接独占此私有 namespace。文件连接不缓存跨操作索引，每次在原生事务内读取 lastSeq 与 states。'
      )
    },
    {
      title: t('Isolate organizations on one native connection', '同一原生连接隔离组织'),
      problem: t(
        'Organization data must share the existing tables without sharing its logical keys.',
        '组织数据需要共用既有表，同时隔离逻辑键。'
      ),
      example: `import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'

await using connection = nodeSqliteDriver(':memory:')
await using host = await createStorageHost({ plugins: [sqliteBackendPlugin({ driver: connection })] as const })
const orgId = createOrgId()
const organization = host.org(orgId).backend('sqlite')
await organization.set('theme', 'dark')
console.log(await organization.get('theme'), await host.backend('sqlite').get('theme'))
await host.dropOrg(orgId)
console.log(await organization.get('theme'))`,
      result: t(
        'Prints dark null, then null. No new connection or organization schema is created; root SQL remains caller-owned and explicit organization views reject it.',
        '输出 dark null，随后输出 null。不新建连接或组织 schema；根 SQL 归调用方，显式组织视图拒绝 SQL。'
      )
    },
    {
      title: t('Commit SQL with a snapshot key', '同事务提交 SQL 与快照键'),
      problem: t(
        'A database row and its application counter must either both commit or both roll back.',
        '数据库行与业务计数必须一起提交或一起回滚。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'

await using connection = nodeSqliteDriver(':memory:')
await using host = await createStorageHost({ plugins: [sqliteBackendPlugin({ driver: connection })] as const })
const store = host.backend('sqlite')
await store.sql\`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT)\`.run()
await store.transaction(async tx => {
  await tx.sql\`INSERT INTO users VALUES(\${1}, \${'Ada'})\`.run()
  await tx.set('count', '1')
})
console.log(await store.get('count'))`,
      result: t(
        'Prints 1. Both writes use one native transaction; host disposal leaves the connection for its caller to release.',
        '输出 1；两个写入处于同一个原生事务。host 释放后连接仍由调用方释放。'
      )
    }
  ],
  nodeSqliteDriver: [
    {
      title: t('Retain precise native integers', '保留原生整数精度'),
      problem: t(
        'SQLite integers can exceed JavaScript safe number precision.',
        'SQLite 整数可能超过 JavaScript 安全整数范围。'
      ),
      example: `import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'

await using connection = nodeSqliteDriver(':memory:')
const row = connection.prepare('SELECT ? AS value').get(9007199254740993n)
console.log(row?.value)`,
      result: t(
        'Prints the exact bigint 9007199254740993n; safe integer columns are normalized to numbers.',
        '输出精确 bigint 9007199254740993n；安全整数列归一为 number。'
      )
    }
  ],
  bunSqliteDriver: [
    {
      title: t('Choose the Bun builtin explicitly', '显式选择 Bun 内置驱动'),
      problem: t(
        'A Bun application needs its native SQLite driver without loading the Node builtin.',
        'Bun 应用需要自己的原生 SQLite 驱动，不能加载 Node 内置模块。'
      ),
      example: `import { bunSqliteDriver } from '@migaia/storage-plugin-sqlite/bun'

await using connection = bunSqliteDriver(':memory:')
console.log(connection.prepare('SELECT 1 AS value').get()?.value)`,
      result: t(
        'Prints 1 through bun:sqlite. Only the creating caller closes the connection.',
        '经 bun:sqlite 输出 1；只有创建连接的调用方负责关闭。'
      )
    }
  ],
  sqliteMaintenanceFeature: [
    {
      title: t('Back up an installed database', '备份已安装数据库'),
      problem: t(
        'A database backup must use the same admitted connection and preserve the original file.',
        '备份必须使用同一个已准入连接，并保留原文件。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
import { sqliteMaintenanceFeature } from '@migaia/storage-plugin-sqlite/features/maintenance'

await using connection = nodeSqliteDriver('./source.sqlite')
await using host = await createStorageHost({ plugins: [sqliteBackendPlugin({ driver: connection }, { maintenance: sqliteMaintenanceFeature() })] as const })
await host.backend('sqlite').api.maintenance.backup('./new-backup.sqlite')`,
      result: t(
        'VACUUM INTO writes the new target through the original SQL endpoint. An existing nonempty target rejects; the library never pre-deletes it.',
        'VACUUM INTO 经原 SQL 终点写入新目标。已有非空目标拒绝；库不预先删除目标。'
      )
    }
  ]
}
