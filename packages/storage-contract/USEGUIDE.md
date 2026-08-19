# `@migaia/storage-contract` 使用指南

本指南逐个模块列出全部导出 API 的签名、语义与用法示例。包的定位与安装方式见 [README](./README.md)。

## 目录

- [`store` 模块](#store-模块)
- [`capabilities` 模块](#capabilities-模块)
- [`context` / `operation-context` 模块](#context-模块)
- [`key` 模块](#key-模块)
- [`codec` / `codec-guard` 模块](#codec-模块)
- [`transaction` 模块](#transaction-模块)
- [`errors` 模块](#errors-模块)
- [`bytes` / `policy-constants` 模块](#bytes-模块)
- [组合工作流示例](#组合工作流示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="store-模块"></a>

## `store` 模块

```ts
type IBackendKind = 'local' | 'session' | 'cookie' | 'indexeddb' | 'memory';

type ISyncKeyValueStore = {
  get(key: string): string | null;
  set(key: string, value: string, options?: ISyncWriteOptions): void;
  remove(key: string): void;
  has(key: string): boolean;
  keys(): string[];
  clearValues(): void;
};

type IKeyValueStore = {
  readonly backend: IBackendKind;
  readonly capabilities: IStorageCapabilities;
  get(key: string, ctx?: IOperationContext): Promise<string | null>;
  set(key: string, value: string, ctx?: IWriteOptions): Promise<void>;
  remove(key: string, ctx?: IOperationContext): Promise<void>;
  has(key: string, ctx?: IOperationContext): Promise<boolean>;
  keys(ctx?: IOperationContext): Promise<string[]>;
  clearValues(ctx?: IOperationContext): Promise<void>;
  clearAll(ctx?: IOperationContext): Promise<void>;
  dispose(): Promise<void>;
  readonly sync?: ISyncKeyValueStore;
};
```

`IKeyValueStore` 是 L0：所有后端都实现的字符串键值通道。`get` 缺失返回 `null`（不是 `undefined`）。`sync` 仅同步后端（localStorage/sessionStorage/内存/cookies）提供；异步后端（IndexedDB）上恒为 `undefined`。

```ts
type ISyncCapableStore<TStore extends { readonly sync?: object }> = TStore & {
  readonly sync: NonNullable<TStore['sync']>;
};
```

把某个 `IKeyValueStore` 变体的 `sync` 字段从可选收紧为必然存在，同步后端的工厂函数用它标注返回类型，调用方无需 `?.`。

```ts
type IRecordStore<TValue = unknown> = IKeyValueStore & {
  getBytes(key: string, ctx?: IOperationContext): Promise<Uint8Array | null>;
  setBytes(key: string, value: Uint8Array, ctx?: IWriteOptions): Promise<void>;
  clearBytes(ctx?: IOperationContext): Promise<void>;
  getRecord(key: IStorageKey, ctx?: IOperationContext): Promise<TValue | undefined>;
  putRecord(value: TValue, key?: IStorageKey, ctx?: IWriteOptions): Promise<IStorageKey>;
  deleteRecord(key: IStorageKey, ctx?: IOperationContext): Promise<void>;
  clearRecords(ctx?: IOperationContext): Promise<void>;
  clearAll(ctx?: IOperationContext): Promise<void>;
  readonly metadata?: {
    get(key: string, ctx?: IOperationContext): Promise<unknown | undefined>;
    set(key: string, value: unknown, ctx?: IWriteOptions): Promise<void>;
    delete(key: string, ctx?: IOperationContext): Promise<void>;
  };
  iterateRecords(
    range?: IKeyRange,
    ctx?: IOperationContext
  ): AsyncIterableIterator<[IStorageKey, TValue]>;
  transaction<T>(
    run: (tx: ITransactionScope<TValue>) => Promise<T>,
    ctx?: IOperationContext
  ): Promise<T>;
};
```

`IRecordStore<T>` 是 L1：结构化后端额外提供的字节通道、结构化记录（`IStorageKey` 主键而非字符串）、范围迭代与事务。`putRecord` 未传 `key` 时由后端生成并返回该键。`metadata` 是后端自有、供可恢复的维护迁移使用的可选通道，与 `records`/`bytes`/`values` 通道相互独立，不受 `clearAll`/`clearRecords` 影响。`clearAll` 覆盖 L0 定义，同时清空 values/bytes/records 三个通道。

```ts
function isKeyValueStore(store: unknown): store is IKeyValueStore;
```

运行时校验一个未知值是否满足完整 L0 形状：`backend` 属于 `{'memory','local','session','cookie','indexeddb'}`、`capabilities` 通过 `isStorageCapabilities`、且 `get`/`set`/`remove`/`has`/`keys`/`clearValues`/`clearAll`/`dispose` 全部是函数。属性访问（含代理陷阱）抛错时返回 `false`，绝不向上抛出。

```ts
function isRecordStore(store: IKeyValueStore): store is IRecordStore;
```

在 `isKeyValueStore` 的基础上，额外要求 `getBytes`/`setBytes`/`clearBytes`/`getRecord`/`putRecord`/`deleteRecord`/`clearRecords`/`iterateRecords`/`transaction` 均是函数，且 `capabilities.records && capabilities.binary && capabilities.transactions && capabilities.iteration` 全部为 `true`。

```ts
function asRecordStore<T = unknown>(store: IKeyValueStore): IRecordStore<T>;
```

运行时收窄断言版：形状或能力不满足时立即抛出 `StorageContractError(code: 'UNSUPPORTED_CAPABILITY', details: { backend })`，`backend` 取探测到的合法后端名（探测失败则 `undefined`）。不做任何静默降级或包装。

```ts
const record = await asRecordStore<{ name: string }>(store).getRecord('profile');
```

---

<a id="capabilities-模块"></a>

## `capabilities` 模块

```ts
type IStorageCapabilities = {
  readonly syncRead: boolean;
  readonly binary: boolean;
  readonly records: boolean;
  readonly transactions: boolean;
  readonly iteration: boolean;
  readonly maxValueBytes: number | undefined;
  readonly opaqueEntries: boolean;
};
```

`maxValueBytes` 是单值近似上限（字节）：cookie 约 4096，localStorage 约 5MB，IndexedDB 为 `undefined`（受配额而非单值限制）。`opaqueEntries` 表示该后端上不可见的键是否可能存在（例如 cookies 的 `HttpOnly` 条目）。

```ts
function snapshotStorageCapabilities(value: unknown): IStorageCapabilities | undefined;
```

读一次候选值的全部 7 个字段并校验类型；`maxValueBytes` 必须是非负安全整数或 `undefined`，其余字段必须是 `boolean`。任一字段访问抛错、类型不符时返回 `undefined`（不抛错）；合法时返回新构造的快照对象（非原值引用）。

```ts
function isStorageCapabilities(value: unknown): value is IStorageCapabilities;
```

等价于 `snapshotStorageCapabilities(value) !== undefined` 的类型守卫。

---

<a id="context-模块"></a>

## `context` / `operation-context` 模块

```ts
type IOperationContext = {
  readonly signal?: IAbortSignal;
  readonly timeoutMs?: number;
  readonly pageSize?: number;
};
type IWriteOptions = IOperationContext & { readonly conflictPolicy?: IConflictPolicy };
type ISyncWriteOptions = { readonly conflictPolicy?: IConflictPolicy };
const ConflictPolicy = { conflict: 'conflict', replace: 'replace' } as const;
type IConflictPolicy = 'conflict' | 'replace';
type IStorageKey = string | number | Date | ArrayBuffer | readonly IStorageKey[];
type IKeyRange = {
  readonly lower?: IStorageKey;
  readonly lowerOpen?: boolean;
  readonly upper?: IStorageKey;
  readonly upperOpen?: boolean;
};
```

`IOperationContext` 是所有公开异步方法的最后一个可选参数：`signal` 是协作式取消（后端可忽略，但调用方一定以 `AbortError` 结束等待；结构化信号类型，不引全局 `AbortSignal`）；`timeoutMs` 是便捷超时，内部合成为 `signal`，与外部 `signal` 同时存在时取先触发者；`pageSize` 限定迭代器的分页大小（IndexedDB 等），用于保护游标内存。`ISyncWriteOptions` 是同步写唯一支持的选项形状——不接受 `signal`/`timeoutMs`（同步调用无法协作式取消或超时）。

```ts
function snapshotOperationContext(
  ctx: IOperationContext | undefined
): IOperationContextSnapshot | undefined;
```

读一次 `ctx` 的全部字段（含 `conflictPolicy`，供实现层内部复用）并校验，返回 `Object.freeze` 后的快照；`ctx === undefined` 时返回 `undefined`。若传入值已经是本函数产出的快照（内部 `WeakSet` 标记），幂等直接返回原值。校验规则：`signal` 若提供必须满足 `IAbortSignal` 形状（`aborted: boolean`、`addEventListener`/`removeEventListener` 均为函数）；`timeoutMs` 必须是非负安全整数；`pageSize` 必须是 `1`~`4096` 之间的整数；`conflictPolicy` 必须是 `'conflict'`/`'replace'`/`undefined`。任一校验失败或字段访问抛错，均抛出 `StorageContractError(code: 'INVALID_ARGUMENT')`。

```ts
function assertOperationContext(ctx: IOperationContext | undefined): void;
```

内部即调用 `snapshotOperationContext`，只做校验，丢弃返回值。

```ts
function snapshotSyncWriteOptions(options: unknown): { readonly conflictPolicy?: IConflictPolicy };
function assertSyncWriteOptions(options: unknown): void;
```

校验同步写选项：`options` 必须是对象或 `undefined`；一旦出现 `signal` 或 `timeoutMs`（即使值为 `undefined` 以外的任何值也不行，只要属性存在即报错）立即抛 `StorageContractError(invalidArgument)`；`conflictPolicy` 校验同上。

```ts
snapshotSyncWriteOptions({ conflictPolicy: 'replace' }); // { conflictPolicy: 'replace' }
snapshotSyncWriteOptions({ timeoutMs: 100 }); // 抛错
```

---

<a id="key-模块"></a>

## `key` 模块

```ts
const KEY_DOMAIN_LIMITS = { maxDepth: 32, maxNodes: 4096, maxBinaryBytes: 1048576 } as const;
```

硬限制，保护平铺键解码免受病态持久化输入影响。

```ts
function assertStorageKey(
  value: unknown,
  backend: IBackendKind,
  label?: string
): asserts value is IStorageKey;
```

校验值落在 `IStorageKey` 域内：字符串永远合法；数字须 `Number.isFinite`；`Date` 须非 `NaN`（跨 realm 通过 `structuredClone` 识别，无 `structuredClone` 时退化为 `instanceof Date`）；`ArrayBuffer` 须 `byteLength <= maxBinaryBytes`（同样用 `structuredClone` 做跨 realm 识别）；数组须非空、无循环引用、每个元素递归合法，且总深度 `<= maxDepth`、总节点数 `<= maxNodes`。`label`（默认 `'key'`）只影响错误消息文案。不合法抛 `StorageContractError(code: 'INVALID_KEY', details: { backend, key: value })`。

```ts
function snapshotStorageKey(value: unknown, backend: IBackendKind, label?: string): IStorageKey;
```

先校验，再深拷贝出一份与原值分离的键（字符串/数字原样，`Date`/`ArrayBuffer` 重新构造，数组递归拷贝），拷贝完成后对拷贝结果**再次**校验。用于避免调用方在异步操作进行期间修改原始键对象。拷贝或二次校验过程中的任何异常都会被包装为 `StorageContractError(invalidKey)` 抛出（若原本已是 `StorageContractError` 则直接透传）。

```ts
function assertStringStorageKey(
  value: unknown,
  backend: IBackendKind,
  label?: string
): asserts value is string;
```

L0/字节/元数据通道要求纯字符串键；非字符串抛 `StorageContractError(code: 'INVALID_ARGUMENT')`（注意：此处是 `invalidArgument` 而非 `invalidKey`，因为这些通道的契约本身就规定键必须是字符串，不是键域越界问题）。

```ts
function compareStorageKeys(a: IStorageKey, b: IStorageKey): number;
```

跨类型稳定比较器：先按类型排名（`number < Date < string < ArrayBuffer < 数组`），同类型再具体比较（数字直接相减；日期取时间戳相减；字符串按 `<`/`>`；`ArrayBuffer` 逐字节比较，短者优先，前缀相同则短的更小；数组逐元素递归比较，前缀相同则短的更小）。用于对键排序或作为 `Array.prototype.sort` 的比较函数。

---

<a id="codec-模块"></a>

## `codec` / `codec-guard` 模块

```ts
type ICodecOutput = 'text' | 'binary' | 'structured';
type ICodec<T = unknown, TRaw = string | Uint8Array | unknown> = {
  readonly name: string;
  readonly output: ICodecOutput;
  encode(value: T, ctx?: IOperationContext): Promise<TRaw>;
  decode(raw: TRaw, ctx?: IOperationContext): Promise<T>;
};
```

序列化是面向开发者的开放契约，不绑定任何库。本包不内置任何编解码器实现；内置实现（`jsonCodec`、`structured.ts`、`binary.ts`）在 `@migaia/storage-web` 中提供。任何自定义编解码——压缩、加密、走 Worker 的重编码——都通过实现同一接口接入。`output` 声明产出形态，用于与后端能力选路（例如 `output: 'binary'` 的 codec 遇到只支持文本的后端应由调用方决定降级策略，本包不做隐式转换）。

```ts
function snapshotCodec(codec: unknown): ICodec;
```

读一次并校验：`codec` 必须是普通对象；`name` 必须是非空字符串（trim 后非空）；`output` 必须属于 `['text','binary','structured']`；`encode`/`decode` 必须是函数。返回浅拷贝出的 4 字段新对象（`{ name, output, encode, decode }`），不透传原对象引用。不合法抛 `StorageContractError(code: 'INVALID_ARGUMENT')`。

```ts
function assertCodec(codec: unknown): asserts codec is ICodec;
```

内部即调用 `snapshotCodec` 并丢弃返回值，仅用于类型断言场景。

---

<a id="transaction-模块"></a>

## `transaction` 模块

```ts
type ITransactionWriteOptions = { readonly conflictPolicy?: IConflictPolicy };
type ITransactionScope<TValue = unknown> = {
  get(key: IStorageKey): Promise<TValue | undefined>;
  put(value: TValue, key?: IStorageKey, options?: ITransactionWriteOptions): Promise<IStorageKey>;
  delete(key: IStorageKey): Promise<void>;
};
```

后端无关的事务作用域，由内存和 IndexedDB 提交引擎共享此类型。隔离级别、提交时机、失败重试都是**实现定义**的，本契约不做约束。回调 resolve 之后不要继续保留并使用该 scope——底层连接/快照生命周期可能已随回调结束而释放。

```ts
function assertTransactionCallback(run: unknown, backend: IBackendKind): void;
```

在后端分配快照/连接资源之前校验回调是函数；非函数抛 `StorageContractError(code: 'INVALID_ARGUMENT', details: { backend })`。

```ts
function readTransactionConflictPolicy(options: unknown, backend: IBackendKind): IConflictPolicy;
```

校验并读出事务写选项里的冲突策略：`options === undefined` 返回 `'conflict'`；对象且 `conflictPolicy` 为 `undefined`/`'conflict'` 返回 `'conflict'`；为 `'replace'` 返回 `'replace'`；其余任何形状（非对象、非法值、属性访问抛错）都抛 `StorageContractError(code: 'INVALID_ARGUMENT', details: { backend })`。

---

<a id="errors-模块"></a>

## `errors` 模块

```ts
class StorageContractError extends Error {
  readonly source: string; // 恒为 '@migaia/storage-contract'
  readonly code: IStorageContractErrorCode;
  readonly backend?: IBackendKind;
  readonly key?: string | IStorageKey;
  constructor(
    code: IStorageContractErrorCode,
    details?: {
      readonly backend?: IBackendKind;
      readonly key?: string | IStorageKey;
      readonly cause?: unknown;
    },
    message?: string
  );
}
```

构造后立即 `Object.freeze`；不重写 `stack`；`cause` 通过标准 `Error` 机制可达（不被冻结阻断）。`message` 默认取 `` `[storage-contract] ${code}` ``。

```ts
const StorageContractErrorCode = {
  invalidArgument: 'INVALID_ARGUMENT',
  invalidKey: 'INVALID_KEY',
  unsupported: 'UNSUPPORTED_CAPABILITY',
  disposed: 'STORE_DISPOSED',
  aborted: 'ABORTED'
} as const;
```

| Code                     | 含义                                                                                                                   | 调用方应对                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`       | 契约级入参/描述符结构校验失败（codec、capabilities、transaction 选项、operation context 等公共契约类型不符合声明形状） | 修正入参后重试；这是永久性传参错误，不是可重试的瞬时失败                         |
| `INVALID_KEY`            | `IStorageKey` 违反键域（类型非法、深度/节点/二进制字节超限、循环、空数组）                                             | 修正键；永久性错误，不要重试同一键                                               |
| `UNSUPPORTED_CAPABILITY` | 调用了当前后端不提供的能力（`asRecordStore` 收窄失败、structured codec 落到 text-only 后端）                           | 先用 `capabilities`/`isRecordStore` 分支，或换一个具备该能力的后端；不做静默降级 |
| `STORE_DISPOSED`         | store 已 `dispose()` 后继续调用其任何方法                                                                              | 新建 store，不要复用已关闭实例                                                   |
| `ABORTED`                | 操作被 `signal` 取消或 `timeoutMs` 到期                                                                                | 按取消处理；已进入原子提交的写按提交事实返回，不伪报回滚                         |

`code` 值是公开 API 的一部分，改名等同破坏性变更；`source` 恒为 `'@migaia/storage-contract'`，与实现包（如 `storage-web`）自己的错误 `source` 互不冲突，可用 `(source, code)` 二元组唯一定位错误来源。

```ts
const STORAGE_CONTRACT_SOURCE: '@migaia/storage-contract';
function isStorageContractError(value: unknown): value is StorageContractError;
```

---

<a id="bytes-模块"></a>

## `bytes` / `policy-constants` 模块

```ts
function isUint8Array(value: unknown): value is Uint8Array;
```

跨 realm 安全：用 `ArrayBuffer.isView(value) && intrinsicConstructorName(value) === 'Uint8Array'` 判断，而不是 `instanceof Uint8Array`，因此能正确识别来自其他 iframe/Worker realm 的 `Uint8Array` 实例。

```ts
function intrinsicConstructorName(value: unknown): string | undefined;
```

不调用用户可覆写方法（不触发可能被篡改的 getter/`Symbol.toStringTag`），直接读原型链上的 `constructor.name`。非对象、`null`、或读取过程抛错均返回 `undefined`。

```ts
const StorageContractConflictPolicy = { conflict: 'conflict', replace: 'replace' } as const;
type IStorageContractConflictPolicy = 'conflict' | 'replace';
```

与 `context` 模块的 `ConflictPolicy`/`IConflictPolicy` 是同名同值的独立导出，供不想引入 `IOperationContext` 等类型的调用点单独使用。

---

<a id="组合工作流示例"></a>

## 组合工作流示例：契约边界的能力收窄与校验前置

```ts
import {
  asRecordStore,
  isRecordStore,
  snapshotOperationContext,
  type IKeyValueStore,
  type IOperationContext
} from '@migaia/storage-contract';

type IProfile = { readonly name: string; readonly avatar?: Uint8Array };

export const saveProfile = async (
  store: IKeyValueStore,
  profile: IProfile,
  ctx: IOperationContext
): Promise<void> => {
  // 提前校验 ctx，坏参数在真正发起 I/O 之前就抛出 INVALID_ARGUMENT
  const snapshot = snapshotOperationContext(ctx);

  if (!isRecordStore(store)) throw new Error('profile storage requires an L1-capable backend');
  const records = asRecordStore<IProfile>(store);

  await records.transaction(async (tx) => {
    await tx.put(profile, 'profile');
  }, snapshot);
};
```

这个模式把"契约层能表达的校验"（操作上下文形状、能力收窄）尽量提前到功能函数入口，真正的持久化细节（连接、提交、重试）完全交给具体实现包（如 `storage-web`）。

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

- **`UNSUPPORTED_CAPABILITY`**：检查 `store.capabilities`；说明当前 provider 只是 L0（或缺少 `records`/`binary`/`transactions`/`iteration` 之一）。
- **`INVALID_ARGUMENT`**：核对 `signal` 形状（须实现 `aborted`/`addEventListener`/`removeEventListener`）、`timeoutMs`/`pageSize` 取值范围、`conflictPolicy` 取值，以及同步写选项是否误传了 `signal`/`timeoutMs`。
- **`INVALID_KEY`**：使用文档列出的键形式（字符串/有限数字/`Date`/`ArrayBuffer`/以上类型的非空嵌套数组），不要传普通对象；检查是否超过深度 32 层或 4096 节点。
- **`STORE_DISPOSED`**：说明拥有该 store 的代码已结束其生命周期；不要在 `dispose()` 之后继续持有引用调用方法。
- 本包不提供任何持久化实现——如果需要真正把数据写进 localStorage/IndexedDB/cookies，去用 `@migaia/storage-web`（或另一个实现本契约的包），本包只负责跨实现的类型与校验共享。

```bash
pnpm --filter @migaia/storage-contract run fmt
pnpm --filter @migaia/storage-contract run lint
pnpm --filter @migaia/storage-contract run typecheck
pnpm --filter @migaia/storage-contract run typecheck:test
pnpm --filter @migaia/storage-contract run test
```

</content>
