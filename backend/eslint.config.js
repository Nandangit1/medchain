const js = require("@eslint/js");
const globals = require("globals");

/**
 * ESLint 9 flat config for the backend.
 *
 * Deliberately narrow: this catches real defects (unused variables, undefined
 * identifiers, unreachable code) rather than enforcing style, which Prettier
 * already owns. A linter that mostly reports formatting gets ignored.
 */
module.exports = [
  {
    ignores: ["node_modules/**", "src/config/contracts/**", "coverage/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
      "no-return-await": "error",
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
