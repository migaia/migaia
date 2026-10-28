import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** Stable public error messages belong to canonical text modules rather than implementation sites. */
function canonicalTexts(): void {
  /** Moved implementations must continue using their package-owned text constants. */
  const sources = [
    readFileSync(new URL('../../src/http.ts', import.meta.url), 'utf8'),
    readFileSync(new URL('../../../log-plugin-process/src/process.ts', import.meta.url), 'utf8'),
    readFileSync(new URL('../../../log-plugin-process/src/group.ts', import.meta.url), 'utf8')
  ].join('\n')
  for (const text of [
    '[logger] process runtime is shutting down',
    '[logger] process plugin already installed with different configuration',
    '[logger] http 日志序列化失败',
    '[logger] HTTP transport is unavailable in this runtime',
    '未捕获异常，进程即将退出',
    '未处理的 Promise rejection，进程即将退出'
  ]) {
    // These six pre-existing public messages are a compile-time bounded contract inventory.
    expect(sources).not.toContain(text)
  }
}
it('keeps stable public error text out of logger implementation modules', canonicalTexts)
