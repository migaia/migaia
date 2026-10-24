import type { ILibraryReference, IText } from './contract.js'
import { storagePluginSparqlCases } from './storage-plugin-sparql-cases.js'
/** One bilingual inventory describes the exact native RDF package boundary. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Native endpoint documentation keeps transaction, lifecycle and query owners distinct. */
export const storagePluginSparqlReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Install shared ground RDF and SPARQL capabilities with native optimistic conditional transactions.',
        zh: '安装共享的规范三元组与查询能力，并提供原生条件更新支撑的乐观事务。'
      }
    },
    http: {
      summary: {
        en: 'Create a caller-owned native SPARQL Protocol endpoint with explicit query, update and optional graph routes.',
        zh: '创建调用方拥有的原生查询协议端点，明确配置查询、更新及可选图操作地址。'
      }
    },
    oxigraph: {
      summary: {
        en: 'Borrow a real Oxigraph Store for native query, update and per-graph document operations without closing it.',
        zh: '借用真实图数据库对象执行原生查询、更新与单图文档操作，不接管关闭权。'
      }
    },
    'features/graph-store': {
      summary: {
        en: 'Select root-only native single-graph reads, replacement, merge, existence and deletion.',
        zh: '选择仅根存储提供的原生单图读取、替换、合并、存在判断与删除方法。'
      }
    },
    'features/ontology': {
      summary: {
        en: 'Select complete RDF document import and export using the original graph port and real N3 parser.',
        zh: '经原图端口与真实文档解析器选择完整图文档导入导出，每份文档独立分配空白身份。'
      }
    }
  },
  symbols: {
    sparqlBackendPlugin: {
      role: 'factory',
      purpose: {
        en: 'Capture the caller-owned endpoint and install native RDF through original host lifecycle, query and transaction owners.',
        zh: '捕获调用方拥有的原生端点，经原宿主生命周期、查询与事务拥有者安装三元组存储。'
      },
      params: {
        features: t(
          'Exact-kind root Features, optionally Graph Store and ontology.',
          '精确 kind 的根 Feature，可选 Graph Store 与 ontology。'
        )
      },
      optionDocs: {
        endpoint: {
          summary: t(
            'Caller-owned query/update endpoint with genuine optional graphStore/atomicUpdate ports.',
            '调用方拥有的 query/update endpoint，可具备真实 graphStore/atomicUpdate。'
          )
        },
        id: {
          summary: {
            en: 'Application-assigned backend identifier used by host.backend.',
            zh: '应用指定的后端标识，用于宿主选择对应存储实例。'
          },
          default: {
            en: 'sparql is the default backend identifier.',
            zh: '缺省使用后端标识 sparql。'
          }
        }
      },
      returns: t(
        'A lazy exact-id backend plugin; the factory performs no native I/O.',
        '惰性精确 id 后端插件，工厂不做原生 I/O。'
      ),
      cases: storagePluginSparqlCases.sparqlBackendPlugin,
      optionCases: [
        {
          covers: ['id', 'endpoint'],
          title: {
            en: 'Install one borrowed RDF engine',
            zh: '安装借用的图存储引擎'
          },
          problem: {
            en: 'An application needs its own native engine while the storage host controls only installed resource lifetimes.',
            zh: '应用需要使用自己的原生图引擎，而存储宿主只控制已安装资源的生命周期。'
          },
          example:
            "import { Store } from 'oxigraph'\nimport { createStorageHost } from '@migaia/storage-host'\nimport { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'\nimport { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'\nawait using host = await createStorageHost({ plugins: [sparqlBackendPlugin({\n  id: 'graphs', endpoint: oxigraphEndpoint(new Store())\n})] as const })\nawait host.detect()",
          result: {
            en: 'The graphs backend borrows the endpoint; only explicit host.detect probes native readiness.',
            zh: '指定后端借用原生端点，仅显式宿主检测才探测原生服务就绪状态。'
          }
        }
      ]
    },
    sparqlBackendKind: {
      role: 'constant',
      purpose: {
        en: 'Authenticate selected native RDF Features against the exact store and borrowed endpoint kind.',
        zh: '以精确存储与借用端点种类认证所选原生扩展，拒绝错误的挂载目标。'
      }
    },
    ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'Identify the registered storage.backend.sparql error domain while retaining native causes and runtime types.',
        zh: '标识已登记的原生图查询错误领域，同时保留原始原因与运行时错误类型。'
      }
    },
    SparqlErrorCode: {
      role: 'constant',
      purpose: t(
        'Classify native protocol failures and transaction business failures while retaining original causes.',
        '分类原生协议失败与事务业务失败，保留原始原因。'
      )
    },
    httpEndpoint: {
      role: 'factory',
      purpose: t(
        'Use native fetch, full status/body errors and one-send modifications without mutation redirects.',
        '使用原 fetch、完整 status/body 错误与一次发送写，不跟随修改重定向。'
      ),
      options: 'ISparqlHttpOptions',
      returns: t(
        'A native endpoint without raw atomicUpdate; host detection owns readiness.',
        '不含 raw atomicUpdate 的原生 endpoint，就绪归宿主检测。'
      ),
      cases: storagePluginSparqlCases.httpEndpoint,
      optionCases: [
        {
          covers: ['queryUrl', 'updateUrl', 'graphStoreUrl'],
          title: {
            en: 'Route one logical dataset',
            zh: '配置同一逻辑数据集路由'
          },
          problem: {
            en: 'Queries, updates and single-graph requests must target the same application dataset.',
            zh: '查询、更新与单图请求必须指向应用选择的同一逻辑数据集。'
          },
          example:
            "import { httpEndpoint } from '@migaia/storage-plugin-sparql/http'\nconst base = process.env.MIGAIA_SPARQL_QUERY_URL!.replace(/\\/query$/, '')\nexport const endpoint = httpEndpoint({\n  queryUrl: base + '/query', updateUrl: base + '/update', graphStoreUrl: base + '/data'\n})",
          result: {
            en: 'The endpoint advertises single-graph operations only when its native route is configured.',
            zh: '仅在配置原生图协议地址时，端点才声明单图操作能力。'
          }
        },
        {
          covers: ['auth', 'auth.basic', 'auth.basic.user', 'auth.basic.password'],
          title: {
            en: 'Use deployment-issued Basic credentials',
            zh: '使用部署方签发的基本认证凭据'
          },
          problem: {
            en: 'Credentials belong in authorization headers, without changing query grammar or diagnostic payloads.',
            zh: '认证凭据应进入请求头，不改变查询语法，也不进入诊断事件载荷。'
          },
          example:
            "import { httpEndpoint } from '@migaia/storage-plugin-sparql/http'\nexport const endpoint = httpEndpoint({\n  queryUrl: process.env.MIGAIA_SPARQL_QUERY_URL!,\n  updateUrl: process.env.MIGAIA_SPARQL_UPDATE_URL!,\n  auth: { basic: { user: process.env.SPARQL_USER!, password: process.env.SPARQL_PASSWORD! } }\n})",
          result: {
            en: 'The original fetch port sends one Basic header and never serializes credentials into hook events.',
            zh: '原网络端口发送单个基本认证请求头，不将凭据序列化到事件中。'
          }
        },
        {
          covers: ['auth.bearer'],
          title: {
            en: 'Use a deployment-issued Bearer token',
            zh: '使用部署方签发的身份令牌'
          },
          problem: {
            en: 'A token-protected endpoint needs one authentication scheme rather than two conflicting headers.',
            zh: '受令牌保护的端点需要单一认证方式，不能同时配置两种相互冲突的认证头。'
          },
          example:
            "import { httpEndpoint } from '@migaia/storage-plugin-sparql/http'\nexport const endpoint = httpEndpoint({\n  queryUrl: process.env.MIGAIA_SPARQL_QUERY_URL!,\n  updateUrl: process.env.MIGAIA_SPARQL_UPDATE_URL!,\n  auth: { bearer: process.env.SPARQL_BEARER_TOKEN! }\n})",
          result: {
            en: 'Only Bearer authentication is selected; Basic credentials are absent.',
            zh: '仅选择令牌身份认证，不同时配置基本身份认证凭据。'
          }
        }
      ]
    },
    oxigraphEndpoint: {
      role: 'factory',
      purpose: {
        en: 'Use the borrowed Store native query, update, load and dump operations while preserving caller ownership.',
        zh: '使用借用图数据库的原生查询、更新与文档操作，同时保留调用方的资源拥有权。'
      },
      params: {
        store: t(
          'Real Oxigraph Store from the supported peer.',
          '受支持真实 peer 的 Oxigraph Store。'
        )
      },
      returns: t(
        'One endpoint with genuine one-body atomicUpdate and per-graph operations.',
        '具备真实单 body atomicUpdate 与 per-graph 操作的 endpoint。'
      ),
      cases: storagePluginSparqlCases.oxigraphEndpoint
    },
    graphStoreFeature: {
      role: 'factory',
      purpose: {
        en: 'Expose root-only graph read, replacement, merge and deletion without a transaction projection or preparation phase.',
        zh: '仅在根存储提供图读取、替换、合并与删除，不增加事务投影或准备阶段。'
      },
      returns: t(
        'An exact-kind Feature; native port availability is checked by original detection.',
        '精确 kind 的 Feature，原生端口在原检测窗口检查。'
      ),
      cases: storagePluginSparqlCases.graphStoreFeature
    },
    ontologyFeature: {
      role: 'factory',
      purpose: {
        en: 'Expose complete RDF document import and export through the original graph port and genuine parser and writer.',
        zh: '经原生图端口与真实解析器、写入器提供完整图文档导入导出，不另建文档协议。'
      },
      returns: t(
        'A root-only Feature; import counts parsed quads including duplicates, not new rows.',
        '根 Feature，import 计解析条数（含重复），不冒充新增数。'
      ),
      cases: storagePluginSparqlCases.ontologyFeature
    }
  },
  types: {
    ISparqlOptions: {
      summary: t(
        'Installation captures one caller-owned native endpoint.',
        '安装捕获单个调用方拥有的原生 endpoint。'
      ),
      members: {
        endpoint: {
          summary: {
            en: 'Borrow the application-created native endpoint without close ownership or a replacement client.',
            zh: '借用应用创建的原生端点，不授予关闭拥有权或替代客户端。'
          }
        }
      }
    },
    ISparqlStore: {
      summary: t(
        'RDF/SPARQL store with genuine conditional native transactions, no KV or lock.',
        '具备真实条件原生事务的 RDF/SPARQL store，无 KV 或 lock。'
      ),
      members: {
        transaction: {
          summary: {
            en: 'Run one authentic native optimistic draft and confirm it with conditional Update plus marker.',
            zh: '运行真实原生乐观草稿，通过条件更新与提交标记确认。'
          },
          params: {
            run: {
              en: 'Application callback receiving the authentic optimistic native scope; failure prevents native commit.',
              zh: '接收真实乐观原生作用域的应用回调，失败时不进行原生提交。'
            },
            options: {
              en: 'Original optimistic transaction or document-import settings for this operation.',
              zh: '本次操作的原乐观事务配置或文档导入配置。'
            }
          },
          returns: {
            en: 'The callback result only after the original native commit confirmation.',
            zh: '仅在原生提交确认后返回回调结果。'
          }
        },
        tx: {
          summary: {
            en: 'Create the original optimistic fluent builder without KV locks.',
            zh: '创建原乐观链式事务构造器，不提供键值锁。'
          },
          params: {},
          returns: {
            en: 'A builder retaining the original native scope and operation budget.',
            zh: '返回保留原生作用域与操作预算的事务构造器。'
          }
        }
      }
    },
    ISparqlTransactionScope: {
      summary: {
        en: 'Original admitted scope with RDF draft preconditions and mutually exclusive raw update.',
        zh: '原准入作用域，提供三元组草稿前提与互斥的原生更新。'
      },
      members: {
        use: {
          summary: {
            en: 'Borrow the current scope RDF draft or update-only raw SPARQL API using its original token.',
            zh: '使用原令牌借用当前作用域三元组草稿或仅更新的原生查询接口。'
          },
          params: {
            capability: {
              en: 'Original rdf or sparql capability token exported by storage-contract.',
              zh: '由共享契约包导出的原始三元组或图查询能力令牌。'
            }
          },
          returns: {
            en: 'The exact current operation view; foreign or expired scopes are rejected before I/O.',
            zh: '返回精确当前操作视图，外来或过期作用域在访问前拒绝。'
          }
        }
      }
    },
    ISparqlTransactionOptions: {
      summary: t(
        'Original operation budget and optimistic concurrency, without key locks.',
        '原操作预算与乐观策略，无键锁。'
      ),
      members: {
        lock: {
          summary: {
            en: 'Never accepted: this backend exposes no key-lock domain.',
            zh: '始终不接受此字段，本后端不提供键锁领域。'
          }
        },
        concurrency: {
          summary: {
            en: 'Authentic optimistic policy; wait and fail locking modes are unsupported.',
            zh: '真实乐观策略，不支持等待或失败式键锁模式。'
          }
        },
        signal: {
          summary: {
            en: 'Original optional caller cancellation signal for the whole attempt.',
            zh: '覆盖完整尝试的原调用方可选取消信号。'
          }
        },
        timeoutMs: {
          summary: {
            en: 'Original optional absolute operation budget captured once.',
            zh: '捕获一次的原可选完整操作绝对超时预算。'
          }
        },
        pageSize: {
          summary: {
            en: 'Original shared positive page-size hint for query operations.',
            zh: '原共享查询操作使用的正整数分页大小提示。'
          }
        },
        orgId: {
          summary: {
            en: 'Original host-assigned organization context; does not grant foreign-org access.',
            zh: '原宿主指定的组织上下文，不授予其它组织访问权。'
          }
        }
      }
    },
    ISparqlTransactionBuilder: {
      summary: {
        en: 'Original optimistic fluent transaction builder retaining run, signal and timeout behavior.',
        zh: '原乐观链式事务构造器，保留执行、取消信号与超时行为。'
      },
      members: {}
    },
    ISparqlOptimisticPolicy: {
      summary: {
        en: 'Authentic original optimistic policy; no key-lock modes are added.',
        zh: '真实原乐观策略，不额外增加任何键锁并发模式。'
      },
      members: {
        locking: {
          summary: {
            en: 'Only the authentic optimistic locking discriminator is accepted.',
            zh: '仅接受真实乐观并发策略的锁定模式区分字段。'
          }
        }
      }
    },
    ISparqlTxRdf: {
      summary: t(
        'Ground draft reads/writes plus conjunctive present/independent absent conditions.',
        'Ground 草稿读写与合取 present、逐项 absent 条件。'
      ),
      members: {
        expect: {
          summary: {
            en: 'Require all selected ground quads to be present when the original native commit executes.',
            zh: '要求原生提交执行时，全部选定完整三元组同时存在。'
          },
          params: {
            quads: {
              en: 'Canonical ground quads used as native commit preconditions.',
              zh: '用作原生提交前提的规范完整三元组集合。'
            }
          },
          returns: {
            en: 'Registers conjunctive presence preconditions on the original draft.',
            zh: '在原草稿登记合取的存在性提交前提。'
          }
        },
        expectAbsent: {
          summary: {
            en: 'Require each selected ground quad to be absent at the native commit boundary.',
            zh: '要求原生提交边界上，每个选定完整三元组均不存在。'
          },
          params: {
            quads: {
              en: 'Canonical ground quads used as native commit preconditions.',
              zh: '用作原生提交前提的规范完整三元组集合。'
            }
          },
          returns: {
            en: 'Registers independent absence preconditions, without an external coordinator.',
            zh: '登记独立的不存在性前提，不增加外部协调器。'
          }
        }
      }
    },
    ISparqlTxUpdateApi: {
      summary: t(
        'Exactly one native raw update body, mutually exclusive with every RDF operation.',
        '单个原生 raw update body，与全部 RDF 操作互斥。'
      ),
      members: {}
    },
    ISparqlEndpoint: {
      summary: t(
        'Caller-owned complete query/update protocol; no interactive transaction client.',
        '调用方拥有的完整 query/update 协议，不提供交互事务 client。'
      ),
      members: {
        query: {
          summary: {
            en: 'Execute one native query and return its negotiated response text.',
            zh: '执行一次原生查询，返回所协商格式的响应文本。'
          },
          params: {
            text: {
              en: 'One complete native query or update body; application values must be bound by the shared tag.',
              zh: '单个完整原生查询或更新正文，应用值应由共享标签绑定。'
            },
            accept: {
              en: 'Requested native result media type: SPARQL JSON or N-Triples.',
              zh: '请求的原生结果媒体类型，为查询结果对象或三元组文档。'
            },
            signal: {
              en: 'Original optional cancellation signal; started synchronous native work still drains.',
              zh: '原可选取消信号，已开始的同步原生工作仍须排空。'
            }
          },
          returns: {
            en: 'Original native response text; protocol failures preserve the native cause.',
            zh: '返回原生响应文本，协议失败保留原生原因。'
          },
          example:
            "import { Store } from 'oxigraph'\nimport { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'\nconst endpoint = oxigraphEndpoint(new Store())\nawait endpoint.update('INSERT DATA { <urn:example:s> <urn:example:p> \"ready\" }')\nconsole.log(await endpoint.query('ASK { <urn:example:s> ?p ?o }', 'application/sparql-results+json'))\nawait endpoint.atomicUpdate!('DELETE DATA { <urn:example:s> <urn:example:p> \"ready\" }')"
        },
        update: {
          summary: {
            en: 'Send one native modification without automatic request replay.',
            zh: '发送单次原生修改请求，不自动重放修改正文。'
          },
          params: {
            text: {
              en: 'One complete native query or update body; application values must be bound by the shared tag.',
              zh: '单个完整原生查询或更新正文，应用值应由共享标签绑定。'
            },
            signal: {
              en: 'Original optional cancellation signal; started synchronous native work still drains.',
              zh: '原可选取消信号，已开始的同步原生工作仍须排空。'
            }
          },
          returns: {
            en: 'Resolves on confirmed native success; unknown modification results remain rejected.',
            zh: '原生成功确认后完成，结果未知的修改仍保持拒绝。'
          },
          example:
            "import { Store } from 'oxigraph'\nimport { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'\nconst endpoint = oxigraphEndpoint(new Store())\nawait endpoint.update('INSERT DATA { <urn:example:s> <urn:example:p> \"ready\" }')\nconsole.log(await endpoint.query('ASK { <urn:example:s> ?p ?o }', 'application/sparql-results+json'))\nawait endpoint.atomicUpdate!('DELETE DATA { <urn:example:s> <urn:example:p> \"ready\" }')"
        },
        atomicUpdate: {
          summary: {
            en: 'Execute one complete atomic native update body only when the real endpoint provides this port.',
            zh: '仅真实端点提供此能力时，执行单个完整原子更新正文。'
          },
          params: {
            text: {
              en: 'One complete native query or update body; application values must be bound by the shared tag.',
              zh: '单个完整原生查询或更新正文，应用值应由共享标签绑定。'
            },
            signal: {
              en: 'Original optional cancellation signal; started synchronous native work still drains.',
              zh: '原可选取消信号，已开始的同步原生工作仍须排空。'
            }
          },
          returns: {
            en: 'Confirms native atomic execution; generic HTTP does not fabricate this method.',
            zh: '确认原生原子执行，通用网络端点不虚构此方法。'
          },
          example:
            "import { Store } from 'oxigraph'\nimport { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'\nconst endpoint = oxigraphEndpoint(new Store())\nawait endpoint.update('INSERT DATA { <urn:example:s> <urn:example:p> \"ready\" }')\nconsole.log(await endpoint.query('ASK { <urn:example:s> ?p ?o }', 'application/sparql-results+json'))\nawait endpoint.atomicUpdate!('DELETE DATA { <urn:example:s> <urn:example:p> \"ready\" }')"
        },
        graphStore: {
          summary: t(
            'Optional native per-graph protocol; detected when a Feature needs it.',
            '可选原生 per-graph 协议，Feature 需要时在检测窗口校验。'
          )
        }
      },
      scenarios: [
        {
          en: 'Borrow one actual engine without transferring close ownership to the storage host.',
          zh: '借用同一真实引擎，不将关闭拥有权转交给存储宿主。'
        }
      ],
      example:
        "import { Store } from 'oxigraph'\nimport { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'\nconst endpoint = oxigraphEndpoint(new Store())\nawait endpoint.update('INSERT DATA { <urn:example:s> <urn:example:p> \"ready\" }')\nconsole.log(await endpoint.query('ASK { <urn:example:s> ?p ?o }', 'application/sparql-results+json'))\nawait endpoint.atomicUpdate!('DELETE DATA { <urn:example:s> <urn:example:p> \"ready\" }')"
    },
    ISparqlGraphStorePort: {
      summary: {
        en: 'Borrowed complete single-graph protocol preserving the original cancellation and endpoint ownership.',
        zh: '借用的完整单图协议，保留原取消信号与端点拥有权。'
      },
      members: {
        get: {
          summary: {
            en: 'Read one native graph document in the requested explicit format.',
            zh: '以请求的显式格式读取单个原生图文档。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            format: {
              en: 'Explicit Turtle or N-Triples format, without dataset or RDF-star extensions.',
              zh: '显式选择图文档格式，不包含数据集或扩展三元组语法。'
            },
            signal: {
              en: 'Original optional cancellation signal; started synchronous native work still drains.',
              zh: '原可选取消信号，已开始的同步原生工作仍须排空。'
            }
          },
          returns: {
            en: 'Complete original graph document text.',
            zh: '返回完整原生图文档文本。'
          }
        },
        put: {
          summary: {
            en: 'Replace one native graph with the complete supplied document.',
            zh: '使用给出的完整文档替换单个原生图内容。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            document: {
              en: 'Complete explicit-format RDF document; parsing gives fresh blank identity per document.',
              zh: '带显式格式的完整图文档，每份文档解析时分配新的空白身份。'
            },
            signal: {
              en: 'Original optional cancellation signal; started synchronous native work still drains.',
              zh: '原可选取消信号，已开始的同步原生工作仍须排空。'
            }
          },
          returns: {
            en: 'Resolves after native graph replacement is confirmed.',
            zh: '原生图替换确认后完成。'
          }
        },
        post: {
          summary: {
            en: 'Merge the complete supplied document into one native graph.',
            zh: '将给出的完整文档合并到单个原生图中。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            document: {
              en: 'Complete explicit-format RDF document; parsing gives fresh blank identity per document.',
              zh: '带显式格式的完整图文档，每份文档解析时分配新的空白身份。'
            },
            signal: {
              en: 'Original optional cancellation signal; started synchronous native work still drains.',
              zh: '原可选取消信号，已开始的同步原生工作仍须排空。'
            }
          },
          returns: {
            en: 'Resolves after native merge, preserving pre-existing graph members.',
            zh: '原生合并后完成，并保留已有图成员。'
          }
        },
        remove: {
          summary: {
            en: 'Delete one selected native graph through the original graph protocol.',
            zh: '通过原图协议删除所选单个原生图。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            signal: {
              en: 'Original optional cancellation signal; started synchronous native work still drains.',
              zh: '原可选取消信号，已开始的同步原生工作仍须排空。'
            }
          },
          returns: {
            en: 'Resolves after native graph deletion is confirmed.',
            zh: '原生图删除确认后完成。'
          }
        },
        has: {
          summary: {
            en: 'Inspect whether the selected native graph exists.',
            zh: '检查所选原生图在当前端点中是否存在。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            signal: {
              en: 'Original optional cancellation signal; started synchronous native work still drains.',
              zh: '原可选取消信号，已开始的同步原生工作仍须排空。'
            }
          },
          returns: {
            en: 'True when the native graph protocol reports existence.',
            zh: '原生图协议报告存在时返回真值。'
          }
        }
      }
    },
    ISparqlAbortSignal: {
      summary: t(
        'Original operation cancellation signal; synchronous native work drains after starting.',
        '原操作取消信号，同步原生工作开始后排空。'
      ),
      members: {}
    },
    ISparqlHttpOptions: {
      summary: t(
        'Native HTTP routes and exactly one optional auth scheme.',
        '原生 HTTP 路由及可选单一认证方式。'
      ),
      members: {
        queryUrl: {
          summary: {
            en: 'Absolute native query URL supplied by application deployment, without embedded credentials.',
            zh: '应用部署提供的绝对原生查询地址，不允许内嵌认证凭据。'
          }
        },
        updateUrl: {
          summary: {
            en: 'Absolute native update URL pointing at the same application-selected logical dataset.',
            zh: '指向应用所选同一逻辑数据集的绝对原生更新地址。'
          }
        },
        graphStoreUrl: {
          summary: {
            en: 'Optional native single-graph route required by graph and ontology Features.',
            zh: '图操作与文档扩展所需的可选原生单图协议地址。'
          },
          default: {
            en: 'Omitted: no graph protocol is advertised.',
            zh: '省略时不声明原生图协议端口。'
          }
        },
        auth: {
          summary: {
            en: 'One deployment-issued Basic or Bearer authentication scheme, never included in diagnostic payloads.',
            zh: '部署方签发的单一基本或令牌认证方式，不写入诊断事件载荷。'
          },
          default: {
            en: 'No authorization header is sent.',
            zh: '省略时不发送身份认证请求头。'
          }
        },
        'auth.basic': {
          summary: {
            en: 'Deployment-issued user and password for the Basic authorization header.',
            zh: '部署方签发的用户名与口令，用于基本身份认证请求头。'
          },
          default: {
            en: 'Omitted when no Basic credentials are supplied.',
            zh: '省略时不提供基本身份认证凭据。'
          }
        },
        'auth.basic.user': {
          summary: {
            en: 'User name issued by the endpoint deployment, not an application storage key.',
            zh: '由端点部署方签发的用户名，不是应用存储键。'
          },
          default: {
            en: 'No Basic scheme unless the complete credentials are selected.',
            zh: '未选择完整凭据时不使用基本身份认证。'
          }
        },
        'auth.basic.password': {
          summary: {
            en: 'Password issued by the endpoint deployment; never logged or placed in URLs.',
            zh: '端点部署方签发的口令，绝不记录到日志或地址中。'
          },
          default: {
            en: 'No Basic scheme unless the complete credentials are selected.',
            zh: '未选择完整凭据时不使用基本身份认证。'
          }
        },
        'auth.bearer': {
          summary: {
            en: 'Bearer token issued by deployment; mutually exclusive with Basic credentials.',
            zh: '部署方签发的身份令牌，与基本身份认证凭据互斥。'
          },
          default: {
            en: 'No Bearer scheme when omitted.',
            zh: '省略时不使用令牌身份认证。'
          }
        }
      }
    },
    IRdfGraphTarget: {
      summary: t(
        'Exactly logical default:true or graph:NamedNode; organization mapping remains backend-owned.',
        '精确选择逻辑 default:true 或 graph:NamedNode，组织映射归后端。'
      ),
      members: {
        default: {
          summary: {
            en: 'Select the logical default graph; mutually exclusive with a named graph.',
            zh: '选择逻辑缺省图，与具名图选择互斥。'
          }
        },
        graph: {
          summary: {
            en: 'Application-assigned named IRI graph; blank graphs are not standard ground identities.',
            zh: '应用指定的具名资源图，空白图不是标准完整身份。'
          }
        }
      }
    },
    IRdfGraphFormat: {
      summary: {
        en: 'Turtle or N-Triples media type; dataset and RDF-star syntax are outside this graph port.',
        zh: '图文档媒体类型，数据集与扩展三元组语法不属于此图端口。'
      },
      members: {}
    },
    IRdfGraphDocument: {
      summary: t('One complete explicit-format native document.', '带显式格式的单份完整原生文档。'),
      members: {
        format: {
          summary: {
            en: 'Explicit Turtle or N-Triples document format; no dataset syntax is accepted.',
            zh: '显式选择图文档格式，不接受包含多图的数据集语法。'
          }
        },
        text: {
          summary: t(
            'Complete document parsed by N3 with fresh blank identity per parse.',
            '由 N3 解析的完整文档，每次解析使用新 blank 身份。'
          )
        }
      }
    },
    IGraphStoreApi: {
      summary: {
        en: 'Root-only native single-graph methods using the original operation context and lifecycle.',
        zh: '仅根存储提供的原生单图方法，使用原操作上下文与生命周期。'
      },
      members: {
        getGraph: {
          summary: {
            en: 'Read one native graph document in the requested explicit format.',
            zh: '以请求的显式格式读取单个原生图文档。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            format: {
              en: 'Explicit Turtle or N-Triples format, without dataset or RDF-star extensions.',
              zh: '显式选择图文档格式，不包含数据集或扩展三元组语法。'
            },
            ctx: {
              en: 'Original operation context carrying cancellation and the one timeout budget.',
              zh: '承载原取消信号与唯一超时预算的操作上下文。'
            }
          },
          returns: {
            en: 'Complete original graph document text.',
            zh: '返回完整原生图文档文本。'
          }
        },
        putGraph: {
          summary: {
            en: 'Replace one native graph with the complete supplied document.',
            zh: '使用给出的完整文档替换单个原生图内容。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            document: {
              en: 'Complete explicit-format RDF document; parsing gives fresh blank identity per document.',
              zh: '带显式格式的完整图文档，每份文档解析时分配新的空白身份。'
            },
            ctx: {
              en: 'Original operation context carrying cancellation and the one timeout budget.',
              zh: '承载原取消信号与唯一超时预算的操作上下文。'
            }
          },
          returns: {
            en: 'Resolves after native graph replacement is confirmed.',
            zh: '原生图替换确认后完成。'
          }
        },
        mergeGraph: {
          summary: {
            en: 'Merge the complete supplied document into one native graph.',
            zh: '将给出的完整文档合并到单个原生图中。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            document: {
              en: 'Complete explicit-format RDF document; parsing gives fresh blank identity per document.',
              zh: '带显式格式的完整图文档，每份文档解析时分配新的空白身份。'
            },
            ctx: {
              en: 'Original operation context carrying cancellation and the one timeout budget.',
              zh: '承载原取消信号与唯一超时预算的操作上下文。'
            }
          },
          returns: {
            en: 'Resolves after native merge, preserving pre-existing graph members.',
            zh: '原生合并后完成，并保留已有图成员。'
          }
        },
        removeGraph: {
          summary: {
            en: 'Delete one selected native graph through the original graph protocol.',
            zh: '通过原图协议删除所选单个原生图。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            ctx: {
              en: 'Original operation context carrying cancellation and the one timeout budget.',
              zh: '承载原取消信号与唯一超时预算的操作上下文。'
            }
          },
          returns: {
            en: 'Resolves after native graph deletion is confirmed.',
            zh: '原生图删除确认后完成。'
          }
        },
        hasGraph: {
          summary: {
            en: 'Inspect whether the selected native graph exists.',
            zh: '检查所选原生图在当前端点中是否存在。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            ctx: {
              en: 'Original operation context carrying cancellation and the one timeout budget.',
              zh: '承载原取消信号与唯一超时预算的操作上下文。'
            }
          },
          returns: {
            en: 'True when the native graph protocol reports existence.',
            zh: '原生图协议报告存在时返回真值。'
          }
        }
      }
    },
    IGraphStoreOutput: {
      summary: {
        en: 'Feature output exposes root graph operations while leaving transaction additions empty.',
        zh: '扩展输出公开根图操作方法，并保持事务附加项为空。'
      },
      members: {}
    },
    IOntologyApi: {
      summary: t(
        'Root importOntology/exportOntology, complete document cost and native inference ownership.',
        '根 importOntology/exportOntology，按完整文档成本执行，推理归原生数据库。'
      ),
      members: {
        importOntology: {
          summary: {
            en: 'Parse a complete RDF document and merge or replace its selected native graph.',
            zh: '解析完整图文档，并合并或替换所选原生图。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            document: {
              en: 'Complete explicit-format RDF document; parsing gives fresh blank identity per document.',
              zh: '带显式格式的完整图文档，每份文档解析时分配新的空白身份。'
            },
            options: {
              en: 'Original optimistic transaction or document-import settings for this operation.',
              zh: '本次操作的原乐观事务配置或文档导入配置。'
            },
            ctx: {
              en: 'Original operation context carrying cancellation and the one timeout budget.',
              zh: '承载原取消信号与唯一超时预算的操作上下文。'
            }
          },
          returns: {
            en: 'Number of parsed quads including duplicates, never a count of newly inserted rows.',
            zh: '返回含重复项的解析条数，不冒充实际新增数据行数。'
          }
        },
        exportOntology: {
          summary: {
            en: 'Export the complete selected native graph using the requested explicit format.',
            zh: '使用请求的显式格式导出所选原生图的完整文档。'
          },
          params: {
            target: {
              en: 'Exactly the logical default graph or an application-assigned named IRI graph.',
              zh: '精确选择逻辑缺省图或应用指定的具名资源图。'
            },
            format: {
              en: 'Explicit Turtle or N-Triples format, without dataset or RDF-star extensions.',
              zh: '显式选择图文档格式，不包含数据集或扩展三元组语法。'
            },
            ctx: {
              en: 'Original operation context carrying cancellation and the one timeout budget.',
              zh: '承载原取消信号与唯一超时预算的操作上下文。'
            }
          },
          returns: {
            en: 'Complete native document text; no local inference engine is introduced.',
            zh: '返回完整原生文档文本，不增加本地推理引擎。'
          }
        }
      }
    },
    IOntologyOutput: {
      summary: {
        en: 'Feature output exposes complete root document import and export with no transaction projection.',
        zh: '扩展输出公开根完整文档导入导出，不提供事务内投影。'
      },
      members: {}
    },
    IOntologyImportOptions: {
      summary: {
        en: 'Native per-graph merge or replacement of one complete RDF document.',
        zh: '单份完整图文档的原生单图合并或替换配置。'
      },
      members: {
        mode: {
          summary: t(
            'merge retains existing triples; replace is one native graph replacement.',
            'merge 保留已有 triple，replace 沿单次原生图替换。'
          ),
          default: t('merge.', 'merge。'),
          values: {
            merge: {
              en: 'Keep existing graph members and add the parsed document.',
              zh: '保留已有图成员，并加入文档解析结果。'
            },
            replace: {
              en: 'Replace the selected graph through one native graph operation.',
              zh: '经单次原生图操作替换所选图的内容。'
            }
          }
        }
      }
    },
    ISparqlUpdateHookPayload: {
      summary: t(
        'Observation-only backend/org identity and operation/precondition counts, without update text.',
        '只观察后端/组织身份与操作/前提数量，无更新正文。'
      ),
      members: {
        operationCount: {
          summary: {
            en: 'Observed logical native update operation count without update text.',
            zh: '观察到的逻辑原生更新操作数量，不包含更新正文。'
          }
        },
        preconditionCount: {
          summary: {
            en: 'Observed present and absent precondition count for the original attempt.',
            zh: '观察到的原尝试存在与不存在前提总数量。'
          }
        }
      }
    },
    ISparqlPreconditionHookPayload: {
      summary: t(
        'Observation-only failed precondition count and original identity.',
        '只观察失败前提数量与原身份。'
      ),
      members: {
        preconditionCount: {
          summary: {
            en: 'Original failed conditional attempt precondition count without business values.',
            zh: '原条件尝试失败时的前提数量，不包含业务数据值。'
          }
        }
      }
    },
    ISparqlErrorCode: {
      summary: t(
        'Value union from the single registered native domain code table.',
        '来自单一登记原生领域码表的值联合。'
      ),
      members: {}
    }
  },
  enums: {
    SparqlErrorCode: {
      summary: t(
        'SPARQL boundary errors preserve causes and native runtime types.',
        'SPARQL 边界错误保留 cause 与原生类型。'
      ),
      values: {
        transactionFailed: t(
          'A callback, draft or finalizer business task failed; the original failure stays primary, without claiming a network failure.',
          'Callback、draft 或 finalizer 业务任务失败，原失败保持 primary，不声称网络失败。'
        ),
        unavailable: {
          en: 'Native read transport or server-side 5xx failed; business callback errors use a different code.',
          zh: '原生读取传输或服务端故障，业务回调失败使用独立错误码。'
        },
        responseInvalid: {
          en: 'Required native query results or graph documents cannot be decoded.',
          zh: '必要的原生查询结果或图文档无法正确解码。'
        },
        requestFailed: t(
          'Native request was explicitly refused; inspect status/body.',
          '原生请求明确拒绝，检查 status/body。'
        ),
        commitUnknown: t(
          'Sent modification has no confirmed result; do not replay and inspect native data.',
          '已发送修改未确认，不重放，应核实原生数据。'
        )
      }
    }
  },
  enhancers: {}
}
