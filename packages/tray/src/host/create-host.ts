/**
 * Publishes the managed Host construction boundary. HostCreation owns claims, startup and rollback;
 * this entry preserves the original generic inference and Promise assimilation.
 */
import { HostCreation } from './host-creation.ts'
import {
  type ICreateHostOptions,
  type ITrayHostSource,
  type ITrayPluginConstraint,
  type ITrayResolvedHost
} from './typing.ts'

/**
 * Constructs and owns exactly one canonical PluginHost and its dynamic dependency graph. All
 * creation options except report are required. Feature providers install before consumers; missing
 * required providers leave definitions blocked. Resolves to the managed view after reconciliation.
 * Factory/admission/startup failures roll back this call's acquired claim and retain cleanup detail
 * on the primary error. Use only the facade for mutation so its publication receipt stays current.
 */
export async function createHost<
  THost extends ITrayHostSource,
  const TPlugins extends readonly ITrayPluginConstraint<THost>[]
>(options: ICreateHostOptions<THost, TPlugins>): Promise<ITrayResolvedHost<THost, TPlugins>> {
  return new HostCreation<THost, TPlugins>(options).create()
}
