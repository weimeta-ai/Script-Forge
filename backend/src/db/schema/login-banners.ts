// =============================================================================
// 登录页轮播图（login_banners）— 管理员上传到 OSS 后展示在登录页
// -----------------------------------------------------------------------------
// 设计要点：
//   - imageUrl 存 OSS 永久 URL（已通过 uploadImageFromBuffer 转存）
//   - ossKey 用于删除时同步清理 OSS 对象
//   - sortOrder 升序排（数字越小越靠前），同序按 createdAt 升序
//   - isActive 软开关：禁用后登录页不展示，但后台仍可见
//   - uploadedBy 记录操作者用户名，便于审计
// =============================================================================

import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'

export const loginBanners = pgTable(
  'login_banners',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 后台识别用的标题（可选）
    title: varchar('title', { length: 120 }),

    // OSS 永久访问 URL（customDomain 或 bucket 直链）
    imageUrl: varchar('image_url', { length: 512 }).notNull(),

    // OSS 对象 key，删除记录时同步删 OSS
    ossKey: varchar('oss_key', { length: 256 }).notNull(),

    // 排序值（数字越小越靠前），默认 0
    sortOrder: integer('sort_order').notNull().default(0),

    // 是否启用（false 则登录页不展示）
    isActive: boolean('is_active').notNull().default(true),

    // 上传者用户名（审计用）
    uploadedBy: varchar('uploaded_by', { length: 64 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 登录页公开查询热路径：WHERE is_active = true ORDER BY sort_order
    activeSortIdx: index('login_banners_active_sort_idx').on(
      table.isActive,
      table.sortOrder,
    ),
  }),
)

export type LoginBanner = typeof loginBanners.$inferSelect
export type NewLoginBanner = typeof loginBanners.$inferInsert
