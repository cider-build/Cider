import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const componentRules = {
  rules: {
    'one-top-level-function': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Require at most one top-level function in each TSX file',
        },
        messages: {
          extra: 'Move this function to its own file. TSX files can contain one top-level function.',
        },
        schema: [],
      },
      create(context) {
        return {
          'Program:exit'(program) {
            const functions = []

            for (const statement of program.body) {
              const declaration =
                statement.type === 'ExportNamedDeclaration' ||
                statement.type === 'ExportDefaultDeclaration'
                  ? statement.declaration
                  : statement

              if (declaration?.type === 'FunctionDeclaration') {
                functions.push(declaration)
                continue
              }

              if (declaration?.type !== 'VariableDeclaration') continue
              for (const item of declaration.declarations) {
                if (
                  item.init?.type === 'ArrowFunctionExpression' ||
                  item.init?.type === 'FunctionExpression'
                ) {
                  functions.push(item)
                }
              }
            }

            for (const node of functions.slice(1)) {
              context.report({ node, messageId: 'extra' })
            }
          },
        }
      },
    },
  },
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
      stylistic.configs.customize({
        indent: 2,
        quotes: 'double',
        semi: true,
        jsx: true,
        arrowParens: true,
        braceStyle: '1tbs',
      }),
    ],
    plugins: {
      cider: componentRules,
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/strict-boolean-expressions': 'warn',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@stylistic/array-bracket-spacing': ['error', 'never'],
      '@stylistic/arrow-spacing': ['error', { before: true, after: true }],
      '@stylistic/block-spacing': ['error', 'always'],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/comma-spacing': ['error', { before: false, after: true }],
      '@stylistic/computed-property-spacing': ['error', 'never'],
      '@stylistic/function-call-spacing': ['error', 'never'],
      '@stylistic/key-spacing': ['error', { beforeColon: false, afterColon: true }],
      '@stylistic/keyword-spacing': ['error', { before: true, after: true }],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/space-before-blocks': 'error',
      '@stylistic/space-before-function-paren': [
        'error',
        { anonymous: 'always', named: 'never', asyncArrow: 'always' },
      ],
      '@stylistic/space-in-parens': ['error', 'never'],
      complexity: ['warn', { max: 15 }],
      'max-depth': ['warn', 4],
      'max-lines-per-function': [
        'warn',
        { max: 150, skipBlankLines: true, skipComments: true },
      ],
      'max-nested-callbacks': ['warn', 3],
      'max-params': ['warn', 4],
      'react-hooks/component-hook-factories': 'error',
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      'cider/one-top-level-function': 'error',
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../**/*.module.css'],
              message: 'Import the CSS Module from this component directory.',
            },
          ],
        },
      ],
    },
  },
])
