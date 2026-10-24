# storage-contract 使用指南

先区分纯校验与执行拥有者。类型、token、定义和错误从 `@migaia/storage-contract` 导入；需要保存可变输入、运行查询或管理资源时，使用 [README 的 host 入口表](./README.md#入口与依赖方向)。

## 校验键而不复制

```ts
import { assertStorageKey, type IStorageKey } from '@migaia/storage-contract'

const input: unknown = ['orders', new Date(0)]
assertStorageKey(input, 'memory')
const key: IStorageKey = input
console.log((key as [string, Date])[1].getTime()) // 0
```

纯校验不打开 store，也不复制键。需要在异步写入前保留键时，由 host 原作者入口复制可变组件：

```ts
import { snapshotStorageKey } from '@migaia/storage-host/authoring/key'

const input = ['orders', new Date(0)] as const
const saved = snapshotStorageKey(input, 'memory') as [string, Date]
input[1].setTime(1000)
console.log(saved[1].getTime()) // 0
```

没有跨异步或公开所有权边界的同步校验直接使用原输入，不建立第二份快照。

## 校验操作意图

```ts
import { assertOperationContext, assertSyncWriteOptions } from '@migaia/storage-contract'

assertOperationContext({ timeoutMs: 0, pageSize: 100 })
assertSyncWriteOptions({ conflictPolicy: 'replace' })
```

这两个函数不运行取消、计时或写入。非法字段沿现有 `INVALID_ARGUMENT` 边界；省略字段不插入后端默认值。signal 是原 live signal，已取消的有效信号也符合 shape。

```ts
import { snapshotOperationContext } from '@migaia/storage-host/authoring/context'

const controller = new AbortController()
const options = { signal: controller.signal, timeoutMs: 10 }
const captured = snapshotOperationContext(options)!
options.timeoutMs = 20
controller.abort()
console.log(captured.timeoutMs, captured.signal === controller.signal) // 10 true
console.log(captured.signal?.aborted) // true
```

快照用于后续实际 await，不冻结，不保证再次 snapshot 返回相同对象，也不承诺属性读取次数。后端已捕获的上下文应复用，不重复复制。

## 识别能力而不取得资源

```ts
import { isStorageCapabilities, type IStorageCapabilities } from '@migaia/storage-contract'

const facts: IStorageCapabilities = {
  syncRead: false,
  binary: false,
  records: false,
  transactions: false,
  iteration: false,
  secondaryIndexes: false,
  changeFeed: false,
  maxValueBytes: undefined,
  opaqueEntries: false
}
console.log(isStorageCapabilities(facts)) // true
```

`batch` 省略表示不提供完整批量写；共享 conformance 的该组记为不适用。shape guard 不创建规范化副本。需要在宿主异步准入期间保存事实时，从 `/authoring/store` 使用 `snapshotStorageCapabilities`。

## 定义 token 与实现

```ts
import { defineStorageCapability, implement, isCapabilityToken } from '@migaia/storage-contract'

const status = defineStorageCapability<{ readStatus(): string }>()('status')
const api = { readStatus: () => 'ready' }
const definition = implement(status, api)
console.log(isCapabilityToken(status), typeof definition) // true object
```

这一步没有发布 store。发布和 has/use 在 host `/authoring/capability`；定义 token 的名字不能替代原对象身份。完整资源和清理示例见 [host 指南](../storage-host/USEGUIDE.md)。

## codec 与原方法 receiver

`assertCodec(codec)` 只检查普通对象或合法 class 的公开结构。`snapshotCodec` 已归 host `/authoring/codec`，现在校验后借用同一对象；它不复制 `{name, output, encode, decode}`，因此 `#private` 方法不会丢失 receiver。调用使用 `codec.encode(value)` / `codec.decode(raw)`。格式转换适配仍使用同入口的 `fromValueCodec`。

## 原错误与进度报告

```ts
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'

const cause = new TypeError('example invalid input')
const error = new StorageContractError(StorageContractErrorCode.invalidArgument, {
  backend: 'memory',
  cause
})
console.log(error.source, error.code, error.cause === cause)
// @migaia/storage-contract INVALID_ARGUMENT true
```

既有错误实例仍冻结，cause 与 stack 保留。归档迁移通过原 `onArchiveRunError` 报告进度，不向错误实例添加状态。

## 后端 conformance

从 `@migaia/storage-contract/conformance` 导入 `runConformance`，提供消费者原有的 describe/it/expect（以及可选 skip）、fresh fixture、真实 token 清单和能力事实。每组执行原公开操作并清理该 fixture；不安装第二个 runner，不据后端名字推断未声明能力。完整参数类型是同入口的 `IConformanceHarness` 与 `IConformanceSubject`。
