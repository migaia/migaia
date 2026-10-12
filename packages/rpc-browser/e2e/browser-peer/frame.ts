import { createBrowserPeer } from '@migaia/rpc-browser'
import { fixtureProviders } from './api.js'

/** The parent supplies its explicit origin as ordinary fixture configuration, never a trust receipt. */
const parentOrigin = new URL(location.href).searchParams.get('parentOrigin')!
parent.postMessage({ browserPeerFixture: 'loaded' }, parentOrigin)
await createBrowserPeer({
  connect: { window: parent, origin: parentOrigin },
  provide: fixtureProviders()
})
