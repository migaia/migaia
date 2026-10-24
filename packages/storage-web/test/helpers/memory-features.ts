import { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'
import { memoryChangeFeedFeature } from '@migaia/storage-host/features/memory-change-feed'

/** Existing memory behavior fixtures explicitly select their original notification surfaces. */
export const memoryTestFeatures = {
  notifications: memoryNotificationsFeature(),
  changeFeed: memoryChangeFeedFeature()
} as const
