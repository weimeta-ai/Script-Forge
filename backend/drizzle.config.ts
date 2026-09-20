// =============================================================================
// Drizzle ORM 配置文件
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// 这个文件是什么：
//   告诉 Drizzle CLI（命令行工具）"schema 在哪、迁移放哪、连哪个数据库"
//   类似 vite.config.ts 之于 vite，drizzle.config.ts 之于 drizzle-kit。
//
// 什么时候会被读取：
//   - npm run db:generate  生成迁移文件时
//   - npm run db:migrate   执行迁移时
//   - npm run db:studio     启动可视化工具时
//
// 关键字段：
//   schema     Drizzle schema 文件所在目录（我们放在 src/db/schema/）
//   out        生成的迁移 SQL 文件输出目录
//   dialect    数据库类型（postgresql/mysql/sqlite）
//   dbCredentials  连接数据库的 URL（从环境变量读取）
// =============================================================================

import { defineConfig } from 'drizzle-kit'
import dotenv from 'dotenv'

// 加载 .env 文件，让 process.env.DATABASE_URL 可用
// 注：drizzle-kit 不会自动加载 .env，需要手动调用 dotenv.config()
dotenv.config()

export default defineConfig({
  // schema 文件目录（所有 pgTable 定义都在这里）
  schema: './src/db/schema',

  // 生成的迁移文件输出目录
  out: './drizzle',

  // 数据库方言（我们用 PostgreSQL）
  dialect: 'postgresql',

  // 数据库连接字符串（从 .env 读，避免硬编码）
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },

  // 打印 SQL 语句到控制台（开发期友好）
  verbose: true,

  // 严格模式：遇到歧义就报错（推荐开启）
  strict: true,
})
