import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseConfigPath, readConfigPath } from '../src/config';

describe('PluginHost configuration properties', () => {
  it('reads arbitrary non-negative array indexes through the public path grammar', () => {
    fc.assert(
      fc.property(fc.nat({ max: 32 }), fc.string(), (index, value) => {
        const config = { records: Array.from({ length: index + 1 }, () => ({ value })) };
        const path = parseConfigPath(`plugin.records.[${index}].value`);
        expect(readConfigPath(config, path)).toBe(value);
      })
    );
  });

  it('copies only the selected object level', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const nested = { value };
        const config = { options: { nested } };
        const result = readConfigPath(config, parseConfigPath('plugin.options')) as {
          nested: typeof nested;
        };
        expect(result).not.toBe(config.options);
        expect(result.nested).toBe(nested);
      })
    );
  });
});
