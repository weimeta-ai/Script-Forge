#!/usr/bin/env bash
# =============================================================================
# dev.sh - 短剧预测项目一键启动脚本（monorepo 版）
# -----------------------------------------------------------------------------
# 启动顺序：
#   1. 前置检查（docker / node / pnpm）
#   2. 基础设施（PostgreSQL / Redis / MinIO）—— backend/docker-compose.yml
#   3. 后端 API + Worker（drama-predict-backend，端口 5174）
#   4. 前端（frontend，vite，端口 3000）
#
# 用法：
#   ./dev.sh                一键启动全部
#   ./dev.sh --no-docker    跳过基础设施（假设已运行）
#   ./dev.sh --no-frontend  只起后端
#   ./dev.sh --no-backend   只起前端
#   ./dev.sh --init         首次启动：装依赖 + 数据库迁移 + seed 管理员
#
# 日志：所有服务输出合并到当前终端，每行加 [label] 前缀染色
# 退出：Ctrl+C 一次性关闭所有子进程
# =============================================================================

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"

# --- 颜色 --------------------------------------------------------------------
C_DOCKER='\033[32m'   # 绿
C_API='\033[36m'      # 青
C_WORKER='\033[35m'   # 紫
C_WEB='\033[33m'      # 黄
C_SYS='\033[90m'      # 灰
C_ERR='\033[31m'      # 红
C_OK='\033[1;32m'     # 加粗绿
C_R='\033[0m'

err()  { echo -e "${C_ERR}[dev]${C_R} ❌ $*" >&2; exit 1; }
info() { echo -e "${C_SYS}[dev]${C_R} $*"; }
ok()   { echo -e "${C_OK}[dev]${C_R} ✅ $*"; }

# --- 解析参数 ----------------------------------------------------------------
SKIP_DOCKER=0
SKIP_FRONTEND=0
SKIP_BACKEND=0
DO_INIT=0
for arg in "$@"; do
  case "$arg" in
    --no-docker)   SKIP_DOCKER=1 ;;
    --no-frontend) SKIP_FRONTEND=1 ;;
    --no-backend)  SKIP_BACKEND=1 ;;
    --init)        DO_INIT=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0 ;;
    *) err "未知参数：$arg（用 --help 查看用法）" ;;
  esac
done

# --- 本地配置初始化 ----------------------------------------------------------
# 只在本机生成随机凭据；这些值会写入被 .gitignore 忽略的 backend/.env。
set_env_value() {
  local env_key="$1"
  local env_value="$2"
  local env_file="$3"

  if grep -q "^${env_key}=" "$env_file"; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^${env_key}=.*|${env_key}=${env_value}|" "$env_file"
    else
      sed -i "s|^${env_key}=.*|${env_key}=${env_value}|" "$env_file"
    fi
  else
    printf '\n%s=%s\n' "$env_key" "$env_value" >> "$env_file"
  fi
}

ensure_dev_env() {
  if [[ -f "$BACKEND_DIR/.env" ]]; then
    return 0
  fi

  [[ -f "$BACKEND_DIR/.env.example" ]] || err "backend/.env.example 不存在，请检查代码完整性"
  info "⚙️  从模板生成 backend/.env（随机凭据不会进入 Git）..."
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"

  local dev_pg_password dev_minio_user dev_minio_password dev_jwt_secret dev_admin_password
  dev_pg_password=$(openssl rand -hex 16)
  dev_minio_user="drama-minio-$(openssl rand -hex 4)"
  dev_minio_password=$(openssl rand -hex 16)
  dev_jwt_secret=$(openssl rand -hex 32)
  dev_admin_password=$(openssl rand -hex 16)

  set_env_value "POSTGRES_PASSWORD" "$dev_pg_password" "$BACKEND_DIR/.env"
  set_env_value "DATABASE_URL" "postgres://drama:${dev_pg_password}@localhost:5432/drama_predict" "$BACKEND_DIR/.env"
  set_env_value "MINIO_ACCESS_KEY" "$dev_minio_user" "$BACKEND_DIR/.env"
  set_env_value "MINIO_SECRET_KEY" "$dev_minio_password" "$BACKEND_DIR/.env"
  set_env_value "JWT_SECRET" "$dev_jwt_secret" "$BACKEND_DIR/.env"
  set_env_value "SEED_ADMIN_PASSWORD" "$dev_admin_password" "$BACKEND_DIR/.env"
  chmod 600 "$BACKEND_DIR/.env"
  ok "已生成 backend/.env（权限 600，管理员初始密码由 seed 脚本输出）"
}

