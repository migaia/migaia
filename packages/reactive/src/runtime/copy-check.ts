/**
 * 双实例自检。
 *
 * 本库的几处关键状态是**模块级**的：所有权表 `OWNERS`、内部面表 `INTERNALS`、 以及同步追踪上下文
 * `activeTracker`。它们是正确性的支点，前提是「整个进程里只有 一份这个模块」。
 *
 * 这个前提会被打破，而且打破得很安静：重复安装（两个版本的依赖各带一份）、 打包产物与 CDN 副本共存、微前端各自打包同一个库。此时：
 *
 * - 两份 `OWNERS`：A 副本创建的节点在 B 副本眼里「不是本库创建的 Runtime」， 报错信息却只说「这不是 createRuntime() 造的」——真正的原因看不出来；
 * - 两份 `activeTracker`：跨副本的依赖读取**检测不到**，于是跨 Runtime 读会静默 拿到陈旧数据，恰好是本库明确承诺要拒绝的那件事。
 *
 * 所以要有自检。它不擅自决定「两份就是错的」——微前端里刻意隔离两份是合理的； 它做的是：登记、在出现第二份时讲清后果、并让需要硬失败的应用能显式要求单副本。
 *
 * 登记刻意**不在模块加载时**发生，而在第一次触碰正确性边界时：创建 Runtime、 查询节点归属、或读取 Runtime 内部面。import 内核不该有副作用（那是
 * defaultRuntime 刚修掉的问题）；但只读副本若拿本副本的 `ownerOf` 查询另一副本的 节点，同样已经进入了所有权协议，不能因为它没创建 Runtime 就从计数里消失。
 *
 * 这套 `Symbol.for` 登记是发布产物与第二份消费者副本共存时的基础设施防线； 当前单体源码树不会因此自动产生第二份 Runtime。
 */
import { createReactiveError } from '../errors.js';
import { ReactiveErrorCode } from '../error-code.js';
import { ReactiveErrorText } from '../error-text.js';

/** 跨副本共享的键。函数化避免 import 时连全局 Symbol registry 都被触碰。 */
const registryKey = (): symbol => Symbol.for('@morning-watch/store.runtime-copies');

/** 本副本的身份。每份模块各自新建一个，因此可用来数副本。 */
const THIS_COPY = Symbol('@morning-watch/store.runtime-copy');

type IRegistry = {
  readonly version: 1;
  readonly copies: Set<symbol>;
  warned: boolean;
};

function isRegistry(value: unknown): value is IRegistry {
  if (typeof value !== 'object' || value === null) return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const version = descriptors.version;
    const copies = descriptors.copies;
    const warned = descriptors.warned;
    return (
      version !== undefined &&
      'value' in version &&
      version.value === 1 &&
      copies !== undefined &&
      'value' in copies &&
      copies.value instanceof Set &&
      warned !== undefined &&
      'value' in warned &&
      typeof warned.value === 'boolean' &&
      warned.writable === true
    );
  } catch {
    return false;
  }
}

/** 本副本是否已登记。热路径只付一次布尔判断，不反复读 globalThis。 */
let thisCopyNoted = false;

/** 惰性读取共享登记表。`create=false` 只观察，绝不因诊断查询制造全局状态。 */
function registryOf(create: false): IRegistry | undefined;
function registryOf(create: true): IRegistry;
function registryOf(create: boolean): IRegistry | undefined {
  const host = globalThis as unknown as object;
  const key = registryKey();
  const descriptor = Object.getOwnPropertyDescriptor(host, key);
  if (descriptor) {
    const existing = 'value' in descriptor ? descriptor.value : undefined;
    if (!isRegistry(existing)) {
      throw createReactiveError(
        ReactiveErrorCode.copyConflict,
        ReactiveErrorText.copyRegistryInvalid
      );
    }
    return existing as IRegistry;
  }
  if (!create) return undefined;
  const created: IRegistry = {
    version: 1,
    copies: new Set(),
    warned: false
  };
  Object.defineProperty(host, key, {
    value: created,
    configurable: true
  });
  return created;
}

