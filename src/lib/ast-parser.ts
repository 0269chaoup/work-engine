/**
 * @file lib/ast-parser.ts — 工作文件的 AST 解析器
 *
 * 本文件负责将 Obsidian 工作文件（Markdown）解析为结构化数据。
 * "AST" 在此上下文中指的是：不仅解析 frontmatter（YAML 元数据），
 * 还对 Markdown 正文进行语法分析，提取统计数据。
 *
 * 解析内容分为两部分：
 *
 * 1. Frontmatter 解析：
 *    - title: 文档标题
 *    - type: 文档类型（Task/TechNote 等）
 *    - status: 工作状态（🌱 Planned/🌿 Active/🚧 Blocked/🍂 Completed/🗃️ Archived）
 *    - project: 所属项目名
 *    - created: 创建日期
 *    - blocked_by: 阻塞依赖（可选）
 *
 * 2. 正文统计：
 *    - todo_total/todo_done: [!todo] 中的 checkbox 数量
 *    - headings: ## 级别标题数
 *    - words: 正文字数（去除 Markdown 语法后）
 *    - knowledge_links: 指向 50-Knowledge 的链接
 *
 * 容错设计：
 *    - 支持修复常见的 YAML 格式错误（如 source:: 双冒号、related 格式问题）
 *    - 解析失败时返回 null，不会中断整个扫描流程
 *
 * 依赖关系：
 *    - 被 aggregator.ts 的 scanWorkFilesAST() 调用
 *    - 生成的 ParsedWorkFile 被 aggregator.ts 聚合统计
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";

/**
 * 解析后的结构化工作文件数据接口
 *
 * 由 parseWorkFileAST() 生成，包含从 Markdown 文件中提取的所有结构化信息。
 * 这是整个数据流的核心数据结构，从解析器流向聚合器再流向模板渲染器。
 */
export interface ParsedWorkFile {
  // ── Frontmatter 字段 ──
  /** 文档标题，优先从 frontmatter 的 title 字段读取，其次为 name，最后取文件名 */
  title: string;
  /** 文档类型：Task（任务）或 TechNote（技术笔记） */
  type: string;
  /** 工作状态：🌱 Planned | 🌿 Active | 🚧 Blocked | 🍂 Completed | 🗃️ Archived */
  status: string;
  /** 所属项目名称（对应 30-Projects/Work/ 下的子目录名，根级文件为 "General"） */
  project: string;
  /** 创建日期（YYYY-MM-DD 格式） */
  created: string;
  /** 阻塞依赖：阻塞当前文件的文件名或原因（可选，仅 Blocked 状态时有意义） */
  blocked_by?: string;

  // ── 路径信息 ──
  /** 相对于 Vault 根目录的路径 */
  relativePath: string;
  /** 文件名（不含 .md 扩展名） */
  fileName: string;

  // ── 正文统计 ──
  /**
   * [!todo] 中的 checkbox 总数（包括 [ ] 和 [x]）
   * 用于计算任务完成进度
   */
  todo_total: number;
  /** [!todo] 中已完成的 checkbox 数量（[x]） */
  todo_done: number;
  /** ## 级别（h2）标题的数量，用于评估文档结构复杂度 */
  headings: number;
  /** 正文字数（去除 Markdown 语法、图片、链接、URL 后的纯文本词数） */
  words: number;
  /** 指向 50-Knowledge 目录的知识链接列表（从 "→ 50-Knowledge/..." 模式中提取） */
  knowledge_links: string[];
}

/**
 * 解析单个工作文件为结构化数据
 *
 * 这是 AST 解析器的核心函数。处理流程：
 *   1. 读取文件内容
 *   2. 使用 gray-matter 解析 frontmatter（YAML 头部）
 *   3. 如果 YAML 解析失败，尝试修复常见格式错误后重试
 *   4. 对正文进行统计分析（todo、标题、字数、链接）
 *   5. 组装并返回 ParsedWorkFile 对象
 *
 * @param vaultRoot     - Obsidian Vault 根目录的绝对路径
 * @param relativePath  - 文件相对于 Vault 根目录的路径（如 "30-Projects/Work/MyProject/task.md"）
 * @returns 解析成功的 ParsedWorkFile 对象，解析失败返回 null
 *
 * 被调用场景：
 *   - aggregator.ts 的 scanWorkFilesAST() 遍历文件列表时逐个调用
 */
