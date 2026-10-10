import { fileURLToPath } from 'node:url'

/** Every entry is an independent language fixture, including the handwritten TS oracle. */
export const peers = [
  {
    language: 'python',
    id: 'python-peer',
    command: 'python3',
    args: ['-B', fileURLToPath(new URL('./python/peer.py', import.meta.url)), '--business']
  },
  {
    language: 'rust',
    id: 'rust-peer',
    command: fileURLToPath(new URL('./rust/run.sh', import.meta.url)),
    args: ['--business']
  },
  {
    language: 'go',
    id: 'go-peer',
    command: fileURLToPath(new URL('./go/run.sh', import.meta.url)),
    args: ['--business']
  },
  {
    language: 'ts-reference',
    id: 'ts-peer',
    command: fileURLToPath(new URL('./ts-reference/run.sh', import.meta.url)),
    args: []
  }
] as const
