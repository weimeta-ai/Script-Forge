// =============================================================================
// 环境变量加载与校验
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// 这个文件做什么：
//   1. 加载 .env 文件到 process.env
//   2. 用 zod 校验每个环境变量（缺了就报错、类型错了就报错）
//   3. 导出强类型的 env 对象，全应用统一从这里读环境变量
//
// 为什么不直接用 process.env：
//   - process.env 的值都是 string | undefined，没有类型保护
//   - 散落在各处用 process.env.PORT，容易写错
//   - 改某变量时不知道哪些地方在用
//
// 类比：
//   process.env ≈ 普通 JS 对象（无类型）
//   env.ts      ≈ TypeScript 类型守卫（拿到值同时确保类型正确）
// =============================================================================

import dotenv from 'dotenv'
import { z } from 'zod'

// 加载 .env 文件
// path 默认是当前目录的 .env
// 后端启动时这行会先执行，把 .env 的内容注入 process.env
dotenv.config()

// -----------------------------------------------------------------------------
// 用 zod 定义环境变量的 schema
// zod 是什么：和后端校验请求体用的是一个库，这里用来校验环境变量
// -----------------------------------------------------------------------------

const envSchema = z.object({
  // 运行环境
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),       // z.coerce.number 把字符串 '3000' 转成数字 3000

  // 数据库
  DATABASE_URL: z.string().url(),              // 必须是合法 URL，否则启动报错

  // Redis
  REDIS_URL: z.string().url(),

  // MinIO
  MINIO_ENDPOINT: z.string().default(''),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USE_SSL: z.coerce.boolean().default(false),
  MINIO_ACCESS_KEY: z.string().default(''),
  MINIO_SECRET_KEY: z.string().default(''),
  MINIO_BUCKET: z.string().default('drama-exports'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 个字符'),  // 强制最小长度
  JWT_EXPIRES_IN: z.string().default('7d'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),

  // LLM
  LLM_PROVIDER: z.enum(['openai', 'anthropic', 'qwen', 'deepseek']).default('qwen'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  LLM_BASE_URL: z.string().url().default(''),
  LLM_TIMEOUT_MS: z.coerce.number().default(90000),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // 是否允许自助注册（默认 false：仅 admin 可创建账号）
  // true 时恢复 POST /auth/register 的注册功能
  REGISTRATION_ENABLED: z.coerce.boolean().default(false),

  // 前端静态文件根目录（生产环境合并部署时启用）
  // - 留空：不挂载静态服务（开发模式，前后端分别启动）
  // - 绝对路径：Hono 会从这个目录 serve 前端构建产物
  //   例：/app/dist（容器内）或 /Users/.../drama-predict-web/dist（本地）
  STATIC_ROOT: z.string().default(''),

  // 任务超时
  ANALYZE_TIMEOUT_WARNING_MS: z.coerce.number().default(45000),
  ANALYZE_TIMEOUT_FAILURE_MS: z.coerce.number().default(90000),
  EXPORT_TIMEOUT_FAILURE_MS: z.coerce.number().default(40000),

  // 日志级别
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('debug'),
})

// -----------------------------------------------------------------------------
// 执行校验
// -----------------------------------------------------------------------------
// safeParse 不会抛错，返回 { success, data } 或 { success, error }
// 这样我们可以在校验失败时打印友好的错误信息
const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  // 校验失败：打印每个缺失/错误的字段，然后退出进程
  console.error('❌ 环境变量校验失败：')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)                              // 退出码 1 = 异常退出
}

// -----------------------------------------------------------------------------
// 导出强类型环境变量
// -----------------------------------------------------------------------------
// 后续代码用：
//   import { env } from '@/config/env'
//   console.log(env.PORT)        // 类型是 number，IDE 自动补全
//   console.log(env.DATABASE_URL) // 类型是 string
export const env = parsed.data

// 派生常量（让业务代码更易读）
export const isDev = env.NODE_ENV === 'development'
export const isProd = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
