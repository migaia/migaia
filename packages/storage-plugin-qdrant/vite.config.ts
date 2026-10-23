import {defineConfig} from 'vite'
/** The genuine SDK is used only through the client adapter boundary. */
export default defineConfig({build:{target:'es2022',lib:{entry:{index:'src/index.ts',http:'src/http.ts',client:'src/client.ts'},formats:['es'],fileName:(_format,name)=>`${name}.js`},sourcemap:true,rollupOptions:{external:(id)=>id.startsWith('@migaia/')||id==='@qdrant/js-client-rest'}}})
