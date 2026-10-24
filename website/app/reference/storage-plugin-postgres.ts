import type { ILibraryReference, IText } from './contract.js'
import { storagePluginPostgresCases } from './storage-plugin-postgres-cases.js'
import {
  storagePostgresQuantizedExample,
  storagePostgresQuantizedSymbols,
  storagePostgresQuantizedTypes
} from './storage-plugin-postgres-quantized.js'
/** Bilingual documentation covers one finite native public surface. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Only explicit driver subpaths load their real peer clients. */
export const storagePluginPostgresReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Install the injected native PostgreSQL backend; choose optional vector, COPY, notification or replication Features.',
        zh: '安装注入原生驱动的存储后端，按需选择向量、流复制、通知与逻辑复制扩展。'
      }
    },
    pg: {
      summary: {
        en: 'Borrow caller-owned pg.Pool connections with native COPY, LISTEN and optional logical replication.',
        zh: '借用调用方连接池的原生连接，提供流式复制、频道监听与可选逻辑复制。'
      }
    },
    'postgres-js': {
      summary: {
        en: 'Borrow postgres.Sql reservations for standard storage, native COPY and committed notifications.',
        zh: '借用客户端保留连接承载标准存储、原生流式复制与已提交通知。'
      }
    },
    bun: {
      summary: {
        en: 'Adapt Bun 1.4.4 or newer SQL with prepare:false; the caller retains the native client.',
        zh: '适配符合版本要求且关闭预编译的内置数据库客户端，连接仍归调用方拥有。'
      }
    },
    'features/pgvector': {
      summary: {
        en: 'Select native pgvector ranking for managed collections and separate caller-owned SQL tables.',
        zh: '选择原生向量排名，同时支持托管集合与独立的调用方数据库表。'
      }
    },
    'features/quantized': {
      summary: t(
        'Select native half-precision or binary expression recall and exact original-vector rescoring for the existing pgvector provider.',
        '为既有原生向量能力选择半精度或二进制表达式召回，并对候选原向量精确重排。'
      ),
      example: storagePostgresQuantizedExample
    },
    'features/listen': {
      summary: {
        en: 'Select dedicated root listeners and native notifications that settle with the original transaction.',
        zh: '选择专用根监听资源与原生消息通知，通知随原事务提交真实结算。'
      }
    },
    'features/copy': {
      summary: {
        en: 'Select backpressured client STDIN COPY on the original reserved connection and transaction.',
        zh: '选择客户端标准输入的流式复制，在原保留连接和事务中应用背压。'
      }
    },
    'features/logical-replication': {
      summary: {
        en: 'Select reliable pgoutput replay from a deployment-created publication and persistent slot.',
        zh: '选择来自部署方预建发布与持久复制槽的可靠逻辑变更重放能力。'
      }
    }
  },
  symbols: {
    postgresBackendPlugin: {
      role: 'factory',
      purpose: {
        en: 'Install an injected native driver with standard transactions, SQL and independently selected native Features.',
        zh: '安装注入的原生驱动，提供标准事务与查询，并允许独立选择所需原生扩展。'
      },
      returns: t(
        'An exact-id plugin; defaults public/migaia/postgres.',
        '精确 id 插件；缺省 public/migaia/postgres。'
      ),
      cases: storagePluginPostgresCases.postgresBackendPlugin,
      params: {
        options: {
          en: 'Caller-supplied native driver, physical layout and original concurrency policy.',
          zh: '调用方给出的原生驱动、物理布局及原并发策略。'
        },
        features: {
          en: 'Exact-kind native Feature selections attached during installation.',
          zh: '安装时附加的精确后端种类原生扩展选择。'
        }
      },
      options: 'IPostgresOptions',
      optionCases: [
        {
          covers: ['id', 'driver', 'schema', 'prefix'],
          title: {
            en: 'Isolate managed tables',
            zh: '隔离托管数据表'
          },
          problem: {
            en: 'Application-owned data must use the intended existing schema and a separate managed table prefix.',
            zh: '应用数据需要位于指定的已有数据库模式，并使用独立的托管数据表前缀。'
          },
          example:
            "import { postgresBackendPlugin, type IPgDriver } from '@migaia/storage-plugin-postgres'\nexport const records = (driver: IPgDriver) => postgresBackendPlugin({\n  id: 'records', driver, schema: 'public', prefix: 'application_records'\n})",
          result: {
            en: 'The factory captures one physical layout shared across organization rows.',
            zh: '工厂捕获同一个物理布局，各组织仍通过行级身份隔离数据。'
          }
        },
        {
          covers: ['concurrency', 'owner', 'owner.label', 'maxLockMs'],
          title: {
            en: 'Bound native lock work',
            zh: '限制原生锁工作期限'
          },
          problem: {
            en: 'Lock-bearing writes need the original concurrency policy and a finite lifetime bound.',
            zh: '持有锁的写入需要使用原并发策略，并保留有限的持锁期限上界。'
          },
          example:
            "import { ConcurrencyPolicy } from '@migaia/storage-contract'\nimport { postgresBackendPlugin, type IPgDriver } from '@migaia/storage-plugin-postgres'\nexport const writes = (driver: IPgDriver) => postgresBackendPlugin({\n  driver, concurrency: ConcurrencyPolicy.wait(), owner: { label: 'worker' }, maxLockMs: 60000\n})",
          result: {
            en: 'The native operation owner applies the policy without a second lock coordinator.',
            zh: '由原生操作拥有者应用所选策略，不再增加第二套锁协调器。'
          }
        }
      ]
    },
    postgresBackendKind: {
      role: 'constant',
      purpose: {
        en: 'Authenticate selected native Features against the exact PostgreSQL backend kind.',
        zh: '以精确后端种类认证所选原生扩展，安装时拒绝错误的挂载目标。'
      }
    },
    PostgresErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Classify native SQL, persisted-data decoding and original transaction failures under the PostgreSQL error domain.',
        zh: '在所属错误领域区分原生查询、持久数据解码与原事务失败，并保留原始原因。'
      }
    },
    pgDriver: {
      role: 'factory',
      purpose: {
        en: 'Borrow pg.Pool connections and dedicated native listeners; only this adapter supplies logical replication.',
        zh: '借用连接池连接与专用原生监听器，仅此适配器提供真实逻辑复制端口。'
      },
      params: {
        pool: {
          en: 'Native pool or SQL client created and owned by the application.',
          zh: '由应用创建并拥有的原生连接池或数据库客户端。'
        }
      },
      returns: {
        en: 'A borrowed native driver; only resources it creates are released, never the injected root client.',
        zh: '返回借用原生驱动，仅释放自身创建的资源，不关闭注入根客户端。'
      }
    },
    postgresJsDriver: {
      role: 'factory',
      purpose: {
        en: 'Borrow genuine postgres.Sql reservations, streaming COPY and original native subscription resources.',
        zh: '借用真实客户端保留连接、流式复制与原生订阅资源，不接管客户端关闭权。'
      },
      params: {
        client: {
          en: 'Native pool or SQL client created and owned by the application.',
          zh: '由应用创建并拥有的原生连接池或数据库客户端。'
        }
      },
      returns: {
        en: 'A borrowed native driver; only resources it creates are released, never the injected root client.',
        zh: '返回借用原生驱动，仅释放自身创建的资源，不关闭注入根客户端。'
      }
    },
    bunSqlDriver: {
      role: 'factory',
      purpose: {
        en: 'Admit a caller-owned Bun SQL client with prepare:false and the required runtime version before native I/O.',
        zh: '在原生输入输出前准入符合运行时版本且关闭预编译的调用方数据库客户端。'
      },
      params: {
        client: {
          en: 'Native pool or SQL client created and owned by the application.',
          zh: '由应用创建并拥有的原生连接池或数据库客户端。'
        }
      },
      returns: {
        en: 'A borrowed native driver; only resources it creates are released, never the injected root client.',
        zh: '返回借用原生驱动，仅释放自身创建的资源，不关闭注入根客户端。'
      }
    },
    pgvectorFeature: {
      role: 'factory',
      purpose: {
        en: 'Publish native standard vector ranking and a separate search API for caller-owned SQL vector tables.',
        zh: '发布原生标准向量排名，并为调用方自己的数据库向量表提供独立检索接口。'
      },
      cases: storagePluginPostgresCases.pgvectorFeature,
      returns: {
        en: 'An exact-kind Feature installed by postgresBackendPlugin, retaining its original native scope.',
        zh: '返回由后端工厂安装的精确种类扩展，保留原生作用域边界。'
      }
    },
    pgListenFeature: {
      role: 'factory',
      purpose: {
        en: 'Add dedicated root LISTEN resources and transaction-bound native NOTIFY calls without polling.',
        zh: '增加专用根频道监听资源与绑定事务的原生通知调用，不另建轮询机制。'
      },
      returns: {
        en: 'An exact-kind Feature installed by postgresBackendPlugin, retaining its original native scope.',
        zh: '返回由后端工厂安装的精确种类扩展，保留原生作用域边界。'
      }
    },
    pgCopyFeature: {
      role: 'factory',
      purpose: {
        en: 'Add streaming client STDIN COPY with a fresh iterable for every actual native transaction attempt.',
        zh: '增加客户端标准输入流式复制，每次真实原生事务尝试都重新获取输入迭代器。'
      },
      returns: {
        en: 'An exact-kind Feature installed by postgresBackendPlugin, retaining its original native scope.',
        zh: '返回由后端工厂安装的精确种类扩展，保留原生作用域边界。'
      }
    },
    pgLogicalReplicationFeature: {
      role: 'factory',
      purpose: {
        en: 'Publish a durable feed backed by deployment-owned slots and publications without creating them implicitly.',
        zh: '发布由部署方复制槽与发布配置支撑的可靠变更流，不隐式创建这些原生对象。'
      },
      cases: storagePluginPostgresCases.pgLogicalReplicationFeature,
      returns: {
        en: 'An exact-kind Feature installed by postgresBackendPlugin, retaining its original native scope.',
        zh: '返回由后端工厂安装的精确种类扩展，保留原生作用域边界。'
      },
      params: {
        options: {
          en: 'Deployment-created persistent slot and publication names.',
          zh: '部署方预先创建的持久复制槽与发布名称。'
        }
      },
      options: 'IPgLogicalReplicationOptions',
      optionCases: [
        {
          covers: ['slot', 'publication'],
          title: {
            en: 'Resume a deployment-owned stream',
            zh: '恢复部署方已有变更流'
          },
          problem: {
            en: 'Deployment must create the persistent slot and publication before the Feature can consume WAL.',
            zh: '部署方必须先创建持久复制槽和发布配置，扩展才能消费原生变更日志。'
          },
          example:
            "import {\n  pgLogicalReplicationFeature\n} from '@migaia/storage-plugin-postgres/features/logical-replication'\nexport const history = pgLogicalReplicationFeature({\n  slot: 'application_storage', publication: 'application_storage_all'\n})",
          result: {
            en: 'The Feature borrows those native objects and never removes them on disposal.',
            zh: '扩展借用这些原生对象，释放时不会删除部署方的复制槽或发布配置。'
          }
        }
      ]
    },
    ...storagePostgresQuantizedSymbols
  },
  types: {
    IPostgresOptions: {
      summary: {
        en: 'Native driver, table layout and original concurrency configuration for one backend.',
        zh: '单个后端的原生驱动、数据表布局与原并发配置。'
      },
      members: {
        id: {
          summary: {
            en: 'Application-assigned backend identifier selected by host.backend.',
            zh: '应用指定的后端标识，供宿主选择对应的存储实例。'
          },
          default: {
            en: 'postgres, the default backend identifier.',
            zh: '缺省使用后端标识 postgres。'
          }
        },
        driver: {
          summary: {
            en: 'Borrowed native driver from pgDriver, postgresJsDriver or bunSqlDriver.',
            zh: '来自公开适配器的借用原生驱动，根客户端仍由调用方拥有。'
          }
        },
        server: {
          summary: {
            en: 'Actual deployed server preset used for native capability admission.',
            zh: '实际部署的服务端预设，用于原生能力准入判断。'
          },
          default: {
            en: 'postgres enables PostgreSQL semantics.',
            zh: '缺省使用 PostgreSQL 原生语义。'
          },
          values: {
            postgres: {
              en: 'PostgreSQL with native change notifications.',
              zh: '使用原生数据库及其真实变更通知能力。'
            },
            cockroach: {
              en: 'CockroachDB without PostgreSQL changeFeed promises.',
              zh: '兼容服务，不承诺原生数据库的变更通知能力。'
            },
            yugabyte: {
              en: 'YugabyteDB without PostgreSQL changeFeed promises.',
              zh: '兼容服务，不承诺原生数据库的变更通知能力。'
            }
          },
          whenToUse: {
            en: 'Choose the actual deployed server, since capability admission depends on its native guarantees.',
            zh: '按实际部署服务选择预设，因为能力准入取决于该服务的原生保证。'
          },
          example:
            "import { postgresBackendPlugin, type IPgDriver } from '@migaia/storage-plugin-postgres'\nexport const database = (driver: IPgDriver) => postgresBackendPlugin({ driver, server: 'postgres' })"
        },
        schema: {
          summary: {
            en: 'Existing SQL schema containing managed tables.',
            zh: '容纳托管数据表的已存在数据库模式名称。'
          },
          default: {
            en: 'public schema.',
            zh: '缺省使用 public 数据库模式。'
          }
        },
        prefix: {
          summary: {
            en: 'Prefix for fixed managed tables, shared by every organization.',
            zh: '全部组织共同使用的固定托管表名前缀。'
          },
          default: {
            en: 'migaia table prefix.',
            zh: '缺省使用 migaia 作为表名前缀。'
          }
        },
        concurrency: {
          summary: {
            en: 'Authentic shared policy governing the original native operation.',
            zh: '控制原生操作的真实共享并发策略，不接受伪造对象。'
          },
          default: {
            en: 'Original shared owner default policy.',
            zh: '省略时沿用原共享拥有者的默认策略。'
          }
        },
        owner: {
          summary: {
            en: 'Optional application diagnostic identity without value payloads.',
            zh: '可选的应用诊断身份，不包含业务值载荷。'
          },
          default: {
            en: 'No application owner label.',
            zh: '省略时不附加应用拥有者标签。'
          }
        },
        'owner.label': {
          summary: {
            en: 'Application-assigned label for native lock diagnostics.',
            zh: '应用指定的标签，用于原生锁的拥有者诊断。'
          },
          default: {
            en: 'No diagnostic application label.',
            zh: '省略时不附加应用诊断标签。'
          }
        },
        maxLockMs: {
          summary: {
            en: 'Positive native logical-key lock lease bound measured against database time.',
            zh: '相对数据库时钟计量的原生逻辑键锁正整数租期上界。'
          },
          default: {
            en: '60000 milliseconds.',
            zh: '缺省锁期限为六万毫秒。'
          }
        }
      }
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
      summary: {
        en: 'Value union from the single package-owned PostgreSQL semantic error table.',
        zh: '来自本包唯一所属原生数据库语义错误表的值联合。'
      },
      members: {}
    },
    IPgServer: {
      summary: {
        en: 'Actual deployed server preset; only PostgreSQL promises the native change feed.',
        zh: '实际部署的服务端预设，仅原生数据库承诺变更通知能力。'
      },
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
      members: {
        query: {
          summary: {
            en: 'Execute native SQL once on the selected original connection.',
            zh: '在所选原始连接上执行一次原生查询。'
          },
          params: {
            text: {
              en: 'Complete native SQL statement using positional parameters.',
              zh: '使用位置参数的完整原生查询语句。'
            },
            params: {
              en: 'Native scalar values or supported one-dimensional array carriers.',
              zh: '原生标量值或受支持的一维数组载体。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'Native scalar rows and command rowCount; native errors retain their cause.',
            zh: '返回原生标量行与命令计数，原生错误保留原始原因。'
          },
          example:
            "import { Pool } from 'pg'\nimport { pgDriver } from '@migaia/storage-plugin-postgres/pg'\nconst pool = new Pool({ connectionString: process.env.MIGAIA_PG_URL! })\ntry {\n  const driver = pgDriver(pool)\n  console.log((await driver.query('SELECT 1 AS value', [])).rows)\n  await using connection = await driver.connect()\n  console.log((await connection.query('SELECT 2 AS value', [])).rows)\n} finally { await pool.end() }"
        },
        connect: {
          summary: {
            en: 'Reserve one original native connection until its resource settles.',
            zh: '保留原生连接直到所属资源完成真实释放。'
          },
          params: {
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'A borrowed connection with original idempotent disposal.',
            zh: '返回借用连接，并保留原幂等资源释放语义。'
          },
          example:
            "import { Pool } from 'pg'\nimport { pgDriver } from '@migaia/storage-plugin-postgres/pg'\nconst pool = new Pool({ connectionString: process.env.MIGAIA_PG_URL! })\ntry {\n  const driver = pgDriver(pool)\n  console.log((await driver.query('SELECT 1 AS value', [])).rows)\n  await using connection = await driver.connect()\n  console.log((await connection.query('SELECT 2 AS value', [])).rows)\n} finally { await pool.end() }"
        },
        listen: {
          summary: {
            en: 'Create one dedicated native channel subscription.',
            zh: '创建单个专用的原生频道订阅资源。'
          },
          params: {
            channel: {
              en: 'Application-assigned native notification channel.',
              zh: '应用指定的原生通知频道名称。'
            },
            listener: {
              en: 'Receives the original string payload; thrown or rejected observer errors are reported.',
              zh: '接收原始字符串载荷，观察者抛出或拒绝时会报告错误。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'An independently disposable listener resource; the root client remains open.',
            zh: '返回可独立释放的监听资源，根客户端保持打开。'
          },
          example:
            "import type { IPgDriver } from '@migaia/storage-plugin-postgres'\nexport async function listen(driver: IPgDriver) {\n  await using subscription = await driver.listen!('example_events', payload => console.log(payload))\n  await driver.query('SELECT pg_notify($1,$2)', ['example_events', 'ready'])\n}"
        },
        logicalReplication: {
          summary: {
            en: 'Optional pg-only native slot and pgoutput port; other adapters omit it.',
            zh: '仅指定适配器提供的原生复制槽与解码端口，其它适配器省略。'
          }
        }
      },
      scenarios: [
        {
          en: 'Borrow native SQL operations while keeping all client ownership in the application.',
          zh: '借用原生查询操作，同时让应用保留全部客户端拥有权。'
        }
      ],
      example:
        "import { Pool } from 'pg'\nimport { pgDriver } from '@migaia/storage-plugin-postgres/pg'\nconst pool = new Pool({ connectionString: process.env.MIGAIA_PG_URL! })\ntry {\n  const driver = pgDriver(pool)\n  console.log((await driver.query('SELECT 1 AS value', [])).rows)\n  await using connection = await driver.connect()\n  console.log((await connection.query('SELECT 2 AS value', [])).rows)\n} finally { await pool.end() }"
    },
    IPgConnection: {
      summary: t(
        'Borrowed native query/COPY connection and original two-promise resource release.',
        '借用的原生 query/COPY 连接及原双 Promise 资源释放。'
      ),
      members: {
        query: {
          summary: {
            en: 'Execute native SQL once on the selected original connection.',
            zh: '在所选原始连接上执行一次原生查询。'
          },
          params: {
            text: {
              en: 'Complete native SQL statement using positional parameters.',
              zh: '使用位置参数的完整原生查询语句。'
            },
            params: {
              en: 'Native scalar values or supported one-dimensional array carriers.',
              zh: '原生标量值或受支持的一维数组载体。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'Native scalar rows and command rowCount; native errors retain their cause.',
            zh: '返回原生标量行与命令计数，原生错误保留原始原因。'
          },
          example:
            "import { Pool } from 'pg'\nimport { pgDriver } from '@migaia/storage-plugin-postgres/pg'\nconst pool = new Pool({ connectionString: process.env.MIGAIA_PG_URL! })\ntry {\n  const driver = pgDriver(pool)\n  console.log((await driver.query('SELECT 1 AS value', [])).rows)\n  await using connection = await driver.connect()\n  console.log((await connection.query('SELECT 2 AS value', [])).rows)\n} finally { await pool.end() }"
        },
        copyFrom: {
          summary: {
            en: 'Stream client STDIN through the same native connection with backpressure.',
            zh: '沿同一原生连接应用背压并流式消费客户端标准输入。'
          },
          params: {
            target: {
              en: 'Structured caller-owned table path and column names.',
              zh: '调用方数据库表的结构化路径与列名称。'
            },
            source: {
              en: 'One byte iterable consumed with native backpressure on this reserved connection.',
              zh: '在此保留连接上沿原生背压消费的单个字节迭代器。'
            },
            options: {
              en: 'Native operation settings for the selected COPY or replication request.',
              zh: '所选流式复制或逻辑复制请求的原生操作配置。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'Resolves after all input settles; a failed COPY follows original rollback.',
            zh: '全部输入结算后完成，复制失败沿原事务回滚路径处理。'
          },
          example:
            "import type { IPgConnection } from '@migaia/storage-plugin-postgres'\nexport async function copy(connection: IPgConnection) {\n  async function* rows() { yield new TextEncoder().encode('1\\n') }\n  await connection.copyFrom!(\n    { table: ['events'], columns: ['id'] }, rows(), { format: 'csv' }\n  )\n}"
        }
      },
      scenarios: [
        {
          en: 'Borrow native SQL operations while keeping all client ownership in the application.',
          zh: '借用原生查询操作，同时让应用保留全部客户端拥有权。'
        }
      ],
      example:
        "import { Pool } from 'pg'\nimport { pgDriver } from '@migaia/storage-plugin-postgres/pg'\nconst pool = new Pool({ connectionString: process.env.MIGAIA_PG_URL! })\ntry {\n  const driver = pgDriver(pool)\n  console.log((await driver.query('SELECT 1 AS value', [])).rows)\n  await using connection = await driver.connect()\n  console.log((await connection.query('SELECT 2 AS value', [])).rows)\n} finally { await pool.end() }"
    },
    IPgResult: {
      summary: t(
        'Validated native scalar rows and actual command rowCount, with null count normalized to zero.',
        '经验证的原生标量行与真实命令 rowCount；null 计数归零。'
      ),
      members: {
        rows: {
          summary: {
            en: 'Original validated rows containing supported SQL scalar values.',
            zh: '包含受支持查询标量值的原始已验证结果行。'
          }
        },
        rowCount: {
          summary: {
            en: 'Actual command row count; native null counts normalize to zero.',
            zh: '真实命令影响行数，原生空计数归一化为零。'
          }
        }
      }
    },
    IPgNativeParameter: {
      summary: t(
        "Shared SQL scalars or this package's finite one-dimensional array carrier.",
        '共享 SQL 标量或本包有限一维数组载体。'
      ),
      members: {
        arrayType: {
          summary: {
            en: 'Array-carrier discriminator; scalar parameters have no such field.',
            zh: '数组载体的类型区分字段，标量参数没有此字段。'
          }
        },
        values: {
          summary: {
            en: 'Native one-dimensional elements on the explicit array carrier only.',
            zh: '仅显式数组载体具有的原生一维元素序列。'
          }
        }
      }
    },
    IPgNativeArrayParameter: {
      summary: t(
        'text/float8 arrays are encoded once and bound as one parameter, never SQL text.',
        'text/float8 数组编码一次后作为单参数绑定，不插入 SQL 文本。'
      ),
      members: {
        arrayType: {
          summary: {
            en: 'Discriminator selecting text or finite float8 array encoding.',
            zh: '选择文本或有限浮点数组编码的类型区分字段。'
          }
        },
        values: {
          summary: {
            en: 'One-dimensional native scalar elements, including explicit null items.',
            zh: '一维原生标量元素，允许显式的空值元素。'
          }
        }
      }
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
      members: {
        table: {
          summary: {
            en: 'Nonempty identifier path to the caller-owned destination table.',
            zh: '指向调用方目标数据表的非空标识符路径。'
          }
        },
        columns: {
          summary: {
            en: 'Nonempty destination column identifiers in incoming field order.',
            zh: '按输入字段顺序排列的非空目标列标识符。'
          }
        }
      }
    },
    IPgCopyOptions: {
      summary: {
        en: 'Restricted native client COPY formatting without server files or programs.',
        zh: '受限的原生客户端流式复制格式，不使用服务端文件或程序。'
      },
      members: {
        format: {
          summary: {
            en: 'Native client COPY format, restricted to CSV or text.',
            zh: '原生客户端复制格式，仅允许逗号分隔或文本格式。'
          },
          default: {
            en: 'csv format.',
            zh: '缺省使用逗号分隔格式。'
          },
          values: {
            csv: {
              en: 'CSV quoting and comma separators.',
              zh: '使用逗号分隔与对应字段引用规则。'
            },
            text: {
              en: 'Native text fields separated by TAB.',
              zh: '使用制表符分隔的原生文本字段。'
            }
          }
        },
        header: {
          summary: {
            en: 'Whether CSV begins with a header row; text rejects true.',
            zh: '逗号分隔输入是否具有首行标题，文本格式拒绝开启。'
          },
          default: {
            en: 'false omits the CSV header.',
            zh: '缺省不包含输入标题行。'
          }
        },
        delimiter: {
          summary: {
            en: 'One native delimiter character, without unsafe control separators.',
            zh: '单个原生分隔字符，不允许不安全的控制分隔符。'
          },
          default: {
            en: 'Comma for CSV and TAB for text.',
            zh: '逗号分隔格式使用逗号，文本格式使用制表符。'
          }
        },
        null: {
          summary: {
            en: 'Native marker distinguishing a null field from text.',
            zh: '区分空字段与普通文本的原生空值标记。'
          },
          default: {
            en: 'Native COPY format default marker.',
            zh: '省略时采用原生复制格式的默认标记。'
          }
        }
      }
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
      members: {
        from: {
          summary: {
            en: 'Stream client STDIN through the same native connection with backpressure.',
            zh: '沿同一原生连接应用背压并流式消费客户端标准输入。'
          },
          params: {
            target: {
              en: 'Structured caller-owned table path and column names.',
              zh: '调用方数据库表的结构化路径与列名称。'
            },
            source: {
              en: 'Factory returning a fresh byte iterable for each actual attempt.',
              zh: '每次真实尝试返回新字节迭代器的输入工厂。'
            },
            options: {
              en: 'Native operation settings for the selected COPY or replication request.',
              zh: '所选流式复制或逻辑复制请求的原生操作配置。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'Resolves after all input settles; a failed COPY follows original rollback.',
            zh: '全部输入结算后完成，复制失败沿原事务回滚路径处理。'
          },
          example:
            "import type { IPgCopyApi } from '@migaia/storage-plugin-postgres'\nexport async function copy(api: IPgCopyApi) {\n  await api.from({ table: ['events'], columns: ['id'] }, async function* () {\n    yield new TextEncoder().encode('1\\n')\n  }, { format: 'csv' })\n}"
        }
      }
    },
    IPgListenApi: {
      summary: t(
        'Root listen(channel,listener,ctx?) returns an owned subscription; notify settles on commit.',
        '根 listen(channel,listener,ctx?) 返回所属订阅；notify 随提交真实结算。'
      ),
      members: {
        listen: {
          summary: {
            en: 'Own a dedicated root notification listener until disposal.',
            zh: '持有专用根通知监听器，直到调用方释放该资源。'
          },
          params: {
            channel: {
              en: 'Application-assigned native notification channel.',
              zh: '应用指定的原生通知频道名称。'
            },
            listener: {
              en: 'Receives the original string payload; thrown or rejected observer errors are reported.',
              zh: '接收原始字符串载荷，观察者抛出或拒绝时会报告错误。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'A native listener resource; disposal leaves the injected pool open.',
            zh: '返回原生监听资源，释放时保持注入连接池打开。'
          }
        },
        notify: {
          summary: {
            en: 'Send native notification on the original root or transaction connection.',
            zh: '在原根连接或事务连接上发送原生通知。'
          },
          params: {
            channel: {
              en: 'Application-assigned native notification channel.',
              zh: '应用指定的原生通知频道名称。'
            },
            payload: {
              en: 'Application notification string delivered after commit.',
              zh: '事务提交后传递的应用通知字符串。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'Resolves with native execution; transaction delivery occurs only after COMMIT.',
            zh: '随原生执行结算，事务通知仅在提交后传递。'
          }
        }
      }
    },
    IPgTransactionNotifyApi: {
      summary: t(
        'Transaction notify only; no nested listen subscription escapes the original scope.',
        '仅事务 notify；无可逃逸原作用域的 listen 订阅。'
      ),
      members: {
        notify: {
          summary: {
            en: 'Stage native notification on the current transaction connection.',
            zh: '在当前事务连接中暂存原生通知消息。'
          },
          params: {
            channel: {
              en: 'Application-assigned native notification channel.',
              zh: '应用指定的原生通知频道名称。'
            },
            payload: {
              en: 'Application notification string delivered after commit.',
              zh: '事务提交后传递的应用通知字符串。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'Delivery follows the real COMMIT; rollback sends nothing.',
            zh: '真实提交后才传递消息，回滚不会发送通知。'
          }
        }
      }
    },
    IPgNativeVectorTarget: {
      summary: t(
        'Caller-owned table path and id/vector/payload columns, separate from managed collections.',
        '调用方表路径及 id/vector/payload 列，独立于托管集合。'
      ),
      members: {
        table: {
          summary: {
            en: 'Structured identifier path to the caller-owned vector table.',
            zh: '指向调用方向量数据表的结构化标识符路径。'
          }
        },
        idColumn: {
          summary: {
            en: 'Column preserving original native SQL point identifiers.',
            zh: '保留原生查询点标识的数据表列名称。'
          }
        },
        vectorColumn: {
          summary: {
            en: 'Native vector(d) column used by pgvector operators.',
            zh: '供原生向量运算符使用的向量数据表列名称。'
          }
        },
        payloadColumn: {
          summary: {
            en: 'Optional native payload column retained in each returned hit.',
            zh: '可选原生载荷列，保留在每个返回命中结果中。'
          }
        }
      }
    },
    IPgNativeVectorSearchOptions: {
      summary: {
        en: 'Native metric, result bound and transaction-local vector index search settings.',
        zh: '原生度量、结果数量上界与仅当前事务有效的向量索引检索配置。'
      },
      members: {
        metric: {
          summary: {
            en: 'Native cosine, dot or Euclidean operator selection.',
            zh: '原生余弦、点积或欧氏距离运算符选择。'
          },
          default: {
            en: 'cosine metric.',
            zh: '缺省使用余弦相似度。'
          },
          values: {
            cosine: {
              en: 'Native cosine similarity.',
              zh: '使用原生余弦相似度计算结果。'
            },
            dot: {
              en: 'Native inner product.',
              zh: '使用原生内积计算相似度结果。'
            },
            euclid: {
              en: 'Native Euclidean distance converted to a score.',
              zh: '将原生欧氏距离转换为结果分数。'
            }
          }
        },
        limit: {
          summary: {
            en: 'Maximum native ranked hits returned by this query.',
            zh: '本次查询最多返回的原生排名命中数量。'
          },
          default: {
            en: '10 hits.',
            zh: '缺省最多返回十个命中。'
          }
        },
        minScore: {
          summary: {
            en: 'Optional finite score bound applied by the native query.',
            zh: '由原生查询应用的可选有限分数下界。'
          }
        },
        filter: {
          summary: {
            en: 'Caller-provided native SQL payload condition for this table.',
            zh: '调用方为此数据表提供的原生查询载荷条件。'
          }
        },
        efSearch: {
          summary: {
            en: 'Optional transaction-local HNSW search effort setting.',
            zh: '可选且仅当前事务有效的近邻搜索工作量配置。'
          }
        },
        probes: {
          summary: {
            en: 'Optional transaction-local IVFFlat probe count.',
            zh: '可选且仅当前事务有效的倒排向量索引探测次数。'
          }
        }
      }
    },
    IPgNativeVectorHit: {
      summary: {
        en: 'Native SQL identifier, finite similarity score and optional original table payload.',
        zh: '原生查询标识、有限相似度分数与可选原始数据表载荷。'
      },
      members: {
        id: {
          summary: {
            en: 'Original native SQL identifier read from the caller-selected id column.',
            zh: '从调用方所选标识列读取的原生查询标识。'
          }
        },
        score: {
          summary: {
            en: 'Finite native similarity score in the requested metric.',
            zh: '采用请求度量的有限原生相似度分数。'
          }
        },
        payload: {
          summary: {
            en: 'Original optional value from the caller-selected payload column.',
            zh: '来自调用方所选载荷列的可选原始值。'
          }
        }
      }
    },
    IPgNativeVectorApi: {
      summary: t(
        'search(target,query,options?,ctx?) uses native operators and caller table semantics.',
        'search(target,query,options?,ctx?) 使用原生运算符与调用方表语义。'
      ),
      members: {
        search: {
          summary: {
            en: 'Rank the caller-owned table using the requested native pgvector operator.',
            zh: '使用请求的原生向量运算符为调用方数据表排名。'
          },
          params: {
            target: {
              en: 'Structured caller-owned table path and column names.',
              zh: '调用方数据库表的结构化路径与列名称。'
            },
            query: {
              en: 'Finite vector with the dimension declared by the caller-owned table.',
              zh: '维度符合调用方数据表声明的有限向量。'
            },
            options: {
              en: 'Native operation settings for the selected COPY or replication request.',
              zh: '所选流式复制或逻辑复制请求的原生操作配置。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'Original SQL identifiers, finite scores and selected payload values.',
            zh: '返回原始查询标识、有限分数与所选载荷值。'
          }
        }
      }
    },
    IPgLogicalReplicationOptions: {
      summary: {
        en: 'Deployment-created persistent slot and publication covering all managed tables.',
        zh: '由部署方创建的持久复制槽，以及覆盖全部托管表的发布配置。'
      },
      members: {
        slot: {
          summary: {
            en: 'Persistent slot name created and assigned by deployment.',
            zh: '由部署方预建并指定的持久复制槽名称。'
          }
        },
        publication: {
          summary: {
            en: 'Deployment-created publication covering every managed table.',
            zh: '部署方预建并覆盖全部托管数据表的发布名称。'
          }
        }
      }
    },
    IPgLogicalReplicationRoute: {
      summary: t(
        'Read-only schema/prefix and optional immutable org route for the original native decoder.',
        '原生 decoder 的只读 schema/prefix 与可选固定 org 路由。'
      ),
      members: {
        schema: {
          summary: {
            en: 'Read-only configured schema containing the managed tables.',
            zh: '容纳托管数据表的只读已配置数据库模式。'
          }
        },
        prefix: {
          summary: {
            en: 'Read-only configured table prefix used by the native decoder.',
            zh: '原生解码器使用的只读已配置数据表前缀。'
          }
        },
        orgId: {
          summary: {
            en: 'Immutable organization identifier assigned by the original host view.',
            zh: '由原宿主视图指定的不可变组织标识符。'
          }
        }
      }
    },
    IPgLogicalReplicationPort: {
      summary: {
        en: 'Native pgoutput detection, bounded replay and owned replication resources for the pg adapter.',
        zh: '指定适配器的原生逻辑解码检测、有界重放与所属复制资源端口。'
      },
      members: {
        detect: {
          summary: {
            en: 'Check the original slot and publication prerequisites without creating them.',
            zh: '检查原复制槽与发布的前提，不自动创建部署对象。'
          },
          params: {
            options: {
              en: 'Native operation settings for the selected COPY or replication request.',
              zh: '所选流式复制或逻辑复制请求的原生操作配置。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'Observed native WAL retention facts.',
            zh: '返回观察到的原生日志保留事实。'
          }
        },
        read: {
          summary: {
            en: 'Read bounded changes from the original slot and native decoder.',
            zh: '从原复制槽与原生解码器读取有界变更。'
          },
          params: {
            options: {
              en: 'Native operation settings for the selected COPY or replication request.',
              zh: '所选流式复制或逻辑复制请求的原生操作配置。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'A change page and original resume cursor.',
            zh: '返回变更页与原恢复游标。'
          }
        },
        open: {
          summary: {
            en: 'Own one native replication session until its resource is disposed.',
            zh: '持有单个原生逻辑复制会话，直到所属资源被释放。'
          },
          params: {
            options: {
              en: 'Native operation settings for the selected COPY or replication request.',
              zh: '所选流式复制或逻辑复制请求的原生操作配置。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'A subscription resource with explicit acknowledgement.',
            zh: '返回具有显式确认能力的订阅资源。'
          }
        },
        dropSlot: {
          summary: {
            en: 'Explicitly remove a deployment-selected native slot.',
            zh: '显式移除部署方指定的原生复制槽。'
          },
          params: {
            slot: {
              en: 'Persistent slot name created and assigned by deployment.',
              zh: '由部署方创建并指定的持久复制槽名称。'
            },
            ctx: {
              en: 'Original optional operation signal and timeout budget, without an additional retry loop.',
              zh: '原可选操作信号与超时预算，不引入额外重试循环。'
            }
          },
          returns: {
            en: 'Resolves after native slot deletion; disposal alone never deletes it.',
            zh: '原生复制槽删除后完成，资源释放本身不会删除复制槽。'
          }
        }
      }
    },
    IPgCapabilityProbeHookPayload: {
      summary: t(
        'Read-only actual version/isolation/capability facts and optional max_slot_wal_keep_size.',
        '只读真实版本、隔离级别、能力事实及可选 max_slot_wal_keep_size。'
      ),
      members: {
        version: {
          summary: {
            en: 'Actual native server version observed by capability detection.',
            zh: '能力检测时观察到的真实原生服务端版本。'
          }
        },
        isolationLevel: {
          summary: {
            en: 'Actual native transaction isolation level observed by detection.',
            zh: '检测时观察到的真实原生事务隔离级别。'
          }
        },
        capabilities: {
          summary: {
            en: 'Detected supported capability facts without business values.',
            zh: '检测到的能力支持事实，不包含业务数据值。'
          }
        },
        maxSlotWalKeepSize: {
          summary: {
            en: 'Optional observed native WAL retention configuration for replication.',
            zh: '针对逻辑复制观察到的可选原生日志保留配置。'
          }
        }
      }
    },
    IPgNotifyHookPayload: {
      summary: t(
        'Native channel identity and original backend/org hook context, without payload values.',
        '原生频道身份与原后端/org hook 上下文，不包含载荷值。'
      ),
      members: {
        channel: {
          summary: {
            en: 'Original native notification channel, excluding message payload.',
            zh: '原始原生通知频道，不包含消息载荷。'
          }
        }
      }
    },
    ...storagePostgresQuantizedTypes
  },
  enums: {
    PostgresErrorCode: {
      summary: {
        en: 'Native database boundary failures retain original runtime types and reachable causes.',
        zh: '原生数据库边界故障保留原运行时类型与可追踪的错误原因。'
      },
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
