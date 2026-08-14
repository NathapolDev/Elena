import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'release/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    /*
     * Type-aware linting, scoped to the processes where the payoff is real: the
     * main and preload processes are full of async IPC handlers and PTY
     * lifecycle, where a floating or misused promise is a genuine defect class.
     * The renderer is left on the syntactic rules to avoid a flood.
     *
     * The `no-unsafe-*` family is off on purpose: with Zod parsing at the
     * boundary and `Result<T>` unwrapping, it reports noise rather than bugs.
     */
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off'
    }
  },
  {
    // Claude Code hook scripts and build helpers: plain Node ESM.
    files: ['.claude/hooks/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'module'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Colours come from styles/tokens.css; a literal here cannot follow the
      // data-theme flip. tests/theme-tokens.test.ts covers the .css side.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/#(?:[0-9a-fA-F]{3}){1,2}\\b|\\brgba?\\(|\\bhsla?\\(/]',
          message:
            'No hard-coded colours in components — use a token from styles/tokens.css (AGENTS.md).'
        }
      ]
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      eqeqeq: ['error', 'smart']
    }
  }
)
