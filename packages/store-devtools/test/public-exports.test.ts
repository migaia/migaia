import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type IBaseline = { packages: Record<string, Record<string, string[]>> };

const packageDirs = [
  'store-devtools',
  'store-indexed',
  'store-keyed',
  'store-light',
  'store-middleware',
  'store-persist',
  'store-react',
  'store-shared',
  'store-ssr',
  'store-wasm',
  'store-worker'
] as const;

describe('Store public export baseline', () => {
  const require = createRequire(import.meta.url);
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  it('matches runtime root and declared adapter subpath exports', async () => {
    const baseline = JSON.parse(
      await readFile(resolve(repositoryRoot, 'docs/store/public-exports.baseline.json'), 'utf8')
    ) as IBaseline;
    for (const dir of packageDirs) {
      const packageName = `@migaia/${dir}`;
      const root = await import(
        pathToFileURL(resolve(repositoryRoot, `packages/${dir}/dist/index.js`)).href
      );
      expect(Object.keys(root).sort()).toEqual(
        (baseline.packages[packageName]?.['.'] ?? []).sort()
      );
      for (const subpath of Object.keys(baseline.packages[packageName] ?? {}).filter(
        (path) => path !== '.'
      )) {
        const entry =
          subpath === './light'
            ? 'light-index'
            : subpath === './indexed'
              ? 'indexed-index'
              : 'keyed-index';
        const module = await import(
          pathToFileURL(resolve(repositoryRoot, `packages/${dir}/dist/${entry}.js`)).href
        );
        expect(Object.keys(module).sort()).toEqual(baseline.packages[packageName][subpath].sort());
      }
    }
  });

  it('rejects representative internal paths after wildcard removal', async () => {
    for (const specifier of [
      '@migaia/store-keyed/reactive/family',
      '@migaia/store-light/store-resource-ownership',
      '@migaia/store-react/provider-registry'
    ]) {
      expect(() => require(specifier)).toThrow();
    }
  });
});
