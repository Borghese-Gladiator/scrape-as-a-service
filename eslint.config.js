const path = require('node:path');
const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'apps/web/**',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: path.resolve(__dirname),
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/__tests__/**/*.ts', '**/__itests__/**/*.ts', 'test/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: [
      '**/__tests__/**/*.ts',
      '**/__itests__/**/*.ts',
      'test/**/*.ts',
      'scripts/**/*.mjs',
    ],
    rules: {
      'no-console': 'off',
    },
  },
);
