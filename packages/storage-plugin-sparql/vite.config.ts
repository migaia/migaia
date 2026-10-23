import { defineConfig } from 'vite'
/** The native WASM implementation is loaded only through its explicit adapter entry. */
export default defineConfig({build:{target:'es2022',lib:{entry:{index:'src/index.ts',http:'src/http.ts',oxigraph:'src/oxigraph.ts'},formats:['es'],fileName:(_format,name)=>`${name}.js`},sourcemap:true,rollupOptions:{external:(id)=>id.startsWith('@migaia/')||id==='n3'||id==='oxigraph'}}})
