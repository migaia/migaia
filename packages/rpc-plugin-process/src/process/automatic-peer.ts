/**
 * Claims the process-local automatic stdio pair once after validating its consumed bootstrap
 * marker. Native IO acquisition remains separate from Session identity and authentication
 * admission.
 */
import { PROCESS_RUNTIME_API_ENV_VERSION } from './constants.ts'
import { invalidProcessRuntimeBootstrap } from './runtime-bootstrap.ts'
import type { IProcessByteChannel } from './types.ts'

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
