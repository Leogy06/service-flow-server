import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "generated/**", "node_modules/**"],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },

  //disables lint in test folder..,
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
