import type { IRpcAuthenticationConfig } from '@migaia/rpc-core'

/** The shared native Worker fixture supplies only ordinary sign/verify credentials. */
export function createFixtureAuthentication(): Required<
  Pick<IRpcAuthenticationConfig, 'sign' | 'verify'>
>
