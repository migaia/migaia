/**
 * `@migaia/capability` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/capability'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 迁移背景（`docs/lifecycle/migration.sdd.md` §3.7.3）：本表把包内原本裸 `throw new Error('…')`
 * 的字符串归纳成码。`INVALID_NAME` / `INVALID_ACTIVATE` / `INVALID_HANDLE` 必须保持抛出值是 `TypeError`
 * ——码只作为附加字段挂上，不替换类型。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更。
 */
export const CapabilityErrorCode = {
  /**
   * 在已 `dispose()` 的 host 上调用**变更方法**（register/setFlag/setFlags/enable/disable 等）时抛出。
   *
   * 落实 `docs/lifecycle/migration.sdd.md` §3.7.3 的 host
   * 终态门禁。**只读终态诊断**（`names`/`state`/`handle`/`error`） 在 disposed 后仍可用，用于观测最终落点；调用方要重新启用必须新建
   * host，不要复活已释放的闸门。
   */
  hostDisposed: 'HOST_DISPOSED',

  /**
   * 在某个 disposer/reporter 的重入窗口内（`transitionDepth > 0`）尝试
   * `register`/`setFlag`/`setFlags`/`enable`/`disable`/`dispose`，或在首次 `dispose()` 完成前再次 调用
   * `dispose()` 时抛出/拒绝。
   *
   * 落实 `docs/lifecycle/migration.sdd.md` §3.7.3 的重入门禁；防止一个正在运行的回退回调把外层正在进行的开关快照重写掉。调用方应把 mutation
   * 移到生命周期回调之外。
   */
  hostTransitioning: 'HOST_TRANSITIONING',

  /**
   * `state`/`handle`/`error`/`enable`/`disable` 等按名字查询/操作一个从未 `register()` 过的能力时抛出。
   *
   * 落实 `docs/lifecycle/migration.sdd.md` §3.7.3。调用方通常是名字写错或注册时序错位，应先 `register()`。
   */
  notRegistered: 'NOT_REGISTERED',

  /**
   * `register()` 传入的 `name` 已经登记过时抛出。同名重复登记视为编程错误，不做静默覆盖。
   *
   * 落实 `docs/lifecycle/migration.sdd.md` §3.7.3。调用方应改名或先移除旧登记。
   */
  alreadyRegistered: 'ALREADY_REGISTERED',

  /**
   * `register()` 传入的 `name` 不是非空字符串时抛出（`TypeError`）。
   *
   * 落实 `docs/lifecycle/migration.sdd.md` §3.7.3 的参数校验。调用方修正 name 后重试。
   */
  invalidName: 'INVALID_NAME',

  /**
   * `register()` 传入的 `activate` 不是函数时抛出（`TypeError`）。
   *
   * 落实 `docs/lifecycle/migration.sdd.md` §3.7.3 的参数校验。调用方提供可调用的 activate。
   */
  invalidActivate: 'INVALID_ACTIVATE',

  /**
   * `activate()` 的返回值缺少可调用的 `dispose` 时抛出（`TypeError`）——「半开」比明确失败更危险。
   *
   * 落实 `docs/lifecycle/migration.sdd.md` §3.7.3 的 handle 契约。调用方确保 activate 返回 `{ dispose }`。
   */
  invalidHandle: 'INVALID_HANDLE',

  /**
   * 闸门拒绝启用。当前没有抛出点——`enable()`/`enableResult()` 用 `{status: 'gated'}` 结构化返回，从不抛错；这个码
   * 保留给诊断/事件通道（未来接入 `onError`/事件总线时使用），不改变「拒绝不抛错」的既有行为。
   *
   * 落实 `docs/lifecycle/migration.sdd.md` §3.7.3（`gated` 与 graph 的 `blocked` 语义分离）。调用方按返回值分支，不要
   * catch。
   */
  gated: 'GATED',

  /**
   * `flags`/`definition` 快照时宿主对象（如 hostile Proxy）的 ownKeys/getOwnPropertyDescriptor/getter
   * 抛错，无法读取配置。
   *
   * Fail-closed 后抛出，原始 Proxy 异常经 `cause` 保持 `===` 可达（`docs/contracts/error-codes.md` §2）；调用方应修复传入的
   * flags/definition 对象，不要对同一份 hostile 输入重试。
   */
  invalidOption: 'INVALID_OPTION'
} as const

export type ICapabilityErrorCode = (typeof CapabilityErrorCode)[keyof typeof CapabilityErrorCode]
