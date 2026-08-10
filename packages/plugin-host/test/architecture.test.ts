import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = new URL('../src/', import.meta.url).pathname;

const filesUnder = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
};

const filesUnderModule = async (name: string): Promise<string[]> => {
  const file = join(sourceRoot, `${name}.ts`);
  try {
    if ((await stat(file)).isFile()) return [file];
  } catch {
    // Fall through to the legacy directory layout.
  }
  return filesUnder(join(sourceRoot, name));
};

describe('architecture boundaries', () => {
  it('keeps internal lower layers independent from the facade and platform adapters', async () => {
    const files = [];
    for (const module of ['config', 'core', 'disposal', 'extension', 'pipeline', 'registry'])
      files.push(...(await filesUnderModule(module)));
    const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
    expect(source).not.toMatch(/from\s+['"].*plugin-host['"]|from\s+['"].*store\//);
    expect(source).not.toMatch(
      /(?:node:|bun:|electron|\b(?:window|document|process|Buffer|Deno|Bun)\b)/
    );
  });
});
