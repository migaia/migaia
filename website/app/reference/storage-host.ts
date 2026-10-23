import type { ILibraryReference, IText } from './contract.js'
import { storageHostCases } from './storage-host-cases.js'
/** Shared bilingual text keeps the reference descriptions aligned. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Neutral host and authoring entry, with no browser or native driver import. */
export const storageHostReference: ILibraryReference = {
  modules: {
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
        'Install exact backend plugins and application extensions with one runtime-neutral host. Browser adapters and native clients remain in their owning packages.',
        '用同一个运行时中立宿主安装精确后端插件和业务扩展。浏览器适配与原生客户端由各自包拥有。'
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
        'A Promise of the exact installed host; a failed initial batch is cleaned up before rejection.',
        '精确宿主的Promise；初始批次失败后完成清理再拒绝。'
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
        'Capture a named descriptor factory and selected Features without opening a backend. Named generic descriptor factories retain the actual store and extension types.',
        '捕获具名descriptor工厂与选中的Feature，不提前打开后端。具名泛型工厂保留实际store和扩展类型。'
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
  types: {},
  enums: {},
  enhancers: {}
}
