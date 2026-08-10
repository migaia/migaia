import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = new URL('../src/', import.meta.url);
const distRoot = new URL('../dist/', import.meta.url);

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
};

describe('runtime purity', () => {
  it('keeps every production source free of platform-only references', async () => {
    const source = (
      await Promise.all(
        (await sourceFiles(sourceRoot.pathname)).map((file) => readFile(file, 'utf8'))
      )
    ).join('\n');
    expect(source).not.toMatch(/(?:from|import\()\s*['"](?:node:|bun:|jsr:)/);
    expect(source).not.toMatch(/\b(?:Bun|Deno|process|Buffer|window|document)\s*[.(]/);
    expect(source).not.toMatch(/(?:from|import\()\s*['"]electron(?:[/'"]|$)/);
    expect(source).not.toContain('AsyncLocalStorage');
  });

  it('keeps emitted declarations free of platform-only references', async () => {
    const declarationFiles = (await sourceFiles(distRoot.pathname)).filter((file) =>
      file.endsWith('.d.ts')
    );
    expect(declarationFiles.length).toBeGreaterThan(0);
    const declarations = (
      await Promise.all(declarationFiles.map((file) => readFile(file, 'utf8')))
    ).join('\n');
    expect(declarations).not.toMatch(/(?:from|import\()\s*['"](?:node:|bun:|jsr:)/);
    expect(declarations).not.toMatch(/\b(?:Bun|Deno|process|Buffer|window|document)\s*[.(]/);
    expect(declarations).not.toMatch(/(?:from|import\()\s*['"]electron(?:[/'"]|$)/);
  });
});
