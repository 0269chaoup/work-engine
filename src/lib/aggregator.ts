/**
 * @file lib/aggregator.ts — 工作文件聚合器
 *
 * 本文件负责将 AST 解析器（ast-parser.ts）解析出的结构化文件数据，
 * 按项目维度进行聚合统计，为 MOC（Map of Content）索引渲染提供数据。
 *
 * 核心功能：
 *   - scanWorkFilesAST(): 扫描 Vault 中 30-Projects/Work/ 下的所有 .md 文件并解析
 *   - aggregateByProject(): 按项目名分组，计算每个项目的统计数据
 *
 * 聚合内容包括：
 *   - 状态分布（各状态的文件列表）
 *   - 完成率（已完成 / 非归档总数）
 *   - 任务进度（[!todo] 中的 [x] 和 [ ] 数量统计）
 *   - 阻塞依赖链（递归解析 blocked_by 形成依赖树）
 *   - 技术笔记列表（按创建时间倒序）
 *   - 任务列表（按状态优先级排序）
 *   - 知识交叉链接（指向 50-Knowledge 的链接集合）
 *
 * 依赖关系：
 *   - ast-parser.ts: 提供 ParsedWorkFile 接口和 parseWorkFileAST() 解析函数
 *   - template.ts:   消费 ProjectAggregation 数据来渲染 INDEX.md
 */

import { glob } from "glob";
import { parseWorkFileAST, type ParsedWorkFile } from "./ast-parser.js";

// ── Aggregator ─────────────────────────────────────────────────────────────

/**
 * 项目聚合数据接口
 *
 * 表示一个项目下所有工作文件的聚合统计结果，
 * 由 aggregateByProject() 函数生成，供 template.ts 的 renderIndex() 使用。
 */
export interface ProjectAggregation {
  /** 项目名称（对应目录名） */
  name: string;
  /** 项目下的文件总数 */
  totalFiles: number;
  /**
   * 状态分布：Map<状态名, 属于该状态的文件列表>
   * 例如: "🌿 Active" => [file1, file2]
   */
  statusBreakdown: Map<string, ParsedWorkFile[]>;
  /**
   * 项目完成率：已完成文件数 / (总文件数 - 已归档文件数)
   * 范围 0~1，归档文件不参与完成率计算（因为它们已不在活跃范围内）
   */
  completionRate: number;
  /**
   * [!todo] 任务进度统计
   * total: 所有 [!todo] callout 中的 checkbox 总数（[ ] + [x]）
   * done:  其中已完成的数量（[x]）
   */
  taskProgress: { total: number; done: number };
  /**
   * 阻塞项列表：记录所有状态为 "🚧 Blocked" 的文件及其依赖链
   * 每个元素包含：
   *   - file:       被阻塞的文件标题
   *   - blocked_by: 阻塞它的文件/原因
   *   - chain:      完整的依赖链（递归解析 blocked_by 字段）
   */
  blockedItems: {
    file: string;
    blocked_by: string;
    chain: string[];
  }[];
  /**
   * 技术笔记列表：type=TechNote 的文件，按创建日期倒序排列
   * 用于在 INDEX.md 中独立展示技术笔记索引
   */
  techNotes: ParsedWorkFile[];
  /**
   * 任务列表：type=Task 的文件，按状态优先级排序
   * 排序顺序：Blocked > Active > Planned > Completed > Archived > 未标注
   */
  tasks: ParsedWorkFile[];
  /**
   * 知识交叉链接：指向 50-Knowledge 目录的链接集合（已去重）
   * 从所有文件的正文中提取，用于在 INDEX.md 中展示相关知识链接
   */
  knowledgeLinks: string[];
}

/**
 * 状态排序优先级（从高到低）
 *
 * 在 INDEX.md 中，文件按此顺序分组展示：
 *   1. 🚧 Blocked（阻塞）— 最需要关注
 *   2. 🌿 Active（进行中）
 *   3. 🌱 Planned（计划中）
 *   4. 🍂 Completed（已完成）
 *   5. 🗃️ Archived（已归档）
 *   6. 未标注 — 提醒用户补充
 */
const STATUS_ORDER = [
  "🚧 Blocked",
  "🌿 Active",
  "🌱 Planned",
  "🍂 Completed",
  "🗃️ Archived",
  "未标注",
];

/** 工作文件在 Vault 中的相对根目录 */
const WORK_DIR = "30-Projects/Work";

/**
 * 扫描并解析所有工作文件
 *
 * 使用 glob 模式匹配 30-Projects/Work/**/*.md，
 * 排除系统目录（.obsidian, .git, .trash, node_modules）和 INDEX.md，
 * 然后逐个调用 parseWorkFileAST() 进行 AST 解析。
 *
 * @param vaultRoot - Obsidian Vault 的根目录绝对路径
 * @returns 解析成功的工作文件数组（解析失败的文件会被过滤掉）
 *
 * 与 ast-parser.ts 的关系：调用 parseWorkFileAST() 进行单文件解析
 * 与 template.ts 的关系：返回值作为 aggregateByProject() 的输入
 */
export async function scanWorkFilesAST(vaultRoot: string): Promise<ParsedWorkFile[]> {
  /** 需要排除的系统目录 */
  const exclude = [".obsidian", ".git", ".trash", "node_modules"];
  const pattern = `${WORK_DIR}/**/*.md`;
  /** 使用 glob 扫描所有 .md 文件 */
  const files = await glob(pattern, {
    cwd: vaultRoot,
    ignore: exclude.map(d => `**/${d}/**`),
    absolute: false,
  });

  /** 过滤掉 INDEX.md（索引文件本身不应被聚合），然后逐个解析 */
  return files
    .filter(f => !f.endsWith("INDEX.md"))
    .map(f => parseWorkFileAST(vaultRoot, f))
    .filter(Boolean) as ParsedWorkFile[];
}

