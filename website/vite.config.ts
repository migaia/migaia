import { reactRouter } from '@react-router/dev/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Connects React Router's framework route graph to Vite and its Oxc-native
 * React Compiler transform; no second JSX or server-rendering pipeline exists.
 */
export default defineConfig({
  plugins: [reactRouter(), react({ compiler: true })],
  resolve: {
    tsconfigPaths: true
  },
  preview: {
    host: '127.0.0.1'
  }
})
