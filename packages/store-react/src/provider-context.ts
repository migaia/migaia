import { createContext } from 'react'
import type { StoreRegistry } from './provider-registry.ts'

export const StoreRegistryContext = createContext<StoreRegistry | null>(null)
