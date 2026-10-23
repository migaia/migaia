import type { ICaseDoc, IText } from './contract.js'
/** Both languages refer to the same actual public-entry examples. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Native examples preserve caller client ownership and explicit Feature selection. */
export const storagePluginPostgresCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  postgresBackendPlugin: [
    {
      title: t('Commit standard storage with SQL', '同事务提交标准存储与 SQL'),
      problem: t(
        'Records and SQL must share one real native transaction.',
        '记录与 SQL 必须共用同一真实原生事务。'
      ),
      example: `import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  await using host = await createStorageHost({ plugins: [postgresBackendPlugin({ driver: pgDriver(pool) })] as const })
  await host.backend('postgres').transaction(async tx => {
    await tx.set('ready', 'yes')
    await tx.putRecord({ name: 'Ada' }, 'user:1')
    await tx.sql\`SELECT 1\`.get()
  })
} finally { await pool.end() }`,
      result: t(
        'All operations settle before returning the connection; the caller still owns its pool.',
        '归还连接前所有操作真实结算；pool 仍归调用方。'
      )
    }
  ],
  pgvectorFeature: [
    {
      title: t('Rank inside native pgvector', '在原生 pgvector 中排名'),
      problem: t(
        'Organization, expiry and faithful filters must precede topK.',
        '组织、期限与忠实条件必须先于 topK。'
      ),
      example: `import { vector } from '@migaia/storage-contract'
// Select pgvectorFeature() on postgresBackendPlugin first.
const collection = store.use(vector).collection('docs', { dimensions: 3, metric: 'cosine' })
await collection.upsert([{ id: 'a', vector: [1, 0, 0], payload: { ready: true } }])
const hits = await collection.near([1, 0, 0], { exact: true }).where('ready', 'eq', true).topK(5).all()`,
      result: t(
        'Native vector(d) computes distances; client predicates never refill missing hits.',
        '原生 vector(d) 计算距离；客户端谓词不补搜。'
      )
    }
  ],
  pgLogicalReplicationFeature: [
    {
      title: t('Persist processed WAL progress', '保存已处理 WAL 进度'),
      problem: t(
        'Partial multi-org commits must resume without confirming unfinished summaries.',
        '多组织提交的部分恢复不能确认未完成摘要。'
      ),
      example: `import { durableChangeFeed } from '@migaia/storage-contract'
// Select pgLogicalReplicationFeature({ slot, publication }) with the /pg adapter.
const feed = store.use(durableChangeFeed)
const page = await feed.readChanges({ after: savedCursor, limit: 1 })
await processAndPersist(page.changes)
await persistCursor(page.cursor)`,
      result: t(
        'Only subsequent complete progress confirms commitEndLsn in the original named slot.',
        '仅后续完整进度才在原命名 slot 确认 commitEndLsn。'
      )
    }
  ]
}
