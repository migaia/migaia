/**
 * Release data collected inside the doctor child (`partom doctor --json --snapshot|--manifest-data
 * |--release-data`), so the compiled executable loads the config the same way `partom types` does.
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ICatalogView, IDescriptor, IIssue } from '@migaia/part-contract'
import type { IDefinition, IPartHost, IPartHostOptions } from '@migaia/part-host'
import type { IPartomConfig, IReleaseConfig, Project } from '../project.ts'
import { REMOTE_MODULES_PLUGIN, ReleaseMode, ReleaseRule, ReleaseText } from './text.ts'

/** One blueprint of the config: id, file relative to the project and its own static issues. */
export type IReleaseBlueprint = {
  readonly id: string
  readonly file: string
  readonly issues: readonly IIssue[]
  /** Definitions it references and their descriptors (manifest mode, for `--inline`). */
  readonly definitions?: readonly string[]
}

/** One part module of `release.parts`: file relative to the project and its part descriptors. */
export type IPartModule = { readonly file: string; readonly parts: readonly IDescriptor[] }

/** Data printed by the release child. */
export type IReleaseData = {
  readonly release: IReleaseConfig
  readonly blueprints: readonly IReleaseBlueprint[]
  readonly issues: readonly IIssue[]
  readonly definitions?: readonly string[]
  readonly descriptors?: readonly IDescriptor[]
  readonly manifest?: unknown
  readonly parts?: readonly IPartModule[]
}

/** The project bundle members the collector uses. */
type IBundle = Awaited<ReturnType<Project['bundle']>>

/** One remote entry: its file relative to the project and its default-exported definitions. */
type IRemoteEntry = { readonly file: string; readonly definitions: readonly IDefinition[] }

/** Files matched by globs under `base`, absolute, in glob order. */
export function globFiles(base: string, patterns: readonly string[]): string[] {
  /** Matched files. */
  const files: string[] = []
  for (const pattern of patterns)
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: base })) files.push(join(base, file))
  return files
}

/** Remote entry files of the release config, absolute, in glob order. */
export function remoteEntries(dir: string, release: IReleaseConfig): string[] {
  return release.remote === undefined
    ? []
    : globFiles(join(dir, release.remote.root), release.remote.modules)
}

/** Imports every remote entry directly; the default export is a definition or a list of them. */
async function importRemote(dir: string, release: IReleaseConfig): Promise<IRemoteEntry[]> {
  /** Imported entries. */
  const entries: IRemoteEntry[] = []
  for (const file of remoteEntries(dir, release)) {
    /** Default export. */
    const value = ((await import(file)) as { default?: unknown }).default
    entries.push({
      file: relative(dir, file),
      definitions: (Array.isArray(value) ? value : [value]) as IDefinition[]
    })
  }
  return entries
}

/** Error issue of one remote entry. */
function entryIssue(file: string, rule: string, message: string): IIssue {
  return {
    address: '',
    facet: 'module',
    path: file,
    code: rule,
    rule,
    messageKey: message,
    severity: 'error'
  }
}

/** `release.remote-in-config` issues: remote definitions the configured catalog already has. */
function remoteInConfig(host: IPartHost, entries: readonly IRemoteEntry[]): IIssue[] {
  /** Issues found. */
  const issues: IIssue[] = []
  for (const entry of entries)
    for (const definition of entry.definitions)
      if (host.catalog.get(definition.descriptor.id) !== undefined)
        issues.push(
          entryIssue(
            entry.file,
            ReleaseRule.remoteInConfig,
            ReleaseText.remoteInConfig(definition.descriptor.id)
          )
        )
  return issues
}

/** Installs every remote definition as one `remote:modules` plugin, as the client does. */
async function installRemote(
  host: IPartHost,
  bundle: IBundle,
  entries: readonly IRemoteEntry[]
): Promise<void> {
  /** Definitions by kind. */
  const lists = {
    enhancers: [] as IDefinition[],
    derives: [] as IDefinition[],
    effects: [] as IDefinition[]
  }
  for (const entry of entries)
    for (const definition of entry.definitions) {
      if (definition.descriptor.kind === 'enhancer') lists.enhancers.push(definition)
      else if (definition.descriptor.kind === 'derive') lists.derives.push(definition)
      else lists.effects.push(definition)
    }
  /** The project's plugin factory, sharing the host's plugin-host copy. */
  const definePartPlugin = bundle.definePartPlugin as (spec: object) => never
  await host.use(definePartPlugin({ name: REMOTE_MODULES_PLUGIN, ...lists }))
}

/** Host of the config without a renderer; the DOM plugin is added when the config omits it. */
function createHost(bundle: IBundle): Promise<IPartHost> {
  /** Host factory. */
  const createPartHost = bundle.createPartHost as (options: IPartHostOptions) => Promise<IPartHost>
  /** Configured plugins. */
  const configured = bundle.config.plugins as NonNullable<IPartHostOptions['plugins']>
  /** The project's DOM plugin. */
  const dom = bundle.domPlugin as NonNullable<IPartHostOptions['plugins']>[number]
  return createPartHost({
    plugins: configured.some((plugin) => plugin.name === dom.name)
      ? configured
      : [dom, ...configured],
    onError: () => undefined
  })
}

