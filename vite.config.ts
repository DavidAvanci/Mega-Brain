import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { megaBrainVitePlugin } from './viteMegaBrainPlugin'
import { loadMegaBrainConfig } from './server/config'

export default defineConfig(({ mode }) => {
  const config = loadMegaBrainConfig({ env: loadEnv(mode, process.cwd(), '') })
  return {
    plugins: [
      react(),
      tailwindcss(),
      megaBrainVitePlugin(config),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      watch: {
        ignored: ['**/src-tauri/target/**', '**/spikes/**', '**/.git/**'],
      },
    },
  }
})
