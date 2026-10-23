import { PROCESS_RUNTIME_API_ENV_VERSION } from './constants.js'
import { invalidProcessRuntimeBootstrap } from './runtime-bootstrap.js'
import type { IProcessByteChannel } from './types.js'

/** A process owns one automatic stdio pair; failure never permits another physical reader. */
let claimed = false

/** The original process-local stdio claim remains shared by internal and new host entry paths. */
export type IAutomaticProcessPlatform = Readonly<{
  marker: string | undefined
  runtime: string
  open(): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>>
}>

/** Claim the actual stdio pair once, retaining validation order before native acquisition. */
export function openAutomaticProcessIO(
  platform: IAutomaticProcessPlatform,
  beforeOpen?: () => void
): ReturnType<IAutomaticProcessPlatform['open']> {
  if (platform.marker !== PROCESS_RUNTIME_API_ENV_VERSION || claimed)
    invalidProcessRuntimeBootstrap()
  beforeOpen?.()
  claimed = true
  return platform.open()
}