/** Loads every blueprint of the config; a thrown load becomes one `release.load` issue. */
async function loadBlueprints(
  project: Project,
  config: IPartomConfig,
  host: IPartHost
): Promise<{ readonly entries: IReleaseBlueprint[]; readonly documents: unknown[] }> {
  /** Entries in config order. */
  const entries: IReleaseBlueprint[] = []
  /** Authored documents in config order. */
  const documents: unknown[] = []
  for (const file of project.blueprintFiles(config)) {
    /** Authored document. */
    const document = JSON.parse(readFileSync(file, 'utf8')) as { readonly id: string }
    /** Static issues. */
    let issues: readonly IIssue[]
    try {
      issues = (await host.blueprint.load(document)).issues
    } catch (cause) {
      issues = [
        {
          ...entryIssue(
            relative(project.dir, file),
            ReleaseRule.load,
            ReleaseText.load(document.id)
          ),
          cause
        }
      ]
    }
    entries.push({ id: document.id, file: relative(project.dir, file), issues })
    documents.push(document)
  }
  return { entries, documents }
}

/** Part descriptors exported by each `release.parts` module. */
async function partModules(dir: string, release: IReleaseConfig): Promise<IPartModule[]> {
  /** Modules in glob order. */
  const modules: IPartModule[] = []
  for (const file of globFiles(dir, release.parts ?? [])) {
    /** Exported values. */
    const exported = Object.values((await import(file)) as Record<string, unknown>)
    /** Part descriptors among them. */
    const parts: IDescriptor[] = []
    for (const value of exported) {
      /** Descriptor, when the value is a definition. */
      const descriptor = (value as { descriptor?: IDescriptor } | null)?.descriptor
      if (descriptor?.kind === 'part') parts.push(descriptor)
    }
    modules.push({ file: relative(dir, file), parts })
  }
  return modules
}

/** Descriptors of `ids` the catalog has, in id order. */
function descriptorsOf(view: ICatalogView, ids: readonly string[]): IDescriptor[] {
  /** Found descriptors. */
  const found: IDescriptor[] = []
  for (const id of ids) {
    /** Descriptor of the id. */
    const descriptor = view.get(id)
    if (descriptor !== undefined) found.push(descriptor)
  }
  return found
}

/**
 * `--snapshot`: loads the config, checks remote entries against it, installs them as
 * `remote:modules`, loads every blueprint and collects definitions and descriptors.
 */
async function snapshotData(
  project: Project,
  bundle: IBundle,
  host: IPartHost
): Promise<IReleaseData> {
  /** Release settings. */
  const release = bundle.config.release ?? {}
  /** Remote entries. */
  const remote = await importRemote(project.dir, release)
  /** Conflicts with the config. */
  const issues = remoteInConfig(host, remote)
  if (issues.length === 0) await installRemote(host, bundle, remote)
  /** Loaded blueprints. */
  const loaded = await loadBlueprints(project, bundle.config, host)
  /** Definition collector of the project. */
  const collectDefinitions = bundle.collectDefinitions as (
    docs: unknown[],
    view: ICatalogView
  ) => string[]
  /** Referenced definitions. */
  const definitions = collectDefinitions(loaded.documents, host.catalog.view())
  return {
    release,
    blueprints: loaded.entries,
    issues,
    definitions,
    descriptors: descriptorsOf(host.catalog.view(), definitions)
  }
}

/**
 * `--manifest-data --build <name>`: the manifest of the config alone (remote modules are not
 * installed), remote-in-config issues, part modules and each blueprint's definitions with all
 * descriptors.
 */
async function manifestData(
  project: Project,
  bundle: IBundle,
  host: IPartHost,
  build: string
): Promise<IReleaseData> {
  /** Release settings. */
  const release = bundle.config.release ?? {}
  /** Conflicts with the config. */
  const issues = remoteInConfig(host, await importRemote(project.dir, release))
  /** Loaded blueprints. */
  const loaded = await loadBlueprints(project, bundle.config, host)
  /** Definition collector of the project. */
  const collectDefinitions = bundle.collectDefinitions as (
    docs: unknown[],
    view: ICatalogView
  ) => string[]
  /** Blueprints with their own definitions. */
  const blueprints = loaded.entries.map((entry, index) => ({
    ...entry,
    definitions: collectDefinitions([loaded.documents[index]], host.catalog.view())
  }))
  return {
    release,
    blueprints,
    issues,
    descriptors: [...host.catalog.view().all()],
    manifest: host.catalog.manifest(build),
    parts: await partModules(project.dir, release)
  }
}

/** Runs one release mode in the doctor child and returns its JSON data. */
export async function collectRelease(
  project: Project,
  config: string | undefined,
  mode: string,
  build: string
): Promise<IReleaseData> {
  /** Project bundle. */
  const bundle = await project.bundle(config)
  /** Host of the config. */
  const host = await createHost(bundle)
  try {
    if (mode === ReleaseMode.snapshot) return await snapshotData(project, bundle, host)
    if (mode === ReleaseMode.manifest) return await manifestData(project, bundle, host, build)
    return {
      release: bundle.config.release ?? {},
      blueprints: project.blueprintFiles(bundle.config).map((file) => ({
        id: (JSON.parse(readFileSync(file, 'utf8')) as { id: string }).id,
        file: relative(project.dir, file),
        issues: []
      })),
      issues: []
    }
  } finally {
    await host.dispose()
  }
}
