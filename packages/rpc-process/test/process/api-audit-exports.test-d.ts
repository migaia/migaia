// @ts-expect-error C01 removes the exact alias; consumers use createProcessTransport.
import type { createAdapterChannel } from '@migaia/rpc-process'
// @ts-expect-error C02 keeps registration approval internal to the host implementation.
import type { IProcessHostRegistrationApproval } from '@migaia/rpc-process'
// @ts-expect-error C02 keeps registration storage internal to the host implementation.
import type { IProcessHostRegistrations } from '@migaia/rpc-process'
import type { createProcessTransport } from '@migaia/rpc-process'

/** The canonical transport remains public and inferred from its sole construction entry. */
export type ICanonicalProcessTransport = ReturnType<typeof createProcessTransport>
/** All rejected bindings are used so unused-import diagnostics cannot mask the export oracle. */
export type IRetiredProcessExports =
  | typeof createAdapterChannel
  | IProcessHostRegistrationApproval
  | IProcessHostRegistrations
