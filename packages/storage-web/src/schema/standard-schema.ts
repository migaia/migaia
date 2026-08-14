import { StorageError, StorageErrorCode } from '../types/errors';
import type { ISchemaAdapter } from './types';

/**
 * [Standard Schema](https://standardschema.dev) 的最小契约。zod ≥3.24、 valibot ≥1.0、arktype ≥2.0
 * 都实现了该规范，一个适配器覆盖三家。 本包不 import 任何一家，也不把它们列为 peerDependency。
 */
export type IStandardSchemaV1<TInput = unknown, TOutput = TInput> = {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    validate(
      value: unknown
    ):
      | { readonly value: TOutput; readonly issues?: undefined }
      | { readonly issues: ReadonlyArray<{ readonly message: string }> }
      | Promise<
          | { readonly value: TOutput; readonly issues?: undefined }
          | { readonly issues: ReadonlyArray<{ readonly message: string }> }
        >;
  };
};

/** 适配任意实现了 Standard Schema 规范的校验库。 */
export const fromStandardSchema = <T>(
  schema: IStandardSchemaV1<unknown, T>
): ISchemaAdapter<T, T> => {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema))
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new TypeError('Standard Schema must be an object')
    });
  let standard: unknown;
  try {
    standard = (schema as { readonly '~standard'?: unknown })['~standard'];
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidArgument, { cause });
  }
  if (typeof standard !== 'object' || standard === null || Array.isArray(standard))
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new TypeError('Standard Schema must provide version 1, vendor, and validate')
    });
  const candidate = standard as Record<string, unknown>;
  let version: unknown;
  let vendor: unknown;
  let validate: unknown;
  try {
    version = candidate.version;
    vendor = candidate.vendor;
    validate = candidate.validate;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidArgument, { cause });
  }
  if (
    version !== 1 ||
    typeof vendor !== 'string' ||
    vendor.trim() === '' ||
    typeof validate !== 'function'
  )
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new TypeError('Standard Schema must provide version 1, vendor, and validate')
    });
  return {
    name: `standard-schema:${vendor}`,
    validate: async (value) => {
      const result: unknown = await (
        validate as IStandardSchemaV1<unknown, T>['~standard']['validate']
      )(value);
      if (typeof result !== 'object' || result === null || Array.isArray(result))
        throw new StorageError(StorageErrorCode.validationFailed, {
          cause: new TypeError('Standard Schema returned an invalid result')
        });
      const resultCandidate = result as Record<string, unknown>;
      let issues: unknown;
      let hasValue: boolean;
      let output: unknown;
      try {
        issues = resultCandidate.issues;
        hasValue = Object.hasOwn(resultCandidate, 'value');
        if (issues === undefined && hasValue) output = resultCandidate.value;
      } catch (cause) {
        throw new StorageError(StorageErrorCode.validationFailed, { cause });
      }
      if (issues !== undefined) {
        if (!Array.isArray(issues))
          throw new StorageError(StorageErrorCode.validationFailed, {
            cause: new TypeError('Standard Schema returned invalid issues')
          });
        const messages: string[] = [];
        try {
          for (const issue of issues) {
            if (typeof issue !== 'object' || issue === null || Array.isArray(issue))
              throw new TypeError('Standard Schema returned invalid issues');
            const message = (issue as { readonly message?: unknown }).message;
            if (typeof message !== 'string')
              throw new TypeError('Standard Schema returned invalid issues');
            messages.push(message);
          }
        } catch (cause) {
          throw new StorageError(StorageErrorCode.validationFailed, { cause });
        }
        throw new StorageError(StorageErrorCode.validationFailed, {
          cause: new Error(messages.join('; '))
        });
      }
      if (!hasValue)
        throw new StorageError(StorageErrorCode.validationFailed, {
          cause: new TypeError('Standard Schema result must contain value or issues')
        });
      return output as T;
    }
  };
};
