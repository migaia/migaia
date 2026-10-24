import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
/**
 * The actual native child bootstrap belongs to its cold transport; one genuine Host owns the
 * provider.
 */
await createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  provide: { twice: (value: number) => value * 2 }
})
