// =============================================================================
// 业务错误类
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// 为什么要自定义错误类：
//   - 原生 Error 只有 message，没有"错误码"
//   - 后端需要给前端返回结构化错误：
//     { code: 'USER_NOT_FOUND', message: '用户不存在', status: 404 }
//   - 自定义错误类携带 HTTP 状态码，让全局错误处理中间件自动转换
//
// 用法：
//   if (!user) {
//     throw new BusinessError('USER_NOT_FOUND', '用户不存在', 404)
//   }
//
// 全局中间件会捕获并返回：
//   { code: 'USER_NOT_FOUND', message: '用户不存在', data: null }
// =============================================================================

// -----------------------------------------------------------------------------
// 通用业务错误
// -----------------------------------------------------------------------------
export class BusinessError extends Error {
  // 可选的结构化错误详情（批量操作场景给前端展示每条失败原因）
  // 全局错误中间件会把 details 透出到响应体的 data 字段
  public details?: unknown

  constructor(
    public code: string,        // 业务错误码（前端用这个判断逻辑，不用判断 message 字符串）
    message: string,            // 给用户看的错误信息
    public status: number = 400, // HTTP 状态码（默认 400 Bad Request）
    details?: unknown,          // 可选结构化详情（如批量文件名错误列表）
  ) {
    super(message)
    this.name = 'BusinessError'
    this.details = details

    // 保持原型链（TS 继承 Error 的标准写法）
    Object.setPrototypeOf(this, BusinessError.prototype)
  }
}

// -----------------------------------------------------------------------------
// 常用错误的快捷工厂函数
// 这样调用方不用每次写 status
// -----------------------------------------------------------------------------

// 400 - 参数错误
export function badRequest(code: string, message: string) {
  return new BusinessError(code, message, 400)
}

// 401 - 未认证（没登录或 token 失效）
export function unauthorized(message: string = '未登录或登录已过期') {
  return new BusinessError('UNAUTHORIZED', message, 401)
}

// 403 - 无权限（登录了但没权限）
export function forbidden(message: string = '无权访问') {
  return new BusinessError('FORBIDDEN', message, 403)
}

// 404 - 资源不存在
export function notFound(resource: string = '资源') {
  return new BusinessError('NOT_FOUND', `${resource}不存在`, 404)
}

// 409 - 冲突（如重复创建）
export function conflict(code: string, message: string) {
  return new BusinessError(code, message, 409)
}

// 500 - 服务器内部错误
export function internalError(message: string = '服务器内部错误') {
  return new BusinessError('INTERNAL_ERROR', message, 500)
}

// 把异常格式化为给用户看的字符串（BusinessError 附加错误码前缀）
// 用于持久化到 task.errorMessage，便于前端展示失败原因与排查
// 仅在 BusinessError 时加 [code] 前缀；原生 Error 只保留 message，不污染语义
export function formatErrorForUser(e: unknown): string {
  const rawMessage = e instanceof Error ? e.message : String(e)
  if (e instanceof BusinessError && e.code) {
    return `[${e.code}] ${rawMessage}`
  }
  return rawMessage
}

// =============================================================================
// 上游 LLM/图像 API 错误信息提取
// -----------------------------------------------------------------------------
// 兼容多种网关的错误响应格式：
//   - OpenAI 标准：{ message } 或 { error: { message } }
//   - ResponseMetadata 风格网关：{ ResponseMetadata: { Error: { Code, Message } } }
//     OpenAI SDK 抛错时：err.error.ResponseMetadata.Error.Message
//     fetch 直调时：errPayload.ResponseMetadata.Error.Message
//
// 用法：
//   const msg = extractUpstreamErrorMessage(err.error) ?? err.message ?? 'unknown error'
// =============================================================================

type UpstreamErrorObj = Record<string, unknown>

// 读取 OpenAI 风格的 message 字段
function readMessage(obj: unknown): string | undefined {
  if (obj && typeof obj === 'object') {
    const v = (obj as UpstreamErrorObj).message
    if (typeof v === 'string' && v) return v
  }
  return undefined
}

// 读取 ResponseMetadata 风格的 ResponseMetadata.Error.Message
function readResponseMetadataMessage(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const rm = (obj as UpstreamErrorObj).ResponseMetadata
  if (rm && typeof rm === 'object') {
    const err = (rm as UpstreamErrorObj).Error
    if (err && typeof err === 'object') {
      const msg = (err as UpstreamErrorObj).Message
      if (typeof msg === 'string' && msg) return msg
    }
  }
  return undefined
}

// 提取上游 API 错误信息（兼容 OpenAI 与 ResponseMetadata 格式）
// 返回 undefined 表示无法从 payload 提取，调用方应回退到 err.message 或默认值
export function extractUpstreamErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const p = payload as UpstreamErrorObj
  // 1. 顶层 message（如 { message: "..." }）
  const top = readMessage(p)
  if (top) return top
  // 2. 顶层 ResponseMetadata 格式（fetch 直调时常见）
  const responseMetadataTop = readResponseMetadataMessage(p)
  if (responseMetadataTop) return responseMetadataTop
  // 3. 嵌套 error 字段（OpenAI SDK 包装后常见）
  if (p.error && typeof p.error === 'object') {
    const e = p.error as UpstreamErrorObj
    const nestedMsg = readMessage(e)
    if (nestedMsg) return nestedMsg
    const responseMetadataNested = readResponseMetadataMessage(e)
    if (responseMetadataNested) return responseMetadataNested
  }
  return undefined
}
