import { activateHostHandle } from './fixtures/host-cleanup.ts'
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CapabilityErrorCode, createCapabilityHost, type ICapabilityHandle } from '../src/index.ts'
import { CAPABILITY_SOURCE, createCapabilityError } from '../src/errors.ts'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

/** Captured source inventory is shared by unchanged code-table assertions. */
const srcFiles = collectSourceFiles(srcDir)

function collectSourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...collectSourceFiles(full))
    else if (entry.endsWith('.ts')) found.push(full)
  }
  return found
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const handleOf = (dispose = () => undefined): ICapabilityHandle => ({ dispose })

describe('capability 码表触发点', () => {
  it('HOST_DISPOSED: dispose 后查询/注册', verifyHOSTDISPOSEDDispose)

  it('NOT_REGISTERED: 查询未注册能力', verifyNOTREGISTERED)

  it('ALREADY_REGISTERED: 同名重复登记', verifyALREADYREGISTERED)

  it('INVALID_NAME: 非字符串/空 name（TypeError）', verifyINVALIDNAMENameTypeError)

  it('INVALID_ACTIVATE: activate 非函数（TypeError）', verifyINVALIDACTIVATEActivateTypeError)

  it(
    'INVALID_HANDLE: activate 返回缺少 dispose 的 handle（结构化 failed 结果，TypeError）',
    verifyINVALIDHANDLEActivateDisposeHandleFailedTypeError
  )

  it(
    'GATED: 开关为 false 时 enable 返回 {status:"gated"} 且不抛错',
    verifyGATEDFalseEnableStatusGated
  )
})

describe('capability 码表穷尽 + 单点声明', () => {
  it('scans a non-trivial number of source files', verifyScansANonTrivialNumberOfSourceFiles)

  it(
    'does not expose the pre-extraction store message prefix',
    verifyDoesNotExposeThePreExtractionStoreMessagePrefix
  )

  it(
    'code values are unique and the table has 9 entries (capability codes + INVALID_OPTION)',
    verifyCodeValuesAreUniqueAndTheTableHas9EntriesCapabilityCodesINVALIDOPTION
  )

  it(
    'every throw site references CapabilityErrorCode instead of an inline literal',
    verifyEveryThrowSiteReferencesCapabilityErrorCodeInsteadOfAnInlineLiteral
  )

  it(
    'no source module outside errors.ts still throws an untagged built-in error',
    verifyNoSourceModuleOutsideErrorsTsStillThrowsAnUntaggedBuiltInError
  )

  it(
    'tagged errors carry source === "capability" and non-empty stack',
    verifyTaggedErrorsCarrySourceCapabilityAndNonEmptyStack
  )

  it(
    'shared attachment preserves native error identity, cause, and stack',
    verifySharedAttachmentPreservesNativeErrorIdentityCauseAndStack
  )
})

/** Executes the existing case: HOST_DISPOSED: dispose 后查询/注册. */
async function verifyHOSTDISPOSEDDispose(): Promise<void> {
  const host = createCapabilityHost<unknown>({})
  host.register({ name: 'a', activate: () => handleOf() })
  await host.dispose()
  expect(() => host.register({ name: 'b', activate: activateHostHandle })).toThrowError(
    expect.objectContaining({ code: CapabilityErrorCode.hostDisposed })
  )
}

/** Executes the existing case: NOT_REGISTERED: 查询未注册能力. */
function verifyNOTREGISTERED(): void {
  const host = createCapabilityHost<unknown>({})
  expect(() => host.state('missing')).toThrowError(
    expect.objectContaining({ code: CapabilityErrorCode.notRegistered })
  )
}

/** Executes the existing case: ALREADY_REGISTERED: 同名重复登记. */
function verifyALREADYREGISTERED(): void {
  const host = createCapabilityHost<unknown>({})
  host.register({ name: 'a', activate: () => handleOf() })
  expect(() => host.register({ name: 'a', activate: activateHostHandle })).toThrowError(
    expect.objectContaining({ code: CapabilityErrorCode.alreadyRegistered })
  )
}

/** Executes the existing case: INVALID_NAME: 非字符串/空 name（TypeError）. */
function verifyINVALIDNAMENameTypeError(): void {
  const host = createCapabilityHost<unknown>({})
  expect(() => host.register({ name: '' } as never)).toThrowError(
    expect.objectContaining({ code: CapabilityErrorCode.invalidName })
  )
  expect(() => host.register({ name: '' } as never)).toThrowError(TypeError)
}

