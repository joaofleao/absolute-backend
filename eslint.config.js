const { defineConfig } = require('eslint/config')

const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended')
const simpleImportSort = require('eslint-plugin-simple-import-sort')
const typescriptEslint = require('@typescript-eslint/eslint-plugin')

module.exports = defineConfig([
  eslintPluginPrettierRecommended,

  {
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      '@typescript-eslint': typescriptEslint,
    },
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      'simple-import-sort/imports': ['error', { groups: [['^react$', 'react-native', '^[a-z]']] }],
    },
  },
  { ignores: ['./convex/_generated/**'] },
])
