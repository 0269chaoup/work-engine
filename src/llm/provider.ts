/**
 * @file llm/provider.ts — LLM 提供者抽象接口定义
 *
 * 本文件定义了 work-engine 中 LLM（大语言模型）交互的抽象接口。
 * 所有 LLM 提供者（API 直连、管道代理）都必须实现此接口。
 *
 * 设计为两种运行模式：
 *   - api  模式：CLI 直接调用 LLM API（静默运行，适用于自动化场景）
 *   - pipe 模式：CLI 将 prompt 输出到 stdout，从 stdin 读取响应
 *               （专为 Helios AI 代理设计：代理读取 prompt、推理、
 *                将结果写回 → 全流程可视化）
 *
 * 依赖关系：
 *   - 被 llm/factory.ts 消费，用于创建具体的 LLM 提供者实例
 *   - 被 llm/api-provider.ts 实现（API 直连模式）
 *   - 被 llm/pipe-provider.ts 实现（管道代理模式）
 *   - 被 lib/cli-utils.ts 通过 CLIContext 传递给各子命令
 */

// ── LLM 响应接口 ──────────────────────────────────────────────────────────

/**
 * LLM 响应数据接口
 *
 * 表示 LLM 返回的一次完整响应，包含生成的文本内容和可选的 token 使用量。
 * 所有 LLM 提供者的 complete() 方法都返回此类型。
 */
export interface LLMResponse {
  /** LLM 生成的文本内容 */
  content: string;
  /**
   * token 使用量统计（可选）
   * prompt:     输入 prompt 消耗的 token 数
   * completion: 输出回答消耗的 token 数
   */
  usage?: { prompt: number; completion: number };
}

// ── LLM 提供者接口 ─────────────────────────────────────────────────────────

/**
 * LLM 提供者抽象接口
 *
 * 定义了与 LLM 交互的标准方法。两种实现：
 *   - APIProvider: 直接调用 Anthropic/OpenAI REST API
 *   - PipeProvider: 通过 stdin/stdout 与外部 AI 代理（Helios）通信
 */
export interface LLMProvider {
  /** 提供者名称标识（如 "api"、"pipe"） */
  name: string;

  /**
   * 发送 prompt 并获取 LLM 响应
   *
   * @param prompt - 发送给 LLM 的用户消息
   * @param system - 可选的系统提示词（定义 LLM 的角色和行为约束）
   * @returns LLM 的响应内容和 token 使用量
   */
  complete(prompt: string, system?: string): Promise<LLMResponse>;

  /**
   * 判断此提供者是否需要人工交互
   *
   * API 模式返回 false（完全自动化）
   * Pipe 模式返回 true（需要外部代理参与）
   */
  isInteractive(): boolean;
}

// ── JSON 解析工具 ──────────────────────────────────────────────────────────

/**
 * 从 LLM 响应文本中解析 JSON 数据
 *
 * LLM 返回的文本可能不是纯 JSON，常见的变体格式包括：
 *   - 包裹在 markdown 代码块中：```json\n{...}\n```
 *   - 混合在其他文本说明中
 *
 * 本函数通过多步策略尝试提取 JSON：
 *   1. 首先去除 markdown 代码块标记
 *   2. 尝试直接 JSON.parse()
 *   3. 如果失败，用正则提取文本中的 JSON 对象/数组
 *
 * @typeParam T - 期望解析出的类型（默认 any）
 * @param text - LLM 返回的原始文本
 * @returns 解析后的 JavaScript 对象
 * @throws 如果所有解析策略都失败，抛出错误（附带原始文本前 500 字符）
 */
export function parseJSON<T = any>(text: string): T {
  /** 去除首尾空白 */
  let cleaned = text.trim();

  /** 策略 1: 提取 markdown 代码块中的 JSON */
  const m = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) cleaned = m[1].trim();

  /** 策略 2: 尝试直接解析 */
  try { return JSON.parse(cleaned); } catch {}

  /** 策略 3: 用正则从混合文本中提取 JSON 对象或数组 */
  const objMatch = cleaned.match(/[\[{][\s\S]*[\]]/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }

  /** 所有策略都失败，抛出错误 */
  throw new Error(`Failed to parse JSON from LLM response:\n${text.slice(0, 500)}`);
}
