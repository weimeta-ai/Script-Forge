// 任务事件持久化 + 进度计算（对齐 p00）
// -----------------------------------------------------------------------------
// 把每个 node_* 事件写入 tasks.events jsonb 数组，前端轮询时按事件折叠为节点进度
// =============================================================================

import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { tasks, type TaskEvent } from '../db/schema'
import { ANALYSIS_NODES } from './nodes'

// 追加事件到 tasks.events（原子操作，避免并发覆盖）
export async function persistEvent(taskId: string, event: TaskEvent): Promise<void> {
  await db
    .update(tasks)
    .set({
      events: sql`${tasks.events} || ${JSON.stringify([event])}::jsonb`,
    })
    .where(eq(tasks.id, taskId))
}

// 从 events 数组计算总体进度（0-100，对齐 p00 calcOverallProgressFromEvents）
export function calcOverallProgressFromEvents(events: TaskEvent[]): number {
  if (!events.length) return 0

  const nodeProgress = new Map<string, number>()
  for (const node of ANALYSIS_NODES) nodeProgress.set(node.id, 0)

  for (const event of events) {
    if (!event.nodeId) continue

    if (event.type === 'node_start') {
      nodeProgress.set(event.nodeId, Math.max(nodeProgress.get(event.nodeId) ?? 0, 3))
      continue
    }

    if (event.type === 'node_progress') {
      nodeProgress.set(
        event.nodeId,
        Math.max(nodeProgress.get(event.nodeId) ?? 0, event.percent ?? 0),
      )
      continue
    }

    if (event.type === 'node_done') {
      nodeProgress.set(event.nodeId, 100)
      continue
    }

    if (event.type === 'node_error') {
      nodeProgress.set(event.nodeId, Math.max(nodeProgress.get(event.nodeId) ?? 0, 100))
    }
  }

  const total = ANALYSIS_NODES.length * 100
  const current = Array.from(nodeProgress.values()).reduce((sum, v) => sum + v, 0)

  if (events.some((e) => e.type === 'task_done')) return 100
  return Math.max(0, Math.min(99, Math.round((current / total) * 100)))
}

