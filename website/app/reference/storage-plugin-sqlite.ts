import type { ILibraryReference, IMemberDoc, IText } from './contract.js'
import { storagePluginSqliteCases } from './storage-plugin-sqlite-cases.js'
/** Bilingual descriptions share the same exact public module inventory. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Full public lifecycle for an explicitly configured in-memory connection. */
const sqliteConfiguredExample = `import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'

await using connection = nodeSqliteDriver(':memory:')
await using host = await createStorageHost({
  plugins: [sqliteBackendPlugin({
    id: 'application', driver: connection, table: 'settings', wal: false,
    owner: { label: 'settings-owner' }, maxLockMs: 10000
  })] as const
})
await host.backend('application').set('theme', 'dark')
console.log(await host.backend('application').get('theme'))`

/** Policy selection remains in the shared concurrency owner, not the native driver. */
const sqliteConcurrencyExample = `import { ConcurrencyPolicy } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'

await using connection = nodeSqliteDriver(':memory:')
await using host = await createStorageHost({
  plugins: [sqliteBackendPlugin({
    driver: connection, concurrency: ConcurrencyPolicy.wait({ timeoutMs: 200 })
  })] as const
})
await host.backend('sqlite').set('theme', 'dark')
console.log(await host.backend('sqlite').get('theme'))`

/** One canonical option table serves the public options type and its anonymous id extension. */
const sqliteOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  driver: {
    summary: t(
      'Caller-owned native connection, exclusive to one installed store until that store drains.',
      '调用方拥有的原生连接；在已安装 store 排空前由其独占。'
    )
  },
  table: {
    summary: t(
      'Physical table prefix, quoted as complete SQL identifiers.',
      '物理表前缀，作为完整 SQL 标识符引用。'
    ),
    default: t(
      'migaia, with separate channel and control tables.',
      'migaia，使用独立通道表和控制表。'
    )
  },
  concurrency: {
    summary: t(
      'Default policy resolved by the shared concurrency owner.',
      '由共同并发 owner 解析的缺省策略。'
    ),
    default: t('The shared default concurrency policy.', '共同缺省并发策略。'),
    whenToUse: t(
      'Choose a logical acquisition budget instead of changing native SQLite timeouts.',
      '需要调整逻辑锁获取预算时使用，不改变 SQLite 原生超时。'
    ),
    example: sqliteConcurrencyExample
  },
  owner: {
    summary: t(
      'Optional diagnostic owner label; it grants no authority.',
      '可选诊断 owner 标签，不授予权限。'
    ),
    default: t('No custom owner label.', '无自定义 owner 标签。')
  },
  maxLockMs: {
    summary: t(
      'Maximum native WAL lock lease; expiration rejects continued transaction use.',
      '原生 WAL 锁的最长租期；过期后拒绝继续使用事务。'
    ),
    default: t('30000 milliseconds.', '缺省租期为 30000 毫秒。')
  },
  wal: {
    summary: t(
      'Select native cross-connection WAL locks or the original in-process shared lock port.',
      '选择原生跨连接 WAL 锁或原进程内共享锁端口。'
    ),
    default: t(
      'true for file databases; false for memory databases. A requested WAL mode must be confirmed by SQLite.',
      '文件库 true，内存库 false；请求的 WAL 模式必须由 SQLite 确认。'
    )
  }
}

