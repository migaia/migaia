import { normalizeRemoteHostCatalog } from '../../remote/contract.js'
import { serveRemoteHost } from '../../remote/serve-host.js'
import { serveProcessSessions } from '../plugin/serve.js'
import { reportSafely } from '../plugin/binding.js'
import { createProcessResilience } from '../resilience/index.js'
import type { IProcessRegistrationListener } from '../resilience/types.js'
import { invalidHostOption, hostCleanupFailure } from './error.js'
import { adoptHostRegistration, type IAdoptedHostRegistration } from './registration.js'
import type { IProcessServeHostOptions, IProcessServeHostHandle } from './types.js'

/** Serve a borrowed target Host through the canonical process session and remote control owners. */
export async function createServeProcessHost(
  options: IProcessServeHostOptions
): Promise<IProcessServeHostHandle> {
  /** Invalid catalog/resolver must be rejected before opening an ingress or publishing providers. */
  const catalog = normalizeRemoteHostCatalog(options.catalog)
  if (typeof options.resolvePlugin !== 'function') invalidHostOption('resolvePlugin')
  if (!options.scheduler || typeof options.scheduler.schedule !== 'function')
    invalidHostOption('scheduler')
  if (
    options.ingress.kind === 'listener' &&
    options.ingress.scheduler &&
    options.ingress.scheduler !== options.scheduler
  )
    invalidHostOption('scheduler')
  if (options.registrations) {
    if (typeof options.registrations.resolveRegistration !== 'function')
      invalidHostOption('registrations.resolveRegistration')
    if (typeof options.registrations.verifyToken !== 'function')
      invalidHostOption('registrations.verifyToken')
    if (options.registrations.scheduler && options.registrations.scheduler !== options.scheduler)
      invalidHostOption('registrations.scheduler')
  }
  /** Only the default governor is owned; it is shared by all ingress and reverse sessions. */
  const resilience =
    options.resilience ??
    createProcessResilience({ scheduler: options.scheduler, report: options.report })
  /** Adopted plugins remain owned independently of the listener's accept lifetime. */
  const adopted = new Set<IAdoptedHostRegistration>()
  /** Closing must also join installs that were cancelled before their callback could adopt. */
  const preparing = new Set<Promise<'adopt' | 'reject'>>()
  /** Only this service owns the reverse listener opened during construction. */
  let listener: IProcessRegistrationListener | undefined
  /** The shared process helper owns the ingress sessions and their parent-loss guard. */
  let sessions: IProcessServeHostHandle | undefined
  try {
    if (options.registrations)
      listener = await resilience.listenRegistrations({
        ...options.registrations,
        scheduler: options.scheduler,
        wire: 'native',
        onCandidate(candidate) {
          const task = adoptHostRegistration(candidate, options, resilience, adopted)
          preparing.add(task)
          return task.finally(() => preparing.delete(task))
        }
      })
    sessions = await serveProcessSessions(
      options.ingress.kind === 'listener'
        ? { ...options.ingress, scheduler: options.scheduler }
        : options.ingress,
      options.endpointFactory,
      ({ endpoint }) =>
        serveRemoteHost({
          host: options.host,
          catalog,
          resolvePlugin: options.resolvePlugin,
          endpoint,
          report: options.report
        }),
      resilience,
      options.report,
      undefined,
      options.scheduler
    )
  } catch (error) {
    try {
      await listener?.close()
    } catch (cleanupError) {
      reportSafely(options.report, cleanupError)
    }
    await Promise.allSettled(preparing)
    for (const entry of adopted) {
      try {
        await entry.close()
      } catch (cleanupError) {
        reportSafely(options.report, cleanupError)
      }
    }
    if (!options.resilience) {
      try {
        await resilience.close()
      } catch (cleanupError) {
        reportSafely(options.report, cleanupError)
      }
    }
    throw error
  }
  /** One close result joins listener cancellation, session drains, adoptions and owned governance. */
  let closing: Promise<void> | undefined
  return Object.freeze({
    close: () =>
      (closing ??= (async () => {
        /** Preserve each cleanup failure in trigger order so the primary stays reachable. */
        const errors: unknown[] = []
        try {
          await listener?.close()
        } catch (error) {
          errors.push(error)
        }
        await Promise.allSettled(preparing)
        /** Join independent cleanup owners before aggregating their failure outcomes. */
        const outcomes = await Promise.allSettled([
          sessions!.close(),
          ...[...adopted].map((entry) => entry.close())
        ])
        for (const outcome of outcomes)
          if (outcome.status === 'rejected') errors.push(outcome.reason)
        if (!options.resilience) {
          try {
            await resilience.close()
          } catch (error) {
            errors.push(error)
          }
        }
        if (errors.length) throw hostCleanupFailure(errors)
      })())
  })
}
