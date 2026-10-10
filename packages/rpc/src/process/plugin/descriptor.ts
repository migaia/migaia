import { BudgetOverflow, ReplaceStrategy } from '@migaia/supervision'
import {
  BootstrapVia,
  StderrMode,
  StdinMode,
  StdoutMode,
  type IProcessBootstrap,
  type IProcessSpec
} from '@migaia/supervision/process'
import { normalizePortable } from '../../contract/index.js'
import type { IRpcPortableValue } from '../../contract/index.js'
import {
  normalizeRemoteContract,
  normalizeRemoteHostCatalog,
  REMOTE_NAME_PATTERN,
  type IRemoteContract,
  type IRemoteHostCatalog
} from '../../remote/index.js'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import {
  PROCESS_PLUGIN_DESCRIPTOR_VERSION,
  PROCESS_DESCRIPTOR_SECRET_ARGUMENTS,
  ProcessDescriptorTarget,
  ProcessPluginChannelKind,
  ProcessPluginInstanceMode,
  ProcessPluginWire
} from './constants.js'

/** Persisted environment entries inherit by name or declare a literal non-secret value. */
export type IProcessDescriptorEnv = Readonly<{
  inherit: readonly string[]
  set?: Readonly<Record<string, Readonly<{ value: string; nonSecret: true }>>>
}>

/** Bootstrap payload is injected at runtime and environment values are explicit data. */
export type IProcessSpecDescriptor = Readonly<
  Omit<IProcessSpec, 'bootstrap' | 'env'> & {
    env: IProcessDescriptorEnv
    bootstrap?: Readonly<Omit<IProcessBootstrap, 'payload'>>
  }
>

/** Persisted budget data has no scheduler, parent, or live lease. */
export type IProcessBudgetDescriptor = Readonly<{
  maxUnits: number
  overflow?: BudgetOverflow
  queueTimeoutMs?: number
  launchRate?: Readonly<{ max: number; windowMs: number }> | false
}>

/** A physical deployment carries pure data rather than adapter functions. */
export type IProcessPluginDeploymentDescriptor =
  | Readonly<{
      kind: 'spawn'
      channelKind: 'byte'
      wire: ProcessPluginWire
      spec: IProcessSpecDescriptor
      budget: IProcessBudgetDescriptor
    }>
  | Readonly<{
      kind: 'spawn'
      channelKind: 'message'
      spec: IProcessSpecDescriptor
      budget: IProcessBudgetDescriptor
    }>
  | Readonly<{ kind: 'connect'; address: string }>

/** Plugin and Host descriptions share deployment data but have disjoint catalogs. */
export type IProcessPluginDescriptor =
  | Readonly<{
      descriptorVersion: 1
      target: 'plugin'
      name: string
      runtime: string
      deployment: IProcessPluginDeploymentDescriptor
      instanceMode?: ProcessPluginInstanceMode
      replaceStrategy?: ReplaceStrategy
      contract: IRemoteContract
    }>
  | Readonly<{
      descriptorVersion: 1
      target: 'host'
      name: string
      runtime: string
      deployment: IProcessPluginDeploymentDescriptor
      replaceStrategy?: ReplaceStrategy
      catalog: IRemoteHostCatalog
    }>

/** Name grammar is the remote contract's one canonical pattern. */
const namePattern = new RegExp(REMOTE_NAME_PATTERN, 'u')

/** A structural error identifies only its field, never its rejected value. */
function invalid(field: string): never {
  throw createProcessError(RpcProcessErrorCode.pluginInvalidOption, undefined, { field })
}

/** Read one already portable record without invoking hostile accessors. */
function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path)
  return value as Readonly<Record<string, unknown>>
}

