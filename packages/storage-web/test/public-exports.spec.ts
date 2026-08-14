import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as storageWeb from '../src/index';

/**
 * `docs/store/public-exports.baseline.json` 记录跨包公开面基线，移除任何 导出都要求一次显式的兼容性决定。这条测试是仓库里第一次真正把这份 JSON
 * 钉到某个包的实际导出上——此前它只是文档，没有任何测试读取过它。
 *
 * 用 process.cwd() 而不是 import.meta.url：vitest 在 jsdom environment 下 转换后的 import.meta.url 不总是真实
 * file:// scheme，new URL() 会抛错； vitest 的 cwd 固定是本包根目录（vitest.config.ts 所在处），足够可靠。
 */
const baselinePath = resolve(process.cwd(), '../../docs/store/public-exports.baseline.json');

describe('public exports baseline', () => {
  it('实际运行时导出与 baseline 完全一致（新增/移除导出都需要同步更新 baseline）', () => {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      packages: Record<string, Record<string, string[]>>;
    };
    const recorded = baseline.packages['@migaia/storage-web']?.['.'];
    expect(recorded).toBeDefined();

    const actual = Object.keys(storageWeb).sort();
    expect(actual).toEqual([...recorded!].sort());
  });
});