/** Explicit native subpaths keep the package root independent of runtime builtin modules. */
export const storagePluginSqliteReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Install native SQLite with shared SQL, isolated organizations and original-transaction journal/undo.',
        '安装具备共同 SQL、组织隔离及原事务日志与撤销的原生 SQLite。'
      )
    },
    node: {
      summary: t(
        'Node and Deno builtin node:sqlite connection ownership.',
        '使用 Node 与 Deno 的内置 node:sqlite，创建需要调用方显式释放的原生连接。'
      )
    },
    bun: {
      summary: t(
        'Bun builtin SQLite with exact integer reads.',
        '使用 Bun 内置 SQLite 创建调用方拥有的连接，读取大整数时保留精确值。'
      )
    },
    'features/maintenance': {
      summary: t(
        'Back up and vacuum through the original installed SQL endpoint.',
        '通过原已安装且经过准入的 SQL 终点执行原生备份与数据库整理。'
      )
    }
  },
  symbols: {
    sqliteBackendPlugin: {
      role: 'factory',
      purpose: t(
        'Define one caller-owned driver backend for the storage host.',
        '为存储宿主定义一个借用调用方原生连接的 SQLite 后端，安装后共用原事务边界。'
      ),
      returns: t(
        'An exact-id backend plugin. File databases verify WAL by default; memory defaults to wal:false and can reserve private native log namespaces.',
        '具有精确 id 的后端插件。文件库缺省确认 WAL；内存库缺省 wal:false，可独占原生私有日志 namespace。'
      ),
      params: {
        options: t(
          'Captured driver and backend configuration.',
          '一次捕获的原生 driver 与后端配置。'
        ),
        features: t(
          'Optional exact-kind Feature definitions keyed by installed API name.',
          '按安装 API 名称命名的可选精确 kind Feature 定义。'
        )
      },
      optionDocs: {
        ...sqliteOptionMembers,
        id: {
          summary: t(
            'Literal backend id selected by host.backend.',
            '宿主按字面量后端标识选择这个已安装实例。'
          ),
          default: t('sqlite.', '缺省标识为 sqlite。')
        },
        'owner.label': {
          summary: t(
            'Diagnostic text for the existing concurrency owner.',
            '既有并发 owner 使用的诊断标签文本。'
          ),
          default: t('No custom label.', '无自定义标签。')
        }
      },
      optionCases: [
        {
          title: t('Own a configured application connection', '拥有已配置的业务连接'),
          problem: t(
            'Use a named backend and table with explicit memory-mode locking; release the host before its connection.',
            '使用具名后端与业务表，明确选择内存库锁模式，并在连接之前释放宿主。'
          ),
          example: sqliteConfiguredExample,
          result: t(
            'Prints dark. Private logs in memory may cache an exclusive index; file connections reread current log state inside each native transaction.',
            '输出 dark。内存私有日志可以缓存独占索引；文件连接在每次原生事务内读取当前日志状态。'
          ),
          covers: ['id', 'driver', 'table', 'wal', 'owner', 'maxLockMs']
        }
      ],
      cases: storagePluginSqliteCases.sqliteBackendPlugin
    },
    sqliteBackendKind: {
      role: 'constant',
      purpose: t(
        'Authenticate SQLite Feature targets by exact kind identity.',
        '通过精确 kind 令牌身份校验 SQLite Feature 的安装目标，错误目标在访问连接之前拒绝。'
      ),
      returns: t(
        'A neutral kind token; it owns no connection and grants no close authority.',
        '中立 kind 令牌，不拥有连接，也不授予关闭权。'
      )
    },
    nodeSqliteDriver: {
      role: 'factory',
      purpose: t(
        'Open the native Node/Deno SQLite connection with exact integers.',
        '打开调用方拥有的 Node/Deno 原生 SQLite 连接，大整数读取保持精确，需显式释放。'
      ),
      returns: t(
        'A caller-owned synchronous driver and storage resource, without a public native Database or close method.',
        '调用方拥有的同步 driver 与存储资源，不公开原生 Database 或 close 方法。'
      ),
      params: {
        path: t(
          'Native database filename or :memory: for a private memory database.',
          '原生数据库文件路径，或以 :memory: 创建私有内存库。'
        )
      },
      cases: storagePluginSqliteCases.nodeSqliteDriver
    },
    bunSqliteDriver: {
      role: 'factory',
      purpose: t(
        'Open bun:sqlite with safeIntegers enabled before statements run.',
        '打开调用方拥有的 Bun 原生 SQLite 连接，在任何语句执行之前启用精确整数读取。'
      ),
      returns: t(
        'A caller-owned connection; disposal uses native close(true).',
        '调用方拥有的连接；释放使用原生 close(true)。'
      ),
      params: {
        path: t(
          'Native database filename or :memory: for a private memory database.',
          '原生数据库文件路径，或以 :memory: 创建私有内存库。'
        )
      },
      cases: storagePluginSqliteCases.bunSqliteDriver
    },
    sqliteMaintenanceFeature: {
      role: 'factory',
      purpose: t(
        'Add backup and vacuum only to the installed store API.',
        '通过 Feature 向已安装的根存储增加原生备份与整理能力，事务视图不公开维护操作。'
      ),
      returns: t(
        'A SQLite Feature. Transactions expose neither maintenance operation.',
        'SQLite Feature；事务不公开这两个维护操作。'
      ),
      cases: storagePluginSqliteCases.sqliteMaintenanceFeature
    },
    SqliteErrorCode: {
      role: 'constant',
      purpose: t(
        'Identify SQLite native, transaction, channel-conflict and decode failures.',
        '使用规范错误码区分 SQLite 原生操作、事务、跨通道键冲突及保存数据解码失败。'
      ),
      returns: t(
        'SQLITE_FAILED, TRANSACTION_FAILED, DUPLICATE_KEY and DECODE_FAILED, retaining original errors through cause or AggregateError.errors.',
        'SQLITE_FAILED、TRANSACTION_FAILED、DUPLICATE_KEY 与 DECODE_FAILED；原错保留在 cause 或 AggregateError.errors。'
      )
    }
  },
  types: {
    ISqliteValue: {
      summary: t(
        'A native SQLite column value: null, number, bigint, string or bytes. SQL inputs also accept booleans, which bind as integers.',
        '原生 SQLite 列值：null、number、bigint、string 或 bytes。SQL 输入也接受 boolean，并绑定为整数。'
      ),
      members: {}
    },
    ISqliteRow: {
      summary: t(
        'A readonly dynamic column record. Safe integer columns become numbers; larger integers remain exact bigint; returned binary values are copied.',
        '只读动态列记录。安全整数列转为 number，更大整数保持精确 bigint，返回二进制值会复制。'
      ),
      members: {}
    },
    ISqliteRunResult: {
      summary: t(
        'A native mutation result with changes and a required lastInsertRowid, preserving large integer identities.',
        '原生修改结果，含 changes 与必有的 lastInsertRowid，保留大整数身份。'
      ),
      members: {
        changes: {
          summary: t('Number of rows changed by the native statement.', '原生语句修改的行数。')
        },
        lastInsertRowid: {
          summary: t(
            'Native insertion rowid, normalized to number only when safely representable.',
            '原生插入 rowid，仅在可安全表示时转为 number。'
          )
        }
      }
    },
    ISqliteStatement: {
      scenarios: [
        t(
          'Bind values through a caller-owned prepared statement and read exact native integers.',
          '通过调用方拥有的预编译语句绑定值，并读取精确的原生整数。'
        )
      ],
      example: storagePluginSqliteCases.nodeSqliteDriver![0]!.example,
      summary: t(
        'A synchronous prepared native statement borrowed from its connection. Disposal of that connection seals captured statements too.',
        '从连接借用的同步原生预编译语句；连接释放后，已捕获语句也不可再执行。'
      ),
      members: {
        run: {
          summary: t('Execute a mutation with positional bindings.', '使用位置绑定执行修改。'),
          params: {
            values: t('Native column values in placeholder order.', '按占位符顺序排列的原生列值。')
          },
          returns: t(
            'Native changes and insertion identity; native failures retain their cause.',
            '返回原生修改计数及插入身份；原生失败保留 cause。'
          ),
          example: "connection.prepare('CREATE TABLE items(id INTEGER)').run()"
        },
        get: {
          summary: t(
            'Read the first row with copied native column values.',
            '读取第一行并复制原生列值。'
          ),
          params: { values: t('Native positional bindings.', '原生位置绑定值。') },
          returns: t(
            'The first row, or undefined when no row matches.',
            '第一行；无匹配行时为 undefined。'
          ),
          example: "connection.prepare('SELECT ? AS n').get(1)"
        },
        all: {
          summary: t(
            'Read all rows without leaving a native cursor open.',
            '读取所有行，不保留打开的原生游标。'
          ),
          params: { values: t('Native positional bindings.', '原生位置绑定值。') },
          returns: t(
            'A detached array of rows, empty when no row matches.',
            '分离的行数组；无匹配行时为空。'
          ),
          example: "connection.prepare('SELECT ? AS n').all(1)"
        }
      }
    },
    ISqliteDriver: {
      summary: t(
        'The synchronous trusted driver surface borrowed by a backend. Selected Features receive the same frozen exec/prepare view for store and transaction calls, without connection disposal authority.',
        '后端借用的同步可信 driver 表面。选中的 Feature 在根与事务调用中得到同一个冻结 exec/prepare 视图，不授予连接释放权。'
      ),
      members: {
        exec: {
          summary: t(
            'Execute trusted native SQL without parameters.',
            '执行无参数的可信原生 SQL。'
          ),
          params: {
            sql: t(
              'Native SQL text supplied by the driver owner.',
              'driver 拥有者提供的原生 SQL 文本。'
            )
          },
          returns: t(
            'Completes synchronously or throws a coded native failure.',
            '同步完成，或抛出带代码的原生失败。'
          ),
          example: "connection.exec('CREATE TABLE items(id INTEGER)')"
        },
        prepare: {
          summary: t(
            'Prepare a native statement without adding a driver cache.',
            '预编译原生语句，不增加 driver 缓存。'
          ),
          params: {
            sql: t('Native SQL with positional placeholders.', '含位置占位符的原生 SQL。')
          },
          returns: t(
            'A synchronous statement borrowed from the same connection.',
            '从同一连接借用的同步语句。'
          ),
          example: "const statement = connection.prepare('SELECT ? AS n')"
        }
      }
    },
    ISqliteConnection: {
      scenarios: [
        t(
          'Give the host a borrowed connection and keep disposal in the creating application.',
          '向宿主提供借用连接，由创建连接的应用保留最终释放权。'
        )
      ],
      example: sqliteConfiguredExample,
      summary: t(
        'The creating caller owns this driver and storage resource. Dispose the host before the connection; backend disposal never closes it.',
        '创建调用方拥有的 driver 与存储资源。先释放 host，再释放连接；后端释放不会关闭连接。'
      ),
      members: {
        dispose: {
          summary: t(
            'Seal the driver and close the native connection once.',
            '封闭 driver 并只关闭原生连接一次。'
          ),
          returns: t(
            'The same explicit disposal Promise on repeated calls; native close failure rejects with its cause.',
            '重复调用返回同一个显式释放 Promise；原生关闭失败保留 cause 并拒绝。'
          ),
          example: 'await host.dispose()\nawait connection.dispose()'
        }
      }
    },
    ISqliteExecutor: {
      summary: t(
        'The common storage SQL executor specialized for native SQLite rows and mutation results. Its sql tag compiles lazily after operation admission.',
        '共同存储 SQL 执行器，以 SQLite 原生行及修改结果特化。sql 标签在操作准入后延迟编译。'
      ),
      members: {
        sql: {
          summary: t(
            'Compose safe SQL through the shared template tag and fragment utilities.',
            '通过共同模板标签及片段工具组合安全 SQL。'
          ),
          params: {
            strings: t('Template literal segments.', '模板字面量片段。'),
            values: t('Bound values or shared SQL nodes.', '绑定值或共同 SQL 节点。')
          },
          returns: t(
            'A lazy statement exposing run, get and all. Transaction control and journal_mode mutation are rejected.',
            '返回具有 run、get、all 的延迟语句；拒绝事务控制及 journal_mode 修改。'
          ),
          example: 'await store.sql`SELECT ${1} AS n`.get()'
        }
      }
    },
    ISqliteCapabilities: {
      summary: t(
        'The exact built-in capability token union: kv, records, sql, ttl and counter.',
        '内置精确能力令牌联合：kv、records、sql、ttl 与 counter。'
      ),
      members: {}
    },
    ISqliteTransactionScope: {
      summary: t(
        'An authentic short transaction view with complete shared transaction operations, selected Feature API and native SQL on the same connection. Derived record queries retain selected chain methods. A caught operation failure still rolls back the whole transaction.',
        '具有共同完整事务操作、选中 Feature API 及同连接原生 SQL 的真实短事务视图。派生记录查询保留所选链方法。即使捕获操作失败，整个事务仍会回滚。'
      ),
      members: {}
    },
    ISqliteStore: {
      summary: t(
        'The installed native store combines text, bytes, typed records, sync access, private metadata, SQL and kv/records/sql/ttl/counter capabilities. Root access rejects while a transaction owns its connection.',
        '已安装原生 store 集合文本、二进制、类型记录、同步访问、私有元数据、SQL 及 kv/records/sql/ttl/counter 能力。事务占用连接时，根访问拒绝。'
      ),
      members: {}
    },
    ISqliteOptions: {
      summary: t(
        'Installation settings captured by sqliteBackendPlugin before native work begins.',
        'sqliteBackendPlugin 在原生工作开始前捕获的安装配置。'
      ),
      members: sqliteOptionMembers
    },
    ISqliteMaintenanceApi: {
      summary: t(
        'Store-only maintenance supplied by sqliteMaintenanceFeature on the original admitted SQL endpoint.',
        'sqliteMaintenanceFeature 经原准入 SQL 终点提供的 store 专属维护 API。'
      ),
      members: {
        backup: {
          summary: t(
            'Run native VACUUM INTO without deleting an existing target.',
            '执行原生 VACUUM INTO，不删除已有目标。'
          ),
          params: {
            path: t('New backup destination path.', '新备份目标路径。'),
            ctx: t('Optional operation cancellation context.', '可选操作取消上下文。')
          },
          returns: t(
            'Resolves after native backup; an existing nonempty target or active transaction rejects.',
            '原生备份完成后兑现；已有非空目标或活动事务导致拒绝。'
          ),
          example: "await store.api.maintenance.backup('./backup.sqlite')"
        },
        vacuum: {
          summary: t(
            'Run native VACUUM on the original connection.',
            '在原连接上执行原生数据库整理，活动事务期间拒绝执行。'
          ),
          params: { ctx: t('Optional operation cancellation context.', '可选操作取消上下文。') },
          returns: t(
            'Resolves after native maintenance; an active transaction rejects.',
            '原生维护完成后兑现；活动事务导致拒绝。'
          ),
          example: 'await store.api.maintenance.vacuum()'
        }
      }
    },
    ISqliteErrorCode: {
      summary: t(
        'The value union of the canonical SqliteErrorCode table.',
        '规范错误码表的值联合，用于对外分类原生操作与事务等失败。'
      ),
      members: {}
    }
  },
  enums: {
    SqliteErrorCode: {
      summary: t(
        'Package boundary failure categories; original native and user errors remain reachable.',
        '包边界失败分类；原生错误及用户错误保持可追溯。'
      ),
      values: {
        sqliteFailed: t(
          'A native operation or connection operation failed; inspect cause.',
          '原生操作或连接操作失败；检查 cause。'
        ),
        transactionFailed: t(
          'A transaction failed or root access met an occupied connection; inspect cause and cleanup errors.',
          '事务失败，或根访问遇到占用的连接；检查 cause 与清理错误。'
        ),
        duplicateKey: t(
          'A write collides with another public storage channel under reject policy.',
          '拒绝策略下，写入与另一公开存储通道发生冲突。'
        ),
        decodeFailed: t(
          'Persisted key or value decoding failed; inspect cause without discarding the stored data.',
          '持久化键或值解码失败；检查 cause，不丢弃原存储数据。'
        )
      }
    }
  },
  enhancers: {}
}