/** Executes the existing case: INVALID_ACTIVATE: activate 非函数（TypeError）. */
function verifyINVALIDACTIVATEActivateTypeError(): void {
  const host = createCapabilityHost<unknown>({})
  expect(() => host.register({ name: 'a', activate: 'not-a-function' } as never)).toThrowError(
    expect.objectContaining({ code: CapabilityErrorCode.invalidActivate })
  )
}

/**
 * Executes the existing case: INVALID_HANDLE: activate 返回缺少 dispose 的 handle（结构化 failed
 * 结果，TypeError）.
 */
async function verifyINVALIDHANDLEActivateDisposeHandleFailedTypeError(): Promise<void> {
  const host = createCapabilityHost<unknown>({}, { flags: { a: true } })
  host.register({ name: 'a', activate: () => ({}) as ICapabilityHandle })
  await expect(host.enable('a')).resolves.toEqual({
    status: 'failed',
    error: expect.objectContaining({ code: CapabilityErrorCode.invalidHandle })
  })
  expect(host.state('a')).toBe('failed')
}

/** Executes the existing case: GATED: 开关为 false 时 enable 返回 {status:"gated"} 且不抛错. */
async function verifyGATEDFalseEnableStatusGated(): Promise<void> {
  const host = createCapabilityHost<unknown>({}, { flags: { a: false } })
  host.register({ name: 'a', activate: () => handleOf() })
  await expect(host.enable('a')).resolves.toEqual({ status: 'gated' })
}

/** Executes the existing case: scans a non-trivial number of source files. */
function verifyScansANonTrivialNumberOfSourceFiles(): void {
  expect(srcFiles.length).toBeGreaterThan(2)
}

/** Executes the existing case: does not expose the pre-extraction store message prefix. */
function verifyDoesNotExposeThePreExtractionStoreMessagePrefix(): void {
  expect(srcFiles.flatMap((file) => readFileSync(file, 'utf8')).join('\n')).not.toContain(
    ['[', 'store', ']'].join('')
  )
}

/**
 * Executes the existing case: code values are unique and the table has 9 entries (capability codes
 * + INVALID_OPTION).
 */
function verifyCodeValuesAreUniqueAndTheTableHas9EntriesCapabilityCodesINVALIDOPTION(): void {
  const declared = Object.values(CapabilityErrorCode)
  expect(new Set(declared).size).toBe(declared.length)
  expect(declared).toHaveLength(9)
}

/**
 * Executes the existing case: every throw site references CapabilityErrorCode instead of an inline
 * literal.
 */
function verifyEveryThrowSiteReferencesCapabilityErrorCodeInsteadOfAnInlineLiteral(): void {
  const offenders: string[] = []
  for (const file of srcFiles) {
    if (file.endsWith('/error-code.ts')) continue
    const source = stripComments(readFileSync(file, 'utf8'))
    for (const code of Object.values(CapabilityErrorCode)) {
      if (new RegExp(`['"\`]${code}['"\`]`).test(source)) {
        offenders.push(`${relative(srcDir, file)}: inline '${code}'`)
      }
    }
  }
  expect(offenders).toEqual([])
}

/**
 * Executes the existing case: no source module outside errors.ts still throws an untagged built-in
 * error.
 */
function verifyNoSourceModuleOutsideErrorsTsStillThrowsAnUntaggedBuiltInError(): void {
  const offenders: string[] = []
  for (const file of srcFiles) {
    if (file.endsWith('/errors.ts') || file.endsWith('/error-code.ts')) continue
    const source = readFileSync(file, 'utf8')
    const bare = /throw new (Error|TypeError|RangeError|AggregateError)\(/.exec(source)
    if (bare) offenders.push(`${relative(srcDir, file)}: ${bare[0]}`)
  }
  expect(offenders).toEqual([])
}

/** Executes the existing case: tagged errors carry source === "capability" and non-empty stack. */
async function verifyTaggedErrorsCarrySourceCapabilityAndNonEmptyStack(): Promise<void> {
  const host = createCapabilityHost<unknown>({})
  await host.dispose()
  let caught: unknown
  try {
    host.state('a')
  } catch (error) {
    caught = error
  }
  expect((caught as { source?: string }).source).toBe(CAPABILITY_SOURCE)
  expect((caught as Error).stack).toBeTruthy()
}

/** Executes the existing case: shared attachment preserves native error identity, cause, and stack. */
function verifySharedAttachmentPreservesNativeErrorIdentityCauseAndStack(): void {
  const cause = new Error('cause')
  const error = createCapabilityError('TEST_CODE', 'message', { cause })
  expect(error).toBeInstanceOf(Error)
  expect(error.source).toBe(CAPABILITY_SOURCE)
  expect(error.code).toBe('TEST_CODE')
  expect(error.cause).toBe(cause)
  expect(error.stack).toBeTruthy()
}
