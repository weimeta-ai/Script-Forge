// =============================================================================
// ESLint 9+ 配置（Flat Config 格式）
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// ESLint 是什么：
//   代码静态检查工具，能在写代码时（VSCode 实时提示）或运行时（npm run lint）
//   发现潜在错误、强制代码风格统一。
//
// 为什么用 Flat Config：
//   ESLint 9+ 默认格式，比老的 .eslintrc 更清晰，配置扁平化。
//
// 我们采用的风格（Standard JS）：
//   - 2 空格缩进
//   - 字符串用单引号
//   - 行末无分号
//   - 必须用 const/let，禁用 var
// =============================================================================

import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // 全局忽略
  {
    ignores: ['dist/', 'node_modules/', 'drizzle/', 'coverage/'],
  },

  // 基础规则
  js.configs.recommended,

  // TypeScript 推荐规则
  ...tseslint.configs.recommended,

  // 自定义规则（Standard JS 风格）
  {
    rules: {
      // 字符串必须用单引号
      quotes: ['error', 'single', { avoidEscape: true }],

      // 行末无分号
      semi: ['error', 'never'],

      // 2 空格缩进
      indent: ['error', 2, { SwitchCase: 1 }],

      // 禁用 var
      'no-var': 'error',

      // 强制 const（不会被重新赋值的变量）
      'prefer-const': 'error',

      // 允许未使用的变量以 _ 开头（参数占位符场景）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // 允许 any（开发期偶尔需要，但 strict tsconfig 会兜底）
      '@typescript-eslint/no-explicit-any': 'off',

      // 关闭 require-await（async 函数里不强制 await）
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Node.js 全局变量支持
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  }
)
