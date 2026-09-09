import { createBroadcastChannelTransport } from '../../src/adapters/broadcast-channel'
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer'
import { createRpc, installErrorGuards, terminalProviders } from './rpc'

const errors = installErrorGuards()
let endpoint: Awaited<ReturnType<typeof createRpc>> | undefined
let channel: BroadcastChannel | undefined
let providerCalls = 0

const allowedIdentity = (allowed: readonly string[]) => (context: { readonly data?: unknown }) => {
  const data = context.data as { __unique_id__?: unknown } | undefined
  return typeof data?.__unique_id__ === 'string' && allowed.includes(data.__unique_id__)
}

globalThis.startBroadcastServer = async (uniqueId: string, label: string) => {
  channel = new BroadcastChannel('web-rpc-e2e')
  endpoint = await createRpc(
    'service',
    ['client'],
    createBroadcastChannelTransport(channel),
    {
      ...terminalProviders,
      who: (context) => context.success({ label, value: context.data })
    },
    { uniqueTargetId: uniqueId, identifier: allowedIdentity(['client-id']) }
  )
}

globalThis.startBroadcastClient = async () => {
  channel = new BroadcastChannel('web-rpc-e2e')
  endpoint = await createRpc(
    'client',
    ['service'],
    createBroadcastChannelTransport(channel),
    {},
    {
      uniqueTargetId: 'client-id',
      identifier: allowedIdentity(['server-a', 'server-b'])
    },
    undefined,
    false,
    {
      schemas: {
        schema: {
          params: {
            parse: () => {
              throw new Error('schema rejected')
            }
          },
          result: { parse: (value) => value }
        }
      }
    }
  )
}

globalThis.startBroadcastAttacker = () => {
  channel = new BroadcastChannel('web-rpc-e2e')
  channel.addEventListener('message', (event) => {
    if (event.data?.kind !== 'discovery-query' || event.data?.targetId !== 'service') return
    channel!.postMessage({
      kind: 'discovery-response',
      taskId: event.data.taskId,
      senderId: 'service',
      targetId: event.data.senderId,
      resolvedTargetId: 'service',
      sentAt: Date.now(),
      data: { __unique_id__: 'attacker' },
      receiverId: 'service:attacker'
    })
  })
}

globalThis.startAnonymousBroadcastServer = async () => {
  channel = new BroadcastChannel('web-rpc-anonymous-e2e')
  endpoint = await createRpc('service', ['client'], createBroadcastChannelTransport(channel), {
    who: (context) => context.success({ value: context.data, mode: 'anonymous' })
  })
  endpoint.hooks.on((event) => {
    if (event.name === 'authentication.rejected' || event.name === 'receive.failure')
      errors.push(`server:${event.name}:${event.code ?? ''}`)
  })
}

globalThis.startAnonymousBroadcastClient = async () => {
  channel = new BroadcastChannel('web-rpc-anonymous-e2e')
  endpoint = await createRpc('client', ['service'], createBroadcastChannelTransport(channel))
  endpoint.hooks.on((event) => {
    if (event.name === 'authentication.rejected' || event.name === 'receive.failure')
      errors.push(`client:${event.name}:${event.code ?? ''}`)
  })
}

globalThis.startAuthenticatedBroadcastServer = async () => {
  channel = new BroadcastChannel('web-rpc-auth-e2e')
  providerCalls = 0
  endpoint = await createRpc(
    'service',
    ['client'],
    createBroadcastChannelTransport(channel),
    {
      who: (context) => {
        providerCalls += 1
        return context.success({ value: context.data, trusted: true })
      },
      notify: (context) => {
        channel!.postMessage({ e2e: 'dispatch-result', value: context.data })
        return context.success(undefined)
      }
    },
    { uniqueTargetId: 'auth-server', identifier: allowedIdentity(['auth-client']) },
    undefined,
    true,
    undefined,
    { chunkSize: 4 }
  )
}

globalThis.startAuthenticatedBroadcastClient = async () => {
  channel = new BroadcastChannel('web-rpc-auth-e2e')
  endpoint = await createRpc(
    'client',
    ['service'],
    createBroadcastChannelTransport(channel),
    {},
    { uniqueTargetId: 'auth-client', identifier: allowedIdentity(['auth-server']) },
    undefined,
    true,
    undefined,
    { chunkSize: 4 }
  )
}

globalThis.startAuthenticatedBroadcastAttacker = () => {
  channel = new BroadcastChannel('web-rpc-auth-e2e')
  channel.addEventListener('message', (event) => {
    const frame = event.data as { value?: Record<string, unknown>; signature?: unknown }
    const request = frame?.value
    if (frame?.signature !== 'trusted' || !request) return
    if (request.kind === 'request') {
      channel!.postMessage({
        ...request,
        kind: 'response',
        ok: true,
        data: { value: 'forged', trusted: false },
        signature: 'forged'
      })
    }
    if (request.kind === 'variation' && request.variation === 'ping') {
      channel!.postMessage({
        ...request,
        kind: 'variation',
        variation: 'pong',
        signature: 'forged'
      })
    }
  })
}

