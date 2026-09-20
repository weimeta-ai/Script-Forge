// =============================================================================
// Schema 统一导出（p00 同款简化 + 用户管理扩展）
// -----------------------------------------------------------------------------
// 重构说明：
//   - 删除 5 个废弃表（projects/script-chapters/evidence-highlights/agent-messages/analyses）
//   - 新增用户管理 / per-user 配置 / 用法日志 / 积分预留 5 张表
// =============================================================================

// 表 schema
export * from './users'
export * from './scripts'
export * from './script-versions'
export * from './tasks'
export * from './export-files'
export * from './hot-dramas'
export * from './knowledge-samples'
export * from './llm-settings'
export * from './image-settings'
export * from './oss-settings'
export * from './prompt-settings'
export * from './user-prompt-settings'
export * from './login-banners'
// 用户管理扩展（每用户配置 + 用法日志 + 积分预留）
export * from './user-llm-settings'
export * from './user-image-settings'
export * from './usage-logs'
export * from './credit-rules'
export * from './credit-transactions'

// 表对象统一导出（方便 Drizzle db 客户端引用）
import { users } from './users'
import { scripts, scriptsRelations } from './scripts'
import { scriptVersions, scriptVersionsRelations } from './script-versions'
import { tasks, tasksRelations } from './tasks'
import { exportFiles, exportFilesRelations } from './export-files'
import { hotDramas } from './hot-dramas'
import { knowledgeSamples } from './knowledge-samples'
import { llmSettings } from './llm-settings'
import { imageSettings } from './image-settings'
import { ossSettings } from './oss-settings'
import { promptSettings } from './prompt-settings'
import { userPromptSettings } from './user-prompt-settings'
import { loginBanners } from './login-banners'
import { userLlmSettings } from './user-llm-settings'
import { userImageSettings } from './user-image-settings'
import { usageLogs } from './usage-logs'
import { creditRules } from './credit-rules'
import { creditTransactions } from './credit-transactions'

export const schema = {
  users,
  scripts,
  scriptsRelations,
  scriptVersions,
  scriptVersionsRelations,
  tasks,
  tasksRelations,
  exportFiles,
  exportFilesRelations,
  hotDramas,
  knowledgeSamples,
  llmSettings,
  imageSettings,
  ossSettings,
  promptSettings,
  userPromptSettings,
  loginBanners,
  // 用户管理扩展
  userLlmSettings,
  userImageSettings,
  usageLogs,
  creditRules,
  creditTransactions,
}
