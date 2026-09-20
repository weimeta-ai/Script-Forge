// =============================================================================
// PostgreSQL 数据库客户端（基于 postgres.js + Drizzle ORM）
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// 这个文件做什么：
//   创建一个"数据库连接池"实例，全应用共享这一个。
//   所有 repository/service 都通过 db.xxx 访问数据库。
//
// 为什么是"单例"：
//   - 每次查询新建连接很慢（要 TCP 握手 + 认证），约 50ms
//   - 连接池预创建 N 个连接复用，每次查询从池里取，秒级响应
//   - postgres.js 默认池大小 = CPU 核心数 * 2，足够用
//
// 两层抽象：
//   1. queryClient (postgres.js)：底层驱动，能跑原始 SQL
//   2. db (drizzle-orm)：上层 ORM，类型安全的查询构造器
//
// 用法：
//   import { db } from '@/db/client'
//   import { users } from '@/db/schema'
//   const all = await db.select().from(users)
// =============================================================================

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../config/env'
import * as schema from './schema/index'

// -----------------------------------------------------------------------------
// 创建 postgres.js 客户端（底层连接）
// -----------------------------------------------------------------------------
export const queryClient = postgres(env.DATABASE_URL, {
  // 连接池最大连接数（默认 10，我们调到 20 以应对批量任务）
  max: 20,

  // 连接空闲超时（30 秒没用就释放）
  idle_timeout: 30,

  // 单条查询超时（30 秒，超时自动取消）
  connect_timeout: 30,

  // 是否在 prepare 阶段做类型推断（开启更安全，关闭略快）
  prepare: false,

  // SSL 配置：根据 URL 协议自动判断
  // postgres://  → 不使用 SSL（docker-compose 内部网络）
  // postgresql:// → 使用 SSL（云数据库）
  ssl: env.DATABASE_URL.startsWith('postgresql:') ? 'require' : false,

  // 调试模式：开发期打印每条 SQL
  debug: true ? undefined : undefined,
})

// -----------------------------------------------------------------------------
// 创建 Drizzle ORM 实例（上层抽象）
// -----------------------------------------------------------------------------
// schema 参数：让 drizzle 知道所有表结构，方便做关联查询
// mode: 'default' 即可
export const db = drizzle(queryClient, { schema })

// -----------------------------------------------------------------------------
// 类型导出（让其他文件能复用）
// -----------------------------------------------------------------------------
// typeof schema = 所有表/枚举的类型集合
// 业务代码可以用：import type { Database } from '@/db/client'
export type Database = typeof db
