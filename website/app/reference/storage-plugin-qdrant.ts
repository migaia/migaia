import type { ILibraryReference, IText } from './contract.js'
import { storagePluginQdrantCases } from './storage-plugin-qdrant-cases.js'
/** Bilingual reference follows the actual finite package entries and shared storage contracts. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Native vector semantics remain separate from standard chain and resource ownership. */
export const storagePluginQdrantReference: ILibraryReference = {
  modules: {
    index: {
      summary: t('Install native vector storage and vector TTL.', '安装原生向量存储与vector TTL。')
    },
    http: { summary: t('Runtime-fetch finite protocol port.', '运行时fetch有限协议端口。') },
    client: { summary: t('Borrow a real SDK 1.11+ client.', '借用真实SDK1.11+客户端。') },
    'features/hybrid': {
      summary: t(
        'Two native dense/sparse RRF branches and sparse updates.',
        '两个原生dense/sparse RRF分支与sparse更新。'
      )
    },
    'features/recommend': {
      summary: t('Native recommendation strategy and lookup.', '原生推荐策略与lookup。')
    },
    'features/group-by': {
      summary: t(
        'Native multivalue groups without with_lookup.',
        '原生多值分组，不提供with_lookup。'
      )
    },
    'features/management': {
      summary: t(
        'Collections, snapshots and organization-scoped physical deletion.',
        '集合、快照及组织内物理删除。'
      )
    }
  },
  symbols: {
    qdrantBackendPlugin: {
      role: 'factory',
      purpose: t(
        'Capture connection data and install native vector/TTL through the original host owners.',
        '捕获连接数据，经原host owner安装原生vector/TTL。'
      ),
      params: {
        features: t(
          'Selected exact-kind native Features; no transaction projection.',
          '所选精确kind原生Feature，无transaction投影。'
        )
      },
      optionDocs: {
        url: { summary: t('Native HTTP(S) server URL.', '原生HTTP(S)服务URL。') },
        apiKey: {
          summary: t(
            'Request authentication header, never hook payload.',
            '请求认证头，不进入hook载荷。'
          )
        },
        collectionPrefix: {
          summary: t(
            'Managed collection namespace; organizations share its physical collections.',
            '托管collection命名空间，各组织共享其物理集合。'
          ),
          default: t('migaia_.', 'migaia_。')
        },
        http: {
          summary: t(
            'Borrow a genuine finite protocol object; disposal does not close it.',
            '借用真实有限协议对象，释放不关闭它。'
          )
        },
        id: {
          summary: t('Exact backend id used by host.backend.', 'host.backend使用的精确id。'),
          default: t('qdrant.', 'qdrant。')
        }
      },
      returns: t(
        'A pure plugin descriptor; detection belongs to host creation or explicit host.detect.',
        '纯插件描述；检测归host创建或显式host.detect。'
      ),
      cases: storagePluginQdrantCases.qdrantBackendPlugin
    },
    qdrantBackendKind: {
      role: 'constant',
      purpose: t(
        'Authenticate native store/client Feature identity.',
        '认证原生store/client Feature身份。'
      )
    },
    ERROR_SOURCE: {
      role: 'constant',
      purpose: t('Registered domain storage.backend.qdrant.', '登记错误域storage.backend.qdrant。')
    },
    QdrantErrorCode: {
      role: 'constant',
      purpose: t(
        'Classify unavailable, rejected and invalid native responses while retaining original causes.',
        '分类不可用、拒绝及无效原生响应，保留原cause。'
      )
    },
    fetchHttp: {
      role: 'factory',
      purpose: t(
        'Use native fetch with one-send writes and complete evidence available at the adapter.',
        '使用原生fetch，一次发送写并保留适配端可取得的完整证据。'
      ),
      cases: storagePluginQdrantCases.fetchHttp
    },
    qdrantClientHttp: {
      role: 'factory',
      purpose: t(
        'Keep the real borrowed SDK configuration and actual request lifetime.',
        '保留真实借用SDK配置与实际请求生命周期。'
      ),
      cases: storagePluginQdrantCases.qdrantClientHttp
    },
    qdrantHybridFeature: {
      role: 'factory',
      purpose: t(
        'Native RRF and sparse-only vector updates; no client scoring.',
        '原生RRF及仅sparse向量更新，不在客户端评分。'
      ),
      cases: storagePluginQdrantCases.qdrantHybridFeature
    },
    qdrantRecommendFeature: {
      role: 'factory',
      purpose: t(
        'Native best_score and lookup retain their distinct engine semantics.',
        '原生best_score与lookup保留不同引擎语义。'
      ),
      cases: storagePluginQdrantCases.qdrantRecommendFeature
    },
    qdrantGroupByFeature: {
      role: 'factory',
      purpose: t(
        'Native groups retain multivalue membership and omit unforwarded lookup.',
        '原生分组保留多值成员语义，移除未转发的lookup。'
      ),
      cases: storagePluginQdrantCases.qdrantGroupByFeature
    },
    qdrantManagementFeature: {
      role: 'factory',
      purpose: t(
        'Only management filter deletion/purge return native operation records; standard deleteWhere remains numeric.',
        '仅管理filter删除/purge返回原生操作记录，标准deleteWhere保持数字。'
      ),
      cases: storagePluginQdrantCases.qdrantManagementFeature
    }
  },
  types: {
    IQdrantOptions: {
      members: {},
      summary: t(
        'Connection options and an optional borrowed finite native port.',
        '连接配置与可选借用有限原生端口。'
      )
    },
    IQdrantHttp: {
      members: {},
      summary: t(
        'Actual SDK method shapes plus operation context, without an arbitrary request method.',
        '真实SDK方法形状加操作上下文，不提供任意request方法。'
      )
    },
    IQdrantStore: {
      members: {},
      summary: t(
        'Exact vector and vector-target TTL store; every base boolean capability is false.',
        '精确vector及vector目标TTL store；base布尔能力全部false。'
      )
    },
    IQdrantUpdateResult: {
      members: {},
      summary: t(
        'Native operationId and acknowledged/completed status, never a deletion count.',
        '原生operationId及acknowledged/completed状态，不是删除计数。'
      )
    },
    IQdrantHybridRequest: {
      members: {},
      summary: t(
        'Exactly two named branches and native RRF fusion.',
        '恰两个named分支与原生RRF fusion。'
      )
    },
    IQdrantSparseVectorsRequest: {
      members: {},
      summary: t(
        'Configured sparse names with unique nonnegative indices and finite values.',
        '已配置sparse名，唯一非负indices及有限values。'
      )
    },
    IQdrantGroupByRequest: {
      members: {},
      summary: t(
        'Actual native grouping parameters with with_lookup omitted.',
        '真实原生分组参数，移除with_lookup。'
      )
    },
    IQdrantManagementApi: {
      members: {},
      summary: t(
        'Native results plus organization-constrained logical filter deletion and expired-point purge.',
        '原生结果及组织内逻辑filter删除、过期点清理。'
      )
    }
  },
  enums: {},
  enhancers: {}
}
