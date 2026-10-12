import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

if (isProcessChild()) {
  await createProcessPeer({
    provide: {
      math: { double: (value) => value * 2 },
      child: () => isProcessChild(),
      flags: () => process.execArgv
    }
  })
} else {
  /** The relative mode is run with a foreign cwd to prove resolution against this main entry. */
  const peer = await createProcessPeer({
    spawn: process.argv[2] === 'relative' ? './short-service.ts' : true
  })
  try {
    process.stdout.write(
      JSON.stringify({
        value: await peer.request('math.double', 21),
        child: await peer.request('child'),
        flags: await peer.request('flags')
      })
    )
  } finally {
    await peer.close()
  }
}