/**
 * 将文件列表按项目名聚合为 ProjectAggregation
 *
 * 这是聚合器的核心函数，为每个项目计算：
 *   - 状态分布和文件分类
 *   - 完成率和任务进度
 *   - 阻塞依赖链
 *   - 知识交叉链接
 *
 * @param files - scanWorkFilesAST() 返回的解析后文件数组
 * @returns Map<项目名, 项目聚合数据>，供 renderIndex() 使用
 *
 * 关键逻辑：
 *   1. 按 project 字段分组
 *   2. 对每个项目计算统计数据
 *   3. 解析阻塞依赖链（递归调用 resolveBlockedChain）
 *   4. 分类整理 TechNotes 和 Tasks
 */
export function aggregateByProject(
  files: ParsedWorkFile[]
): Map<string, ProjectAggregation> {
  /** 第一步：按项目名分组 */
  const byProject = new Map<string, ParsedWorkFile[]>();

  for (const f of files) {
    const existing = byProject.get(f.project) ?? [];
    existing.push(f);
    byProject.set(f.project, existing);
  }

  const result = new Map<string, ProjectAggregation>();

  /** 第二步：为每个项目计算聚合数据 */
  for (const [name, projectFiles] of byProject) {
    // ── 状态分布统计 ──
    const statusBreakdown = new Map<string, ParsedWorkFile[]>();
    for (const f of projectFiles) {
      const st = f.status || "未标注";
      const existing = statusBreakdown.get(st) ?? [];
      existing.push(f);
      statusBreakdown.set(st, existing);
    }

    // ── 完成率计算 ──
    // 公式：已完成数 / (总数 - 已归档数)
    // 归档文件不参与计算，因为它们已不在活跃工作范围内
    const archived = statusBreakdown.get("🗃️ Archived")?.length ?? 0;
    const completed = statusBreakdown.get("🍂 Completed")?.length ?? 0;
    const nonArchived = projectFiles.length - archived;
    const completionRate = nonArchived > 0 ? completed / nonArchived : 0;

    // ── 任务进度统计 ──
    // 汇总所有文件中 [!todo] callout 的 checkbox 数量
    let todoTotal = 0;
    let todoDone = 0;
    for (const f of projectFiles) {
      todoTotal += f.todo_total;
      todoDone += f.todo_done;
    }

    // ── 阻塞依赖链 ──
    // 为每个 Blocked 状态的文件解析完整的依赖链
    const blockedFiles = statusBreakdown.get("🚧 Blocked") ?? [];
    const blockedItems = blockedFiles.map(f => ({
      file: f.title,
      blocked_by: f.blocked_by ?? "",
      chain: resolveBlockedChain(f, projectFiles),
    }));

    // ── 技术笔记 ──
    // 筛选 type=TechNote，按创建时间倒序排列（最新的在前）
    const techNotes = projectFiles
      .filter(f => f.type === "TechNote")
      .sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));

    // ── 任务列表 ──
    // 筛选 type=Task，按状态优先级排序（Blocked > Active > Planned > ...）
    const tasks = projectFiles
      .filter(f => f.type === "Task")
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

    // ── 知识交叉链接 ──
    // 收集所有文件中指向 50-Knowledge 的链接，去重后存储
    const knowledgeLinks = [
      ...new Set(projectFiles.flatMap(f => f.knowledge_links)),
    ];

    /** 组装最终的聚合数据 */
    result.set(name, {
      name,
      totalFiles: projectFiles.length,
      statusBreakdown,
      completionRate,
      taskProgress: { total: todoTotal, done: todoDone },
      blockedItems,
      techNotes,
      tasks,
      knowledgeLinks,
    });
  }

  return result;
}

/**
 * 递归解析阻塞依赖链
 *
 * 给定一个被阻塞的文件，沿着 blocked_by 字段递归查找，
 * 形成完整的依赖链。用于在 INDEX.md 中展示 "谁阻塞了谁" 的完整链条。
 *
 * 例如：A 被 B 阻塞，B 被 C 阻塞 → 依赖链为 [B, C]
 *
 * @param file     - 当前被阻塞的文件
 * @param allFiles - 项目下的所有文件（用于查找 blocker）
 * @param depth    - 当前递归深度（防止循环依赖导致无限递归）
 * @returns 依赖链中的文件标题数组
 *
 * 关键逻辑：
 *   - 最大递归深度 10 层，防止循环依赖
 *   - 通过文件标题或文件名匹配 blocker
 *   - 如果 blocker 不在已知文件中，返回原始 blocked_by 值
 */
function resolveBlockedChain(
  file: ParsedWorkFile,
  allFiles: ParsedWorkFile[],
  depth = 0
): string[] {
  /** 防止循环依赖：超过 10 层或无 blocked_by 时终止 */
  if (depth > 10 || !file.blocked_by) return [];

  /** 在所有文件中查找 blocker（通过标题或文件名匹配） */
  const blocker = allFiles.find(
    f => f.title === file.blocked_by || f.fileName === file.blocked_by
  );

  /** 如果 blocker 文件不在已知列表中，返回原始的 blocked_by 值 */
  if (!blocker) return [file.blocked_by];

  /** 如果 blocker 自身也被阻塞，继续递归解析 */
  if (blocker.blocked_by) {
    return [blocker.title, ...resolveBlockedChain(blocker, allFiles, depth + 1)];
  }

  return [blocker.title];
}
