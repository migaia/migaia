import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('runtime-neutral boundary', () => {
  it('ES-T12 ships one side-effect-free root without workspace runtime dependencies', () => {
    const packageRoot = resolve(import.meta.dirname, '..');
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      readonly sideEffects?: boolean;
      readonly dependencies?: Record<string, string>;
      readonly exports?: Record<string, unknown>;
    };
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.']);
  });

  it('ES-T17 confines host scheduler access to the terminal adapter', () => {
    const sourceRoot = resolve(import.meta.dirname, '../src');
    const sourceFiles = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = resolve(directory, entry.name);
        return entry.isDirectory()
          ? sourceFiles(entryPath)
          : entry.name.endsWith('.ts')
            ? [entryPath]
            : [];
      });
    const source = sourceFiles(sourceRoot).map((filePath) => ({
      filePath,
      text: readFileSync(filePath, 'utf8')
    }));
    const coreSource = source
      .filter(({ filePath }) => !filePath.endsWith('/internal/terminal-runtime.ts'))
      .map(({ text }) => text)
      .join('\n');
    const terminalSource = source.find(({ filePath }) =>
      filePath.endsWith('/internal/terminal-runtime.ts')
    )?.text;
    expect(coreSource).not.toMatch(/from ['"](?:[^'"]*lifecycle|[^'"]*reactive|[^'"]*resource)/);
    expect(coreSource).not.toMatch(/from ['"]node:/);
    expect(coreSource).not.toMatch(/queueMicrotask|setTimeout|Date\.now|performance\.now/);
    expect(terminalSource ?? '').toContain('queueMicrotask');
  });

  it('ES-T24 keeps event fan-out independent from middleware execution', () => {
    const packageRoot = resolve(import.meta.dirname, '..');
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@migaia/middleware-pipeline');
    const sourceRoot = resolve(import.meta.dirname, '../src');
    const source = readFileSync(resolve(sourceRoot, 'index.ts'), 'utf8');
    expect(source).not.toContain('middleware-pipeline');
  });

  it('ES-T25 keeps heavy lifecycle ownership outside the package runtime graph', () => {
    const packageRoot = resolve(import.meta.dirname, '..');
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@migaia/lifecycle');
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@migaia/event-dispatcher');
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('@migaia/lifecycle');
  });

  it('ES-T27 keeps pipeline and generator control flow out of the public root', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/index.ts'), 'utf8');
    expect(source).not.toMatch(/waterfall|next\(|generator|middleware/);
  });

  it('ES-T13 keeps registration removal structural rather than scan-based', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/channel.ts'), 'utf8');
    expect(source).not.toMatch(/\.indexOf\(|\.find\(|\.filter\(/);
    expect(source).toContain('owner.previous');
    expect(source).toContain('owner.next');
  });

  it('ES-T51 gives every package test a stable ES-T identifier', () => {
    const testRoot = resolve(import.meta.dirname);
    const testFiles = readdirSync(testRoot)
      .filter((entry) => entry.endsWith('.test.ts'))
      .map((entry) => readFileSync(resolve(testRoot, entry), 'utf8'));
    const testNames = testFiles.flatMap((source) => source.match(/it\('([^']+)'/g) ?? []);
    expect(testNames.length).toBeGreaterThan(0);
    expect(testNames.every((name) => /it\('ES-T\d+ /.test(name))).toBe(true);
    const ids = testNames.map((name) => name.match(/it\('(ES-T\d+) /)?.[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
