// =============================================================================
// 积分规则 Repository
// -----------------------------------------------------------------------------
// 提供：
//   - listAll / findByCode / create / update / deleteById：基础 CRUD
//   - findByCodeCached：带内存缓存（60s TTL），lockCredits 高频调用用
// =============================================================================

import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { creditRules, type CreditRule, type NewCreditRule } from '../db/schema'

// 简单的 TTL 缓存（参考 auth.middleware 的 userExistCache 模式）
// V1 规则数量少（~6 条），全表缓存在内存中即可
class RuleCache {
  private cache = new Map<string, { value: CreditRule | null; expiresAt: number }>()
  private ttlMs: number

  constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs
  }

  get(code: string): { value: CreditRule | null; hit: boolean } | null {
    const entry = this.cache.get(code)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(code)
      return null
    }
    return { value: entry.value, hit: true }
  }

  set(code: string, value: CreditRule | null): void {
    this.cache.set(code, { value, expiresAt: Date.now() + this.ttlMs })
  }

  clear(): void {
    this.cache.clear()
  }
}

class CreditRuleRepository {
  private cache = new RuleCache()

  async listAll(): Promise<CreditRule[]> {
    return db.select().from(creditRules).orderBy(creditRules.code)
  }

  async findByCode(code: string): Promise<CreditRule | null> {
    const rows = await db
      .select()
      .from(creditRules)
      .where(eq(creditRules.code, code))
      .limit(1)
    return rows[0] ?? null
  }

  // 带缓存的查询（lockCredits 高频调用）
  // 注意：缓存命中时返回的是引用副本，调用方不应修改
  async findByCodeCached(code: string): Promise<CreditRule | null> {
    const hit = this.cache.get(code)
    if (hit) return hit.value
    const value = await this.findByCode(code)
    this.cache.set(code, value)
    return value
  }

  async create(data: NewCreditRule): Promise<CreditRule> {
    const rows = await db.insert(creditRules).values(data).returning()
    this.cache.clear()
    return rows[0]
  }

  async update(id: string, data: Partial<NewCreditRule>): Promise<CreditRule | null> {
    const rows = await db
      .update(creditRules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(creditRules.id, id))
      .returning()
    this.cache.clear()
    return rows[0] ?? null
  }

  async deleteById(id: string): Promise<void> {
    await db.delete(creditRules).where(eq(creditRules.id, id))
    this.cache.clear()
  }
}

export const creditRuleRepository = new CreditRuleRepository()
