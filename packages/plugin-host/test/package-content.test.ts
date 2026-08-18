import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

type IPackageManifest = {
  readonly files?: readonly string[];
};

/** Check declared package content and README links without invoking pack or publish. */
const readPackageContent = async (): Promise<{
  readonly files: ReadonlySet<string>;
  readonly readme: string;
}> => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  ) as IPackageManifest;
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  return { files: new Set(packageJson.files ?? []), readme };
};

describe('plugin-host package content', () => {
  it('declares USEGUIDE and keeps README relative links inside published files', async () => {
    const { files, readme } = await readPackageContent();
    expect(files.has('README.md')).toBe(true);
    expect(files.has('USEGUIDE.md')).toBe(true);

    const links = [...readme.matchAll(/\]\((\.\/[^)#]+)(?:#[^)]*)?\)/g)].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const packageFile = link.slice(2);
      expect(files.has(packageFile)).toBe(true);
      await access(new URL(`../${packageFile}`, import.meta.url));
    }
  });
});
