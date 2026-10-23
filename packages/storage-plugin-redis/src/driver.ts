import type { IStorageResource } from '@migaia/storage-contract'
/** Fixed command consumers validate their own native reply, including RESP3 values. */
export type IRedisReply = unknown
/** Native EXEC entries preserve each original error rather than claiming rollback. */
export type IRedisExecEntry =
  | { readonly ok: true; readonly value: IRedisReply }
  | { readonly ok: false; readonly error: Error }
/** The callback borrows the genuine client without acquiring connection ownership. */
export type IRedisBorrowedClient<TClient extends object> = Omit<
  TClient,
  | 'connect'
  | 'close'
  | 'destroy'
  | 'disconnect'
  | 'quit'
  | 'end'
  | 'duplicate'
  | 'createPool'
  | typeof Symbol.asyncDispose
>
/** The native pool or duplicate owns this connection until the complete callback settles. */
export type IRedisConnection<TClient extends object = object> = {
  getClient(): IRedisBorrowedClient<TClient>
  command(args: readonly string[]): Promise<IRedisReply>
  exec(
    commands: readonly (readonly (string | Uint8Array)[])[]
  ): Promise<readonly IRedisExecEntry[] | null>
  readonly binaryCommand?: (args: readonly (string | Uint8Array)[]) => Promise<IRedisReply>
}
/** One neutral port shares the original native connection and subscription owners. */
export type IRedisDriver<TClient extends object = object> = {
  command(args: readonly string[]): Promise<IRedisReply>
  withConnection<TResult>(
    run: (connection: IRedisConnection<TClient>) => Promise<TResult>
  ): Promise<TResult>
  subscribe(channel: string, listener: (message: string) => void): Promise<IStorageResource>
}
