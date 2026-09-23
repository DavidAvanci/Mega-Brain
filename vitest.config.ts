import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'plans/**'],
    passWithNoTests: true,
    setupFiles: ['./test/safety-guard.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'test/**', 'scripts/commands/**'],
    },
  },
})
