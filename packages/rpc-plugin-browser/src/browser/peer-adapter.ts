import { defineMessageAdapter, type IAdapterDefinition } from '@migaia/rpc-host/plugin'
import { openBrowserPeerPort } from './peer-port.js'
import type { IRuntimeBrowserConnect } from './peer-types.js'

/** Import stays inert; the first physical Peer construction obtains the canonical SDK definition. */
let browserMessageAdapter: IAdapterDefinition<IRuntimeBrowserConnect, 'thread'> | undefined

/** One definition retains raw carrier operations while Core owns all Peer protocol and call state. */
export function getBrowserMessageAdapter(): IAdapterDefinition<IRuntimeBrowserConnect, 'thread'> {
  return (browserMessageAdapter ??= defineMessageAdapter({ open: openBrowserPeerPort }))
}
