import { reactRouter } from '@react-router/dev/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Keeps Oxc JSX and React Compiler transforms while React Router exclusively owns dev refresh. */
const reactTransforms = react({ compiler: true }).filter(
  (plugin) => !/refresh|preamble/.test(plugin.name)
)

/**
 * Connects React Router's framework route graph to Vite and its Oxc-native
 * React Compiler transform; no second JSX or server-rendering pipeline exists.
 */
export default defineConfig({
  plugins: [...reactTransforms, reactRouter()],
  resolve: {
    tsconfigPaths: true
  },
  preview: {
    host: '127.0.0.1'
  }
})
