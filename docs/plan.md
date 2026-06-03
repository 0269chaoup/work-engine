---
type: Plan
status: active
created: 2026-05-27T00:00:00.000Z
updated: '2026-05-27'
version: 4
domain: work-engine
---

# work-engine-任务管理架构

## 背景

当前系统中任务管理与知识管理耦合严重

## 目标

实现任务 SSOT 在 Work/

## 方案设计

### 核心原则
- 任务 SSOT 在 Work/（30-Projects/Work/）
- 只支持 Task 和 TechNote 两种类型
- 五态状态模型：Planned → Active → Blocked → Completed → Archived
- 纯语义命名（无时间戳，时间在 YAML created 字段）
- 与 wiki-engine 解耦：Work = action，Knowledge = reference

### CLI 命令
| 命令 | 功能 |
|------|------|
| work create | 创建任务文件 |
| work validate | 验证 frontmatter |
| work fix | 修复缺失/错误的 frontmatter |
| work normalize | 全量规范化 |
| work index | 生成 MOC-enhanced INDEX.md |
| work archive | 归档项目 |
| work task | 任务 callout 管理 |
| work report | 项目状态报告 |
| work log | 往日记写日志事件 |

### 日记集成（Strategy A）
- work log 命令通过 diary-bridge 模块写入日记
- 支持关联任务：-p project -t task
## 实施状态

- [x] 核心 CLI 框架
- [x] Task/TechNote 类型系统
- [x] 五态状态模型
- [x] frontmatter 验证/修复/规范化
- [x] MOC-enhanced INDEX.md 生成
- [x] 项目归档（压实 TechNotes）
- [x] 日记集成（diary-bridge + work log）
## 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-27 | v1 | 初稿 |
| 2026-05-27 | v4 | 初稿：整理现有架构到 plan-engine |
