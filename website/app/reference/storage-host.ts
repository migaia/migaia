import type { ILibraryReference, IText } from './contract.js'
import { storageHostCases } from './storage-host-cases.js'
/** Shared bilingual text keeps the reference descriptions aligned. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Neutral host and authoring entry, with no browser or native driver import. */
export const storageHostReference: ILibraryReference = {
  modules: {
    'authoring/backend': {
      summary: t(
        'Share channel, unique-index, error and cancellation rules through finite backend functions. Controller and local key-lock construction stay on the original core; only their types are public through this entry. Features retain only controller lookup. The controller closing signal cancels its own pending lock admission without closing the shared provider.',
        '通过有限后端函数共享通道、唯一索引、错误和取消规则。controller和本地键锁构造归原core，本入口只公开其类型；Feature只保留controller读取。controller关闭信号只取消自身尚未启动的锁准入，不关闭共享provider。'
      ),
      example: `import { createStorageOperationReporter, reportCleanupError } from '@migaia/storage-host/authoring/backend'

const report = createStorageOperationReporter()
reportCleanupError(report, new Error('cleanup failed'))`
    },
    entity: {
      summary: t(
        'Use neutral schema adapters and strict portable codecs through one entity entry.',
        '通过同一个实体入口使用中立schema适配与严格portable codec。'
      ),
      example: `import { jsonCodec } from '@migaia/storage-host/entity'

const encoded = await jsonCodec.encode({ active: true })
console.log(await jsonCodec.decode(encoded))`
    },
    index: {
      summary: t(
        'Install exact backend plugins and application extensions with one runtime-neutral host. Installation-scoped borrowing reads committed dependencies without acquiring close authority. Browser adapters and native clients remain in their owning packages.',
        '用同一个运行时中立宿主安装精确后端插件和业务扩展。安装窗口借用已提交依赖，不授予关闭权。浏览器适配与原生客户端由各自包拥有。'
      ),
      example: `import { createStorageHost, definePlugin } from '@migaia/storage-host'

const labels = definePlugin('labels', () => ({
  install: () => ({ label: (value: string) => value.toUpperCase() })
}))
await using host = await createStorageHost({ plugins: [labels] })
console.log(host.extensions.label('draft'))`
    }
  },
  symbols: {
    resolveStorageNamespace: {
      role: 'operation',
      purpose: t(
        'Resolve one configured backend namespace while keeping each instance prefix and canonical organization identity.',
        '解析后端配置namespace，保留各实例前缀与规范组织身份。'
      ),
      returns: t(
        'One argument validates and returns the configured target. Three arguments return the configured default target, or configured/orgId for another organization. A slash UUID configuration suffix rejects before I/O.',
        '单参校验并返回原配置；三参在缺省组织返回原配置目标，其它组织返回configured/orgId。配置的slash UUID后缀在I/O前拒绝。'
      ),
      cases: storageHostCases.resolveStorageNamespace
    },
    createOrgId: {
      role: 'factory',
      purpose: t(
        'Generate a lowercase UUID using the host native crypto.randomUUID capability.',
        '通过宿主原生crypto.randomUUID能力生成小写UUID。'
      ),
      returns: t(
        'A canonical UUID string. Missing native UUID support rejects with UNSUPPORTED_CAPABILITY and preserves the original cause.',
        '规范UUID字符串。缺少原生UUID能力时以UNSUPPORTED_CAPABILITY拒绝，并保留原cause。'
      ),
      example: `import { createOrgId } from '@migaia/storage-host'

console.log(createOrgId())`,
      cases: storageHostCases.createOrgId
    },
    repositoryMigrationKey: {
      role: 'operation',
      purpose: t(
        'Read the existing entity metadata layout identity shared by repositories and backend raw-record firewalls.',
        '读取repository与后端raw-record firewall共用的既有实体metadata布局身份。'
      ),
      returns: t(
        'The unchanged repository:<entityName>:migration metadata key.',
        '保持原格式的repository:<entityName>:migration metadata key。'
      ),
      example: `import { repositoryMigrationKey } from '@migaia/storage-host/entity'

console.log(repositoryMigrationKey('users'))`,
      cases: storageHostCases.repositoryMigrationKey
    },
    jsonCodec: {
      role: 'operation',
      purpose: t(
        'Encode portable values with the original version-one JSON codec. Unsupported values reject before backend I/O.',
        '使用原version-one JSON codec编码portable值。不支持的值在后端I/O前拒绝。'
      ),
      returns: t(
        'An asynchronous json@1 text codec whose errors retain the contract and original codec causes.',
        '异步json@1文本codec，错误cause保留contract与原codec错误。'
      ),
      cases: storageHostCases.jsonCodec
    },
    createStorageHost: {
      role: 'factory',
      purpose: t(
        'Create the original PluginHost-backed storage lifecycle and atomically install its initial tuple. Backend lookup retains the exact admitted object.',
        '建立复用原PluginHost的存储生命周期，并原子安装初始插件元组。后端查找保留准入的原对象。'
      ),
      returns: t(
        'A Promise of the exact installed host after default environment detection; a failed install or check is cleaned up before rejection. Set autoDetect:false for explicit host.detect().',
        '完成默认环境检查后返回精确宿主的Promise；安装或检查失败后完成清理再拒绝。autoDetect:false改为显式host.detect()。'
      ),
      example: `import { createStorageHost, definePlugin } from '@migaia/storage-host'

const labels = definePlugin('labels', () => ({
  install: () => ({ label: (value: string) => value.toUpperCase() })
}))
await using host = await createStorageHost({ plugins: [labels] })
console.log(host.extensions.label('draft'))`,
      cases: storageHostCases.createStorageHost
    },
    definePlugin: {
      role: 'factory',
      purpose: t(
        'Capture a named descriptor factory and selected Features without opening a backend. Named generic descriptor factories retain the actual store and extension types. The original core reads the captured defaultOrgId and creates revision facts for a physical backend through createRevisionPort().',
        '捕获具名descriptor工厂与选中的Feature，不提前打开后端。具名泛型工厂保留实际store和扩展类型。原core读取已捕获的defaultOrgId，并经createRevisionPort()创建物理后端修订事实。'
      ),
      returns: t(
        'An opaque literal-id plugin handle consumed by createStorageHost or host.use.',
        '由createStorageHost或host.use消费的字面量id插件句柄。'
      )
    },
    defineFeature: {
      role: 'factory',
      purpose: t(
        'Bind a synchronous Feature definition to authentic backend kind identities. Its selected capabilities, chain methods and grouped API retain precise author types.',
        '把同步Feature定义绑定到真实后端种类身份，保留所选能力、链方法和分组API的作者类型。'
      ),
      returns: t(
        'The original opaque PluginHost Feature with private storage target metadata.',
        '带私有存储目标元数据的原PluginHost Feature。'
      )
    },
    defineStorageBackendKind: {
      role: 'factory',
      purpose: t(
        'Create an identity token describing the backend store, native client and extra function expose. Equal names do not make two tokens interchangeable.',
        '创建描述后端store、原生client与额外函数暴露面的身份令牌。同名令牌不能互换。'
      ),
      returns: t(
        'A kind factory whose result is checked by exact object identity at installation.',
        '种类工厂；安装时按结果对象的准确身份校验。'
      )
    },
    assertStorageBackendId: {
      role: 'operation',
      purpose: t(
        'Reject an invalid bounded ASCII backend id before installation changes membership.',
        '安装改变成员前拒绝非法的有界ASCII后端id。'
      ),
      returns: t(
        'Returns void for valid input; invalid input throws a coded native TypeError.',
        '合法输入返回void；非法输入抛带语义码的原生TypeError。'
      )
    }
  },
  types: {
    IStorageHooks: {
      summary: t(
        'One synchronous registry shared by constructor hooks, host listeners and original plugin installation scopes.',
        '构造hooks、宿主监听器与原插件安装scope共用的同步注册表。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'

await using host = await createStorageHost()
const off = host.hooks.on('beforeHostClose', ({ backendCount }) => console.log(backendCount))
await host.dispose()
off()`,
      scenarios: [
        t(
          'Observe cleanup or storage stage counts while retaining the original lifecycle owner.',
          '观察清理或存储阶段数量，保留原生命周期owner。'
        )
      ],
      members: {
        on: {
          summary: t(
            'Register one synchronous observer on the original host channel. Listener failures are reported without changing storage results.',
            '在原宿主通道登记同步observer。监听失败只报告，不改变存储结果。'
          ),
          params: {
            name: t(
              'An event key from the single augmentable hook map.',
              '唯一可扩充hook map中的事件键。'
            ),
            handler: t(
              'Receives the exact payload for that event; its return value is not awaited.',
              '接收该事件的精确载荷；不等待其返回值。'
            )
          },
          returns: t(
            'The original idempotent unsubscribe handle. Registration after host closure rejects.',
            '原幂等取消句柄。宿主关闭后登记会被拒绝。'
          ),
          example: `import { createStorageHost } from '@migaia/storage-host'

await using host = await createStorageHost()
const off = host.hooks.on('beforeHostClose', ({ backendCount }) => console.log(backendCount))
await host.dispose()
off()`
        }
      }
    }
  },
  enums: {},
  enhancers: {}
}
