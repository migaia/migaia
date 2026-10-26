/** A28 public warning subscriptions observe real trusted native parent admission. */
import { expect, expectTypeOf, it, vi } from 'vitest'
import {
  createRpcHost,
  RpcWarningCode,
  type IRpcHost,
  type IRpcHostOptions,
  type IRpcWarning
} from '@migaia/rpc-host'
import { defineFlowFeature, defineFlowPlugin, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { errorMap } from '@migaia/rpc-host/plugins/error-map'
import type { IRpcTransportContext } from '@migaia/rpc-contract/interfaces'
import { MemoryCarrier } from '../fixtures/core-carrier.js'
import { coreMemoryServer } from './core-fixture.js'

/** One physical pair lends actual native startup facts to the unchanged public Host constructor. */
class WarningPair {
  /** The existing native listener owns the parent Session and its public echo provider. */
  readonly #server = coreMemoryServer('warning-parent')
  /** The original linked endpoint carries actual parent-side handshake traffic. */
  readonly #parentCarrier = new MemoryCarrier('warning-parent-source')
  /** The child endpoint is admitted through its genuine SDK transport context. */
  readonly #childCarrier = new MemoryCarrier('warning-child-source')
  /** Only successfully opened public parent roots enter cleanup. */
  #parent: IRpcHost | undefined
  /** Public child construction owns all warning subscriptions and the accepted identity. */
  #child: IRpcHost | undefined
  /** An unnamed parent supplies only the instance assignment, leaving default naming to Host. */
  readonly #parentNamed: boolean
  /** A second real namespace may repeat the same parent assignment without its optional name. */
  readonly #repeatAssignment: boolean
  /** This separate namespace owns its independent parent-side native attachment. */
  readonly #otherServer = coreMemoryServer('warning-parent', 'warning-parent', 'other')
  /** Repeated identity facts arrive through a distinct genuine physical source. */
  readonly #otherParent = new MemoryCarrier('warning-other-parent')
  /** The second child endpoint never shares a carrier identity or native listener with the first. */
  readonly #otherChild = new MemoryCarrier('warning-other-child')

  /** Link the maintained real carrier fixture before either endpoint subscribes. */
  constructor(parentNamed = true, repeatAssignment = false) {
    this.#parentNamed = parentNamed
    this.#repeatAssignment = repeatAssignment
    this.#parentCarrier.link(this.#childCarrier)
    this.#childCarrier.link(this.#parentCarrier)
    this.#otherParent.link(this.#otherChild)
    this.#otherChild.link(this.#otherParent)
  }

  /** Complete original native setup before exercising the public child namespace. */
  async open(
    options: Pick<IRpcHostOptions, 'onWarning' | 'report'> &
      Partial<Pick<IRpcHostOptions, 'plugins' | 'self'>>,
    configuredSelf = true
  ): Promise<void> {
    this.#parent = await createRpcHost({
      ...this.#server.options,
      plugins: [
        this.#server.transport,
        ...(this.#repeatAssignment ? [this.#otherServer.transport] : [])
      ],
      provide: { echo: (value) => value }
    })
    this.#child = await createRpcHost({
      ...options,
      ...(configuredSelf
        ? { self: options.self ?? { name: 'math-child', instanceId: 'configured-child' } }
        : {}),
      plugins: [
        ...(options.plugins ?? []),
        defineTransportPlugin({
          name: 'warning-child-native',
          namespace: 'memory',
          open: this.#connect
        }),
        ...(this.#repeatAssignment
          ? [
              defineTransportPlugin({
                name: 'warning-other-native',
                namespace: 'other',
                open: this.#connectOther
              })
            ]
          : [])
      ]
    })
  }

  /** Business success proves warning delivery never replaces successful construction or calls. */
  send(value: number): Promise<unknown> {
    return this.#child!.memory.send('warning-parent', 'echo', value)
  }

  /** The public child identity is inspected after the actual native handshake completes. */
  get self() {
    return this.#child!.self
  }

  /** Preserve both public roots' original close owners on success and assertion failure. */
  async close(): Promise<void> {
    await Promise.all([this.#child?.close(), this.#parent?.close()])
  }

  /** Trusted startup facts enter only through the genuine native SDK attachment boundary. */
  readonly #connect = async (context: IRpcTransportContext) => {
    /** The independently installed parent listener receives its original endpoint. */
    const parent = this.#server.accept(this.#parentCarrier)
    /** Parent-supplied identity overrides the child's explicit name before its actual handshake. */
    const child = context.attach(this.#childCarrier, {
      self: { ...(this.#parentNamed ? { name: 'math' } : {}), instanceId: 'assigned-child' }
    })
    await Promise.all([parent.ready, child.ready])
    return { dispose: () => undefined }
  }

  /** Later native facts omit the name instead of changing the identity accepted by the first source. */
  readonly #connectOther = async (context: IRpcTransportContext) => {
    /** Both original namespace owners complete their real handshake independently. */
    const parent = this.#otherServer.accept(this.#otherParent)
    /** Omitting a field cannot introduce a conflicting parent-assigned name. */
    const child = context.attach(this.#otherChild, { self: { instanceId: 'assigned-child' } })
    await Promise.all([parent.ready, child.ready])
    return { dispose: () => undefined }
  }
}

it('A28 delivers one original warning to the option then host SDK plugins in registration order', async () => {
  /** Recipient identity and order are observed on the same actual warning object. */
  const deliveries: { recipient: string; warning: IRpcWarning }[] = []
  /** A successful warning must never enter the independent background error channel. */
  const reports: unknown[] = []
  /** Configured recipients suppress the fallback sink. */
  const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  /** Public native construction is the sole warning producer. */
  const pair = new WarningPair()
  try {
    await pair.open({
      onWarning(warning) {
        expectTypeOf(warning).toEqualTypeOf<IRpcWarning>()
        expectTypeOf(warning.data).toEqualTypeOf<
          Readonly<{
            parentName?: string
            ignoredName?: string
            parentInstanceId?: string
            ignoredInstanceId?: string
          }>
        >()
        deliveries.push({ recipient: 'option', warning })
      },
      plugins: [
        defineFlowPlugin({
          name: 'warning-first',
          setup: () => ({
            onWarning: (warning) => deliveries.push({ recipient: 'first', warning })
          })
        }),
        defineFlowPlugin({
          name: 'warning-second',
          setup: () => ({
            onWarning: (warning) => deliveries.push({ recipient: 'second', warning })
          })
        })
      ],
      report: (error) => reports.push(error)
    })
    expect(await pair.send(42)).toBe(42)
    expect(deliveries.map(({ recipient }) => recipient)).toEqual(['option', 'first', 'second'])
    /** The public record contains structured data rather than top-level name aliases or errors. */
    const warning = deliveries[0]!.warning
    expect(warning).toEqual({
      code: RpcWarningCode.selfIgnored,
      message: expect.stringContaining('self.name will be ignored'),
      data: {
        parentName: 'math',
        ignoredName: 'math-child',
        parentInstanceId: 'assigned-child',
        ignoredInstanceId: 'configured-child'
      }
    })
    expect(deliveries[1]!.warning).toBe(warning)
    expect(deliveries[2]!.warning).toBe(warning)
    expect(reports).toEqual([])
    expect(consoleWarning).not.toHaveBeenCalled()
  } finally {
    await pair.close()
    consoleWarning.mockRestore()
  }
})

it('calls SDK setup and observation callbacks without a configuration receiver', async () => {
  /** Normal functions expose receiver binding that arrow callbacks cannot observe. */
  const receivers: { callback: string; receiver: unknown }[] = []
  /** The SDK observer must see real lifecycle and business events. */
  const observations: unknown[] = []
  /** Native parent facts exercise the same warning producer as the subscription cases. */
  const pair = new WarningPair()
  try {
    await pair.open({
      plugins: [
        defineTransportPlugin({
          name: 'receiver-transport',
          namespace: 'other',
          open: function (this: unknown) {
            receivers.push({ callback: 'transport open', receiver: this })
            return { dispose: () => undefined }
          }
        }),
        defineFlowFeature({
          name: 'receiver-feature',
          setup: function (this: unknown) {
            receivers.push({ callback: 'feature setup', receiver: this })
            return {}
          }
        }),
        defineFlowPlugin({
          name: 'receiver-observer',
          setup: function (this: unknown) {
            receivers.push({ callback: 'plugin setup', receiver: this })
            return {
              onWarning: function (this: unknown) {
                receivers.push({ callback: 'warning', receiver: this })
              },
              observe: function (this: unknown, event) {
                receivers.push({ callback: 'observe', receiver: this })
                observations.push(event)
              }
            }
          }
        })
      ]
    })
    expect(await pair.send(42)).toBe(42)
    expect(observations.length).toBeGreaterThan(0)
    expect(new Set(receivers.map(({ callback }) => callback))).toEqual(
      new Set(['transport open', 'feature setup', 'plugin setup', 'warning', 'observe'])
    )
    expect(
      new Set(
        receivers.filter(({ receiver }) => receiver !== undefined).map(({ callback }) => callback)
      )
    ).toEqual(new Set())
  } finally {
    await pair.close()
  }
})

it('A26 warns only about an ignored instanceId when the configured name matches the parent', async () => {
  /** The actual parent and child names agree; only their configured instance addresses differ. */
  const warnings: IRpcWarning[] = []
  /** Successful native reconciliation must not report an error. */
  const reports: unknown[] = []
  /** Reuse the genuine SDK attachment and public business path. */
  const pair = new WarningPair()
  try {
    await pair.open({
      self: { name: 'math', instanceId: 'configured-child' },
      onWarning: (warning) => warnings.push(warning),
      report: (error) => reports.push(error)
    })
    expect(await pair.send(42)).toBe(42)
    expect(warnings).toEqual([
      {
        code: RpcWarningCode.selfIgnored,
        message: expect.stringContaining('self.instanceId will be ignored'),
        data: { parentInstanceId: 'assigned-child', ignoredInstanceId: 'configured-child' }
      }
    ])
    expect(reports).toEqual([])
  } finally {
    await pair.close()
  }
})

it('A26 keeps an unconfigured child name equal to its parent-assigned instanceId', async () => {
  /** Defaults are replaced without warning because the child configured no competing identity. */
  const warnings: IRpcWarning[] = []
  /** This public parent deliberately omits the name from its genuine attachment facts. */
  const pair = new WarningPair(false)
  try {
    await pair.open({ onWarning: (warning) => warnings.push(warning) }, false)
    expect(pair.self).toEqual({ name: 'assigned-child', instanceId: 'assigned-child' })
    expect(await pair.send(42)).toBe(42)
    expect(warnings).toEqual([])
  } finally {
    await pair.close()
  }
})

it('A26 retains the accepted parent name when a later namespace repeats only its instanceId', async () => {
  /** No explicit child identity competes with either trusted native assignment. */
  const warnings: IRpcWarning[] = []
  /** The first source names the child; the second supplies only the same instance assignment. */
  const pair = new WarningPair(true, true)
  try {
    await pair.open({ onWarning: (warning) => warnings.push(warning) }, false)
    expect(pair.self).toEqual({ name: 'math', instanceId: 'assigned-child' })
    expect(await pair.send(42)).toBe(42)
    expect(warnings).toEqual([])
  } finally {
    await pair.close()
  }
})

it('A28 uses console.warn exactly once when neither warning recipient is installed', async () => {
  /** The original successful decision reaches the existing console sink only when unobserved. */
  const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  /** Warning delivery must remain separate from error diagnostics. */
  const report = vi.fn()
  /** Real native startup produces the same identity decision as configured subscriptions. */
  const pair = new WarningPair()
  try {
    await pair.open({ report })
    expect(await pair.send(42)).toBe(42)
    expect(consoleWarning).toHaveBeenCalledExactlyOnceWith({
      code: RpcWarningCode.selfIgnored,
      message: expect.stringContaining('self.name will be ignored'),
      data: {
        parentName: 'math',
        ignoredName: 'math-child',
        parentInstanceId: 'assigned-child',
        ignoredInstanceId: 'configured-child'
      }
    })
    expect(report).not.toHaveBeenCalled()
  } finally {
    await pair.close()
    consoleWarning.mockRestore()
  }
})

it('A28 lets a host SDK subscriber receive the warning without an onWarning option', async () => {
  /** The actual SDK subscriber is the only configured recipient. */
  const receive = vi.fn<(warning: IRpcWarning) => void>()
  /** Plugin-only reception must suppress the fallback console sink. */
  const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  /** Successful native admission never reports the warning as an error. */
  const report = vi.fn()
  /** One public host owns the original subscriber lifetime. */
  const pair = new WarningPair()
  try {
    await pair.open({
      plugins: [defineFlowPlugin({ name: 'warning-only', setup: () => ({ onWarning: receive }) })],
      report
    })
    expect(await pair.send(42)).toBe(42)
    expect(receive).toHaveBeenCalledExactlyOnceWith({
      code: RpcWarningCode.selfIgnored,
      message: expect.stringContaining('self.name will be ignored'),
      data: {
        parentName: 'math',
        ignoredName: 'math-child',
        parentInstanceId: 'assigned-child',
        ignoredInstanceId: 'configured-child'
      }
    })
    expect(consoleWarning).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  } finally {
    await pair.close()
    consoleWarning.mockRestore()
  }
})

it('A28 reports each original failing recipient and still delivers the same warning to later plugins', async () => {
  /** Exact original errors prove neither option nor plugin failures replace the warning record. */
  const optionFailure = new Error('warning option failed')
  /** The second independent recipient fails after the option has already reported its error. */
  const pluginFailure = new Error('warning plugin failed')
  /** Every attempted recipient retains the exact original record. */
  const warnings: IRpcWarning[] = []
  /** Handler errors retain their original identity and delivery order. */
  const reports: unknown[] = []
  /** Failing configured recipients still count as subscribers; fallback must remain absent. */
  const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  /** Actual startup and business calls must complete despite both callback failures. */
  const pair = new WarningPair()
  try {
    await pair.open({
      onWarning(warning) {
        warnings.push(warning)
        throw optionFailure
      },
      plugins: [
        defineFlowPlugin({
          name: 'warning-failing',
          setup: () => ({
            onWarning(warning) {
              warnings.push(warning)
              throw pluginFailure
            }
          })
        }),
        defineFlowPlugin({
          name: 'warning-survivor',
          setup: () => ({ onWarning: (warning) => warnings.push(warning) })
        })
      ],
      report: (error) => reports.push(error)
    })
    expect(await pair.send(42)).toBe(42)
    expect(warnings).toHaveLength(3)
    expect(warnings[1]).toBe(warnings[0])
    expect(warnings[2]).toBe(warnings[0])
    expect(reports).toHaveLength(2)
    expect(reports[0]).toBe(optionFailure)
    expect(reports[1]).toBe(pluginFailure)
    expect(consoleWarning).not.toHaveBeenCalled()
  } finally {
    await pair.close()
    consoleWarning.mockRestore()
  }
})

it('A28 rejects local subscriber plugins and host-only warning callbacks returned by Features', async () => {
  /** A host subscription is a real SDK plugin, rather than an information-flow Feature. */
  const plugin = defineFlowPlugin({
    name: 'warning-misplaced-plugin',
    setup: () => ({ onWarning() {} })
  })
  /** Returning a host-only subscription does not turn an actual Feature into a host observer. */
  const feature = defineFlowFeature({
    name: 'warning-misplaced-feature',
    setup: () => ({ onWarning() {} })
  })
  /** Both invalid local placements must remain cold before native acquisition. */
  const open = vi.fn(() => ({ dispose: () => undefined }))
  // These two genuine SDK definitions form a fixed compile-time placement domain.
  for (const subscriber of [plugin, feature]) {
    /** Keep synchronous cold validation and asynchronous native preparation on one public entry. */
    const construct = async () =>
      createRpcHost({
        report: () => undefined,
        plugins: [
          defineTransportPlugin({
            name: 'warning-invalid-placement',
            namespace: 'memory',
            features: [subscriber],
            open
          })
        ]
      })
    await expect(construct()).rejects.toMatchObject({
      source: 'rpc.endpoint',
      code: 'INVALID_CONFIG'
    })
  }
  /** A Feature cannot gain host subscription authority by moving its setup result to host level. */
  await expect(
    createRpcHost({
      report: () => undefined,
      plugins: [
        feature,
        defineTransportPlugin({
          name: 'warning-invalid-host-feature',
          namespace: 'memory',
          open
        })
      ]
    })
  ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'INVALID_CONFIG' })
  expect(open).not.toHaveBeenCalled()
})

