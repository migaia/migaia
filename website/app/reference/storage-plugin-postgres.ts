import type { ILibraryReference, IText } from './contract.js'
import { storagePluginPostgresCases } from './storage-plugin-postgres-cases.js'
/** Bilingual documentation covers one finite native public surface. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Only explicit driver subpaths load their real peer clients. */
export const storagePluginPostgresReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'PostgreSQL storage plugin and native contracts.',
        'PostgreSQL 存储插件与原生契约。'
      )
    },
    pg: {
      summary: t(
        'Caller-owned pg.Pool, COPY, LISTEN and optional replication.',
        '调用方 pg.Pool、COPY、LISTEN 与可选复制。'
      )
    },
    'postgres-js': {
      summary: t('Native postgres.Sql reserved connections.', '原生 postgres.Sql 保留连接。')
    },
    bun: {
      summary: t('Bun 1.4.4+ SQL with prepare:false.', 'Bun 1.4.4+ SQL，要求 prepare:false。')
    },
    'features/pgvector': {
      summary: t('Native standard vectors and caller-table search.', '原生标准向量与调用方表检索。')
    },
    'features/listen': {
      summary: t('Root subscriptions and transaction notifications.', '根订阅与事务通知。')
    },
    'features/copy': {
      summary: t('Backpressured STDIN in the original transaction.', '原事务中的背压 STDIN。')
    },
    'features/logical-replication': {
      summary: t(
        'Durable pgoutput replay through the original slot.',
        '经原 slot 的可靠 pgoutput 重放。'
      )
    }
  },
  symbols: {
    postgresBackendPlugin: {
      role: 'factory',
      purpose: t(
        'Install an injected-driver backend without taking client ownership.',
        '安装注入 driver 的后端，不接管客户端。'
      ),
      returns: t(
        'An exact-id plugin; defaults public/migaia/postgres.',
        '精确 id 插件；缺省 public/migaia/postgres。'
      ),
      cases: storagePluginPostgresCases.postgresBackendPlugin
    },
    postgresBackendKind: {
      role: 'constant',
      purpose: t('Authenticate selected Features by exact kind.', '按精确 kind 校验所选 Feature。')
    },
    PostgresErrorCode: {
      role: 'constant',
      purpose: t(
        'Owned semantic codes use storage.backend.postgres.',
        '所属语义错误码使用 storage.backend.postgres。'
      )
    },
    pgDriver: {
      role: 'factory',
      purpose: t(
        'Borrow real pg.Pool connections and pg-only replication.',
        '借用真实 pg.Pool 连接与仅 pg 提供的复制。'
      )
    },
    postgresJsDriver: {
      role: 'factory',
      purpose: t(
        'Borrow postgres.Sql reservations, native COPY and listeners.',
        '借用 postgres.Sql 保留连接、原生 COPY 与监听。'
      )
    },
    bunSqlDriver: {
      role: 'factory',
      purpose: t(
        'Admit Bun 1.4.4+ prepare:false before I/O.',
        '在 I/O 前准入 Bun 1.4.4+ prepare:false。'
      )
    },
    pgvectorFeature: {
      role: 'factory',
      purpose: t(
        'Publish standard vector and separate caller-table search.',
        '发布标准 vector 与独立调用方表检索。'
      ),
      cases: storagePluginPostgresCases.pgvectorFeature
    },
    pgListenFeature: {
      role: 'factory',
      purpose: t(
        'Add root notifications.listen/notify and transaction notify.',
        '增加根 notifications.listen/notify 与事务 notify。'
      )
    },
    pgCopyFeature: {
      role: 'factory',
      purpose: t(
        'Add atomic STDIN COPY from a fresh iterable per attempt.',
        '增加原子 STDIN COPY，每次尝试新建 iterable。'
      )
    },
    pgLogicalReplicationFeature: {
      role: 'factory',
      purpose: t(
        'Publish durableChangeFeed using deployment-owned slot/publication.',
        '使用部署方 slot/publication 发布 durableChangeFeed。'
      ),
      cases: storagePluginPostgresCases.pgLogicalReplicationFeature
    }
  }
}
