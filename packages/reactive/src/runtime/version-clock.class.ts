import { createReactiveError, tagReactiveError } from '../errors.js';
import { ReactiveErrorCode } from '../error-code.js';
import { ReactiveErrorText } from '../error-text.js';

// 单调版本时钟：memo 失效判定、脏检查短路、时间旅行锚点都靠同一个递增计数器。
export class VersionClock {
  #version = 0;
  #maxVersion: number;

  /**
   * 生产上限是 `Number.MAX_SAFE_INTEGER`。即使持续每秒产生一百万个真实变更，也要 约 285 年才耗尽。原地归零会与仍存活节点的旧版本碰撞并制造漏更新，因此耗尽 后故意
   * fail-stop；恢复方式是释放 Store / Scope 持有的节点、丢弃旧 Runtime，再新建一份，而不是重置同一张依赖图。终态断边不领取版本，所以时钟耗尽不妨碍清理。
   *
   * `maxVersion` 仅用于把终态缩小后做确定性测试，Runtime 不覆盖默认值。
   */
  constructor(maxVersion = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(maxVersion) || maxVersion < 1) {
      throw tagReactiveError(
        new RangeError(ReactiveErrorText.maximumReactiveVersionInvalid),
        ReactiveErrorCode.invalidOption
      );
    }
    this.#maxVersion = maxVersion;
  }

  /** 领取下一个版本号——signal/computed 的值真的变了就调一次 */
  next(): number {
    if (this.#version >= this.#maxVersion) {
      throw createReactiveError(
        ReactiveErrorCode.versionExhausted,
        ReactiveErrorText.versionClockExhausted
      );
    }
    return ++this.#version;
  }

  /** 当前版本号——只读查看，不消耗 */
  current(): number {
    return this.#version;
  }
}
