// =============================================================================
// 统一响应工具
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// 为什么需要统一响应格式：
//   前端期望所有接口返回同样的结构，方便统一处理。
//
//   不统一（坏味道）：
//     GET /users → { data: [...] }
//     GET /user/1 → { user: {...} }
//     POST /user → { success: true, id: '...' }
//
//   统一（推荐）：
//     所有接口：{ code: 0, data: ..., message: 'ok' }
//     错误时：  { code: 'XXX_ERROR', data: null, message: '错误描述' }
//
// 前端可以这样封装：
//   const res = await fetch(...)
//   const { code, data, message } = await res.json()
//   if (code === 0) return data
//   else throw new Error(message)
// =============================================================================

import type { Context } from 'hono'

// 成功响应类型（业务码 0 表示成功）
export const SUCCESS_CODE = 0
export const SUCCESS_MESSAGE = 'ok'

// -----------------------------------------------------------------------------
// 成功响应助手
// 用法：
//   return ok(c, { users: [...] })           // 默认 200
//   return ok(c, { id: '123' }, 201)         // 创建资源用 201
// -----------------------------------------------------------------------------
export function ok<T>(c: Context, data: T, status: 200 | 201 | 202 = 200) {
  return c.json(
    {
      code: SUCCESS_CODE,
      data,
      message: SUCCESS_MESSAGE,
    },
    status
  )
}

// -----------------------------------------------------------------------------
// 分页响应助手
// 列表接口返回 { items, total, page, pageSize }
// 前端可以基于 total 判断是否还有下一页
// -----------------------------------------------------------------------------
export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): PageResult<T> {
  return {
    items,
    total,
    page,
    pageSize,
  }
}

// -----------------------------------------------------------------------------
// 空响应（如 DELETE 操作）
// 返回 { code: 0, data: null, message: 'ok' }
// -----------------------------------------------------------------------------
export function noContent(c: Context) {
  return c.json({
    code: SUCCESS_CODE,
    data: null,
    message: SUCCESS_MESSAGE,
  })
}
