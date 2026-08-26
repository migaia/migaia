import { createContext } from 'react'
import type { StoreRegistry } from './provider-registry.js'

export const StoreRegistryContext = createContext<StoreRegistry | null>(null)
