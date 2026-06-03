/**
 * @file lib/cli-utils.ts — CLI 工具函数
 *
 * 本文件提供 CLI 命令执行所需的通用工具函数：
 *
 *   - CLIContext 接口: 定义 CLI 运行上下文（Vault 路径、LLM 实例、详细模式标志）
 *   - buildContext(): 从 commander 的父命令选项中构建完整的 CLI 上下文
 *   - requireLLM():   确保 LLM 提供者可用（否则抛出异常）
 *   - row():          格式化输出表格行（带颜色的标签-值对）
 *
 * 设计意图：
 *   将所有子命令共用的上下文构建逻辑集中到此文件，
 *   避免在每个子命令中重复相同的初始化代码。
 *   buildContext() 会同时处理 Vault 路径验证和 LLM 实例创建。
 *
 * 依赖关系：
 *   - llm/factory.ts: createLLM() 创建 LLM 提供者实例
 *   - llm/provider.ts: LLMProvider 接口定义
 *   - 被 commands/work.ts 中所有子命令的 action 调用
 */

import fs from "fs";
import { createLLM } from "../llm/factory.js";
import type { LLMOptions } from "../llm/factory.js";
import type { LLMProvider } from "../llm/provider.js";

/**
 * CLI 运行上下文接口
 *
 * 在每个子命令执行时通过 buildContext() 创建，
 * 包含命令执行所需的所有环境信息。
 */
export interface CLIContext {
  /**
   * Vault 信息
   * root: Obsidian Vault 根目录的绝对路径
   */
  vault: { root: string };
  /**
   * LLM 提供者实例（可能为 null）
   * 当 LLM 创建失败时（如缺少 API key），此值为 null
   * 不需要 LLM 的命令（如 create、validate）仍然可以正常运行
   */
  llm: LLMProvider | null;
  /** 是否启用详细输出模式（用于调试） */
  verbose: boolean;
}

/**
 * 从 commander 父命令选项中构建 CLI 上下文
 *
 * 这是所有子命令的统一入口函数，负责：
 *   1. 解析 Vault 根目录路径（优先级：--vault 选项 > OBSIDIAN_VAULT 环境变量 > 当前目录）
 *   2. 验证 Vault 目录是否存在
 *   3. 创建 LLM 提供者实例（如果创建失败则为 null）
 *   4. 组装并返回 CLIContext 对象
 *
 * @param opts - commander 父命令解析后的选项对象
 *               包含 vault、llm、apiProvider、model、apiKey、baseUrl、verbose 等字段
 * @returns CLIContext 对象，供子命令的 action 回调使用
 * @throws 如果 Vault 目录不存在，抛出错误
 */
export function buildContext(opts: any): CLIContext {
  /** 解析 Vault 根目录：--vault 选项 > 环境变量 > 当前目录 */
  const vaultRoot: string = opts.vault ?? process.env.OBSIDIAN_VAULT ?? process.cwd();
  /** 验证 Vault 目录是否存在 */
  if (!fs.existsSync(vaultRoot)) {
    throw new Error(`Vault not found: ${vaultRoot}`);
  }

  /** 构建 LLM 配置选项 */
  const llmOpts: LLMOptions = {
    provider: opts.llm ?? "api",
    apiProvider: opts.apiProvider ?? "anthropic",
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  };
  /**
   * 创建 LLM 实例
   * 如果创建失败（如缺少 API key），返回 null 而非抛出异常
   * 这样不需要 LLM 的命令（如 create、validate）仍然可以运行
   */
  const llm = createLLM(llmOpts);

  return { vault: { root: vaultRoot }, llm, verbose: opts.verbose ?? false };
}

/**
 * 要求 LLM 提供者必须可用
 *
 * 在需要 LLM 功能的命令中调用，如果 LLM 不可用则抛出明确的错误信息。
 * 用于需要 AI 辅助的功能（如智能分析、自动标签等）。
 *
 * @param ctx - CLI 上下文
 * @returns LLM 提供者实例
 * @throws 如果 LLM 不可用（ctx.llm 为 null），抛出错误并提示设置环境变量
 */
export function requireLLM(ctx: CLIContext): LLMProvider {
  if (!ctx.llm) {
    throw new Error("This command requires an LLM provider. Set ANTHROPIC_AUTH_TOKEN or use --llm agent");
  }
  return ctx.llm;
}

/**
 * 打印格式化的表格行
 *
 * 输出一个带标签和值的行，标签左对齐并填充到 24 字符宽度。
 * 支持 ANSI 颜色代码来高亮显示。
 *
 * @param label - 标签文本（左对齐，填充到 24 字符）
 * @param value - 值（数字或字符串）
 * @param color - 可选的 ANSI 颜色代码（如 "32" 表示绿色，"31" 表示红色）
 *
 * 使用示例：
 *   row("Total Files", 42);            // 无颜色
 *   row("Errors", 3, "31");            // 红色
 *   row("Status", "OK", "32");         // 绿色
 */
export function row(label: string, value: string | number, color?: string): void {
  /** 构建 ANSI 颜色前缀 */
  const c = color ? `\x1b[${color}m` : "";
  /** ANSI 重置后缀（恢复默认颜色） */
  const r = "\x1b[0m";
  console.log(`  ${c}${label.padEnd(24)}${r} ${value}`);
}
