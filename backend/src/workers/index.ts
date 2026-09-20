// Worker 进程入口（p00 同款简化）
// -----------------------------------------------------------------------------
// 启动方式：npm run worker（package.json 已配 tsx watch src/workers/index.ts）
// 加载 analyze worker（8 节点分析）+ cover worker（封面异步生成）
// =============================================================================

import './analyze.worker'
import './cover.worker'

console.log('[workers] analyze + cover workers started, waiting for jobs...')