ensure_dev_env

# --- 前置检查 ----------------------------------------------------------------
command -v docker >/dev/null 2>&1 || {
  [[ $SKIP_DOCKER -eq 1 ]] || err "未检测到 docker，请安装 Docker Desktop 或用 --no-docker 跳过"
}
command -v pnpm >/dev/null 2>&1 || err "未检测到 pnpm，请先 npm install -g pnpm"
[[ -d "$BACKEND_DIR" ]]  || err "后端目录不存在：$BACKEND_DIR"
[[ -d "$FRONTEND_DIR" ]] || err "前端目录不存在：$FRONTEND_DIR"

# --- 子进程管理（Ctrl+C 一次性清理）-----------------------------------------
CHILD_PIDS=()
cleanup() {
  echo
  info "🛑 正在关闭所有子进程..."
  # 注意：set -u 下空数组 ${ARR[@]} 会报 unbound variable，用 ${ARR[@]:-} 兜底
  for pid in ${CHILD_PIDS[@]:-}; do
    kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  info "👋 已退出"
}
trap cleanup EXIT INT TERM

# 后台启动 + 加前缀染色日志
# 用法：spawn "标签" "颜色" "命令..."
spawn() {
  local label="$1"; shift
  local color="$1"; shift
  local prefix="${color}[${label}]${C_R}"
  # 通过 sed 给每行加前缀（保留颜色）
  "$@" 2>&1 | sed "s/^/${prefix} /" &
  CHILD_PIDS+=("$!")
}

# =============================================================================
# 步骤 1：基础设施
# =============================================================================
if [[ $SKIP_DOCKER -eq 0 ]]; then
  info "🐳 启动基础设施（PostgreSQL / Redis / MinIO）..."
  docker compose -f "$COMPOSE_FILE" up -d 2>&1 | sed 's/^/[docker] /'

  # 等待 healthy
  info "⏳ 等待基础设施就绪..."
  for i in {1..30}; do
    local_health=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null | grep -c '"Health":"healthy"')
    [[ "$local_health" -ge 3 ]] && break
    sleep 1
  done
  ok "基础设施就绪"
fi

# =============================================================================
# 步骤 2：首次初始化（--init）
# =============================================================================
if [[ $DO_INIT -eq 1 ]]; then
  info "📦 安装依赖..."
  pnpm install || err "依赖安装失败"

  info "🗄️  执行数据库迁移..."
  (cd "$BACKEND_DIR" && pnpm db:migrate) || err "数据库迁移失败"

  info "🌱 初始化管理员账号..."
  (cd "$BACKEND_DIR" && pnpm db:seed) || err "管理员 seed 失败"

  info "📝 初始化 Prompt 模板..."
  (cd "$BACKEND_DIR" && pnpm db:seed:prompts) || info "Prompt 模板已存在，跳过"

  ok "初始化完成"
fi

# =============================================================================
# 步骤 3：启动后端 API + Worker
# =============================================================================
if [[ $SKIP_BACKEND -eq 0 ]]; then
  info "🚀 启动后端 API（端口 5174）..."
  spawn "api" "$C_API" bash -c "cd '$BACKEND_DIR' && pnpm dev"

  # Worker 在独立进程跑（异步流水线：分析/封面生成）
  info "⚙️  启动后端 Worker..."
  spawn "worker" "$C_WORKER" bash -c "cd '$BACKEND_DIR' && pnpm worker"

  # 等待 API 就绪
  info "⏳ 等待 API 就绪..."
  for i in {1..30}; do
    if curl -sf http://localhost:5174/health >/dev/null 2>&1; then
      ok "API 已就绪 → http://localhost:5174"
      break
    fi
    sleep 1
  done
fi

# =============================================================================
# 步骤 4：启动前端
# =============================================================================
if [[ $SKIP_FRONTEND -eq 0 ]]; then
  info "🎨 启动前端（端口 3000）..."
  spawn "web" "$C_WEB" bash -c "cd '$FRONTEND_DIR' && pnpm dev"
  ok "前端启动中 → http://localhost:3000"
fi

# =============================================================================
# 步骤 5：保持前台运行，等待 Ctrl+C
# =============================================================================
echo
ok "全部启动完成。按 Ctrl+C 退出。"
echo
wait
