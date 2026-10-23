import { windowPlugin } from '@migaia/rpc-plugin-browser'
import { createRpcHost } from '@migaia/rpc-host'
import { fixtureProviders } from './api.js'

/** The parent supplies its explicit origin as ordinary fixture configuration, never a trust receipt. */
const parentOrigin = new URL(location.href).searchParams.get('parentOrigin')!
parent.postMessage({ browserPeerFixture: 'loaded' }, parentOrigin)
await createRpcHost({
  plugins: [windowPlugin({ window: parent, origin: parentOrigin })],
  provide: fixtureProviders()
})
