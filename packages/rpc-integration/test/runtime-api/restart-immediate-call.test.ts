import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createProcessPlugin, createProcessTransport } from '@migaia/rpc-process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'
import { createThreadPlugin } from '@migaia/rpc-threads'
import {
  createNodeThreadChannelFactory,
  createNodeThreadLauncher
} from '@migaia/rpc-threads/adapters/node'
import type { ISpawnProcessPluginDeployment } from '../../../rpc-process/dist/process/plugin/types.js'
import { RuntimeEventName } from '../../../rpc-core/dist/remote/runtime-api/constants.js'
import type { IRuntimeEvent } from '../../../rpc-core/dist/remote/runtime-api/events.js'
import type { IRuntimeOutlet } from '../../../rpc-core/dist/remote/runtime-api/outlet.js'
import { runtimeTestHost } from '../../../rpc-core/test/runtime-api/fixture.js'

/** The existing child installs exposed Features through automatic process/thread discovery. */
const entry = fileURLToPath(new URL('./fixtures/automatic-plugin.mjs', import.meta.url))

it.each(['process', 'thread'] as const)(
  '%s automatic child admits an immediate exposed call after each of 20 restart ready events',
  async (kind) => {
    /** One true Host retains the public connection outlet across all native child replacements. */
    const host = runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** Repeated process launches test admission rather than the independent launch-rate policy. */
    const processBudget = createUnitBudget({ kind: 'process', maxUnits: 1, launchRate: false })
    /** Worker leases retain their separate native execution domain. */
    const threadBudget = createUnitBudget({ kind: 'thread', maxUnits: 1, launchRate: false })
    /** Both adapters keep genuine execution, authentication and disposal owners. */
    const processLauncher = createNodeProcessLauncher()
    /** Every process generation's establish callback reads its original launcher identity. */
    let processHandle: Awaited<ReturnType<typeof processLauncher.launch>> | undefined
    /** Fixture authentication bytes remain confined to the native source handshake. */
    const token = 'serve-commit-restart-fixture'
    /** Every report level keeps its semantic classification without repeating native stacks. */
    const describeError = (error: unknown) => {
      /** Native Error and coded plain values use the same test-side evidence projection. */
      const value = error !== null && typeof error === 'object' ? error : undefined
      return {
        name: (value && Reflect.get(value, 'name')) ?? null,
        source: (value && Reflect.get(value, 'source')) ?? null,
        code: (value && Reflect.get(value, 'code')) ?? null,
        reason: (value && Reflect.get(value, 'reason')) ?? null,
        message: String((value && Reflect.get(value, 'message')) ?? error).replaceAll(
          token,
          '<REDACTED>'
        ),
        detail: (value && Reflect.get(value, 'detail')) ?? null
      }
    }
    /** Preserve each observed cause classification so a wrapper cannot hide REGISTRATION_REVOKED. */
    const classifyFailure = (error: unknown) => {
      /** The native restart reports have ordinary acyclic Error cause chains. */
      const cause: Array<ReturnType<typeof describeError>> = []
      /** Follow actual cause ownership rather than inferring a root from the top-level code. */
      let current =
        error !== null && typeof error === 'object' ? Reflect.get(error, 'cause') : undefined
      while (current !== undefined) {
        cause.push(describeError(current))
        current =
          current !== null && typeof current === 'object'
            ? Reflect.get(current, 'cause')
            : undefined
      }
      return { ...describeError(error), cause }
    }
    /** Provider and adapter reports preserve complete failure evidence for assertion output. */
    const reports: Array<ReturnType<typeof classifyFailure>> = []
    /** All actual source owners use the same complete classification sink. */
    const report = (error: unknown) => {
      reports.push(classifyFailure(error))
    }
    /** Existing process deployment owners perform every restart without a fixture launcher. */
    const processDeployment: ISpawnProcessPluginDeployment<NonNullable<typeof processHandle>> = {
      kind: 'spawn',
      channelKind: 'byte',
      wire: 'native',
      token,
      supervision: {
        id: 'serve-commit-child',
        spec: {
          command: process.execPath,
          args: [entry],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
        },
        budget: processBudget,
        isolation: 'best-effort',
        report,
        launcher: {
          ...processLauncher,
          /** Retain the exact trusted identity minted for the current native generation. */
          launch: async (spec, context) =>
            (processHandle = await processLauncher.launch(spec, context))
        }
      },
      rawChannel: async (handle) => handle.channel!,
      /** Use the accepted native bootstrap proposal, without adding a second handshake. */
      establish: async (raw, prepared) =>
        createProcessTransport(raw as NonNullable<typeof processHandle>['channel'] & object, {
          role: 'initiator',
          offer: prepared.offer!,
          peerId: processHandle!.runtimeApiIdentity!.instanceId,
          scheduler: prepared.scheduler,
          ipc: { ...prepared.session, log: () => undefined },
          report
        })
    }
    /** The original thread deployment owns both worker termination and channel preparation. */
    const threadDeployment = {
      spec: { entry, name: 'serve-commit-child' },
      budget: threadBudget,
      scheduler: systemScheduler,
      launcher: createNodeThreadLauncher(),
      channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
      report
    }
    /** Each ready event starts exactly one call before the restart caller can resume. */
    const calls: Array<{
      event: IRuntimeEvent
      payload: string
      result: Promise<{ value: unknown } | { error: ReturnType<typeof classifyFailure> }>
    }> = []
    /** Unsubscribe before Host disposal so cleanup cannot create extra acceptance calls. */
    let removeReady: (() => void) | undefined
    try {
      /** Existing child reverse methods need no parent Feature installation barrier. */
      const provide = {
        parent: { read: (payload: unknown) => payload, ready: () => undefined }
      }
      await host.use(
        kind === 'process'
          ? createProcessPlugin({
              name: 'bridge',
              spawn: processDeployment,
              provide,
              report
            })
          : createThreadPlugin({
              name: 'bridge',
              spawn: threadDeployment,
              provide,
              report
            })
      )
      /** The actual public outlet performs every control and business call. */
      const outlet = host[kind]! as unknown as IRuntimeOutlet
      removeReady = outlet.on(RuntimeEventName.ready, (event) => {
        if (event.name !== 'bridge') return
        /** Distinct payloads prove the immediate call belongs to this ready generation. */
        const payload = `${kind}:${calls.length + 1}`
        /**
         * Invoke synchronously in the ready callback; no delay, commit ACK or retry masks the
         * admission regression.
         */
        const result = outlet.request('bridge', 'service.probe', payload).then(
          (value) => ({ value }),
          (error: unknown) => ({ error: classifyFailure(error) })
        )
        calls.push({ event, payload, result })
      })
      for (let restart = 0; restart < 20; restart++) {
        await outlet.restart('bridge')
        assert.equal(calls.length, restart + 1, 'every restart publishes one ready event')
        await calls[restart]!.result
      }
      /** Retain every original rejection rather than retrying or suppressing a failed generation. */
      const outcomes = await Promise.all(calls.map((call) => call.result))
      assert.equal(calls.length, 20)
      assert.equal(new Set(calls.map((call) => call.event.instanceId)).size, 20)
      assert.equal(
        outcomes.filter(
          (outcome) => 'error' in outcome && outcome.error.code === 'REGISTRATION_REVOKED'
        ).length,
        0,
        'no immediate exposed call fails REGISTRATION_REVOKED'
      )
      for (const [index, outcome] of outcomes.entries()) {
        assert.deepEqual(
          outcome,
          { value: [42, calls[index]!.payload] },
          `restart ${index + 1} invokes its exposed method successfully`
        )
      }
    } finally {
      removeReady?.()
      await host.dispose()
    }
    /** Ordinary native stop reports remain evidence; only the admission regression fails this check. */
    assert.equal(
      reports.some(
        (failure) =>
          failure.code === 'REGISTRATION_REVOKED' ||
          failure.cause.some((cause) => cause.code === 'REGISTRATION_REVOKED')
      ),
      false,
      'no reported cause chain contains REGISTRATION_REVOKED'
    )
    /** Repeated native close diagnostics are grouped by their full classification and cause chain. */
    const diagnostics = new Map<
      string,
      { count: number; failure: ReturnType<typeof classifyFailure> }
    >()
    for (const failure of reports) {
      /** This exact classification key retains branch details and every cause message. */
      const key = JSON.stringify(failure)
      /** Equal diagnostics accumulate counts without expanding stacks in test output. */
      const previous = diagnostics.get(key)
      if (previous) previous.count += 1
      else diagnostics.set(key, { count: 1, failure })
    }
    console.info(
      '[serve-commit restart]',
      JSON.stringify({
        family: kind,
        readyCalls: calls.length,
        diagnostics: [...diagnostics.values()]
      })
    )
    assert.equal(processBudget.inUse, 0)
    assert.equal(threadBudget.inUse, 0)
  },
  120_000
)
