#!/usr/bin/env bash
# =============================================================================
# deploy.sh - 服务器一键部署脚本（生产环境）
# -----------------------------------------------------------------------------
# 用法：
#   ./deploy.sh init      首次部署：生成 .env.production + 构建镜像 + 启动 + DB 迁移
#   ./deploy.sh start     启动所有服务（已 init 过）
#   ./deploy.sh stop      停止所有服务
#   ./deploy.sh restart   重启所有服务
#   ./deploy.sh update    拉最新代码 + 重新构建 + 滚动重启
#   ./deploy.sh logs      查看实时日志（Ctrl+C 退出）
#   ./deploy.sh status    查看服务状态
#   ./deploy.sh backup    备份数据库到 backup-YYYY-MM-DD-HHMMSS.sql.gz
#   ./deploy.sh migrate   手动跑数据库迁移
#   ./deploy.sh seed      手动初始化管理员 + Prompt 模板
#
# 前置条件：
#   - 服务器已装 Docker（curl -fsSL https://get.docker.com | sh）
#   - 当前用户在 docker 组里（usermod -aG docker $USER 后重新登录）
#
# 注意：
#   - Nginx + HTTPS 不在脚本范围内，请参考 DEPLOY.md 第六节手动配置
#   - .env.production 含密钥，不会入 git，仅在服务器本地生成
# =============================================================================

# 注意：用 -e 但不要 -u（dc ps --format json 等命令空输出会触发 unbound）
set -eo pipefail

# --- 路径与颜色 -------------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
ENV_FILE="$ROOT_DIR/.env.production"

C_SYS='\033[90m'
C_OK='\033[1;32m'
C_ERR='\033[31m'
C_WARN='\033[33m'
C_R='\033[0m'

info() { echo -e "${C_SYS}[deploy]${C_R} $*"; }
ok()   { echo -e "${C_OK}[deploy]${C_R} ✅ $*"; }
warn() { echo -e "${C_WARN}[deploy]${C_R} ⚠️  $*"; }
err()  { echo -e "${C_ERR}[deploy]${C_R} ❌ $*" >&2; exit 1; }

# --- 前置检查 ---------------------------------------------------------------
# 基础检查：docker / compose / 项目文件
preflight_basic() {
  command -v docker >/dev/null 2>&1 || err "未检测到 docker，请先安装：curl -fsSL https://get.docker.com | sh"
  docker compose version >/dev/null 2>&1 || err "docker compose 不可用，请升级 Docker"
  [[ -f "$COMPOSE_FILE" ]] || err "找不到 $COMPOSE_FILE，请确认在项目根目录执行"
}

# 完整检查：基础 + .env.production（除 init 外的所有命令都需要）
preflight() {
  preflight_basic
  [[ -f "$ENV_FILE" ]] || err ".env.production 不存在，请先执行：./deploy.sh init"
}

# --- DC wrapper（统一带 --env-file）-----------------------------------------
dc() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# --- 从 .env.production 读取某个变量（不污染当前 shell）---------------------
env_value() {
  local key="$1"
  local default="${2:-}"
  local val
  val=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)
  echo "${val:-$default}"
}

# --- 等待所有容器健康 --------------------------------------------------------
# 不用 set -e 触发：grep 没匹配返回 1 不会让函数退出（因为 || true 兜底）
wait_healthy() {
  local max_wait="${1:-180}"
  local waited=0
  info "等待所有服务健康（最多 ${max_wait}s）..."
  while (( waited < max_wait )); do
    local count
    count=$(dc ps --format json 2>/dev/null \
            | grep -iE '"(Health|State)"\s*:\s*"(healthy|running)"' \
            | wc -l || true)
    if (( count >= 4 )); then
      ok "全部服务健康"
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
    printf "."
  done
  echo
  warn "等待超时，部分服务可能还没就绪，请用 ./deploy.sh status 查看"
}

# =============================================================================
# 命令实现
# =============================================================================

