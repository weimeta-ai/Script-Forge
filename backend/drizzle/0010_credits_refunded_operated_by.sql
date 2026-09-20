-- 0010: 积分系统展会场景重构
-- 1. credit_transactions 加 operated_by 字段（记录管理端调配操作人）
-- 2. tasks 加 credits_refunded 字段（标记任务失败/取消后是否已退款，用于前端展示）
-- 3. type 枚举语义扩展（recharge/consume/refund/deduct/compensate，旧 lock/unlock 保留兼容）

ALTER TABLE "credit_transactions" ADD COLUMN "operated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "credits_refunded" boolean DEFAULT false NOT NULL;
