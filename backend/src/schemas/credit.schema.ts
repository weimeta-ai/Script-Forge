// =============================================================================
// 积分模块 zod 校验
// -----------------------------------------------------------------------------
// 涵盖：
//   - admin 调整积分（POST /admin/users/:id/credits/adjust）
//   - 流水查询（GET .../transactions）
//   - 规则 CRUD（POST/PATCH /admin/credit-rules）
// =============================================================================

import { z } from 'zod'

// admin 调整积分：正负整数 + 选填备注（内容自定义）+ category（区分后台充值/人工补偿/人工扣减）
export const adjustCreditsSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0, '调整量不能为 0'),
  remark: z
    .string()
    .max(255, '备注最长 255 字')
    .optional()
    // 空串/纯空白归一为 undefined，落库为 NULL
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
  category: z.enum(['recharge', 'compensate', 'deduct']),
})

// 流水列表查询参数
export const listTransactionsQuerySchema = z.object({
  type: z
    .enum(['recharge', 'consume', 'refund', 'deduct', 'compensate', 'lock', 'unlock'])
    .optional(),
  refTaskId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// 创建积分规则
export const createRuleSchema = z.object({
  code: z
    .string()
    .min(1, '规则代码不能为空')
    .max(64)
    .regex(/^[a-z0-9_.-]+$/, '规则代码仅支持小写字母、数字、点、下划线、连字符'),
  name: z.string().min(1, '请填写规则名称').max(128),
  description: z.string().max(500, '用途说明最多 500 字').optional().nullable(),
  creditsPerUnit: z.number().int().min(0, '单价不能为负').max(1_000_000),
  unitType: z.enum(['per_call', 'per_1k_tokens', 'per_image']).default('per_call'),
  enabled: z.boolean().default(true),
})

// 更新规则（全部可选）
export const updateRuleSchema = createRuleSchema.partial()

export type AdjustCreditsInput = z.infer<typeof adjustCreditsSchema>
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>
export type CreateRuleInput = z.infer<typeof createRuleSchema>
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>
