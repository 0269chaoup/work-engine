# work-engine

Obsidian 工作任务管理引擎 CLI 工具 — 基于 MOC（Map of Content）的项目看板驱动。

以 `30-Projects/Work/` 为任务 Single Source of Truth，通过 frontmatter 元数据 + AST 正文解析 + 多文件聚合，实现从创建任务到归档项目的全生命周期管理。与 `wiki-engine`（知识管理）解耦：**Work = action，Knowledge = reference**。

## 特性

- 📋 **五态状态模型**：`🌱 Planned → 🌿 Active → 🚧 Blocked → 🍂 Completed → 🗃️ Archived`
- 📝 **双类型系统**：只支持 `Task`（任务）和 `TechNote`（技术笔记），其他类型自动映射
- 🗂️ **MOC 驱动索引**：自动为每个项目生成 `INDEX.md`，含状态分组、进度条、依赖链、知识交叉链接
- 📓 **日记桥接**：状态变更和日志自动写入 Obsidian 日记，形成时间线
- 🔧 **数据修复**：frontmatter 校验、修复、规范化，支持 dry-run 预览
- 🤖 **LLM 集成**：可选的 LLM 提供者（agent 管道模式 / API 直调模式）

## 安装

```bash
# 克隆并构建
cd ~/Projects/work-engine
npm install
npm run build

# 全局链接（可选）
npm link
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `OBSIDIAN_VAULT` | Obsidian Vault 根目录路径（也可通过 `--vault` 指定） |
| `ANTHROPIC_AUTH_TOKEN` | Anthropic API 密钥（LLM 功能需要） |
| `OPENAI_API_KEY` | OpenAI API 密钥（可选） |

### 全局选项

```
--vault <path>          Vault 根目录（默认 OBSIDIAN_VAULT 或当前目录）
--llm <provider>        LLM 提供者：agent（管道）| api（直调），默认 agent
--api-provider <name>   API 提供者：anthropic | openai
--model <name>          模型名称，默认 claude-sonnet-4-6
--api-key <key>         API 密钥
--base-url <url>        自定义 API 基础 URL
--verbose               详细输出
```

## 命令速查

### 工作文件管理

```bash
# 创建工作任务文件
work-engine work create <project> <title>
work-engine work create <project> <title> -t TechNote         # 技术笔记
work-engine work create <project> <title> --status "🌿 Active"  # 指定初始状态

# 校验 frontmatter 完整性
work-engine work validate                                     # 全量校验
work-engine work validate -p <project>                        # 限定项目
work-engine work validate --errors-only                       # 仅显示错误

# 修复缺失/错误的 frontmatter（自动迁移旧状态值）
work-engine work fix                                          # 全量修复
work-engine work fix -p <project> --dry-run                   # 预览修复

# 全面规范化（修正类型、移除 Knowledge 字段、统一日期、移动孤立文件）
work-engine work normalize                                    # 全量规范化
work-engine work normalize --dry-run                          # 预览变更

# 生成 MOC 索引（INDEX.md）
work-engine work index                                        # 所有项目
work-engine work index -p <project>                           # 单个项目

# 归档项目
work-engine work archive <project>                            # 归档
work-engine work archive <project> --compact                  # 压实 TechNotes 为复盘报告
work-engine work archive <project> --dry-run                  # 预览归档
```

### 任务管理（[!todo] callout 格式）

```bash
# 创建带 [!todo] 模板的任务笔记
work-engine work task create <project> <title>
work-engine work task create <project> <title> --group "前端开发" --group "后端开发"

# 查看任务格式模板
work-engine work task template

# 更新任务状态（支持简写）
work-engine work status <project> <title> <status>
work-engine work status my-project "API对接" completed        # 自动写日记
work-engine work status my-project "API对接" active
work-engine work status my-project "API对接" blocked
```

状态简写对照：

| 简写 | 完整值 |
|------|--------|
| `planned` | `🌱 Planned` |
| `active` | `🌿 Active` |
| `blocked` | `🚧 Blocked` |
| `completed` | `🍂 Completed` |
| `archived` | `🗃️ Archived` |

### 日志与报告

```bash
# 写入日记日志
work-engine work log "完成了用户认证模块"
work-engine work log "修复登录bug" -p my-project -t "用户认证"  # 关联任务
work-engine work log "部署完成" --icon 🚀 --tag #deploy        # 自定义图标和标签

# 生成项目状态报告
work-engine work report
```

## 架构概览

### 数据流

```
Markdown 文件 (.md)
       │
       ▼
┌─────────────────┐     ┌──────────────────┐
│  ast-parser.ts  │────▶│  aggregator.ts   │
│  (AST 解析)     │     │  (多文件聚合)    │
└─────────────────┘     └────────┬─────────┘
       │                         │
       ▼                         ▼
