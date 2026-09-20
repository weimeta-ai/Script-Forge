// =============================================================================
// 用户管理业务服务层（admin only）
// -----------------------------------------------------------------------------
// 职责：
//   - listUsers(filter)：分页 + 关键词 + 状态/角色筛选 + 统计聚合
//   - getUserDetail(id)：单用户 + 配置状态 + 统计
//   - createUser(input)：创建用户（含可选 copyTemplate）
//   - updateUser(id, input)：编辑用户（displayName / role / status / 重置密码）
//   - disableUser(id)：软禁用（status='disabled'）
//
// 设计要点：
//   - 不允许物理删除用户（外键 CASCADE 会丢失历史数据），统一走软禁用
//   - 创建用户可选「复制模板配置」，避免 admin 重输 apiKey
//   - username 唯一约束由 DB 保证，service 层捕获冲突
// =============================================================================

import { userRepository, type ListUsersFilter } from '../repositories/user.repository'
import { usageLogRepository } from '../repositories/usage-log.repository'
import { hashPassword, validatePasswordStrength } from '../lib/password'
import { badRequest, notFound, conflict } from '../lib/errors'
import * as userLlmConfigService from './user-llm-config.service'
import * as userImageConfigService from './user-image-config.service'

// admin 列表查询入参
export type ListUsersInput = ListUsersFilter

// admin 创建用户入参
export interface CreateUserInput {
  username: string
  password: string
  displayName?: string
  role: 'admin' | 'user'
  status?: 'active' | 'disabled'
  copyTemplateConfig?: boolean // true 则自动复制全局 llm/image 模板
}

// admin 编辑用户入参（所有字段可选）
// 注意：creditBalance 不在此处调整，所有余额变更必须走
//   POST /admin/users/:id/credits/adjust（强制写流水审计）
export interface UpdateUserInput {
  displayName?: string
  role?: 'admin' | 'user'
  status?: 'active' | 'disabled'
  password?: string // 重置密码
}

// 列表（带统计聚合）
export async function listUsers(filter: ListUsersInput = {}) {
  return userRepository.listWithStats(filter)
}

// 详情：基本信息 + 配置状态 + 累计统计
export async function getUserDetail(id: string) {
  const user = await userRepository.findById(id)
  if (!user) {
    throw notFound('用户')
  }

  // 并行查：LLM 配置状态 + 图片配置状态 + 用法聚合
  const [llmMasked, imageMasked, usage] = await Promise.all([
    userLlmConfigService.getMaskedByUser(id),
    userImageConfigService.getMaskedByUser(id),
    usageLogRepository.summarizeByUser(id),
  ])

  // 脱敏 passwordHash 不出参
  const { passwordHash: _omit, ...safeUser } = user
  return {
    ...safeUser,
    hasLlmConfig: !!llmMasked,
    hasImageConfig: !!imageMasked,
    llmConfig: llmMasked,
    imageConfig: imageMasked,
    usage: {
      totalTokens: usage.totalTokens,
      totalCalls: usage.totalCalls,
      lastActiveAt: usage.lastActiveAt?.toISOString() ?? null,
    },
  }
}

// 创建用户
export async function createUser(input: CreateUserInput) {
  // 1. 校验密码强度
  const pwdError = validatePasswordStrength(input.password)
  if (pwdError) {
    throw badRequest('WEAK_PASSWORD', pwdError)
  }

  // 2. 用户名唯一性检查（DB 唯一约束兜底，但提前校验给出更友好的错误码）
  const existing = await userRepository.findByUsername(input.username)
  if (existing) {
    throw conflict('USERNAME_TAKEN', '用户名已被使用')
  }

  // 3. 哈希密码
  const passwordHash = await hashPassword(input.password)

  // 4. 创建用户
  const user = await userRepository.create({
    username: input.username,
    passwordHash,
    displayName: input.displayName ?? input.username,
    role: input.role,
    status: input.status ?? 'active',
    creditBalance: 0,
    creditLocked: 0,
  })

  // 5. 可选：复制模板配置
  let copiedTemplate: { llm: boolean; image: boolean } | null = null
  if (input.copyTemplateConfig) {
    const results = await Promise.allSettled([
      userLlmConfigService.copyFromTemplate(user.id),
      userImageConfigService.copyFromTemplate(user.id),
    ])
    copiedTemplate = {
      llm: results[0].status === 'fulfilled',
      image: results[1].status === 'fulfilled',
    }
  }

  // 脱敏返回
  const { passwordHash: _omit, ...safeUser } = user
  return { ...safeUser, copiedTemplate }
}

// 编辑用户
export async function updateUser(id: string, input: UpdateUserInput) {
  const user = await userRepository.findById(id)
  if (!user) {
    throw notFound('用户')
  }

  // 重置密码：走强度校验
  let passwordHash: string | undefined
  if (input.password) {
    const pwdError = validatePasswordStrength(input.password)
    if (pwdError) {
      throw badRequest('WEAK_PASSWORD', pwdError)
    }
    passwordHash = await hashPassword(input.password)
  }

  // 防止最后一个 admin 把自己降级（业务约束）
  if (input.role === 'user' && user.role === 'admin') {
    const { items: admins } = await userRepository.listWithStats({
      role: 'admin',
      status: 'active',
      pageSize: 100,
    })
    if (admins.filter((u) => u.id !== id).length === 0) {
      throw badRequest(
        'LAST_ADMIN',
        '系统至少保留一个启用状态的管理员，无法降级当前账号',
      )
    }
  }

  // 防止 admin 把自己禁用（自我锁定）
  if (input.status === 'disabled' && user.role === 'admin') {
    const { items: admins } = await userRepository.listWithStats({
      role: 'admin',
      status: 'active',
      pageSize: 100,
    })
    if (admins.filter((u) => u.id !== id).length === 0) {
      throw badRequest(
        'LAST_ADMIN',
        '系统至少保留一个启用状态的管理员，无法禁用当前账号',
      )
    }
  }

  const updated = await userRepository.update(id, {
    displayName: input.displayName,
    role: input.role,
    status: input.status,
    passwordHash,
  })

  if (!updated) {
    throw notFound('用户')
  }

  const { passwordHash: _omit, ...safeUser } = updated
  return safeUser
}

// 软禁用（status='disabled'，禁止登录）
export async function disableUser(id: string) {
  return updateUser(id, { status: 'disabled' })
}
