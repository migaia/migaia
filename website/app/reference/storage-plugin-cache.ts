import type { ILibraryReference, IText } from './contract.js'
import { storagePluginCacheCases } from './storage-plugin-cache-cases.js'
/** Bilingual prose retains the same public cache identities. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Cache metadata documents package-owned policies and canonical request keys. */
export const storagePluginCacheReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Canonical cache request keys and tier policy contracts.',
        '规范缓存请求键与分层策略契约。'
      )
    }
  },
  symbols: {
    cacheKey: {
      role: 'operation',
      purpose: t(
        'Hash canonical portable request parts without accessing storage.',
        '对规范 portable 请求参数取哈希，不访问存储。'
      ),
      cases: storagePluginCacheCases.cacheKey
    },
    cacheBackendKind: {
      role: 'constant',
      purpose: t(
        'Authenticate the exact cache Feature target with no native client exposure.',
        '校验精确缓存 Feature 目标，不暴露原生 client。'
      )
    },
    CacheWriteMode: {
      role: 'constant',
      purpose: t(
        'Name through and back tier write policies.',
        '定义 through 与 back 分层写入策略。'
      )
    },
    CacheErrorCode: {
      role: 'constant',
      purpose: t(
        'Distinguish configuration, loader and embedding failures.',
        '区分配置、回源与嵌入失败。'
      )
    },
    ERROR_SOURCE: {
      role: 'constant',
      purpose: t(
        'Registered cache error domain storage.backend.cache.',
        '登记的缓存错误领域 storage.backend.cache。'
      )
    }
  },
  types: {},
  enums: {
    CacheWriteMode: {
      summary: t('Choose when a tier receives its cached write.', '选择层接收缓存写入的时机。'),
      values: {
        through: t('Wait for this layer before returning.', '返回前完成本层写入。'),
        back: t(
          'Coalesce writes in the configured pending table.',
          '在配置的待写表中按键合并写入。'
        )
      }
    },
    CacheErrorCode: {
      summary: t('Registered orchestration failure categories.', '登记的编排失败类别。'),
      values: {
        tierInvalid: t(
          'Correct invalid tier or call policy configuration.',
          '修正非法层或单次策略配置。'
        ),
        loadFailed: t(
          'Inspect the original loader or encoding failure on cause.',
          '通过 cause 检查原回源或编码错误。'
        ),
        embedFailed: t(
          'Inspect the original embedding failure on cause.',
          '通过 cause 检查原嵌入错误。'
        )
      }
    }
  },
  enhancers: {}
}
