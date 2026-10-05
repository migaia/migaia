import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor } from '@migaia/supervision/process'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createNodeThreadLauncher } from '../../src/threads/adapters/node.js'
import { prepareRuntimePeerSourceContext } from '../../src/remote/runtime-api/peer.js'
import { nativeWorkerFor } from '../threads/fixture.js'

it('[A46] ready process stop drains then SIGTERM without launcher abort issuing SIGKILL', async () => {
  /** Actual child readiness precedes stop, avoiding a race with native handler installation. */
  let ready!: () => void
  /** Native stderr is already owned by the launcher's original output drain. */
  const childReady = new Promise<void>((resolve) => {
    ready = resolve
  })
  /** The close callback remains pending while the original supervisor owns the active unit. */
  let release!: () => void
  /** Only the test decides when the actual application drain completes. */
  const drained = new Promise<void>((resolve) => {
    release = resolve
  })
  /** The genuine native launcher and process profile preserve code/signal from actual close. */
  const supervisor = createProcessSupervisor({
    id: 'handoff-process',
    launcher: createNodeProcessLauncher(),
    spec: {
      command: process.execPath,
      args: ['-e', "process.stderr.write('ready'); setInterval(() => {}, 1000)"],
      env: { inherit: [], set: {} },
      stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'drain' }
    },
    output: { onChunk: () => ready() },
    ready: () => childReady,
    isolation: 'best-effort',
    restart: { mode: 'never' },
    report: () => undefined,
    budget: createUnitBudget({ kind: 'process', maxUnits: 1, launchRate: false }),
    stop: { beforeTerminate: () => drained, drainTimeoutMs: 1000 }
  })
  try {
    expect((await supervisor.start()).state).toBe('ready')
    /** The generation's original cancellation happens synchronously inside stop. */
    const stopping = supervisor.stop()
    release()
    await stopping
    expect(
      supervisor.inspect().lastExit?.status,
      '[A46] launch-to-active ownership handoff'
    ).toEqual({
      code: null,
      signal: 'SIGTERM'
    })
  } finally {
    release()
    await supervisor.dispose()
  }
})

it('[A47] an acknowledged Worker no longer belongs to the launcher cancellation listener', async () => {
  /** This genuine Worker emits the private ACK through its original runtime bootstrap. */
  const entry = fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url))
  /** Cancelling a handed-off attempt cannot bypass the supervisor's application drain. */
  const controller = new AbortController()
  /** The real compiled offer is supplied by the same source-context owner as a managed Peer. */
  const context = prepareRuntimePeerSourceContext({
    name: 'handoff-parent',
    instanceId: 'handoff-parent'
  })
  /** A native method spy observes force before any queued supervisor work can run. */
  const handle = await createNodeThreadLauncher({ runtimeApi: context }).launch(
    { entry },
    { signal: controller.signal }
  )
  /** No fake Worker lifecycle or replacement termination owner participates. */
  const terminate = vi.spyOn(nativeWorkerFor(handle), 'terminate')
  try {
    await handle.runtimeApi!.prepared
    controller.abort()
    expect(
      terminate,
      '[A47] active unit is not force-killed by launch cancellation'
    ).not.toHaveBeenCalled()
    handle.terminate()
    await handle.exited
    expect(terminate).toHaveBeenCalledTimes(1)
  } finally {
    handle.terminate()
    await handle.exited
    terminate.mockRestore()
  }
})
