import { ReduxDevToolsCommand, type IReduxDevToolsCommand } from '@migaia/store-middleware'
// @ts-expect-error moves extension vocabulary to its actual adapter owner.
import { StoreDevtoolsCommand } from '../src/index.ts'
// @ts-expect-error removes the old local diagnostic type export.
import type { IStoreDevtoolsCommand } from '../src/index.ts'
// @ts-expect-error Diagnostic error classification is private implementation.
import { identifyDevtoolsFailure } from '../src/index.ts'

/** The existing protocol owner supplies the unchanged wire value and public union. */
const command: IReduxDevToolsCommand = ReduxDevToolsCommand.jumpToState
void command
void StoreDevtoolsCommand
void (undefined as unknown as IStoreDevtoolsCommand)
void identifyDevtoolsFailure
