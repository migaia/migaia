import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PluginHostErrorCode } from '../src/typing';

describe('PluginHost public error-code documentation', () => {
  it('documents every exported error code in README and USEGUIDE', async () => {
    const [readme, useguide] = await Promise.all([
      readFile(new URL('../README.md', import.meta.url), 'utf8'),
      readFile(new URL('../USEGUIDE.md', import.meta.url), 'utf8')
    ]);
    for (const code of Object.values(PluginHostErrorCode)) {
      expect(readme).toContain(code);
      expect(useguide).toContain(code);
    }
  });
});