# init：生成 .env.production（如不存在）+ 构建 + 启动 + DB 初始化
cmd_init() {
  preflight_basic

  if [[ ! -f "$ENV_FILE" ]]; then
    info "生成 .env.production..."

    # 自动生成强密钥
    local deploy_pg_password deploy_minio_password deploy_jwt_secret deploy_admin_password
    deploy_pg_password=$(openssl rand -hex 16)
    deploy_minio_password=$(openssl rand -hex 16)
    deploy_jwt_secret=$(openssl rand -hex 32)
    deploy_admin_password=$(openssl rand -hex 16)

    cat > "$ENV_FILE" <<EOF
# 生产环境配置（含密钥，绝对不能进 git，绝对不能分享）
# 由 deploy.sh init 在 $(date '+%Y-%m-%d %H:%M:%S') 自动生成

# ============== 数据库 ==============
POSTGRES_DB=drama_predict
POSTGRES_USER=drama
POSTGRES_PASSWORD=$deploy_pg_password

# ============== MinIO 对象存储 ==============
MINIO_ACCESS_KEY=drama-minio-admin
MINIO_SECRET_KEY=$deploy_minio_password
MINIO_BUCKET=drama-exports

# ============== JWT 鉴权 ==============
JWT_SECRET=$deploy_jwt_secret
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_EXPIRES_IN=30d

# ============== LLM Provider ==============
# 留空也可以启动，之后在管理员后台配置；不要把真实 Key 提交到 Git。
LLM_PROVIDER=qwen
LLM_API_KEY=
LLM_MODEL=qwen-max
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_TIMEOUT_MS=90000

# 初次执行 ./deploy.sh seed 时使用，脚本随机生成，seed 后请在密码管理器中保存并修改。
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=$deploy_admin_password

# ============== CORS ==============
# 同源部署（前后端同域名）可以填 *；分域名填具体 origin
CORS_ORIGIN=*

# ============== 日志级别 ==============
LOG_LEVEL=info
EOF
    chmod 600 "$ENV_FILE"
    ok ".env.production 已生成（权限 600）"
    echo
    warn "下一步：检查 .env.production；可在管理员后台配置模型 API Key"
    info  "    nano $ENV_FILE"
    info  "    改完后执行：./deploy.sh start"
    info  "    然后执行：./deploy.sh seed  创建管理员账号"
    return 0
  fi

  warn ".env.production 已存在，直接构建启动"
  cmd_start
  cmd_migrate
  echo
  warn "如首次部署，请执行：./deploy.sh seed  创建管理员账号"
}

# start：构建并启动所有服务
cmd_start() {
  preflight

  info "构建镜像并启动（首次构建约 5-10 分钟，需下载 Chromium）..."
  dc up -d --build

  wait_healthy 240

  echo
  dc ps
  echo
  info "应用访问地址：http://<服务器IP>:5174"
}

# stop：停止所有服务（数据保留）
cmd_stop() {
  preflight
  dc down
  ok "已停止全部服务"
}

# restart：重启
cmd_restart() {
  preflight
  dc restart
  wait_healthy 60
  ok "已重启"
}

# update：拉新代码 + 重新构建 + 重启
cmd_update() {
  preflight
  info "拉取最新代码..."
  git pull --ff-only

  info "重新构建并启动..."
  dc up -d --build

  wait_healthy 240

  ok "更新完成"
  dc ps
}

# logs：实时日志（用户 Ctrl+C 退出不应被当失败）
cmd_logs() {
  preflight
  # 关掉 -e，避免 SIGINT 触发退出码非 0 被当失败
  set +e
  dc logs -f --tail=100
}

# status：服务状态
cmd_status() {
  preflight
  dc ps
  echo
  info "磁盘占用："
  docker system df
}

# backup：备份数据库（从 .env.production 读 PG 用户名/库名）
cmd_backup() {
  preflight

  local pg_user pg_db
  pg_user=$(env_value POSTGRES_USER drama)
  pg_db=$(env_value POSTGRES_DB drama_predict)

  local backup_file="$ROOT_DIR/backup-$(date +%Y-%m-%d-%H%M%S).sql.gz"
  info "备份数据库（user=$pg_user db=$pg_db）到 $backup_file ..."

  if dc exec -T postgres pg_dump -U "$pg_user" "$pg_db" 2>/tmp/pgdump.err | gzip > "$backup_file"; then
    local size
    size=$(du -h "$backup_file" | awk '{print $1}')
    ok "备份完成（大小 $size）"
  else
    err "备份失败：$(cat /tmp/pgdump.err)"
  fi
}

# migrate：手动跑迁移
cmd_migrate() {
  preflight
  info "执行数据库迁移..."
  dc exec -T app pnpm db:migrate
  ok "迁移完成"
}

# seed：初始化管理员 + Prompt（关闭 -e 让单步失败也能继续）
cmd_seed() {
  preflight
  set +e
  info "创建管理员账号..."
  dc exec -T app pnpm db:seed
  info "初始化 Prompt 模板..."
  dc exec -T app pnpm db:seed:prompts
  set -e
  ok "Seed 完成（如管理员已存在会跳过）"
}

# =============================================================================
# 入口
# =============================================================================
case "${1:-}" in
  init)     cmd_init ;;
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  restart)  cmd_restart ;;
  update)   cmd_update ;;
  logs)     cmd_logs ;;
  status)   cmd_status ;;
  backup)   cmd_backup ;;
  migrate)  cmd_migrate ;;
  seed)     cmd_seed ;;
  -h|--help|help|"")
    sed -n '2,25p' "$0"
    exit 0 ;;
  *) err "未知命令：$1（用 ./deploy.sh help 查看支持的命令）" ;;
esac
