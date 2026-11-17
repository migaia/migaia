import type { IRpcAuthenticationOptions } from '@migaia/rpc-host/features/auth'

/** The shared native Worker fixture supplies only ordinary sign/verify credentials. */
export function createFixtureAuthentication(): Required<
  Pick<IRpcAuthenticationOptions, 'sign' | 'verify'>
>
