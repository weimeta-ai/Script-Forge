// =============================================================================
// 知识库样本表 Schema（5c 阶段）
// -----------------------------------------------------------------------------
// 用途：5e 评分引擎做「基准锚定」时，按 genre + grade 召回的样本库
//      让 LLM 看几个 A 级同题材样本，相对评分而非凭印象打分
//
// 设计要点：
//   - 独立参考表（无 userId、无业务 relations）— 全局共享，admin 维护
//   - summary ≥120 字硬约束 — 给 LLM 做 few-shot 的最小上下文
//   - (genre, grade) 复合索引 — 5e 召回主路径
//   - isActive 软删 — 保留历史，便于追溯误删
// =============================================================================

import {
  pgTable,
  uuid,
  varchar,
  char,
  decimal,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'

export const knowledgeSamples = pgTable(
  'knowledge_samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 标题（便于人工识别，不参与检索）
    title: varchar('title', { length: 255 }).notNull(),

    // 一级召回键：题材（与 projects.genre 对齐）
    genre: varchar('genre', { length: 64 }).notNull(),

    // 二级召回键：评级 A/B/C/D（与 analyses.grade 对齐）
    grade: char('grade', { length: 1 }).notNull(),

    // 综合分（可选，0-100，精度到 0.01）
    overallScore: decimal('overall_score', { precision: 5, scale: 2 }),

    // 六维分数（结构对齐 analyses.sixDimensions）
    // 形如：{ rhythm: 78, emotion: 82, conflict: 75, character: 80, dialogue: 76, genre: 85 }
    sixDimensions: jsonb('six_dimensions'),

    // 关键片段摘要（≥120 字，给 LLM 做 few-shot 锚定的最小上下文）
    summary: text('summary').notNull(),

    // 亮点片段数组（前 30 秒钩子、爽点桥段等，便于人工对照）
    highlights: jsonb('highlights').notNull().default([]),

    // 来源标记（manual_import / promoted / external）
    sourceType: varchar('source_type', { length: 32 }).notNull().default('manual_import'),

    // 软删标记
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 5e 召回主路径：genre + grade 复合索引
    genreGradeIdx: index('knowledge_samples_genre_grade_idx').on(table.genre, table.grade),
    // 按评级过滤（admin 列表筛选用）
    gradeIdx: index('knowledge_samples_grade_idx').on(table.grade),
  })
)

export type KnowledgeSample = typeof knowledgeSamples.$inferSelect
export type NewKnowledgeSample = typeof knowledgeSamples.$inferInsert
