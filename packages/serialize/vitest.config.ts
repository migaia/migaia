import { defineConfig } from 'vitest/config';
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs';

export default defineConfig(withDistFreshness({}));
