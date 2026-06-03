#!/usr/bin/env node
/**
 * @file index.ts — work-engine 的命令行入口文件
 *
 * 本文件是 Obsidian 工作任务管理引擎 (work-engine) 的主入口。
 * 使用 commander 库构建 CLI 命令行工具，支持以下全局选项：
 *   --vault:        指定 Obsidian Vault 根目录（默认读取 OBSIDIAN_VAULT 环境变量或当前目录）
 *   --llm:          LLM 提供者类型，支持 "agent"（管道模式，由 AI 代理处理）或 "api"（直接 API 调用）
 *   --api-provider: API 提供者名称，支持 "anthropic" 或 "openai"
 *   --model:        LLM 模型名称
 *   --api-key:      API 密钥（也可通过环境变量设置）
 *   --base-url:     自定义 API 基础 URL（用于代理服务器）
 *   --verbose:      是否输出详细信息
 *
 * 所有子命令通过 workCommand() 注册，主要功能包括：
 *   - 创建/验证/归档工作任务文件
 *   - 生成项目索引（MOC 驱动）
 *   - 管理任务笔记（[!todo] 格式）
 *   - 修复和规范化工作文件的 frontmatter
 *   - 生成项目状态报告
 *   - 记录日志到 Obsidian 日记中
 */

import { Command } from "commander";
import { workCommand } from "./commands/work.js";

/** 创建 CLI 程序实例 */
const program = new Command();

/** 配置全局命令行选项和描述信息 */
program
  .name("work-engine")
  .description(
    "Project & task management engine for Obsidian vault — MOC-driven work tracking"
  )
  .version("1.0.0")
  /** Obsidian Vault 根目录路径，默认取环境变量 OBSIDIAN_VAULT 或当前工作目录 */
  .option(
    "--vault <path>",
    "vault root directory",
    process.env.OBSIDIAN_VAULT ?? process.cwd()
  )
  /** LLM 提供者类型：agent（管道模式，由外部 AI 代理读取 prompt 并返回结果）或 api（直接调用 API） */
  .option("--llm <provider>", "LLM provider: agent | api", "agent")
  /** API 提供者名称，决定调用哪个 LLM 服务 */
  .option("--api-provider <name>", "API provider: anthropic | openai", "anthropic")
  /** LLM 模型名称，默认 claude-sonnet-4-6 */
  .option("--model <name>", "LLM model name", "claude-sonnet-4-6")
  /** API 密钥，也可通过 ANTHROPIC_AUTH_TOKEN 或 OPENAI_API_KEY 环境变量设置 */
  .option("--api-key <key>", "API key (or set ANTHROPIC_AUTH_TOKEN / OPENAI_API_KEY)")
  /** 自定义 API 基础 URL，用于代理服务器或私有部署 */
  .option("--base-url <url>", "Custom API base URL (for proxies)")
  /** 详细输出模式，用于调试 */
  .option("--verbose", "verbose output", false);

/** 注册 work 子命令（包含 create/validate/index/archive/task/fix/normalize/report/log 等子命令） */
program.addCommand(workCommand());

/** 解析命令行参数并执行对应的命令处理函数 */
program.parse();
