/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
    },
    rules: {
      // Catch TDZ bugs: const/class used before declaration
      // functions: false — hoisted function declarations are normal JS pattern
      'no-use-before-define': ['error', {
        functions: false,
        classes: true,
        variables: true,
      }],
    },
  },
  {
    ignores: ['node_modules/**', 'temp/**', 'reports/**'],
  },
];