export function parseWorkFileAST(
  vaultRoot: string,
  relativePath: string
): ParsedWorkFile | null {
  /** 构建文件绝对路径 */
  const abs = path.resolve(vaultRoot, relativePath);
  /** 文件不存在则返回 null */
  if (!fs.existsSync(abs)) return null;

  /** 读取文件原始内容 */
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf-8");
  } catch {
    return null;
  }

  // ── Frontmatter AST（YAML 头部解析） ──
  let data: Record<string, unknown>;
  let content: string;

  try {
    /** 使用 gray-matter 库解析 YAML frontmatter 和正文内容 */
    ({ data, content } = matter(raw));
  } catch {
    /**
     * YAML 解析失败时的容错处理：
     * 常见的 YAML 格式错误包括：
     *   - source:: xxx（双冒号，应为 source: xxx）
     *   - related:: 格式的列表（应为 related: 格式）
     */
    let fixed = raw;
    /** 修复 source:: 双冒号格式 */
    fixed = fixed.replace(/^source::\s*/gm, "source: ");
    /** 移除 related:: 相关行（格式太不一致，直接移除） */
    fixed = fixed.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
    try {
      ({ data, content } = matter(fixed));
    } catch {
      /** 修复后仍然无法解析，放弃该文件 */
      return null;
    }
  }

  // ── Body AST（正文统计分析） ──

  /**
   * 统计 Todo checkbox 数量：
   * - 匹配 `- [ ]` 和 `- [x]` 格式（包括 callout 内外的）
   * - todoAll: 所有 checkbox 的总数
   * - todoDone: 已完成 [x] 的数量
   */
  const todoAll = content.match(/-\[[ x]\]/g) ?? [];
  const todoDone = content.match(/-\[x\]/g) ?? [];

  /** 统计 ## 级别（h2）标题的数量 */
  const headings = (content.match(/^##\s/gm) ?? []).length;

  /**
   * 字数统计：
   *   1. 移除 Markdown 语法字符（# > ` - [ ] ( ) | * _ ~）
   *   2. 移除图片嵌入（![[...]]）
   *   3. 移除 wikilinks（[[...]]）
   *   4. 移除 URL（http://... 和 https://...）
   *   5. 按空白字符分词，统计非空词数
   */
  const plainText = content
    .replace(/[>#` \-[\]()|*_~]/g, "")
    .replace(/!\[\[.*?\]\]/g, "")  // 图片
    .replace(/\[\[.*?\]\]/g, "")    // wikilinks
    .replace(/https?:\/\/\S+/g, "") // URLs
    .trim();
  const words = plainText.length > 0
    ? plainText.split(/\s+/).filter(w => w.length > 0).length
    : 0;

  /**
   * 提取知识交叉链接：
   * 匹配 "→ 50-Knowledge/xxx" 模式，提取指向知识库的引用
   * 这些链接用于在项目 INDEX.md 中展示 "相关知识" 区域
   */
  const knowledgeLinks: string[] = [];
  const linkMatches = content.matchAll(/→\s*(50-Knowledge\/[^\n\]]+)/g);
  for (const m of linkMatches) {
    knowledgeLinks.push(m[1].trim());
  }

  // ── 组装结果 ──

  /**
   * 从文件路径中推断项目名：
   * 路径格式为 "30-Projects/Work/项目名/文件.md"
   * 去掉 "30-Projects/Work/" 前缀后，如果还有子目录则第一段为项目名
   * 如果文件直接在 Work 根目录下，项目名为 "General"
   */
  const relFromWork = relativePath.replace(/^30-Projects\/Work\//, "");
  const parts = relFromWork.split("/");
  const project = parts.length > 1 ? parts[0] : "General";

  return {
    /** 标题优先级：frontmatter.title > frontmatter.name > 文件名 */
    title: (data.title as string) ?? (data.name as string) ?? path.basename(relativePath, ".md"),
    type: (data.type as string) ?? "",
    status: (data.status as string) ?? "",
    /** 优先使用 frontmatter 中的 project 字段，否则从路径推断 */
    project: (data.project as string) ?? project,
    created: (data.created as string) ?? "",
    blocked_by: (data.blocked_by as string) ?? undefined,
    relativePath,
    fileName: path.basename(relativePath, ".md"),
    todo_total: todoAll.length,
    todo_done: todoDone.length,
    headings,
    words,
    knowledge_links: knowledgeLinks,
  };
}
