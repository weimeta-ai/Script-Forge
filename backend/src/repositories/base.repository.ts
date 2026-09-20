// =============================================================================
// 通用 Repository 基类（DRY 原则）
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// Repository 模式是什么：
//   把"数据库操作"集中到 repository 层，service 层只调方法不懂 SQL。
//   类比前端的 API 客户端封装（fetch wrapper）。
//
// 为什么需要基类：
//   每张表都有 findById/findAll/create/update/delete 等通用操作
//   不写基类 → 每张表都重复写一遍 → 违反 DRY
//   写基类 → 子类继承，只写特殊查询
//
// 设计要点：
//   - 泛型 <T>：让子类指定表类型，方法返回类型推断
//   - 抽象属性 table：子类声明对应的 Drizzle 表对象
//   - 不暴露 db：子类用 this.db 访问（受控）
// =============================================================================

import { eq, and, type Table } from 'drizzle-orm'
import { db } from '../db/client'

// 构造类型：从 Drizzle 表推导"行"类型
// T 必须是 Drizzle 的 pgTable 返回值
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export abstract class BaseRepository<T extends Record<string, any>> {
  // 抽象属性：子类必须实现，指定对应的 Drizzle 表对象
  protected abstract table: Table

  // 数据库实例（共享）
  protected get db() {
    return db
  }

  // 按 ID 查询
  async findById(id: string): Promise<T | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await db.select().from(this.table as any).where(eq((this.table as any).id, id)).limit(1)
    return (rows[0] as T) ?? null
  }

  // 删除（按 ID）
  // 注意：默认物理删除；业务表推荐重写为软删（update status='deleted'）
  async deleteById(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.delete(this.table as any).where(eq((this.table as any).id, id))
  }

  // 统计总数（用于分页）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async count(where?: ReturnType<typeof eq> | ReturnType<typeof and>): Promise<number> {
    // 简单实现：select * 后取长度（数据量小可用，大表建议 SELECT count(*)）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = db.select().from(this.table as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = where ? await query.where(where as any) : await query
    return rows.length
  }
}
