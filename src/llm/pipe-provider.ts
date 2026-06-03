/**
 * @file llm/pipe-provider.ts — 管道模式的 LLM 提供者（Helios 代理模式）
 *
 * 本文件实现了通过 stdin/stdout 管道与外部 AI 代理（Helios）通信的提供者。
 * 与 APIProvider 不同，此提供者不直接调用 LLM API，而是通过标准输入输出
 * 与外部进程交互，实现"人在回路"的 AI 推理流程。
 *
 * 工作模式（Helios 代理协作）：
 *   1. CLI 将 prompt 以 JSON 格式输出到 stdout
 *   2. Helios（外部 AI 代理）从 stdout 读取 prompt
 *   3. Helios 进行推理（在聊天中可见 → 实现推理过程的可视化！）
 *   4. Helios 将结果以 JSON 格式写入 stdin
 *   5. CLI 继续执行
 *
 * 通信协议（JSON 行格式）：
 *   → stdout（CLI 输出 prompt）:
 *     {"type":"prompt","id":"...","prompt":"...","system":"..."}
 *   ← stdin（代理输入响应）:
 *     {"type":"response","id":"...","content":"..."}
 *
 * 设计优势：
 *   - 推理过程在聊天中可见，便于调试和理解
 *   - 支持复杂推理（代理可以进行多步思考）
 *   - 不需要 API key（由代理负责调用 LLM）
 *
 * 依赖关系：
 *   - 实现 llm/provider.ts 的 LLMProvider 接口
 *   - 被 llm/factory.ts 的 createLLM() 创建（当 --llm agent 时）
 */

import * as readline from "readline";
import type { LLMProvider, LLMResponse } from "./provider.js";

/**
 * 管道模式的 LLM 提供者类
 *
 * 通过 stdin/stdout 管道与外部 AI 代理（如 Helios）进行通信。
 * 使用 JSON 行协议实现异步的请求-响应模式。
 */
export class PipeProvider implements LLMProvider {
  /** 提供者名称标识 */
  name = "pipe";

  /**
   * 待响应的请求映射表
   * key: 请求 ID，value: 响应回调函数
   * 当收到匹配的响应时，调用对应的回调函数完成 Promise
   */
  private pendingResolves = new Map<string, (value: string) => void>();

  /** readline 接口，用于从 stdin 逐行读取 JSON 响应 */
  private rl: readline.Interface;

  /** prompt 计数器，用于生成唯一的请求 ID */
  private promptCounter = 0;

  /**
   * 构造函数
   *
   * 初始化 stdin 的 readline 接口，设置响应监听器。
   * 当 stdin 收到一行 JSON 数据时，解析并匹配到对应的 pending 请求。
   */
  constructor() {
    /** 创建 readline 接口，从 stdin 读取（非终端模式） */
    this.rl = readline.createInterface({ input: process.stdin, terminal: false });

    /** 监听每一行输入 */
    this.rl.on("line", (line) => {
      try {
        /** 尝试解析为 JSON */
        const msg = JSON.parse(line);
        /**
         * 检查是否为匹配的响应消息：
         *   - type 必须为 "response"
         *   - 必须有 id 字段
         *   - id 必须在待响应映射表中
         */
        if (msg.type === "response" && msg.id && this.pendingResolves.has(msg.id)) {
          /** 调用对应的回调函数，完成等待中的 Promise */
          this.pendingResolves.get(msg.id)!(msg.content);
          /** 从映射表中移除已完成的请求 */
          this.pendingResolves.delete(msg.id);
        }
      } catch {
        /** JSON 解析失败的行被静默忽略（可能是非 JSON 输出） */
      }
    });
  }

  /**
   * 判断是否需要人工交互
   *
   * 管道模式需要外部代理参与，返回 true。
   * 调用方可据此决定是否显示交互提示信息。
   */
  isInteractive() { return true; }

  /**
   * 发送 prompt 并等待代理返回响应
   *
   * 处理流程：
   *   1. 生成唯一的请求 ID
   *   2. 将 prompt 以 JSON 格式输出到 stdout
   *   3. 等待 stdin 收到匹配 ID 的响应
   *   4. 超时时间 5 分钟（300 秒）
   *
   * @param prompt - 用户消息文本
   * @param system - 可选的系统提示词
   * @returns LLM 响应（由外部代理生成）
   * @throws 如果 5 分钟内未收到响应，抛出超时错误
   */
  async complete(prompt: string, system?: string): Promise<LLMResponse> {
    /** 生成唯一的请求 ID（格式：p1, p2, p3, ...） */
    const id = `p${++this.promptCounter}`;

    /** 将 prompt 以 JSON 行格式输出到 stdout，供外部代理读取 */
    const msg = JSON.stringify({ type: "prompt", id, prompt, system });
    process.stdout.write(msg + "\n");

    /**
     * 返回 Promise，等待外部代理通过 stdin 返回匹配的响应
     * 使用超时机制防止无限等待
     */
    return new Promise((resolve, reject) => {
      /** 设置 5 分钟超时定时器 */
      const timer = setTimeout(() => {
        /** 超时后清理待响应映射并拒绝 Promise */
        this.pendingResolves.delete(id);
        reject(new Error(`Pipe timeout waiting for response (id=${id}). Is Helios listening?`));
      }, 300_000); // 5 分钟超时

      /** 注册待响应回调 */
      this.pendingResolves.set(id, (content) => {
        /** 收到响应后清除超时定时器 */
        clearTimeout(timer);
        /** 解析响应并返回 */
        resolve({ content });
      });
    });
  }

  /**
   * 关闭管道连接
   *
   * 释放 readline 接口资源。
   * 在 CLI 退出前应调用此方法，确保资源正确释放。
   */
  close() {
    this.rl.close();
  }
}
