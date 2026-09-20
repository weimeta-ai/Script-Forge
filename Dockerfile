# =============================================================================
# 多阶段 Dockerfile：合并构建前后端 + Chromium 运行时
# -----------------------------------------------------------------------------
# 阶段说明：
#   1. base          装 Node + pnpm + Chromium 运行时依赖（共享基础镜像）
#   2. deps          装根级 + frontend + backend 依赖（利用 docker 层缓存）
#   3. build-fe      构建前端 dist（直接 vite build，跳过 custom_build.sh 的 zip 打包）
#   4. build-be      构建后端 dist
#   5. runtime       最终运行镜像，只保留产物 + 必要运行时
#
# 启动后：
#   - 单一端口 5174 同时服务前端静态文件 + 后端 API
#   - STATIC_ROOT=/app/dist 让 Hono 挂载前端 SPA
# =============================================================================
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# 配置 npm 镜像（包括 corepack 下载 pnpm 也会使用）
COPY .npmrc /root/.npmrc

# 启用 Corepack 并配置 pnpm 国内镜像源
RUN corepack enable && pnpm config set registry https://registry.npmmirror.com

# 禁用 pnpm 11+ 新的 ignored builds 检查，直接允许所有构建脚本
ENV PNPM_ALLOW_ALL_BUILDS=true

# 替换为国内北京外国语大学 apt 源（更稳定的镜像源，解决下载超时问题）
RUN sed -i 's/deb.debian.org/mirrors.bfsu.edu.cn/g' /etc/apt/sources.list.d/debian.sources && \
    sed -i 's/security.debian.org/mirrors.bfsu.edu.cn/g' /etc/apt/sources.list.d/debian.sources

# 装 Chromium 运行时依赖（puppeteer 23.x 导出 PDF 需要）
# 不装 chromium 包：让 puppeteer 用自带 Chromium（版本严格匹配）
RUN env DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    fonts-noto-cjk \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# puppeteer 缓存目录（构建时装入 Chromium，运行时复用）
ENV PUPPETEER_CACHE_DIR=/usr/local/.cache/puppeteer

# =============================================================================
# 阶段 2：装依赖（前后端共享 lockfile）
# =============================================================================
FROM base AS deps
WORKDIR /build

# copy 依赖描述文件，最大化 docker 层缓存命中
COPY package.json pnpm-lock.yaml ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

# 强制写入干净的 pnpm-workspace.yaml
# 允许所有构建 + 明确批准需要运行脚本的包，彻底解决 ERR_PNPM_IGNORED_BUILDS
RUN printf "packages:\n  - 'frontend'\n  - 'backend'\nallowAllBuilds: true\nallowBuilds:\n  esbuild: true\n  msgpackr-extract: true\n  puppeteer: true\n" > pnpm-workspace.yaml

# 强行写入 pnpm 的安全白名单配置到项目根 .npmrc，确保配置生效
RUN echo "only-built-dependencies[]=esbuild" >> .npmrc && \
    echo "only-built-dependencies[]=msgpackr-extract" >> .npmrc && \
    echo "only-built-dependencies[]=puppeteer" >> .npmrc

# 装根级 + frontend + backend 依赖，pnpm v11 正确参数写法
# --config.only-built-dependencies 直接指定允许运行构建脚本的白名单
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --config.only-built-dependencies=esbuild,msgpackr-extract,puppeteer

# =============================================================================
# 阶段 3：构建前端
# =============================================================================
FROM deps AS build-fe
WORKDIR /build

# 复制全部源码（.dockerignore 已经排除了 node_modules）
COPY . .

# 直接调 vite build，跳过 custom_build.sh（它会把 dist 改名 + zip 打包，生产不需要）
WORKDIR /build/frontend
ENV VITE_API_BASE_URL=/api
RUN pnpm exec vite build

# =============================================================================
# 阶段 4：构建后端
# =============================================================================
FROM deps AS build-be
WORKDIR /build

# 复制全部源码（确保能正确找到所有文件进行构建）
COPY . .

# TypeScript 编译后端到 dist/
# 不用 --filter，直接切目录构建，最稳妥不会匹配错
RUN cd backend && pnpm build && ls -la dist/

# =============================================================================
# 阶段 5：运行时镜像
# =============================================================================
FROM base AS runtime
WORKDIR /app

# 1. 前端构建产物 → /app/dist (STATIC_ROOT=/app/dist)
COPY --from=build-fe /build/frontend/dist ./dist

# 2. 直接拷贝整个 backend 目录，确保所有文件都在（包括 dist/config/env.js）
# 什么文件都不会漏掉，彻底解决找不到模块问题
COPY --from=build-be /build/backend ./backend

# 根目录 node_modules (根依赖)
COPY --from=build-be /build/node_modules ./node_modules

# puppeteer 下载的 Chromium（base 阶段已设 PUPPETEER_CACHE_DIR）
COPY --from=build-be /usr/local/.cache/puppeteer /usr/local/.cache/puppeteer

# 运行时环境变量（可被 docker-compose 覆盖）
ENV NODE_ENV=production
ENV PORT=5174
ENV STATIC_ROOT=/app/dist
ENV LOG_LEVEL=info
# puppeteer 用 cache 内的 Chromium（base 阶段已下载）
ENV PUPPETEER_EXECUTABLE_PATH=

EXPOSE 5174

# 拷贝单容器启动脚本（同时启动 server + worker，适配 Coolify 部署）
COPY docker-entrypoint.sh /app/backend/docker-entrypoint.sh
RUN chmod +x /app/backend/docker-entrypoint.sh

# 工作目录设到 backend，让 entrypoint 内的 node dist/*.js 能找到相对路径
WORKDIR /app/backend
CMD ["/app/backend/docker-entrypoint.sh"]
