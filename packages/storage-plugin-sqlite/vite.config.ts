import { defineConfig } from 'vite'
/** Native builtins load only through their explicit driver entries. */
export default defineConfig({build:{target:'es2022',lib:{entry:{index:'src/index.ts',node:'src/node.ts',bun:'src/bun.ts','features/maintenance':'src/features/maintenance.ts'},formats:['es'],fileName:(_format,name)=>`${name}.js`},sourcemap:true,rollupOptions:{external:(id)=>id.startsWith('@migaia/')||id==='node:sqlite'||id==='bun:sqlite'}}})
