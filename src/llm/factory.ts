/**
 * @file llm/factory.ts — LLM 提供者工厂
 *
 * 本文件提供 LLM 提供者的工厂函数，根据 CLI 选项创建对应的 LLM 实例。
 *
 * 工厂模式的实现：
 *   - --llm api   → 创建 APIProvider（直接调用 LLM API，静默运行）
 *   - --llm agent → 创建 PipeProvider（通过 stdin/stdout 与 Helios 代理通信）
 *
 * 设计特点：
 *   - 创建失败时返回 null 而非抛出异常，使不需要 LLM 的命令仍可正常运行
 *   - 集中管理 LLM 实例的创建逻辑，避免在各子命令中重复
 *
 * 依赖关系：
 *   - 被 lib/cli-utils.ts 的 buildContext() 调用
 *   - 消费 llm/api-provider.ts 的 APIProvider 类
 *   - 消费 llm/pipe-provider.ts 的 PipeProvider 类
 *   - 使用 llm/provider.ts 的 LLMProvider 接口
 */

import type { LLMProvider } from "./provider.js";
import { APIProvider } from "./api-provider.js";
import { PipeProvider } from "./pipe-provider.js";

/**
 * LLM 配置选项接口
 *
 * 从 CLI 命令行参数解析而来，用于创建 LLM 提供者实例。
 */
export interface LLMOptions {
  /**
   * LLM 提供者类型
   *   - "api":   直接调用 LLM API（需要 API key）
   *   - "agent": 通过管道与外部 AI 代理通信（由 Helios 读取 prompt 并返回结果）
   */
  provider: "api" | "agent";
  /**
   * API 服务提供者名称
   *   - "anthropic": Anthropic Claude API
   *   - "openai":    OpenAI GPT API
   */
  apiProvider?: "anthropic" | "openai";
  /** LLM 模型名称（如 "claude-sonnet-4-6"） */
  model?: string;
  /** API 密钥（也可通过环境变量 ANTHROPIC_AUTH_TOKEN 或 OPENAI_API_KEY 设置） */
  apiKey?: string;
  /** 自定义 API 基础 URL（用于代理服务器或私有部署） */
  baseUrl?: string;
}

/**
 * 根据 CLI 选项创建 LLM 提供者实例
 *
 * 工厂函数，根据 --llm 选项决定创建哪种提供者：
 *   - "agent" → PipeProvider（管道模式，与 Helios AI 代理通信）
 *   - "api"   → APIProvider（直连模式，调用 Anthropic/OpenAI API）
 *
 * @param opts - LLM 配置选项，来自 CLI 命令行参数
 * @returns LLM 提供者实例，创建失败时返回 null
 *
 * 设计决策：
 *   返回 null 而非抛出异常，是因为许多命令（如 create、validate）不需要 LLM。
 *   这些命令可以正常执行，只有真正需要 LLM 的命令才通过 requireLLM() 检查。
 *
 * 被调用场景：
 *   - lib/cli-utils.ts 的 buildContext() 在构建 CLI 上下文时调用
 */
export function createLLM(opts: LLMOptions): LLMProvider | null {
  /** agent 模式：创建管道提供者（无需 API key） */
  if (opts.provider === "agent") {
    return new PipeProvider();
  }

  /** api 模式：创建 API 直连提供者 */
  try {
    return new APIProvider({
      provider: opts.apiProvider ?? "anthropic",
      model: opts.model ?? "claude-sonnet-4-6",
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
    });
  } catch {
    /** 创建失败（通常因为缺少 API key），返回 null */
    return null;
  }
}
