// =============================================================================
// 阿里云 OSS 图床配置表（AI 生成图片持久化）
// -----------------------------------------------------------------------------
// 用途：让前端 admin 动态配置阿里云 OSS 凭据（AccessKey/Bucket/Region/CDN），
//       不重启后端即可切换图床。配合 image-config/generate 使用：
//       AI 生成图片返回临时 URL → 后端代理转存到 OSS → 返回永久 URL。
//
// 设计要点（与 image-settings / llm-settings 一致）：
//   - 单行表（singleton）：CHECK id = 1，全局唯一配置
//   - accessKeySecret 敏感字段，repository 出参脱敏
//   - endpoint / customDomain 可空（默认用 region 推导 / bucket 直链）
//   - pathPrefix 用于虚拟目录隔离（如 drama/images、knowledge/cover）
// =============================================================================

import {
  pgTable,
  integer,
  varchar,
  timestamp,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const ossSettings = pgTable(
  'oss_settings',
  {
    // 固定 id = 1（singleton 模式）
    id: integer('id').primaryKey().default(1),

    // 配置名称（便于人工识别，如 "aliyun-prod" / "aliyun-dev"）
    name: varchar('name', { length: 64 }).notNull().default('default'),

    // 阿里云 AccessKey Id（敏感字段，repository 出参时脱敏）
    accessKeyId: varchar('access_key_id', { length: 128 }).notNull(),

    // 阿里云 AccessKey Secret（敏感字段，repository 出参时脱敏）
    accessKeySecret: varchar('access_key_secret', { length: 256 }).notNull(),

    // 地域（如 oss-cn-hangzhou / oss-cn-shanghai / oss-cn-beijing）
    region: varchar('region', { length: 64 }).notNull(),

    // Bucket 名称
    bucket: varchar('bucket', { length: 64 }).notNull(),

    // 自定义 Endpoint（可空，默认用 region 推导为 https://oss-cn-hangzhou.aliyuncs.com）
    endpoint: varchar('endpoint', { length: 256 }),

    // 自定义域名 / CDN 加速域名（可空，含 https:// 前缀）
    customDomain: varchar('custom_domain', { length: 256 }),

    // 文件存储路径前缀（虚拟目录，如 drama/images、knowledge/cover）
    pathPrefix: varchar('path_prefix', { length: 128 }).notNull().default('drama/images'),

    // SDK 单次操作超时（毫秒）
    timeoutMs: integer('timeout_ms').notNull().default(60000),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (_table) => ({
    // 强制单行：CHECK id = 1
    singletonCheck: check('oss_settings_singleton_check', sql`id = 1`),
  }),
)

export type OssSettings = typeof ossSettings.$inferSelect
export type NewOssSettings = typeof ossSettings.$inferInsert
