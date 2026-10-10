import globals from 'globals'

// Marks <Component/> identifiers as used (what eslint-plugin-react's
// jsx-uses-vars does) so no-unused-vars does not flag imported components.
const local = {
  rules: {
    'jsx-uses-vars': {
      create(context) {
        return {
          JSXOpeningElement(node) {
            let name = node.name
            while (name.type === 'JSXMemberExpression') name = name.object
            if (name.type === 'JSXIdentifier') context.sourceCode.markVariableAsUsed(name.name, node)
          },
        }
      },
    },
  },
}

export default [
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    plugins: { local },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.jest, ...globals.vitest, __DEV__: 'readonly', vi: 'readonly' },
    },
    rules: {
      'local/jsx-uses-vars': 'error',
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
      'no-console': 'warn',
      'no-unused-vars': ['warn', { args: 'after-used', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-unreachable': 'warn',
      'no-dupe-keys': 'warn',
      'no-useless-catch': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
]
