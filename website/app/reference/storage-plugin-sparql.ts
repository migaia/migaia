import type { ILibraryReference, IText } from './contract.js'
import { storagePluginSparqlCases } from './storage-plugin-sparql-cases.js'
/** One bilingual inventory describes the exact native RDF package boundary. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Native endpoint documentation keeps transaction, lifecycle and query owners distinct. */
export const storagePluginSparqlReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Install the shared RDF/SPARQL capabilities and native optimistic transactions.',
        '安装共享 RDF/SPARQL 与原生乐观事务。'
      )
    },
    http: {
      summary: t(
        'Create a caller-owned native SPARQL Protocol endpoint.',
        '创建调用方拥有的原生 SPARQL Protocol 端点。'
      )
    },
    oxigraph: {
      summary: t('Borrow one real Oxigraph 0.4.11 Store.', '借用真实 Oxigraph 0.4.11 Store。')
    },
    'features/graph-store': {
      summary: t(
        'Install five root-only per-graph document methods.',
        '安装五个根 per-graph 文档方法。'
      )
    },
    'features/ontology': {
      summary: t(
        'Import/export RDF1.1 documents with fresh per-document blank identity.',
        '导入/导出 RDF1.1 文档，每份文档使用新 blank 身份。'
      )
    }
  },
  symbols: {
    sparqlBackendPlugin: {
      role: 'factory',
      purpose: t(
        'Capture a native endpoint and install it through the original host lifecycle, pipeline and transaction owners.',
        '捕获原生 endpoint，经原宿主生命周期、pipeline 与事务 owner 安装。'
      ),
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
          summary: t('Exact backend id used by host.backend.', 'host.backend 使用的精确 id。'),
          default: t('sparql.', 'sparql。')
        }
      },
      returns: t(
        'A lazy exact-id backend plugin; the factory performs no native I/O.',
        '惰性精确 id 后端插件，工厂不做原生 I/O。'
      ),
      cases: storagePluginSparqlCases.sparqlBackendPlugin
    },
    sparqlBackendKind: {
      role: 'constant',
      purpose: t(
        'Authenticate Features against the exact native RDF store/client boundary.',
        '校验 Feature 对应精确 native RDF store/client 边界。'
      )
    },
    ERROR_SOURCE: {
      role: 'constant',
      purpose: t('Registered domain storage.backend.sparql.', '登记错误域 storage.backend.sparql。')
    },
    SparqlErrorCode: {
      role: 'constant',
      purpose: t(
        'Classify native refusal, read availability, invalid response and uncertain commits with original causes.',
        '分类原生拒绝、读取不可用、响应非法与提交未知，保留原始原因。'
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
      cases: storagePluginSparqlCases.httpEndpoint
    },
    oxigraphEndpoint: {
      role: 'factory',
      purpose: t(
        'Use actual query/update/load/dump on the borrowed Store; do not close it.',
        '使用借用 Store 的真实 query/update/load/dump，不关闭它。'
      ),
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
      purpose: t(
        'Add root api.graphStore get/put/merge/remove/has, with no transaction projection or prepare phase.',
        '增加根 api.graphStore 的 get/put/merge/remove/has，无事务投影或 prepare。'
      ),
      returns: t(
        'An exact-kind Feature; native port availability is checked by original detection.',
        '精确 kind 的 Feature，原生端口在原检测窗口检查。'
      ),
      cases: storagePluginSparqlCases.graphStoreFeature
    },
    ontologyFeature: {
      role: 'factory',
      purpose: t(
        'Add root import/export through the same native graph port and genuine N3 parser/writer.',
        '经同一原生图端口与真实 N3 parser/writer 增加根 import/export。'
      ),
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
          summary: t(
            'No close ownership or replacement client is granted.',
            '不授予关闭权或替代 client。'
          )
        }
      }
    },
    ISparqlStore: {
      summary: t(
        'RDF/SPARQL store with genuine conditional native transactions, no KV or lock.',
        '具备真实条件原生事务的 RDF/SPARQL store，无 KV 或 lock。'
      ),
      members: {}
    },
    ISparqlTransactionScope: {
      summary: t(
        'Original owner identity with RDF draft/expect/expectAbsent and update-only raw tag.',
        '原 owner 身份，具备 RDF 草稿/expect/expectAbsent 与 update-only raw tag。'
      ),
      members: {}
    },
    ISparqlTransactionOptions: {
      summary: t(
        'Original operation budget and optimistic concurrency, without key locks.',
        '原操作预算与乐观策略，无键锁。'
      ),
      members: {}
    },
    ISparqlTransactionBuilder: {
      summary: t(
        'Original shared optimistic fluent builder with run, signal and timeout.',
        '原共享乐观 builder，具备 run、signal、timeout。'
      ),
      members: {}
    },
    ISparqlOptimisticPolicy: {
      summary: t(
        'Authentic original policy restricted to optimistic locking.',
        '真实原策略，仅允许 optimistic。'
      ),
      members: {}
    },
    ISparqlTxRdf: {
      summary: t(
        'Ground draft reads/writes plus conjunctive present/independent absent conditions.',
        'Ground 草稿读写与合取 present、逐项 absent 条件。'
      ),
      members: {}
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
          summary: t(
            'Native SELECT/ASK JSON or CONSTRUCT N-Triples response text.',
            '原生 SELECT/ASK JSON 或 CONSTRUCT N-Triples 响应文本。'
          )
        },
        update: {
          summary: t('One native SPARQL Update request.', '单次原生 SPARQL Update 请求。')
        },
        atomicUpdate: {
          summary: t(
            'Optional genuine atomic complete body; generic HTTP omits it.',
            '可选真实原子完整 body，通用 HTTP 不提供。'
          )
        },
        graphStore: {
          summary: t(
            'Optional native per-graph protocol; detected when a Feature needs it.',
            '可选原生 per-graph 协议，Feature 需要时在检测窗口校验。'
          )
        }
      }
    },
    ISparqlGraphStorePort: {
      summary: t(
        'Borrowed get/put/post/remove/has graph protocol with original cancellation.',
        '借用 get/put/post/remove/has 图协议与原取消。'
      ),
      members: {}
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
          summary: t(
            'Absolute query URL without embedded credentials.',
            '无内嵌凭据的绝对查询 URL。'
          )
        },
        updateUrl: {
          summary: t(
            'Absolute update URL on the same logical dataset.',
            '同一逻辑 dataset 的绝对更新 URL。'
          )
        },
        graphStoreUrl: {
          summary: t('Optional native per-graph route.', '可选原生 per-graph 路由。'),
          default: t('Absent means no graph protocol.', '省略表示无 graph 协议。')
        },
        auth: {
          summary: t(
            'Basic {user,password} or Bearer token; never copied into diagnostics.',
            'Basic user/password 或 Bearer token，不复制到诊断。'
          ),
          default: t('No authorization header.', '不加认证头。')
        }
      }
    },
    IRdfGraphTarget: {
      summary: t(
        'Exactly logical default:true or graph:NamedNode; organization mapping remains backend-owned.',
        '精确选择逻辑 default:true 或 graph:NamedNode，组织映射归后端。'
      ),
      members: {}
    },
    IRdfGraphFormat: {
      summary: t(
        'text/turtle or application/n-triples, excluding datasets and RDF-star.',
        'text/turtle 或 application/n-triples，不含 dataset 或 RDF-star。'
      ),
      members: {}
    },
    IRdfGraphDocument: {
      summary: t('One complete explicit-format native document.', '带显式格式的单份完整原生文档。'),
      members: {
        format: { summary: t('Turtle or N-Triples.', 'Turtle 或 N-Triples。') },
        text: {
          summary: t(
            'Complete document parsed by N3 with fresh blank identity per parse.',
            '由 N3 解析的完整文档，每次解析使用新 blank 身份。'
          )
        }
      }
    },
    IGraphStoreApi: {
      summary: t(
        'Root-only getGraph/putGraph/mergeGraph/removeGraph/hasGraph; last argument is original ctx.',
        '根 getGraph/putGraph/mergeGraph/removeGraph/hasGraph，末参原 ctx。'
      ),
      members: {}
    },
    IGraphStoreOutput: {
      summary: t(
        'Empty capabilities/chain/transaction groups with the selected root graph API.',
        '空 capabilities/chain/transaction 与选定根 graph API。'
      ),
      members: {}
    },
    IOntologyApi: {
      summary: t(
        'Root importOntology/exportOntology, complete document cost and native inference ownership.',
        '根 importOntology/exportOntology，按完整文档成本执行，推理归原生数据库。'
      ),
      members: {}
    },
    IOntologyOutput: {
      summary: t(
        'Root-only ontology API with empty transaction projection.',
        '根 ontology API，事务投影为空。'
      ),
      members: {}
    },
    IOntologyImportOptions: {
      summary: t('Per-graph native merge or replace.', 'Per-graph 原生 merge 或 replace。'),
      members: {
        mode: {
          summary: t(
            'merge retains existing triples; replace is one native graph replacement.',
            'merge 保留已有 triple，replace 沿单次原生图替换。'
          ),
          default: t('merge.', 'merge。')
        }
      }
    },
    ISparqlUpdateHookPayload: {
      summary: t(
        'Observation-only backend/org identity and operation/precondition counts, without update text.',
        '只观察后端/组织身份与操作/前提数量，无更新正文。'
      ),
      members: {}
    },
    ISparqlPreconditionHookPayload: {
      summary: t(
        'Observation-only failed precondition count and original identity.',
        '只观察失败前提数量与原身份。'
      ),
      members: {}
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
        'Native SPARQL error categories preserve cause and native runtime types.',
        '原生 SPARQL 错误族保留 cause 与原生类型。'
      ),
      values: {
        unavailable: t('Read transport/5xx failed.', '读取 transport/5xx 失败。'),
        responseInvalid: t('Native results or documents are invalid.', '原生结果或文档非法。'),
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
