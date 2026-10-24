import { defineConfig } from 'vite'
/** Archive keeps native drivers and borrowed host ownership outside its neutral entry. */
export default defineConfig({build:{target:'es2022',lib:{entry:'src/index.ts',formats:['es'],fileName:'index'},sourcemap:true,rollupOptions:{external:(id)=>id.startsWith('@migaia/')}}})
