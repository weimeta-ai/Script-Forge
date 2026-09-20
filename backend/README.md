# drama-predict-backend

短剧商业潜力评估系统的后端服务：3 阶段流水线（导入 → 分析 → 导出）。

## 技术栈

- 运行时：Node.js 20+ / TypeScript（ESM）
- Web 框架：Hono
- ORM / 迁移：Drizzle ORM + drizzle-kit
- 数据库：PostgreSQL
- 队列 / 缓存：BullMQ + Redis
- 对象存储：MinIO（S3 兼容）/ 阿里云 OSS
- LLM：OpenAI 兼容协议 + Anthropic 原生协议双支持
- 文档解析：mammoth（docx）/ pdf-parse（PDF）
- 导出：Puppeteer（PDF）
- 日志：pino

## 目录结构

```
src/
├── db/            # Drizzle schema 与 client
├── routes/        # HTTP 路由（Hono）
├── services/      # 业务逻辑
├── workers/       # 异步任务 worker（分析 / 封面生成）
├── prompts/       # 提示词模板（开源版为占位模板，需自行配置）
├── repositories/  # 数据访问层
├── lib/           # 工具库（analyzer / errors / logger ...）
├── scripts/       # 种子脚本（管理员 / 话术 / 积分规则）
└── schemas/       # 请求校验 schema
```

## 快速开始

环境准备与启动步骤见根目录 [README.md](../README.md)，环境变量说明见 [.env.example](.env.example)。

```bash
pnpm install
pnpm db:migrate        # 数据库迁移
pnpm db:seed           # 初始化管理员
pnpm dev               # 启动 API 服务（默认 5174 端口）
pnpm worker            # 启动异步任务 worker（另一个终端）
```

## 提示词配置

开源版不附带业务话术，以下位置为占位模板，需自行编写：

- `refer/system_prompt.md` — 报告分析系统提示词（可被管理后台配置覆盖）
- `src/prompts/ultra.md` — Ultra 模式用户提示词
- `src/prompts/nodes.ts` — 8 节点分析的用户提示词模板

配置完成后可运行 `pnpm db:seed:prompts` 写入数据库，之后可在管理后台在线编辑。
