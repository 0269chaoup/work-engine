/**
 * @file llm/api-provider.ts — API 直连模式的 LLM 提供者
 *
 * 本文件实现了通过 REST API 直接调用 LLM 服务的提供者。
 * 支持两种 API 服务：Anthropic (Claude) 和 OpenAI (GPT)。
 *
 * 工作模式：
 *   - CLI 直接向 API 发送 HTTP 请求，获取 LLM 响应
 *   - 全程静默，无需人工交互，适用于自动化场景
 *
 * 支持的 API 服务：
 *   - Anthropic: Claude 系列模型（默认）
 *   - OpenAI:    GPT 系列模型
 *
 * 配置方式（优先级从高到低）：
 *   1. 构造函数参数（config.apiKey）
 *   2. 环境变量 ANTHROPIC_AUTH_TOKEN（Anthropic）
 *   3. 环境变量 OPENAI_API_KEY（OpenAI）
 *
 * 依赖关系：
 *   - 实现 llm/provider.ts 的 LLMProvider 接口
 *   - 被 llm/factory.ts 的 createLLM() 创建
 *   - 被 lib/cli-utils.ts 通过 CLIContext 传递给需要 LLM 的子命令
 */

import type { LLMProvider, LLMResponse } from "./provider.js";

/**
 * API 提供者配置接口
 *
 * 定义 API 调用所需的全部参数。
 */
interface APIConfig {
  /** API 服务提供者：Anthropic 或 OpenAI */
  provider: "anthropic" | "openai";
  /** API 密钥（用于身份认证） */
  apiKey: string;
  /** 要使用的 LLM 模型名称 */
  model: string;
  /** 自定义 API 基础 URL（可选，用于代理服务器或私有部署） */
  baseUrl?: string;
}

/**
 * API 直连模式的 LLM 提供者类
 *
 * 通过 HTTP REST API 直接调用 Anthropic 或 OpenAI 的 LLM 服务。
 * 实现 LLMProvider 接口，提供完整的 LLM 交互能力。
 *
 * 使用示例：
 *   const provider = new APIProvider({ provider: "anthropic", apiKey: "sk-xxx" });
 *   const response = await provider.complete("请分析这段代码...");
 */
export class APIProvider implements LLMProvider {
  /** 提供者名称标识 */
  name = "api";

  /** API 配置信息（私有，不可从外部访问） */
  private config: APIConfig;

  /**
   * 构造函数
   *
   * 初始化 API 提供者，解析配置参数。
   * 如果未提供 API key，会尝试从环境变量读取。
   * 如果环境变量也没有，抛出错误。
   *
   * @param config - 可选的部分配置参数，缺失的字段使用默认值
   * @throws 如果没有找到 API key，抛出错误
   */
  constructor(config?: Partial<APIConfig>) {
    this.config = {
      provider: config?.provider ?? "anthropic",
      /** API key 优先级：构造参数 > 环境变量 ANTHROPIC_AUTH_TOKEN > 环境变量 OPENAI_API_KEY */
      apiKey: config?.apiKey ?? process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.OPENAI_API_KEY ?? "",
      model: config?.model ?? "claude-sonnet-4-6",
      baseUrl: config?.baseUrl,
    };
    if (!this.config.apiKey) {
      throw new Error("No API key found. Set ANTHROPIC_AUTH_TOKEN or OPENAI_API_KEY env var.");
    }
  }

  /**
   * 判断是否需要人工交互
   *
   * API 直连模式全程自动化，无需人工参与，返回 false。
   */
  isInteractive() { return false; }

  /**
   * 发送 prompt 并获取 LLM 响应
   *
   * 根据配置的 provider 类型，自动选择调用 Anthropic 或 OpenAI API。
   *
   * @param prompt - 用户消息文本
   * @param system - 可选的系统提示词（定义 LLM 角色和行为约束）
   * @returns LLM 响应，包含生成的文本和 token 使用量
   */
  async complete(prompt: string, system?: string): Promise<LLMResponse> {
    if (this.config.provider === "anthropic") {
      return this.callAnthropic(prompt, system);
    }
    return this.callOpenAI(prompt, system);
  }

  /**
   * 调用 Anthropic Claude API
   *
   * 使用 Anthropic Messages API (/v1/messages) 发送请求。
   *
   * API 文档：https://docs.anthropic.com/claude/reference/messages_post
   *
   * @param prompt - 用户消息文本
   * @param system - 可选的系统提示词（默认为知识分析引擎的角色设定）
   * @returns LLM 响应
   * @throws 如果 API 返回错误，抛出异常
   */
  private async callAnthropic(prompt: string, system?: string): Promise<LLMResponse> {
    /** 使用自定义 base URL 或默认的 Anthropic API 地址 */
    const url = this.config.baseUrl ?? "https://api.anthropic.com";
    const resp = await fetch(`${url}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        /** Anthropic API 使用 x-api-key 头部进行身份认证 */
        "x-api-key": this.config.apiKey,
        /** 指定 API 版本 */
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model,
        /** 最大输出 token 数 */
        max_tokens: 4096,
        /** 系统提示词：定义 LLM 的角色 */
        system: system ?? "You are a knowledge analysis engine. Always respond in valid JSON when asked.",
        /** 用户消息 */
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json() as any;
    /** 检查 API 错误 */
    if (data.error) throw new Error(`Anthropic API error: ${data.error.message}`);
    return {
      /** 提取响应文本：Anthropic 返回 content 数组，取第一个元素的 text */
      content: data.content?.[0]?.text ?? "",
      /** 提取 token 使用量（Anthropic 使用 input_tokens/output_tokens） */
      usage: data.usage ? { prompt: data.usage.input_tokens, completion: data.usage.output_tokens } : undefined,
    };
  }

  /**
   * 调用 OpenAI Chat Completions API
   *
   * 使用 OpenAI Chat Completions API (/v1/chat/completions) 发送请求。
   *
   * API 文档：https://platform.openai.com/docs/api-reference/chat
   *
   * @param prompt - 用户消息文本
   * @param system - 可选的系统提示词（默认为知识分析引擎的角色设定）
   * @returns LLM 响应
   * @throws 如果 API 返回错误，抛出异常
   */
  private async callOpenAI(prompt: string, system?: string): Promise<LLMResponse> {
    /** 使用自定义 base URL 或默认的 OpenAI API 地址 */
    const url = this.config.baseUrl ?? "https://api.openai.com";
    const resp = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        /** OpenAI API 使用 Bearer token 进行身份认证 */
        "Authorization": `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        /** 最大输出 token 数 */
        max_tokens: 4096,
        /** OpenAI 的 system 消息放在 messages 数组的首位 */
        messages: [
          { role: "system", content: system ?? "You are a knowledge analysis engine. Always respond in valid JSON when asked." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await resp.json() as any;
    /** 检查 API 错误 */
    if (data.error) throw new Error(`OpenAI API error: ${data.error.message}`);
    return {
      /** 提取响应文本：OpenAI 返回 choices 数组，取第一个元素的 message.content */
      content: data.choices?.[0]?.message?.content ?? "",
      /** 提取 token 使用量（OpenAI 使用 prompt_tokens/completion_tokens） */
      usage: data.usage ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens } : undefined,
    };
  }
}
