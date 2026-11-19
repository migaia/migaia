/** `partom publish|promote|rollback|history`: catalog environment commands. */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hashBytes, parseSnapshot } from '@migaia/part-contract'
import { ExitCode, flag, type IArgs } from '../args.ts'
import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError, PartCliText } from '../errors.ts'
import { releaseData, releaseProject } from './child.ts'
import { CatalogClient, type ICallOutcome } from './service.ts'
import { BuildFile, DEFAULT_BUILD_DIR, DEFAULT_ENV, ReleaseMode, ReleaseText } from './text.ts'

/** Value of a required flag, or USAGE_INVALID. */
export function required(args: IArgs, name: string): string {
  /** Flag value. */
  const value = flag(args, name)
  if (value === undefined || value === '')
    throw createPartCliError(PartCliErrorCode.usageInvalid, PartCliText.usage)
  return value
}

/** Prints a 4xx body and returns exit 1; returns undefined for a success. */
export function rejected(outcome: ICallOutcome): number | undefined {
  if (outcome.ok) return undefined
  console.error(outcome.body)
  return ExitCode.problems
}

/** Client for the project named in the config. */
export async function configClient(args: IArgs): Promise<CatalogClient> {
  /** Project directory. */
  const dir = resolve(flag(args, '--project') ?? process.cwd())
  /** Release settings. */
  const data = await releaseData(dir, flag(args, '--config'), [ReleaseMode.release])
  return new CatalogClient(
    required(args, '--service'),
    releaseProject(data, ReleaseText.configMissing)
  )
}

/**
 * `partom publish`: uploads every module, the snapshot bytes and the sources of a build, then moves
 * the environment (default `dev`) to the snapshot. The project comes from the snapshot's lock.
 */
async function publish(args: IArgs): Promise<number> {
  /** Build directory. */
  const dir = resolve(
    flag(args, '--project') ?? process.cwd(),
    flag(args, '--dir') ?? DEFAULT_BUILD_DIR
  )
  /** Snapshot bytes. */
  const bytes = new Uint8Array(readFileSync(join(dir, BuildFile.snapshot)))
  /** Snapshot hash. */
  const hash = await hashBytes(bytes)
  /** Catalog client. */
  const client = new CatalogClient(required(args, '--service'), parseSnapshot(bytes).lock.project)
  /** Built module files. */
  const files = readdirSync(join(dir, BuildFile.modules), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  for (const file of files) {
    /** Upload outcome. */
    const failed = rejected(
      await client.call(
        'PUT',
        `m/${file}`,
        readFileSync(join(dir, BuildFile.modules, file)),
        'text/javascript'
      )
    )
    if (failed !== undefined) return failed
  }
  /** Remaining uploads in order. */
  const steps: (() => Promise<ICallOutcome>)[] = [
    () => client.call('PUT', `snapshots/${hash}`, bytes, 'application/json'),
    () =>
      client.call(
        'PUT',
        `snapshots/${hash}/sources`,
        readFileSync(join(dir, BuildFile.sources)),
        'application/json'
      ),
    () =>
      client.json('POST', `env/${flag(args, '--env') ?? DEFAULT_ENV}/publish`, { snapshot: hash })
  ]
  /** Last response. */
  let last: Response | undefined
  for (const step of steps) {
    /** Step outcome. */
    const outcome = await step()
    if (!outcome.ok) return rejected(outcome) as number
    last = outcome.response
  }
  console.log(await (last as Response).text())
  return ExitCode.ok
}

/** Prints a successful response body. */
async function printed(outcome: ICallOutcome): Promise<number> {
  if (!outcome.ok) return rejected(outcome) as number
  console.log(await outcome.response.text())
  return ExitCode.ok
}

/** `partom promote --env <env> --from <env>`. */
async function promote(args: IArgs): Promise<number> {
  /** Catalog client. */
  const client = await configClient(args)
  return printed(
    await client.json('POST', `env/${required(args, '--env')}/promote`, {
      from: required(args, '--from')
    })
  )
}

/**
 * `partom rollback --env <env> --to <tag|snapshot>`: a tag is resolved through the environment's
 * history; anything else is sent as a snapshot hash and the catalog decides.
 */
async function rollback(args: IArgs): Promise<number> {
  /** Catalog client. */
  const client = await configClient(args)
  /** Environment. */
  const env = required(args, '--env')
  /** Target tag or hash. */
  const to = required(args, '--to')
  /** History of the environment. */
  const history = await client.call('GET', `env/${env}/history`)
  if (!history.ok) return rejected(history) as number
  /** History entry with the tag. */
  const entry = ((await history.response.json()) as { tag: string; snapshot: string }[]).find(
    (item) => item.tag === to
  )
  return printed(
    await client.json('POST', `env/${env}/rollback`, { snapshot: entry?.snapshot ?? to })
  )
}

/** `partom history --env <env>`. */
async function history(args: IArgs): Promise<number> {
  /** Catalog client. */
  const client = await configClient(args)
  return printed(await client.call('GET', `env/${required(args, '--env')}/history`))
}

/** Catalog environment commands by name. */
export const EnvironmentCommand = { publish, promote, rollback, history } as const
