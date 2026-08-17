import { StorageError } from '../types/errors.js';
import { isStorageContractError, type StorageContractError } from '@migaia/storage-contract';

/**
 * 识别两类 storage 错误（web + contract），供归一化/重抛/解包路径统一使用。 contract 错误默认原样穿透（identity/source/code/cause
 * 保留），只有「非 storage 家族」的未知异常才归一化成 web 错误。
 */
export const isStorageErrorFamily = (
  value: unknown
): value is StorageError | StorageContractError =>
  value instanceof StorageError || isStorageContractError(value);
