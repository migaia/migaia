import type { IDisposable } from './types';
import { LifecycleScopeImpl } from './lifecycle-primitives';

// Scope 只负责「所有权」——一组资源的集中释放。Store 把内部 Computed/Effect/wasm 字段归入一个 Scope，
// $dispose() 即 scope.dispose()，一次性释放整棵。
export class Scope extends LifecycleScopeImpl implements IDisposable {
  get disposed(): boolean {
    return this.lifecycle === 'terminal';
  }

  // 登记资源；已释放的 Scope 立即释放传入资源并抛错
  own<T extends IDisposable>(resource: T): T {
    return super.own(resource);
  }

  // 从 Scope 解除登记（资源已被单独 dispose 时调用），避免长期反复 own/dispose 造成滞留泄漏
  release(resource: IDisposable): boolean {
    return super.release(resource);
  }

  dispose(): void {
    super.dispose();
  }

  disposeAsync(): Promise<void> {
    return super.disposeAsync();
  }
}
