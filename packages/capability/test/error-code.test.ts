import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityErrorCode, createCapabilityHost, type ICapabilityHandle } from '../src/index';
import { CAPABILITY_SOURCE } from '../src/errors';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectSourceFiles(full));
    else if (entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const handleOf = (dispose = () => undefined): ICapabilityHandle => ({ dispose });

describe('M-T38 (§3.7.3): capability 码表触发点', () => {
  it('HOST_DISPOSED: dispose 后查询/注册', async () => {
    const host = createCapabilityHost<unknown>({});
    host.register({ name: 'a', activate: () => handleOf() });
    await host.dispose();
    expect(() => host.register({ name: 'b', activate: () => handleOf() })).toThrowError(
      expect.objectContaining({ code: CapabilityErrorCode.hostDisposed })
    );
  });

  it('NOT_REGISTERED: 查询未注册能力', () => {
    const host = createCapabilityHost<unknown>({});
    expect(() => host.state('missing')).toThrowError(
      expect.objectContaining({ code: CapabilityErrorCode.notRegistered })
    );
  });

  it('ALREADY_REGISTERED: 同名重复登记', () => {
    const host = createCapabilityHost<unknown>({});
    host.register({ name: 'a', activate: () => handleOf() });
    expect(() => host.register({ name: 'a', activate: () => handleOf() })).toThrowError(
      expect.objectContaining({ code: CapabilityErrorCode.alreadyRegistered })
    );
  });

  it('INVALID_NAME: 非字符串/空 name（TypeError）', () => {
    const host = createCapabilityHost<unknown>({});
    expect(() => host.register({ name: '' } as never)).toThrowError(
      expect.objectContaining({ code: CapabilityErrorCode.invalidName })
    );
    expect(() => host.register({ name: '' } as never)).toThrowError(TypeError);
  });

  it('INVALID_ACTIVATE: activate 非函数（TypeError）', () => {
    const host = createCapabilityHost<unknown>({});
    expect(() => host.register({ name: 'a', activate: 'not-a-function' } as never)).toThrowError(
      expect.objectContaining({ code: CapabilityErrorCode.invalidActivate })
    );
  });

  it('INVALID_HANDLE: activate 返回缺少 dispose 的 handle（结构化 failed 结果，TypeError）', async () => {
    const host = createCapabilityHost<unknown>({}, { flags: { a: true } });
    host.register({ name: 'a', activate: () => ({}) as ICapabilityHandle });
    await expect(host.enable('a')).resolves.toEqual({
      status: 'failed',
      error: expect.objectContaining({ code: CapabilityErrorCode.invalidHandle })
    });
    expect(host.state('a')).toBe('failed');
  });

  it('GATED: 开关为 false 时 enableResult 返回 {status:"gated"} 且不抛错', async () => {
    const host = createCapabilityHost<unknown>({}, { flags: { a: false } });
    host.register({ name: 'a', activate: () => handleOf() });
    await expect(host.enableResult('a')).resolves.toEqual({ status: 'gated' });
  });
});

describe('M-T41 (§3.7.5): capability 码表穷尽 + 单点声明', () => {
  const srcFiles = collectSourceFiles(srcDir);

  it('scans a non-trivial number of source files', () => {
    expect(srcFiles.length).toBeGreaterThan(2);
  });

  it('code values are unique and the table has 9 entries (§3.7.3 + INVALID_OPTION)', () => {
    const declared = Object.values(CapabilityErrorCode);
    expect(new Set(declared).size).toBe(declared.length);
    expect(declared).toHaveLength(9);
  });

  it('every throw site references CapabilityErrorCode instead of an inline literal', () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      if (file.endsWith('/error-code.ts')) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const code of Object.values(CapabilityErrorCode)) {
        if (new RegExp(`['"\`]${code}['"\`]`).test(source)) {
          offenders.push(`${relative(srcDir, file)}: inline '${code}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no source module outside errors.ts still throws an untagged built-in error', () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      if (file.endsWith('/errors.ts') || file.endsWith('/error-code.ts')) continue;
      const source = readFileSync(file, 'utf8');
      const bare = /throw new (Error|TypeError|RangeError|AggregateError)\(/.exec(source);
      if (bare) offenders.push(`${relative(srcDir, file)}: ${bare[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('tagged errors carry source === "@migaia/capability" and non-empty stack', async () => {
    const host = createCapabilityHost<unknown>({});
    await host.dispose();
    let caught: unknown;
    try {
      host.state('a');
    } catch (error) {
      caught = error;
    }
    expect((caught as { source?: string }).source).toBe(CAPABILITY_SOURCE);
    expect((caught as Error).stack).toBeTruthy();
  });
});
