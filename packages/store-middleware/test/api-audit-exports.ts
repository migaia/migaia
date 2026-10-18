// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { tolerantClone } from '../src/index.js'
void tolerantClone
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import type { IMutationGuard } from '../src/index.js'
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import type { IMutationPolicy } from '../src/index.js'
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { ClonePolicy } from '../src/index.js'
void ClonePolicy
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { immutableSnapshotClone } from '../src/index.js'
void immutableSnapshotClone
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { opaqueReferenceClone } from '../src/index.js'
void opaqueReferenceClone
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { diagnosticClone } from '../src/index.js'
void diagnosticClone
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import type { IClonePolicyMode } from '../src/index.js'
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { middlewarePlugin } from '../src/index.js'
void middlewarePlugin
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import type { IStoreMiddleware } from '../src/index.js'
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import type { IMiddlewareContext } from '../src/index.js'
// @ts-expect-error The deprecated clone alias is absent from the narrow entry too.
import { tolerantClone as retiredNarrowClone } from '../src/tolerant-clone.js'
void retiredNarrowClone
export type IRetiredTypes = [
  IMutationGuard,
  IMutationPolicy,
  IClonePolicyMode,
  IStoreMiddleware<unknown>,
  IMiddlewareContext<unknown>
]
