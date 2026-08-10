import { describe, expect, it } from 'vitest';

/**
 * `src/rpc` 要能独立发布：依赖方向必须是单向的 `store -> rpc`。这个文件只守 一件事——`src/rpc` 内部任何文件都不得 import
 * `src/store`（相对路径穿出去， 或走 `@/store` 别名）。用 `import.meta.glob` 读源码文本，不用 Node `fs`——
 * 这个包要能在纯浏览器构建里被独立引用，检查它自己的工具也不该反过来依赖 Node 专属 API（这条本身就是本文件要断言的同一件事的一个实例）。
 */
const SOURCES = import.meta.glob(['./**/*.ts', './**/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

/** 覆盖具名/默认/命名空间/副作用四种 import 形态——任何一种都能把跨包依赖悄悄带回来。 */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /export\s+[^'"]*from\s+['"]([^'"]+)['"]/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

describe('src/rpc 边界：不得依赖 src/store', () => {
  it('no file imports from ../store or @/store', () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) continue;
      for (const specifier of importSpecifiers(source)) {
        if (
          specifier.includes('/store/') ||
          specifier.endsWith('/store') ||
          specifier.startsWith('@/store')
        ) {
          offenders.push(`${path} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the glob actually found source files (guards against a silently-empty scan)', () => {
    const nonTestFiles = Object.keys(SOURCES).filter(
      (path) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx')
    );
    expect(nonTestFiles.length).toBeGreaterThan(5);
  });
});
