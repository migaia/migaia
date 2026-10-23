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
  },
  types: {
    IPostgresOptions: {
      summary: t(
        'Injected driver and physical store configuration; schema=public, prefix=migaia, server=postgres.',
        '注入 driver 与物理配置；缺省 schema=public、prefix=migaia、server=postgres。'
      ),
      members: {}
    },
    IPostgresStore: {
      summary: t(
        'Exact preset store with native SQL, full standard transactions and organization-safe selected providers.',
        '精确 preset store，包含原生 SQL、完整标准事务与组织安全的所选 provider。'
      ),
      members: {}
    },
    IPostgresTransactionScope: {
      summary: t(
        'The original admitted view sharing KV, records, TTL, counter and SQL on one connection.',
        '同一连接上共享 KV、records、TTL、counter 与 SQL 的原准入视图。'
      ),
      members: {}
    },
    IPostgresErrorCode: {
      summary: t(
        'Value union of the package-owned PostgresErrorCode table.',
        '本包 PostgresErrorCode 表的值联合。'
      ),
      members: {}
    },
    IPgServer: {
      summary: t(
        'Actual postgres, cockroach or yugabyte server preset; only postgres declares native changeFeed.',
        '真实 postgres、cockroach 或 yugabyte preset；仅 postgres 声明原生 changeFeed。'
      ),
      members: {}
    },
    IPgCapabilities: {
      summary: t(
        'The backend native kv/records/ttl/counter/sql token union, before optional Features.',
        '选择 Feature 前的后端原生 kv/records/ttl/counter/sql 令牌联合。'
      ),
      members: {}
    },
    IPgDriver: {
      summary: t(
        'Caller-owned query/connect and optional listen/replication ports; no close authority.',
        '调用方拥有的 query/connect 及可选 listen/replication 端口，不授予关闭权。'
      ),
      members: {}
    },
    IPgConnection: {
      summary: t(
        'Borrowed native query/COPY connection and original two-promise resource release.',
        '借用的原生 query/COPY 连接及原双 Promise 资源释放。'
      ),
      members: {}
    },
    IPgResult: {
      summary: t(
        'Validated native scalar rows and actual command rowCount, with null count normalized to zero.',
        '经验证的原生标量行与真实命令 rowCount；null 计数归零。'
      ),
      members: {}
    },
    IPgNativeParameter: {
      summary: t(
        "Shared SQL scalars or this package's finite one-dimensional array carrier.",
        '共享 SQL 标量或本包有限一维数组载体。'
      ),
      members: {}
    },
    IPgNativeArrayParameter: {
      summary: t(
        'text/float8 arrays are encoded once and bound as one parameter, never SQL text.',
        'text/float8 数组编码一次后作为单参数绑定，不插入 SQL 文本。'
      ),
      members: {}
    },
    IPgNativeOperation: {
      summary: t(
        'Finite backend author port reusing the original transaction and host pipeline.',
        '复用原事务与 host pipeline 的有限后端作者端口。'
      ),
      members: {}
    },
    IPgCopyTarget: {
      summary: t(
        'Structured nonempty table identifier path and nonempty column names for client STDIN.',
        '客户端 STDIN 的非空结构化表标识符路径与列名。'
      ),
      members: {}
    },
    IPgCopyOptions: {
      summary: t(
        'CSV defaults to comma/header:false; text defaults to TAB and rejects header.',
        'CSV 缺省逗号/header:false；text 缺省 TAB 且拒绝 header。'
      ),
      members: {}
    },
    IPgCopySource: {
      summary: t(
        'A fresh AsyncIterable<Uint8Array> factory invoked once per actual attempt.',
        '每次真实尝试调用一次、返回新 AsyncIterable<Uint8Array> 的工厂。'
      ),
      members: {}
    },
    IPgCopyApi: {
      summary: t(
        'Root/transaction from(target,source,options?,ctx?) streams native COPY and returns void.',
        '根/事务 from(target,source,options?,ctx?) 流式执行原生 COPY 并返回 void。'
      ),
      members: {}
    },
    IPgListenApi: {
      summary: t(
        'Root listen(channel,listener,ctx?) returns an owned subscription; notify settles on commit.',
        '根 listen(channel,listener,ctx?) 返回所属订阅；notify 随提交真实结算。'
      ),
      members: {}
    },
    IPgTransactionNotifyApi: {
      summary: t(
        'Transaction notify only; no nested listen subscription escapes the original scope.',
        '仅事务 notify；无可逃逸原作用域的 listen 订阅。'
      ),
      members: {}
    },
    IPgNativeVectorTarget: {
      summary: t(
        'Caller-owned table path and id/vector/payload columns, separate from managed collections.',
        '调用方表路径及 id/vector/payload 列，独立于托管集合。'
      ),
      members: {}
    },
    IPgNativeVectorSearchOptions: {
      summary: t(
        'metric=cosine, limit=10; finite minScore/filter and transaction-local efSearch/probes.',
        '缺省 metric=cosine、limit=10；有限 minScore/filter 与事务内 efSearch/probes。'
      ),
      members: {}
    },
    IPgNativeVectorHit: {
      summary: t(
        'Original native SQL id, finite score and optional native payload.',
        '原生 SQL id、有限 score 与可选原生 payload。'
      ),
      members: {}
    },
    IPgNativeVectorApi: {
      summary: t(
        'search(target,query,options?,ctx?) uses native operators and caller table semantics.',
        'search(target,query,options?,ctx?) 使用原生运算符与调用方表语义。'
      ),
      members: {}
    },
    IPgLogicalReplicationOptions: {
      summary: t(
        'Deployment-owned persistent slot and FOR ALL TABLES publication names.',
        '部署方拥有的持久 slot 与 FOR ALL TABLES publication 名称。'
      ),
      members: {}
    },
    IPgLogicalReplicationRoute: {
      summary: t(
        'Read-only schema/prefix and optional immutable org route for the original native decoder.',
        '原生 decoder 的只读 schema/prefix 与可选固定 org 路由。'
      ),
      members: {}
    },
    IPgLogicalReplicationPort: {
      summary: t(
        'pg-only detect/read/open/dropSlot backed by the original slot and pgoutput peer.',
        '仅 pg 提供，原 slot 与 pgoutput peer 支撑的 detect/read/open/dropSlot。'
      ),
      members: {}
    },
    IPgCapabilityProbeHookPayload: {
      summary: t(
        'Read-only actual version/isolation/capability facts and optional max_slot_wal_keep_size.',
        '只读真实版本、隔离级别、能力事实及可选 max_slot_wal_keep_size。'
      ),
      members: {}
    },
    IPgNotifyHookPayload: {
      summary: t(
        'Native channel identity and original backend/org hook context, without payload values.',
        '原生频道身份与原后端/org hook 上下文，不包含载荷值。'
      ),
      members: {}
    }
  },
  enums: {
    PostgresErrorCode: {
      summary: t('Package boundary errors preserve original causes.', '包边界错误保留原始 cause。'),
      values: {
        sqlFailed: t(
          'Native query, stream or connection failure; inspect cause.',
          '原生查询、流或连接失败；检查 cause。'
        ),
        decodeFailed: t(
          'Persisted key/value/native metadata decoding failed.',
          '持久键值或原生元数据解码失败。'
        ),
        transactionFailed: t(
          'Original transaction failed, preserving the primary and cleanup causes.',
          '原事务失败，保留首错与清理 cause。'
        ),
        duplicateKey: t(
          'A rejected write collides with another public channel.',
          '拒绝写入与另一公开通道冲突。'
        )
      }
    }
  },
  enhancers: {}
}
