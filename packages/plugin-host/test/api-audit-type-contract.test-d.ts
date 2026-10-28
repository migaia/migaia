// @ts-expect-error Managed provenance writers belong to private constructor wiring.
import type { buildManagedPort } from '../src/composition-entry.ts'
// @ts-expect-error Public readers cannot grant managed-host provenance to arbitrary objects.
import type { registerManagedHost } from '../src/composition-entry.ts'

/** Negative imports remain live without exposing replacement writer aliases. */
type IPrivateWriters = [typeof buildManagedPort, typeof registerManagedHost]
/** Type-only negative fixture is never evaluated as runtime code. */
const forbidden = undefined as unknown as IPrivateWriters
void forbidden

// @ts-expect-error Registration views are public only through composition/createView.
import type { createRegistrationView } from '../src/index.ts'
// @ts-expect-error Deprecated receipt alias is removed; use composition/IRegistrationToken.
import type { IPluginRegistrationReceipt } from '../src/index.ts'

/** Forbidden root exports stay checked without recreating compatibility paths. */
type IPrivateRootExports = [typeof createRegistrationView, IPluginRegistrationReceipt]
/** Compile-only fixture is never evaluated at runtime. */
const forbiddenRoot = undefined as unknown as IPrivateRootExports
void forbiddenRoot
