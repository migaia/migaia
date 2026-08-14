import { createContext } from 'react';
import type { StoreRegistry } from './provider-registry';

export const StoreRegistryContext = createContext<StoreRegistry | null>(null);
