import type { IWebStorageLike } from '../types/storage.js';

/**
 * 探测一个 Storage 对象是否真的可用。
 *
 * Safari 隐私模式下 `localStorage`/`sessionStorage` 对象存在， `setItem` 却会抛异常（旧版本是 SecurityError，新版本是
 * quota=0 的 QuotaExceededError）。唯一可靠的探测方式是真的写一次再删掉。
 */
export const probeWebStorage = (
  storage: IWebStorageLike | undefined,
  probeKey = '__storage_web_probe__',
  onFailure?: (cause: unknown) => void
): boolean => {
  if (!storage) return false;
  let activeProbeKey = probeKey;
  let previousValue: string | null = null;
  let available = false;
  try {
    previousValue = storage.getItem(probeKey);
    if (previousValue !== null) {
      activeProbeKey = `${probeKey}:${Date.now().toString(36)}:${Math.random()
        .toString(36)
        .slice(2)}`;
      previousValue = null;
    }
    storage.setItem(activeProbeKey, '1');
    available = true;
  } catch (cause) {
    onFailure?.(cause);
    available = false;
  } finally {
    try {
      if (previousValue === null) storage.removeItem(activeProbeKey);
      else storage.setItem(activeProbeKey, previousValue);
    } catch (cause) {
      // Probe failures are reported by the boolean result; never leak a raw DOM exception.
      onFailure?.(cause);
      available = false;
    }
  }
  return available;
};