/** 节点上的跨副本诊断品牌；真正的归属权威仍是每份模块私有的 WeakMap。 */
const ownershipCopyKey = (): symbol => Symbol.for('@morning-watch/store.ownership-copy');

/** 为本副本创建的受管对象加不可变品牌，供另一份模块 fail closed。 */
export function brandOwnedValue(value: object): void {
  const key = ownershipCopyKey();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor) {
    if ('value' in descriptor && descriptor.value === THIS_COPY) return;
    if ('value' in descriptor && typeof descriptor.value === 'symbol') {
      noteRuntimeCopy(descriptor.value);
      noteRuntimeCopy();
      throw createReactiveError(ReactiveErrorCode.copyConflict, ReactiveErrorText.foreignCopyValue);
    }
    throw createReactiveError(
      ReactiveErrorCode.brandCorrupted,
      ReactiveErrorText.ownershipBrandCorrupted
    );
  }
  Object.defineProperty(value, key, {
    value: THIS_COPY,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

/** 本地 WeakMap miss 时识别另一副本的受管对象，避免把它降级成普通值放行。 */
export function assertNoForeignOwnershipBrand(value: object): void {
  const descriptor = Object.getOwnPropertyDescriptor(value, ownershipCopyKey());
  if (!descriptor) return;
  if ('value' in descriptor && descriptor.value === THIS_COPY) return;
  if ('value' in descriptor && typeof descriptor.value === 'symbol') {
    noteRuntimeCopy(descriptor.value);
    noteRuntimeCopy();
    throw createReactiveError(
      ReactiveErrorCode.copyConflict,
      ReactiveErrorText.foreignCopyDependency
    );
  }
  throw createReactiveError(
    ReactiveErrorCode.brandCorrupted,
    ReactiveErrorText.ownershipBrandCorrupted
  );
}

/**
 * 待上报的多副本诊断。`noteRuntimeCopy` 可能发生在 Runtime 构造**之前**（`createRuntime` 先登记再 new）， 所以先记录状态，等 Runtime
 * 建立后经其 diagnostic 通道上报；不直接 `console.error`（AF-04）。
 */
let pendingCopyWarning: string | undefined;

/** 取出并清空待上报的多副本诊断；Runtime 构造时消费。 */
export const consumePendingCopyWarning = (): string | undefined => {
  const warning = pendingCopyWarning;
  pendingCopyWarning = undefined;
  return warning;
};

/**
 * 登记本副本。`createRuntime()` 与所有权/内部面边界调用，幂等且有本地 fast path。
 *
 * `copy` 参数只为测试模拟「另一份模块」——生产路径永远用本副本的身份。
 */
export function noteRuntimeCopy(copy: symbol = THIS_COPY): void {
  if (copy === THIS_COPY && thisCopyNoted) return;
  const registry = registryOf(true);
  registry.copies.add(copy);
  if (copy === THIS_COPY) thisCopyNoted = true;
  if (registry.copies.size > 1 && !registry.warned) {
    registry.warned = true;
    pendingCopyWarning = ReactiveErrorText.multipleCopiesWarning;
  }
}

/** 当前进程里已进入 Runtime/所有权正确性边界的副本数。单纯 import 不计数。 */
export const runtimeCopyCount = (): number => registryOf(false)?.copies.size ?? 0;

/**
 * 要求单副本，否则抛错。
 *
 * 给「宁可启动失败也不要静默陈旧数据」的应用用。库自身不调用它——是否可接受多副本 是部署决策，不是库能替调用方做的判断。
 */
export function assertSingleRuntimeCopy(): void {
  // 调用断言的只读副本也算一份；否则「另一份已登记 + 本副本未建 Runtime」会误判。
  noteRuntimeCopy();
  const registry = registryOf(true);
  if (registry.copies.size > 1) {
    throw createReactiveError(
      ReactiveErrorCode.copyConflict,
      ReactiveErrorText.expectedSingleCopy(registry.copies.size)
    );
  }
}

/** 仅供测试：清掉模拟出来的副本，避免用例之间互相影响。 */
export function resetRuntimeCopiesForTest(): void {
  Reflect.deleteProperty(globalThis, registryKey());
  thisCopyNoted = false;
}
