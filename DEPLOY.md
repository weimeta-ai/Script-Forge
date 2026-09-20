# 部署指南（生产环境）

> 适用于 Ubuntu 20.04+ / Debian 11+ 服务器，采用 **Docker Compose 一体化部署** + **Nginx 反向代理** + **Let's Encrypt HTTPS**。

## 目录

- [1. 架构概览](#1-架构概览)
- [2. 服务器要求](#2-服务器要求)
- [3. 服务器初始化](#3-服务器初始化)
- [4. 拉代码与部署](#4-拉代码与部署)
- [5. 数据库初始化](#5-数据库初始化)
- [6. Nginx + HTTPS 配置](#6-nginx--https-配置)
- [7. 常用维护命令](#7-常用维护命令)
- [8. 故障排查](#8-故障排查)
- [9. 备份与恢复](#9-备份与恢复)

---

## 1. 架构概览

```
                      ┌─────────────────────────────────────────┐
                      │  Ubuntu Server                          │
                      │                                         │
   用户 ── HTTPS ──► │  Nginx :443 ──┐                         │
                      │               │                         │
                      │  Docker Compose 网络：                  │
                      │    ┌──────────┴──────────┐              │
                      │    │ app  :5174          │              │
                      │    │   ├─ Hono API       │              │
                      │    │   ├─ 静态文件 (前端) │              │
                      │    │   └─ Chromium (PDF) │              │
                      │    │   ↓                 │              │
                      │    │ postgres (内部)     │              │
                      │    │ redis    (内部)     │              │
                      │    │ minio    (内部)     │              │
                      │    └─────────────────────┘              │
                      └─────────────────────────────────────────┘
```

**特性：**
- 单一端口（5174）同时服务前端静态文件 + 后端 API
- 前端通过 `/api/*` 调用后端（同源，无 CORS 问题）
- 后端内置 Puppeteer Chromium，支持 PDF 导出
- 数据持久化：PG / Redis / MinIO 数据卷

---

## 2. 服务器要求

| 项目 | 最低配置 | 推荐 |
|------|---------|------|
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB（Chromium 吃内存）|
| 磁盘 | 20 GB | 50 GB |
| 系统 | Ubuntu 20.04+ / Debian 11+ | Ubuntu 22.04 LTS |
| 端口 | 80 / 443 / 22 必须开放 | 加 5174（Nginx 配置前的临时访问）|

---

## 3. 服务器初始化

SSH 登录服务器后执行（仅首次）：

```bash
# 装 Docker、git、Nginx、Certbot、防火墙
apt update
apt install -y git nginx certbot ufw

# 装 Docker（官方脚本，一条命令）
curl -fsSL https://get.docker.com | sh

# 把当前用户加入 docker 组（免 sudo）
usermod -aG docker $USER
# ⚠️ 上面这步执行后需要重新 SSH 登录才生效

# 配置防火墙
ufw allow 22/tcp       # SSH
ufw allow 80/tcp       # HTTP（重定向 + Let's Encrypt 验证）
ufw allow 443/tcp      # HTTPS
ufw --force enable
```

---

## 4. 拉代码与部署

### 4.1 拉代码

```bash
mkdir -p /opt/drama && cd /opt/drama

# 替换为你的仓库地址（HTTP 方式，无需配 SSH key）
git clone <你的仓库地址> .
```

### 4.2 一键部署

```bash
./deploy.sh init
```

脚本会：
1. 自动生成 `.env.production`（含强随机密码）
2. 提示你检查 `.env.production`；模型 Key 可以留空，之后在管理员后台配置
3. 改完后执行 `./deploy.sh start` 构建并启动

> **首次构建耗时**：5-10 分钟（要下载 Chromium ~500MB + 中文字体）

### 4.3 改 LLM_API_KEY

```bash
nano .env.production
# 可选：在这里配置模型 Key；也可以启动后在管理员后台配置
# LLM_API_KEY=

# 保存后启动
./deploy.sh start
```

### 4.4 验证启动

```bash
./deploy.sh status
```

应该看到 4 个容器都 `healthy`：

```
NAME             STATUS                   PORTS
drama-app        Up 2 minutes (healthy)   0.0.0.0:5174->5174/tcp
drama-postgres   Up 3 minutes (healthy)
drama-redis      Up 3 minutes (healthy)
drama-minio      Up 3 minutes (healthy)
```

测试 API：

```bash
curl http://localhost:5174/api/health
# 应返回：{"code":0,"data":{"status":"healthy",...},"message":"ok"}
```

浏览器访问 `http://<服务器IP>:5174` 应该能看到登录页（暂未配置 HTTPS）。

---

## 5. 数据库初始化

```bash
./deploy.sh seed
```

脚本会：
1. 创建管理员账号（首次会输出用户名和默认密码，请记录）
2. 初始化内置 Prompt 模板（报告话术、封面模板等）

如果忘了密码，可以重置：

```bash
./deploy.sh exec app pnpm db:seed
```

---

## 6. Nginx + HTTPS 配置

### 6.1 域名解析

在你的域名服务商后台，把 `drama.yourdomain.com` 的 **A 记录**指向服务器 IP。

验证解析：

```bash
dig drama.yourdomain.com +short
# 应返回你的服务器 IP
```

### 6.2 申请 HTTPS 证书

```bash
# 先临时停掉占用 80 端口的（Nginx 已装未启动时不用停）
certbot certonly --standalone -d drama.yourdomain.com

# 按提示输入邮箱、同意条款
# 成功后证书路径：
#   /etc/letsencrypt/live/drama.yourdomain.com/fullchain.pem
#   /etc/letsencrypt/live/drama.yourdomain.com/privkey.pem
```

### 6.3 配置 Nginx

```bash
cat > /etc/nginx/conf.d/drama.conf <<'EOF'
server {
    listen 80;
    server_name drama.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name drama.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/drama.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/drama.yourdomain.com/privkey.pem;

    # 上传大文件（剧本文件 + 批量图片）
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:5174;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 支持（任务进度推送必需）
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
EOF

# 测试配置语法
nginx -t

# 启动 Nginx 并设置开机自启
systemctl enable --now nginx
systemctl reload nginx
```

### 6.4 设置证书自动续期

Let's Encrypt 证书 90 天过期，加 cron 自动续：

```bash
echo "0 3 * * * root certbot renew --quiet --post-hook 'systemctl reload nginx'" | sudo tee /etc/cron.d/certbot
```

### 6.5 收紧防火墙

Nginx 配好后，关闭 5174 对公网的直接访问（只让 Nginx 走 443）：

```bash
ufw deny 5174/tcp
ufw reload
```

### 6.6 验证

访问 `https://drama.yourdomain.com`，应该能看到登录页。

---

## 7. 常用维护命令

```bash
cd /opt/drama

# 查看实时日志（Ctrl+C 退出）
./deploy.sh logs

# 查看服务状态
./deploy.sh status

# 重启所有服务
./deploy.sh restart

# 停止全部
./deploy.sh stop

# 启动（已 init 过）
./deploy.sh start

# 更新到最新代码
./deploy.sh update

# 备份数据库
./deploy.sh backup

# 单独跑数据库迁移
./deploy.sh migrate

# 重新初始化管理员 / Prompt
./deploy.sh seed
```

### 查看单个服务日志

```bash
docker compose -f docker-compose.prod.yml logs -f app       # 应用
docker compose -f docker-compose.prod.yml logs -f postgres  # 数据库
docker compose -f docker-compose.prod.yml logs -f redis     # 队列
docker compose -f docker-compose.prod.yml logs -f minio     # 对象存储
```

---

## 8. 故障排查

### 8.1 容器启动失败

```bash
# 看具体哪个容器挂了
./deploy.sh status

# 看失败容器的日志
docker compose -f docker-compose.prod.yml logs app
```

### 8.2 数据库连接失败

```bash
# 进 postgres 容器检查
docker compose -f docker-compose.prod.yml exec postgres psql -U drama -d drama_predict
```

如果报 `password authentication failed`，检查 `.env.production` 里的密码是否和 `POSTGRES_PASSWORD` 一致。

**重置密码（破坏性操作）**：

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm drama-predict-web_pgdata   # ⚠️ 会清空数据库
./deploy.sh start
./deploy.sh migrate
./deploy.sh seed
```

### 8.3 LLM 调用 401

检查管理员后台中的模型地址、模型名称和 API Key。不要把真实 Key 粘贴到命令、日志、Issue 或 Git 提交中。

### 8.4 PDF 导出失败（Puppeteer）

容器内 Chromium 状态：

```bash
docker compose -f docker-compose.prod.yml exec app which chromium || echo "未找到 Chromium"
docker compose -f docker-compose.prod.yml exec app ls -la /usr/local/.cache/puppeteer/
```

### 8.5 端口被占用

```bash
lsof -i :5174    # 看 5174 被谁占了
lsof -i :80
lsof -i :443
```

### 8.6 磁盘满了

```bash
df -h

# 清理 Docker 无用镜像（小心，会删除未使用的镜像）
docker system prune -af --volumes
```

---

## 9. 备份与恢复

### 9.1 自动备份（推荐）

加 cron 每天凌晨 3 点备份：

```bash
echo "0 3 * * * root /opt/drama/deploy.sh backup >> /var/log/drama-backup.log 2>&1" | sudo tee /etc/cron.d/drama-backup
```

备份文件在 `/opt/drama/backup-YYYY-MM-DD-HHMMSS.sql.gz`，定期同步到 OSS 或本地。

### 9.2 手动恢复

```bash
# 1. 把备份文件传到服务器
scp backup-2026-06-26-030000.sql.gz root@server:/opt/drama/

# 2. 恢复
cd /opt/drama
gunzip -c backup-2026-06-26-030000.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U drama drama_predict
```

---

## 附录：常用环境变量速查

| 变量 | 默认值 | 必改 | 说明 |
|------|--------|------|------|
| `POSTGRES_PASSWORD` | 随机 | ❌ | 数据库密码，脚本自动生成 |
| `JWT_SECRET` | 随机 | ❌ | JWT 签名密钥，脚本自动生成 |
| `MINIO_SECRET_KEY` | 随机 | ❌ | MinIO 密钥，脚本自动生成 |
| `LLM_API_KEY` | 空 | 可选 | LLM 服务商 API Key，也可以在管理员后台配置 |
| `LLM_PROVIDER` | qwen | ❌ | LLM 服务商（qwen/deepseek/openai）|
| `CORS_ORIGIN` | * | ❌ | 同源部署填 * 即可 |
| `LOG_LEVEL` | info | ❌ | 日志级别（debug/info/warn/error）|

---

## 附录：完整首次部署（一键脚本版）

如果你已经按第 3 节装好 Docker + Nginx + Certbot，下面是完整流程：

```bash
# 1. 拉代码
mkdir -p /opt/drama && cd /opt/drama
git clone <你的仓库地址> .

# 2. 生成配置
./deploy.sh init

# 3. （可选）配置 LLM_API_KEY；也可以启动后在管理员后台配置
nano .env.production

# 4. 构建 + 启动
./deploy.sh start

# 5. 初始化数据库
./deploy.sh seed

# 6. 配置域名（如需要 HTTPS）
certbot certonly --standalone -d drama.yourdomain.com
# 然后参考第 6.3 节配置 Nginx

# 完成！访问 https://drama.yourdomain.com
```
