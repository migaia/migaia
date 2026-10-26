import { expect, it, vi } from 'vitest'
import { createRpcHost, RpcWarningCode, type IRpcNamespace } from '@migaia/rpc-host'
import { defineTransportPlugin, createRpcMessageCarrier } from '@migaia/rpc-host/sdk'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'
import { NativeIdentityChild, type IIdentitySnapshot } from './fixtures/native-identity-child.js'

/** Native Node launchers consume the same maintained source in a real process or Worker. */
const childEntry = new URL('./fixtures/native-identity-realm.ts', import.meta.url)

/** A real cooperative task retains the child until the original supervisor requests shutdown. */
function childTask(collectWarnings = true): ICoroutineUserTask {
  return async ({ connect, signal }) => {
    /** This task's actual child Host owns its own configured self and diagnostic deliveries. */
    const child = new NativeIdentityChild(collectWarnings)
    await child.open(coroutinePlugin({ connectToParent: connect }))
    try {
      if (!signal.aborted)
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        )
    } finally {
      await child.close()
    }
  }
}

/** The existing public plugin entry is the only native-family selection in these regressions. */
function parentPlugin(kind: 'process' | 'thread' | 'coroutine', name?: string) {
  /** Omission is meaningful: it must not become a namespace-derived child bootstrap name. */
  const naming = name === undefined ? {} : { name }
  if (kind === 'process') return processPlugin({ ...naming, spawn: childEntry })
  if (kind === 'thread') return threadPlugin({ ...naming, spawn: childEntry })
  return coroutinePlugin({ ...naming, spawn: childTask() })
}

it.each(['process', 'thread', 'coroutine'] as const)(
  'A26: %s parent name overrides explicit child self once outside report',
  async (kind) => {
    /** Only unexpected parent-side errors enter this independent error channel. */
    const reports: unknown[] = []
    /** Real native startup carries both the chosen logical name and child instance assignment. */
    const host = await createRpcHost({
      plugins: [parentPlugin(kind, 'math')],
      report: (error) => reports.push(error)
    })
    try {
      /** Public lookup proves the accepted peer is addressable by the actual parent's chosen name. */
      const namespace = Reflect.get(host, kind) as IRpcNamespace
      /** The provider returns the child Host's own public identity and original warning deliveries. */
      const snapshot = (await namespace.send('math', 'inspect', null)) as IIdentitySnapshot
      expect(snapshot.self.name).toBe('math')
      expect(snapshot.self.instanceId).not.toBe('configured-child-instance')
      expect(snapshot.self.instanceId).toBeTruthy()
      expect(snapshot.warnings).toEqual([
        {
          code: RpcWarningCode.selfIgnored,
          message: expect.stringContaining('self.name will be ignored'),
          data: {
            parentName: 'math',
            ignoredName: 'math-child',
            parentInstanceId: snapshot.self.instanceId,
            ignoredInstanceId: 'configured-child-instance'
          }
        }
      ])
      expect(snapshot.reports).toBe(0)
      expect(await namespace.send('math', 'inspect', null)).toEqual(snapshot)
    } finally {
      await host.close()
    }
  },
  15000
)

it.each(['process', 'thread', 'coroutine'] as const)(
  'A26: unnamed %s parent uses the child handshake name',
  async (kind) => {
    /** A configured child name remains its original lookup name when native facts omit the name. */
    const host = await createRpcHost({ plugins: [parentPlugin(kind)], report: () => undefined })
    try {
      /** No alias is substituted by the namespace or the native parent launcher. */
      const namespace = Reflect.get(host, kind) as IRpcNamespace
      /** Original child warning/error counts must remain empty after successful construction. */
      const snapshot = (await namespace.send('math-child', 'inspect', null)) as IIdentitySnapshot
      expect(snapshot.self.name).toBe('math-child')
      expect(snapshot.self.instanceId).not.toBe('configured-child-instance')
      expect(snapshot.warnings).toEqual([
        {
          code: RpcWarningCode.selfIgnored,
          message: expect.stringContaining('self.instanceId will be ignored'),
          data: {
            parentInstanceId: snapshot.self.instanceId,
            ignoredInstanceId: 'configured-child-instance'
          }
        }
      ])
      expect(snapshot.reports).toBe(0)
    } finally {
      await host.close()
    }
  },
  15000
)

it('A26: omitted onWarning uses console.warn for the successful native name override', async () => {
  /** The same-realm native task makes the actual default warning sink directly observable. */
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  /** Native error reporting remains independently empty while the default warning sink fires. */
  const reports: unknown[] = []
  try {
    /** The child intentionally receives no onWarning option; only its parent selected the name. */
    const host = await createRpcHost({
      plugins: [coroutinePlugin({ name: 'math', spawn: childTask(false) })],
      report: (error) => reports.push(error)
    })
    try {
      expect(await host.coroutine.send('math', 'inspect', null)).toMatchObject({
        self: { name: 'math' },
        reports: 0
      })
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          code: RpcWarningCode.selfIgnored,
          data: expect.objectContaining({
            parentName: 'math',
            ignoredName: 'math-child',
            parentInstanceId: expect.any(String),
            ignoredInstanceId: 'configured-child-instance'
          })
        })
      )
    } finally {
      await host.close()
    }
    expect(reports).toEqual([])
  } finally {
    warning.mockRestore()
  }
})

it('A26: conflicting trusted parent startup facts still reject the public Host', async () => {
  /** Two actual native ports back independently acquired sources within one cold transport. */
  const first = new MessageChannel()
  /** The second original source claims a different parent-assigned child identity. */
  const second = new MessageChannel()
  /** Public SDK IO callbacks attach only the actual original native receiver and sender. */
  const carrier = (port: MessagePort, id: string) =>
    createRpcMessageCarrier({
      id,
      report: () => undefined,
      io: {
        send: (value) => port.postMessage(value),
        onMessage: (listener) => {
          /** The exact native wrapper is removed by its SDK-owned subscription receipt. */
          const receive = (event: MessageEvent) => listener(event.data)
          port.addEventListener('message', receive)
          port.start()
          return () => port.removeEventListener('message', receive)
        },
        onClose: (listener) => {
          port.addEventListener('close', listener)
          return () => port.removeEventListener('close', listener)
        },
        close: () => port.close()
      }
    })
  try {
    await expect(
      createRpcHost({
        report: () => undefined,
        plugins: [
          defineTransportPlugin({
            name: 'native-facts',
            namespace: 'native',
            open: (context) => {
              context.attach(carrier(first.port1, 'native-first'), {
                self: { name: 'math', instanceId: 'native-first-child' }
              })
              context.attach(carrier(second.port1, 'native-second'), {
                self: { name: 'other', instanceId: 'native-second-child' }
              })
              return { dispose: () => undefined }
            }
          })
        ]
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  } finally {
    first.port1.close()
    first.port2.close()
    second.port1.close()
    second.port2.close()
  }
})