┌─────────────────┐     ┌──────────────────┐
│  lib/work.ts    │     │  template.ts     │
│  (CRUD + 状态)  │     │  (MOC 渲染)      │
└────────┬────────┘     └────────┬─────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│          commands/work.ts               │
│       (CLI 命令定义与路由)               │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  diary-bridge   │
│  (日记写入)     │
└─────────────────┘
```

### 目录结构

```
src/
├── index.ts                 # CLI 入口（commander 全局选项定义）
├── commands/
│   └── work.ts              # work 子命令组（create/validate/index/archive/task/fix/normalize/report/log/status）
├── lib/
│   ├── work.ts              # 核心业务逻辑（CRUD、状态管理、校验、修复、规范化、报告）
│   ├── ast-parser.ts        # Markdown AST 解析（frontmatter + checkbox + 标题 + 词数 + 知识链接）
│   ├── aggregator.ts        # 多文件聚合（按项目分组、完成率、阻塞链、任务进度）
│   ├── template.ts          # MOC 模板渲染（INDEX.md 生成，含状态分组和依赖链）
│   ├── diary-bridge.ts      # @hermes/vault-utils re-export（日记读写桥接）
│   └── cli-utils.ts         # CLI 工具（上下文构建、LLM 初始化、格式化输出）
└── llm/
    ├── provider.ts          # LLMProvider 接口定义
    ├── factory.ts           # LLM 工厂（根据配置创建提供者）
    ├── api-provider.ts      # API 直调模式（Anthropic / OpenAI）
    └── pipe-provider.ts     # 管道模式（由外部 AI 代理处理）
```

### 文件格式

每个工作文件包含标准的 YAML frontmatter：

```markdown
---
title: "任务标题"
type: Task
project: my-project
status: 🌿 Active
created: 2026-06-03
blocked_by: "另一个任务"  # 可选，仅 Blocked 状态时使用
---

# 任务标题

正文内容...

> [!todo] 待办事项
> - **开发**
>   - [x] 已完成的任务
>   - [ ] 待完成的任务
```

### 生成的 INDEX.md 结构

每个项目索引包含：

- **概览**：文档总数、完成率、任务进度、阻塞数
- **按状态分组**：`🚧 Blocked` → `🌿 Active` → `🌱 Planned` → `🍂 Completed` → `🗃️ Archived`
- **TechNotes 索引**：独立的技术笔记列表
- **依赖链**：blocked_by 的完整递归链条
- **相关知识**：指向 `50-Knowledge/` 的交叉链接

## 双向桥接说明

`diary-bridge.ts` 是 work-engine 与 Obsidian 日记系统之间的桥接层。所有共享逻辑已迁移到 `@hermes/vault-utils` 包，此文件仅做 re-export，保持现有 import 路径不变。

### 桥接功能

| 模块 | 功能 |
|------|------|
| `ensureDiary` | 确保当日日记文件存在，不存在则创建 |
| `appendEvent` | 向日记的 `## 日志` 区域追加事件条目 |
| `findTaskFile` / `findTaskFileGlobal` | 按项目/全局查找任务文件 |
| `readTaskInfo` | 读取任务文件信息，生成 wikilink |
| `formatEventLine` | 格式化日志事件行（时间 + 图标 + 描述 + 链接 + 标签） |
| `getDiaryPath` / `relativeToVault` / `toWikilink` | 路径工具函数 |

### 日记集成场景

1. **`work status <project> <title> completed`**：状态变更为已完成时，自动在当日日记追加 `- HH:MM ✅ 完成 [[任务标题]] #task`
2. **`work log <message>`**：手动写入日志条目，可关联任务（`-p` + `-t`），生成 wikilink

## 开发说明

### 技术栈

- **运行时**：Node.js + TypeScript（ESM）
- **CLI 框架**：commander
- **Markdown 解析**：gray-matter（frontmatter）+ 正则（正文统计）
- **文件扫描**：glob
- **测试**：vitest

### 开发命令

```bash
# 构建
npm run build

# 开发模式（watch）
npm run dev

# 运行测试
npm test
```

### 设计原则

- **任务 SSOT 在 Work/**：所有任务数据以 `30-Projects/Work/` 下的 Markdown 文件为准
- **纯语义命名**：文件名不含时间戳，时间信息存储在 YAML `created` 字段
- **与 wiki-engine 解耦**：Work = action（行动），Knowledge = reference（参考）
- **只支持 Task 和 TechNote**：其他类型通过 `TYPE_NORMALIZE_MAP` 自动映射
- **所有修改操作支持 dry-run**：预览模式不写入文件
- **容错解析**：YAML 解析失败时自动尝试修复常见格式错误（双冒号、Windows 路径、重复 key）

### 依赖

| 包 | 用途 |
|----|------|
| `commander` | CLI 命令行框架 |
| `gray-matter` | YAML frontmatter 解析 |
| `glob` | 文件扫描 |
| `@hermes/vault-utils` | 日记读写、路径工具（diary-bridge re-export） |
