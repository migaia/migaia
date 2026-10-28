import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { formatFeature } from '@migaia/log-host/features'
import { consolePlugin, prettyFeature } from '../src/index.ts'
import { MemoryConsole, MemoryStdout } from './fixtures.ts'

/** A formatting fixture names the environment and injected terminal independently. */
type IFormatCase = {
  name: string
  format?: string
  ci?: string
  tty: boolean
  expected: 'json' | 'pretty'
}

/** Preserve automatic output precedence without treating an invalid format as plain. */
async function automaticFormat(fixture: IFormatCase): Promise<void> {
  vi.stubEnv('LOG_FORMAT', fixture.format)
  vi.stubEnv('CI', fixture.ci)
  vi.stubEnv('NO_COLOR', undefined)
  vi.stubEnv('FORCE_COLOR', undefined)
  /** A private borrowed console captures the selected final format. */
  const console = new MemoryConsole()
  /** The injected terminal capability participates in auto detection. */
  const stdout = new MemoryStdout(fixture.tty)
  /** No explicit format policy should override this fixture's auto fallback. */
  const host = createLogHost({ plugins: [consolePlugin({ console, stdout })] })
  try {
    host.log('info', 'automatic')
    await host.flush()
    expect(console.logs).toHaveLength(1)
    /** Native pretty has its established prefix; JSON remains an ordinary serialized entry. */
    const text = String(console.logs[0][0])
    if (fixture.expected === 'json') {
      expect(JSON.parse(text).message).toBe('automatic')
      expect(text).not.toContain('\u001b[')
    } else expect(text).toContain('[INFO]')
  } finally {
    await host.shutdown('manual')
    vi.unstubAllEnvs()
  }
}
it.each<IFormatCase>([
  { name: 'json overrides CI and TTY', format: 'json', ci: '1', tty: true, expected: 'json' },
  { name: 'pretty overrides no CI or TTY', format: 'pretty', tty: false, expected: 'pretty' },
  { name: 'CI selects pretty', ci: '1', tty: false, expected: 'pretty' },
  { name: 'TTY selects pretty', tty: true, expected: 'pretty' },
  { name: 'plain pipe selects json', tty: false, expected: 'json' },
  {
    name: 'invalid env falls through to CI',
    format: 'plain',
    ci: '1',
    tty: false,
    expected: 'pretty'
  },
  { name: 'invalid env without CI stays json', format: 'other', tty: false, expected: 'json' }
])('preserves automatic format precedence: $name', automaticFormat)

/** Host and output formats override fallback without console duplicating host scope resolution. */
async function explicitFormats(): Promise<void> {
  vi.stubEnv('LOG_FORMAT', 'pretty')
  vi.stubEnv('CI', '1')
  /** Each console observes one independently selected format. */
  const hostConsole = new MemoryConsole()
  /** The host-level JSON feature wins over auto pretty. */
  const first = createLogHost({
    features: [formatFeature({ format: 'json' })],
    plugins: [consolePlugin({ console: hostConsole })]
  })
  /** Output-level plain wins over the host's JSON and the output's pretty fallback. */
  const plainConsole = new MemoryConsole()
  /** Distinct hosts avoid duplicate same-name output registration. */
  const second = createLogHost({
    features: [formatFeature({ format: 'json' })],
    plugins: [
      consolePlugin({ console: plainConsole, features: [formatFeature({ format: 'plain' })] })
    ]
  })
  /** Output-level pretty is recognized by the owner of this exact issued descriptor. */
  const prettyConsole = new MemoryConsole()
  /** Native arguments are deliberately distinct from JSON text. */
  const third = createLogHost({
    features: [formatFeature({ format: 'json' })],
    plugins: [
      consolePlugin({
        console: prettyConsole,
        features: [prettyFeature({ color: 'never', timestamp: false })]
      })
    ]
  })
  try {
    first.log('info', 'json')
    second.log('info', 'plain')
    third.log('info', 'native', { marker: true })
    await Promise.all([first.flush(), second.flush(), third.flush()])
    expect(JSON.parse(String(hostConsole.logs[0][0])).message).toBe('json')
    expect(String(plainConsole.logs[0][0])).toContain('[INFO] plain')
    expect(prettyConsole.logs[0]).toEqual(['[INFO] native', { marker: true }])
  } finally {
    await first.shutdown('manual')
    await second.shutdown('manual')
    await third.shutdown('manual')
    vi.unstubAllEnvs()
  }
}
it('consumes output-over-host-over-fallback formatting without guessing text', explicitFormats)

/** Every supported color priority is observed independently from automatic format selection. */
type IColorCase = {
  name: string
  color: 'auto' | 'always' | 'never'
  noColor?: string
  force?: string
  tty: boolean
  ci?: string
  ansi: boolean
}

/** The renderer and its explicit Ansis level must agree on the selected ANSI policy. */
async function colorPriority(fixture: IColorCase): Promise<void> {
  vi.stubEnv('LOG_FORMAT', undefined)
  vi.stubEnv('NO_COLOR', fixture.noColor)
  vi.stubEnv('FORCE_COLOR', fixture.force)
  vi.stubEnv('CI', fixture.ci)
  /** An injected output isolates TTY policy from the test runner's terminal. */
  const console = new MemoryConsole()
  /** Native pretty is the only path that is expected to carry ANSI. */
  const host = createLogHost({
    plugins: [
      consolePlugin({
        console,
        stdout: new MemoryStdout(fixture.tty),
        features: [prettyFeature({ color: fixture.color, timestamp: false })]
      })
    ]
  })
  try {
    host.log('info', 'color')
    await host.flush()
    expect(String(console.logs[0][0]).includes('\u001b[')).toBe(fixture.ansi)
  } finally {
    await host.shutdown('manual')
    vi.unstubAllEnvs()
  }
}
it.each<IColorCase>([
  { name: 'always wins NO_COLOR', color: 'always', noColor: '1', tty: false, ansi: true },
  { name: 'never wins FORCE_COLOR', color: 'never', force: '1', tty: true, ci: '1', ansi: false },
  {
    name: 'NO_COLOR wins FORCE_COLOR',
    color: 'auto',
    noColor: '1',
    force: '1',
    tty: true,
    ansi: false
  },
  { name: 'nonzero FORCE_COLOR enables color', color: 'auto', force: '1', tty: false, ansi: true },
  {
    name: 'zero FORCE_COLOR does not enable color',
    color: 'auto',
    force: '0',
    tty: false,
    ansi: false
  },
  { name: 'TTY enables color', color: 'auto', tty: true, ansi: true },
  { name: 'CI enables color', color: 'auto', ci: '1', tty: false, ansi: true },
  { name: 'pipe without hints stays plain', color: 'auto', tty: false, ansi: false }
])('preserves color precedence: $name', colorPriority)