/** Closed records reject unknown fields before missing required fields. */
function exact(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  path: string
): void {
  for (const key of Object.keys(value))
    if (!required.includes(key) && !optional.includes(key)) invalid(`${path}.${key}`)
  for (const key of required) if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`)
}

/** Secrets are not part of persisted data even inside arbitrary environment keys. */
function rejectToken(value: IRpcPortableValue, path: string): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) rejectToken(item, `${path}.${index}`)
    return
  }
  if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      if (key === 'token') invalid(`${path}.token`)
      rejectToken(item, `${path}.${key}`)
    }
}

/** Plugin and Host names use the same grammar as remote contracts. */
function name(value: unknown, path: string): string {
  if (typeof value !== 'string' || !namePattern.test(value)) invalid(path)
  return value
}

/** Runtime labels and socket addresses are nonempty but do not select adapters. */
function nonempty(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(path)
  return value
}

/** Persisted argument, permission, and environment lists contain only strings. */
function strings(value: unknown, path: string): void {
  if (!Array.isArray(value)) invalid(path)
  for (const item of value) if (typeof item !== 'string') invalid(path)
}

/** Check persisted spec structure; platform admission remains with supervision. */
function specShape(value: unknown, path: string): IProcessSpecDescriptor {
  const spec = record(value, path)
  exact(
    spec,
    ['command', 'args', 'env', 'stdio'],
    ['cwd', 'tmpDir', 'limits', 'permissions', 'bootstrap'],
    path
  )
  nonempty(spec.command, `${path}.command`)
  strings(spec.args, `${path}.args`)
  for (const [index, arg] of (spec.args as readonly string[]).entries()) {
    /** An equals form and a separate value argument are both secret-bearing. */
    const normalized = arg.toLowerCase()
    if (
      PROCESS_DESCRIPTOR_SECRET_ARGUMENTS.some(
        (name) => normalized === name || normalized.startsWith(`${name}=`)
      )
    )
      invalid(`${path}.args.${index}`)
  }
  for (const field of ['cwd', 'tmpDir'])
    if (spec[field] !== undefined) nonempty(spec[field], `${path}.${field}`)
  const env = record(spec.env, `${path}.env`)
  exact(env, ['inherit'], ['set'], `${path}.env`)
  strings(env.inherit, `${path}.env.inherit`)
  if (env.set !== undefined) {
    const set = record(env.set, `${path}.env.set`)
    for (const [key, item] of Object.entries(set)) {
      const literal = record(item, `${path}.env.set.${key}`)
      exact(literal, ['value', 'nonSecret'], [], `${path}.env.set.${key}`)
      if (typeof literal.value !== 'string' || literal.nonSecret !== true)
        invalid(`${path}.env.set.${key}`)
    }
  }
  const stdio = record(spec.stdio, `${path}.stdio`)
  exact(stdio, ['stdin', 'stdout', 'stderr'], [], `${path}.stdio`)
  if (!Object.values(StdinMode).includes(stdio.stdin as StdinMode)) invalid(`${path}.stdio.stdin`)
  if (!Object.values(StdoutMode).includes(stdio.stdout as StdoutMode))
    invalid(`${path}.stdio.stdout`)
  if (!Object.values(StderrMode).includes(stdio.stderr as StderrMode))
    invalid(`${path}.stdio.stderr`)
  if (spec.limits !== undefined) {
    const limits = record(spec.limits, `${path}.limits`)
    exact(limits, [], ['memoryBytes', 'cpuTimeMs', 'callWallTimeMs'], `${path}.limits`)
    for (const [key, item] of Object.entries(limits))
      if (typeof item !== 'number' || !Number.isFinite(item) || item <= 0)
        invalid(`${path}.limits.${key}`)
  }
  if (spec.permissions !== undefined) strings(spec.permissions, `${path}.permissions`)
  if (spec.bootstrap !== undefined) {
    const bootstrap = record(spec.bootstrap, `${path}.bootstrap`)
    exact(bootstrap, ['via'], ['fd'], `${path}.bootstrap`)
    if (bootstrap.via === BootstrapVia.fd) {
      if (!Number.isInteger(bootstrap.fd) || (bootstrap.fd as number) < 3)
        invalid(`${path}.bootstrap.fd`)
    } else if (bootstrap.via === BootstrapVia.stdin) {
      if (bootstrap.fd !== undefined) invalid(`${path}.bootstrap.fd`)
    } else invalid(`${path}.bootstrap.via`)
  }
  return spec as IProcessSpecDescriptor
}

/** Budget limits are checked as data without creating a live budget. */
function budgetShape(value: unknown, path: string): IProcessBudgetDescriptor {
  const budget = record(value, path)
  exact(budget, ['maxUnits'], ['overflow', 'queueTimeoutMs', 'launchRate'], path)
  if (!Number.isSafeInteger(budget.maxUnits) || (budget.maxUnits as number) < 0)
    invalid(`${path}.maxUnits`)
  if (
    budget.overflow !== undefined &&
    !Object.values(BudgetOverflow).includes(budget.overflow as BudgetOverflow)
  )
    invalid(`${path}.overflow`)
  if (
    budget.queueTimeoutMs !== undefined &&
    (typeof budget.queueTimeoutMs !== 'number' ||
      !Number.isFinite(budget.queueTimeoutMs) ||
      budget.queueTimeoutMs <= 0)
  )
    invalid(`${path}.queueTimeoutMs`)
  if (budget.launchRate !== undefined && budget.launchRate !== false) {
    const rate = record(budget.launchRate, `${path}.launchRate`)
    exact(rate, ['max', 'windowMs'], [], `${path}.launchRate`)
    if (!Number.isSafeInteger(rate.max) || (rate.max as number) <= 0)
      invalid(`${path}.launchRate.max`)
    if (typeof rate.windowMs !== 'number' || !Number.isFinite(rate.windowMs) || rate.windowMs <= 0)
      invalid(`${path}.launchRate.windowMs`)
  }
  return budget as IProcessBudgetDescriptor
}

/** One deployment parser owns byte, message, and borrowed connection discrimination. */
function deploymentShape(value: unknown, path: string): IProcessPluginDeploymentDescriptor {
  const deployment = record(value, path)
  if (deployment.kind === 'connect') {
    exact(deployment, ['kind', 'address'], [], path)
    nonempty(deployment.address, `${path}.address`)
    return deployment as IProcessPluginDeploymentDescriptor
  }
  if (deployment.kind !== 'spawn') invalid(`${path}.kind`)
  exact(deployment, ['kind', 'channelKind', 'spec', 'budget'], ['wire'], path)
  const spec = specShape(deployment.spec, `${path}.spec`)
  budgetShape(deployment.budget, `${path}.budget`)
  if (deployment.channelKind === ProcessPluginChannelKind.byte) {
    if (!Object.values(ProcessPluginWire).includes(deployment.wire as ProcessPluginWire))
      invalid(`${path}.wire`)
    if (!spec.bootstrap) invalid(`${path}.spec.bootstrap`)
    if (deployment.wire === ProcessPluginWire.jsonrpc && spec.bootstrap.via !== BootstrapVia.fd)
      invalid(`${path}.spec.bootstrap.via`)
  } else if (deployment.channelKind === ProcessPluginChannelKind.messagePort) {
    if (deployment.wire !== undefined) invalid(`${path}.wire`)
    if (spec.bootstrap !== undefined) invalid(`${path}.spec.bootstrap`)
  } else invalid(`${path}.channelKind`)
  return deployment as IProcessPluginDeploymentDescriptor
}

/** Normalize one portable description without retaining launch ports or secrets. */
export function parseProcessPluginDescriptor(input: unknown): IProcessPluginDescriptor {
  /** Portable normalization rejects getters, cycles, platform objects, and non-finite values. */
  let portable: IRpcPortableValue
  try {
    portable = normalizePortable(input)
  } catch {
    /** A hostile getter may throw a value containing the forbidden token. */
    invalid('descriptor')
  }
  const root = record(portable, 'descriptor')
  /** Method and plugin names are data; only deployment fields can carry a secret. */
  if (root.deployment !== undefined)
    rejectToken(root.deployment as IRpcPortableValue, 'descriptor.deployment')
  const target = root.target ?? ProcessDescriptorTarget.plugin
  if (target !== ProcessDescriptorTarget.plugin && target !== ProcessDescriptorTarget.host)
    invalid('descriptor.target')
  const common = ['descriptorVersion', 'name', 'runtime', 'deployment']
  if (target === ProcessDescriptorTarget.plugin)
    exact(
      root,
      [...common, 'contract'],
      ['target', 'instanceMode', 'replaceStrategy'],
      'descriptor'
    )
  else exact(root, [...common, 'target', 'catalog'], ['replaceStrategy'], 'descriptor')
  if (root.descriptorVersion !== PROCESS_PLUGIN_DESCRIPTOR_VERSION)
    invalid('descriptor.descriptorVersion')
  const pluginName = name(root.name, 'descriptor.name')
  const runtime = nonempty(root.runtime, 'descriptor.runtime')
  const deployment = deploymentShape(root.deployment, 'descriptor.deployment')
  if (root.replaceStrategy !== undefined) {
    if (!Object.values(ReplaceStrategy).includes(root.replaceStrategy as ReplaceStrategy))
      invalid('descriptor.replaceStrategy')
    if (deployment.kind === 'connect') invalid('descriptor.replaceStrategy')
  }
  const replacement =
    root.replaceStrategy === undefined
      ? {}
      : { replaceStrategy: root.replaceStrategy as ReplaceStrategy }
  if (target === ProcessDescriptorTarget.host) {
    const catalog = normalizeRemoteHostCatalog(root.catalog)
    return Object.freeze({
      descriptorVersion: PROCESS_PLUGIN_DESCRIPTOR_VERSION,
      target,
      name: pluginName,
      runtime,
      deployment,
      ...replacement,
      catalog
    })
  }
  if (
    root.instanceMode !== undefined &&
    root.instanceMode !== ProcessPluginInstanceMode.shared &&
    root.instanceMode !== ProcessPluginInstanceMode.perConnection
  )
    invalid('descriptor.instanceMode')
  const contract = normalizeRemoteContract(root.contract)
  if (contract.plugin !== pluginName) invalid('descriptor.name')
  return Object.freeze({
    descriptorVersion: PROCESS_PLUGIN_DESCRIPTOR_VERSION,
    target,
    name: pluginName,
    runtime,
    deployment,
    ...(root.instanceMode === undefined
      ? {}
      : { instanceMode: root.instanceMode as ProcessPluginInstanceMode }),
    ...replacement,
    contract
  })
}
