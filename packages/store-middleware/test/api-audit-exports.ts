// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { tolerantClone } from '../src/index.ts'
void tolerantClone
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import type { IMutationGuard } from '../src/index.ts'
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import type { IMutationPolicy } from '../src/index.ts'
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { ClonePolicy } from '../src/index.ts'
void ClonePolicy
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { immutableSnapshotClone } from '../src/index.ts'
void immutableSnapshotClone
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { opaqueReferenceClone } from '../src/index.ts'
void opaqueReferenceClone
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { diagnosticClone } from '../src/index.ts'
void diagnosticClone
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import type { IClonePolicyMode } from '../src/index.ts'
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import { middlewarePlugin } from '../src/index.ts'
void middlewarePlugin
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import type { IStoreMiddleware } from '../src/index.ts'
// @ts-expect-error Retired aliases and compatibility adapters are absent from the root.
import type { IMiddlewareContext } from '../src/index.ts'
// @ts-expect-error The deprecated clone alias is absent from the narrow entry too.
import { tolerantClone as retiredNarrowClone } from '../src/tolerant-clone.ts'
void retiredNarrowClone
export type IRetiredTypes = [
  IMutationGuard,
  IMutationPolicy,
  IClonePolicyMode,
  IStoreMiddleware<unknown>,
  IMiddlewareContext<unknown>
]