it.each([false, true])(
  'A32 keeps warnings and recipient reports original without calling errorMap, subscriber first %s',
  async (subscriberFirst) => {
    /** The warning recipient's exact error belongs only to the local report channel. */
    const recipientFailure = new Error('A32 warning recipient failed')
    /** Both recipients receive this same actual warning record from trusted native parent admission. */
    const warnings: IRpcWarning[] = []
    const reports: unknown[] = []
    /** Mapping outbound errors must never transform warnings or a local recipient failure. */
    const map = vi.fn(() => null)
    const mapping = errorMap(map)
    const subscriber = defineFlowPlugin({
      name: 'a32-warning-subscriber',
      setup: () => ({ onWarning: (warning) => warnings.push(warning) })
    })
    /** The existing real native fixture remains the sole warning producer. */
    const pair = new WarningPair()
    try {
      await pair.open({
        onWarning(warning) {
          warnings.push(warning)
          throw recipientFailure
        },
        plugins: subscriberFirst ? [subscriber, mapping] : [mapping, subscriber],
        report: (error) => reports.push(error)
      })
      expect(await pair.send(42)).toBe(42)
      expect(warnings).toHaveLength(2)
      expect(warnings[1]).toBe(warnings[0])
      expect(warnings[0]).toMatchObject({
        code: RpcWarningCode.selfIgnored,
        data: {
          parentName: 'math',
          ignoredName: 'math-child',
          parentInstanceId: 'assigned-child',
          ignoredInstanceId: 'configured-child'
        }
      })
      expect(reports).toEqual([recipientFailure])
      expect(map).not.toHaveBeenCalled()
    } finally {
      await pair.close()
    }
  }
)
