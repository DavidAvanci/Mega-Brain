import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'plans/**', 'spikes/**', 'src-tauri/gen/**', 'src-tauri/target/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../server/**',
                '../../server/**',
                '../../../server/**',
                '../scripts/**',
                '../../scripts/**',
                '../../../scripts/**',
              ],
              message:
                'O frontend deve usar contratos compartilhados e o cliente HTTP, nunca módulos de servidor ou automação.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['server/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../src/**', '../../src/**', '../../../src/**'],
              message: 'O backend não deve depender do frontend; mova contratos para shared/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'server/app-settings.ts',
      'server/config.ts',
      'server/editor-detection.ts',
      'server/workspace/service.ts',
      'server/chat/service.ts',
      'server/chat/http.ts',
      'server/claude-usage/service.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx,mjs}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-empty': 'warn',
      'no-undef': 'off',
    },
  },
)
