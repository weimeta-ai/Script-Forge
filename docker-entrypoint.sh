#!/usr/bin/env bash
# =============================================================================
# docker-entrypoint.sh - 单容器同时启动 server + worker
# -----------------------------------------------------------------------------
# 使用场景：
#   - Coolify 部署（一个应用 = 一个容器）
#   - 本地 docker run 直跑
#   - 单机部署不想用 docker-compose 编排
#
# 启动内容：
#   1. HTTP server（node dist/server.js）—— 监听 5174，提供 API + 前端静态文件
#   2. BullMQ worker（node dist/workers/index.js）—— 消费 analyze/cover 队列
#
# 进程管理：
#   - 任一子进程退出 → 杀掉另一个 → 容器非 0 退出 → Coolify/Docker 自动重启
#   - 收到 SIGTERM/SIGINT → 转发给两个子进程，给最多 15s 优雅退出
#
# 为什么不用 supervisord：
#   - 增加镜像体积（需 apt 装 supervisor）
#   - 配置文件复杂，违反 KISS
#   - bash trap + wait -n 已能满足需求
# =============================================================================

set -uo pipefail

# 工作目录默认 /app/backend（与 Dockerfile WORKDIR 一致）
WORKDIR="${WORKDIR:-/app/backend}"
cd "$WORKDIR"

# -----------------------------------------------------------------------------
# 启动前自动执行数据库迁移
# -----------------------------------------------------------------------------
# 为什么放这里：
#   - Coolify 单容器部署没有 docker-compose 的 healthcheck 依赖，PG 容器可能
#     还没 ready，应用直接查新字段会报 42703（如 cover_url_candidates 事件）
#   - 每次 entrypoint 启动都同步 schema，避免服务器 DB 滞后于代码
#   - drizzle-kit migrate 是增量幂等的，已应用的迁移会跳过
#
# 为什么不用 `pnpm db:migrate`：
#   - pnpm v11 跑任何 script 前会强制做 runDepsStatusCheck
#   - 运行时镜像没 COPY pnpm-workspace.yaml，导致 allowAllBuilds 配置缺失
#   - deps check 会因 ERR_PNPM_IGNORED_BUILDS 拦截，根本跑不到 drizzle-kit
#   - 解决方式：直接调 node 跑 drizzle-kit/bin.cjs，绕开 pnpm script 机制
#
# 失败策略：重试 5 次（每次间隔 3s，应对 PG 还没就绪），全失败则容器退出由 Coolify 重启
run_migrations() {
  echo "[entrypoint] running database migrations..."
  for i in 1 2 3 4 5; do
    if node ./node_modules/drizzle-kit/bin.cjs migrate; then
      echo "[entrypoint] migrations applied successfully (attempt $i)"
      return 0
    fi
    echo "[entrypoint] migration attempt $i failed, retrying in 3s..."
    sleep 3
  done
  echo "[entrypoint] migrations failed after 5 attempts, exiting"
  return 1
}

run_migrations || exit 1

# -----------------------------------------------------------------------------
# 启动两个子进程（都放后台）
# -----------------------------------------------------------------------------
echo "[entrypoint] starting worker..."
node dist/workers/index.js &
WORKER_PID=$!

echo "[entrypoint] starting server..."
node dist/server.js &
SERVER_PID=$!

echo "[entrypoint] server PID=$SERVER_PID, worker PID=$WORKER_PID"

# -----------------------------------------------------------------------------
# 信号转发：docker stop / Coolify 部署更新时同时通知两个子进程
# -----------------------------------------------------------------------------
shutdown() {
  echo "[entrypoint] received signal, forwarding to children..."
  kill -TERM "$SERVER_PID" "$WORKER_PID" 2>/dev/null || true
  # 给子进程最多 15s 优雅退出（server.ts 内置 10s 兜底）
  timeout 15 wait "$SERVER_PID" "$WORKER_PID" 2>/dev/null || true
  echo "[entrypoint] shutdown complete"
  exit 0
}
trap shutdown TERM INT

# -----------------------------------------------------------------------------
# 等待任一进程退出，杀掉另一个，让容器整体退出（触发 Coolify 重启）
# -----------------------------------------------------------------------------
wait -n "$SERVER_PID" "$WORKER_PID"
EXIT_CODE=$?

echo "[entrypoint] process exited (code=$EXIT_CODE), terminating sibling..."
kill -TERM "$SERVER_PID" "$WORKER_PID" 2>/dev/null || true
wait "$SERVER_PID" "$WORKER_PID" 2>/dev/null || true

exit "$EXIT_CODE"
