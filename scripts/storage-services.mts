#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** The compose file owns both service definitions and the test environment they expose. */
const composeFile = fileURLToPath(
  new URL('../docker/storage-services.compose.yml', import.meta.url)
)
/** One local project keeps data available across independently serialized backend test windows. */
const projectName = 'migai-storage'
/** CLI actions are intentionally limited to service startup, inspection and environment injection. */
const Command = { build: 'build', up: 'up', status: 'status', env: 'env', run: 'run' } as const
/** Stable command messages belong here rather than in the backend packages. */
const Text = {
  usage: 'Usage: node scripts/storage-services.mts build|up|status|env|run -- <command...>',
  environmentFailure: (service: string, status: number | null) =>
    `storage-services: environment failure starting ${service} (exit ${status ?? 'unknown'})`,
  missingCommand: 'storage-services: run requires a command after --'
}
/** Only repository-owned fixture fields consumed by this script cross the JSON boundary. */
type IComposeConfig = {
  services: Record<string, unknown>
  'x-storage-test-environment': Record<string, string>
  'x-storage-init-services': readonly string[]
}

/** Runs the existing Docker Compose CLI, respecting the caller's Docker context. */
function compose(args: readonly string[], capture = false) {
  return spawnSync(
    'docker',
    ['compose', '--project-name', projectName, '--file', composeFile, ...args],
    {
      encoding: 'utf8',
      stdio: capture ? 'pipe' : 'inherit'
    }
  )
}

/** Keeps the original child error visible and returns its actual process status. */
function childStatus(result: ReturnType<typeof compose>): number {
  if (result.error !== undefined) console.error(result.error)
  return result.status ?? 1
}

/** The caller chooses an action; omitted action only inspects existing containers. */
const command = process.argv[2] ?? Command.status
if (command === Command.status) {
  process.exit(childStatus(compose(['ps', '--all'])))
}
if (command === Command.build) {
  process.exit(childStatus(compose([Command.build])))
}
if (!Object.values(Command).includes(command as (typeof Command)[keyof typeof Command])) {
  console.error(Text.usage)
  process.exit(64)
}

/** Compose resolves port substitutions once, so emitted URLs match its actual configuration. */
const configuration = compose(['config', '--format', 'json'], true)
if (configuration.status !== 0) {
  if (configuration.stderr) process.stderr.write(configuration.stderr)
  process.exit(childStatus(configuration))
}
/** These are repository-owned fixture values, never credentials discovered from user accounts. */
const config = JSON.parse(configuration.stdout) as IComposeConfig
/** The same fixture environment is printed for shells or passed directly to the real test command. */
const environment = config['x-storage-test-environment']

if (command === Command.env) {
  for (const [name, value] of Object.entries(environment))
    console.log(`export ${name}='${value.replaceAll("'", "'\\''")}'`)
} else if (command === Command.up) {
  /** A missing image or failed service must not prevent independent services from starting. */
  let status = 0
  for (const service of Object.keys(config.services)) {
    /** Jobs settle by exit status; server readiness stays owned by Compose health checks. */
    const args = config['x-storage-init-services'].includes(service)
      ? [Command.run, '--rm', '--no-deps', service]
      : [Command.up, '-d', '--no-build', '--wait', '--wait-timeout', '120', service]
    /** Image builds belong in their existing exclusive window, outside this detached startup. */
    const result = compose(args)
    if (childStatus(result) !== 0) {
      console.error(Text.environmentFailure(service, result.status))
      status = 1
    }
  }
  process.exitCode = status
} else {
  /** Arguments remain an array; no shell expansion or second test runner is introduced. */
  const args = process.argv.slice(process.argv[3] === '--' ? 4 : 3)
  if (args.length === 0) {
    console.error(Text.missingCommand)
    process.exit(64)
  }
  /** The existing test command and exclusive-window runner retain all execution ownership. */
  const result = spawnSync(args[0]!, args.slice(1), {
    env: { ...process.env, ...environment },
    stdio: 'inherit',
    encoding: 'utf8'
  })
  process.exitCode = childStatus(result)
}