globalThis.sendBroadcast = (value: unknown) => endpoint!.send('service', 'who', value)
globalThis.dispatchBroadcast = async () => {
  const dispatchResult = new Promise<unknown>((resolve) => {
    channel!.addEventListener('message', function onDispatch(event) {
      if (event.data?.e2e === 'dispatch-result') {
        channel!.removeEventListener('message', onDispatch)
        resolve(event.data.value)
      }
    })
  })
  endpoint!.dispatch('service', 'notify', 'broadcast-chunked-dispatch-😀')
  return String(await dispatchResult)
}
globalThis.sendBroadcastTerminal = async () => {
  const chunkedRequest = await endpoint!.send('service', 'who', 'broadcast-chunked-request-😀')
  const chunkedRemoteError = await endpoint!
    .send('service', 'fail', 'broadcast-chunked-error-😀')
    .then(
      () => 'resolved',
      (error: { readonly code?: string }) => error.code ?? 'error'
    )
  const chunkedTimeout = await endpoint!
    .send('service', 'hang', 'broadcast-chunked-timeout-😀', { timeoutMs: 40 })
    .then(
      () => 'resolved',
      (error: { readonly code?: string }) => error.code ?? 'error'
    )
  const remoteError = await endpoint!.send('service', 'fail', null).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const timeout = await endpoint!.send('service', 'hang', null, { timeoutMs: 40 }).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const controller = new AbortController()
  const pending = endpoint!.send('service', 'hang', 'broadcast-chunked-abort-😀', {
    signal: controller.signal
  })
  controller.abort()
  const aborted = await pending.then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const schemaError = await endpoint!.send('service', 'schema', 'broadcast-chunked-schema-😀').then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const activeSnapshot = readEndpointDebugSnapshot(endpoint!)
  if (activeSnapshot === undefined) throw new Error('missing endpoint snapshot')
  return {
    chunkedRequest: (chunkedRequest as { readonly value: string }).value,
    chunkedRemoteError,
    chunkedTimeout,
    remoteError,
    timeout,
    aborted,
    schemaError,
    activeSnapshot
  }
}
globalThis.pingBroadcast = () => endpoint!.ping('service')
globalThis.pingBroadcastTerminal = async () => {
  const success = await endpoint!.ping('service')
  const timeout = await endpoint!.ping('missing', undefined, { timeoutMs: 40 })
  const controller = new AbortController()
  const pending = endpoint!.ping('service', undefined, { signal: controller.signal })
  controller.abort()
  const aborted = await pending
  return { success, timeout, aborted }
}
globalThis.broadcastServers = () => endpoint!.connect.getServerList('service')
globalThis.pinBroadcast = (receiverId: string) =>
  endpoint!.connect.pinReceiver('service', receiverId)
globalThis.unpinBroadcast = () => endpoint!.connect.unpinReceiver('service')
globalThis.disposeBroadcast = async () => {
  await endpoint?.dispose()
  channel?.close()
  return errors
}
globalThis.broadcastSnapshot = () => readEndpointDebugSnapshot(endpoint!)
globalThis.broadcastProviderCalls = () => providerCalls

declare global {
  var startBroadcastServer: (uniqueId: string, label: string) => Promise<void>
  var startBroadcastClient: () => Promise<void>
  var startBroadcastAttacker: () => void
  var startAnonymousBroadcastServer: () => Promise<void>
  var startAnonymousBroadcastClient: () => Promise<void>
  var sendBroadcast: (value: unknown) => Promise<unknown>
  var dispatchBroadcast: () => Promise<string>
  var sendBroadcastTerminal: () => Promise<{
    chunkedRequest: string
    remoteError: string
    timeout: string
    aborted: string
    schemaError: string
    activeSnapshot: {
      phase: string
      pending: number
      chunks?: number
      activeControllers: number
    }
  }>
  var pingBroadcast: () => Promise<boolean>
  var pingBroadcastTerminal: () => Promise<{
    success: boolean
    timeout: boolean
    aborted: boolean
  }>
  var broadcastServers: () => readonly { receiverId: string; uniqueTargetId?: string }[]
  var pinBroadcast: (receiverId: string) => void
  var unpinBroadcast: () => void
  var disposeBroadcast: () => Promise<string[]>
  var broadcastSnapshot: () => unknown
  var broadcastProviderCalls: () => number
  var startAuthenticatedBroadcastServer: () => Promise<void>
  var startAuthenticatedBroadcastClient: () => Promise<void>
  var startAuthenticatedBroadcastAttacker: () => void
}
