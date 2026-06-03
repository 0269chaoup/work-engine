/**
 * @file lib/template.ts — MOC 索引模板渲染器
 *
 * 本文件负责将聚合器（aggregator.ts）生成的 ProjectAggregation 数据
 * 渲染为 Obsidian 兼容的 Markdown 索引文件（INDEX.md）。
 *
 * MOC（Map of Content）是 Obsidian 中的一种知识组织方式，
 * 通过索引文件将相关内容按逻辑分组链接在一起。
 *
 * 提供两个渲染函数：
 *
 *   renderIndex():
 *     为单个项目生成 INDEX.md，包含：
 *     - YAML frontmatter（标准的工作文件元数据）
 *     - 项目概览（文档数、完成率、任务进度、阻塞数）
 *     - 按状态分组的文件列表（含 wikilink、进度、阻塞信息）
 *     - TechNotes 索引（独立区域，按创建时间排列）
 *     - 依赖链展示（blocked_by 的完整链条）
 *     - 知识交叉链接（指向 50-Knowledge 的引用）
 *
 *   renderRootIndex():
 *     为 Work 根目录生成总索引 INDEX.md，包含：
 *     - 所有项目的列表及其文档数
 *     - 按文件数量降序排列
 *
 * 依赖关系：
 *   - 消费 aggregator.ts 的 ProjectAggregation 数据
 *   - 消费 ast-parser.ts 的 ParsedWorkFile 数据
 *   - 生成的 INDEX.md 被 Obsidian 渲染为可交互的项目看板
 */

import type { ProjectAggregation } from "./aggregator.js";
import type { ParsedWorkFile } from "./ast-parser.js";

// ── Template ───────────────────────────────────────────────────────────────

/**
 * 状态排序优先级（从高到低）
 *
 * 与 aggregator.ts 中的定义保持一致，用于在 INDEX.md 中
 * 按优先级排列各状态分组。阻塞项最靠前，以引起注意。
 */
const STATUS_ORDER = [
  "🚧 Blocked",
  "🌿 Active",
  "🌱 Planned",
  "🍂 Completed",
  "🗃️ Archived",
  "未标注",
];

/**
 * 获取当天日期的 YYYY-MM-DD 格式字符串
 * 用于 frontmatter 中的 created/updated 字段
 * @returns 当天日期字符串，如 "2026-06-03"
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 渲染单个项目的 INDEX.md 内容
 *
 * 生成的文件结构：
 *   1. YAML frontmatter（标准的工作文件元数据格式）
 *   2. 项目标题和概览信息（文档数、完成率、任务进度、阻塞数）
 *   3. 按状态分组的文件列表（每组一个 ## 标题）
 *   4. TechNotes 索引（独立的 ## 区域）
 *   5. 依赖链展示（## 依赖链 区域）
 *   6. 知识交叉链接（## 相关知识 区域）
 *
 * @param agg - 项目聚合数据，由 aggregateByProject() 生成
 * @returns 渲染后的 Markdown 内容字符串，可直接写入 INDEX.md
 *
 * 关键渲染逻辑：
 *   - 状态分组按 STATUS_ORDER 排序（Blocked 优先）
 *   - 每个文件显示 wikilink、TechNote 标记、阻塞信息和任务进度
 *   - 完成率和任务进度以百分比形式展示
 */
export function renderIndex(agg: ProjectAggregation): string {
  /** 计算完成百分比（0-100 的整数） */
  const pct = Math.round(agg.completionRate * 100);
  /** 计算任务完成百分比（[!todo] 中已完成/总数） */
  const taskPct = agg.taskProgress.total > 0
    ? Math.round((agg.taskProgress.done / agg.taskProgress.total) * 100)
    : 0;

  const lines: string[] = [
    // ── YAML Frontmatter ──
    "---",
    `title: "${agg.name} 项目索引"`,
    "type: TechNote",
    `project: ${agg.name}`,
    "status: 🍂 Completed",
    `created: ${today()}`,
    `updated: ${today()}`,
    "---",
    "",
    // ── 项目标题 ──
    `# ${agg.name}`,
    "",
    // ── 概览信息（使用 Obsidian 的 callout 语法 >） ──
    `> 📊 **${agg.totalFiles}** 个文档`,
  ];

  // ── 进度摘要 ──
  if (agg.taskProgress.total > 0) {
    lines.push(
      `> ✅ ${pct}% 完成 | 📋 任务 ${taskPct}%（${agg.taskProgress.done}/${agg.taskProgress.total}）`
    );
  } else {
    lines.push(`> ✅ ${pct}% 完成`);
  }

  // ── 阻塞数量（仅在有阻塞项时显示） ──
  if (agg.blockedItems.length > 0) {
    lines.push(`> ⛔ **${agg.blockedItems.length}** 个阻塞`);
  }
  lines.push("");

  // ── 按状态分组的文件列表 ──
  /** 按 STATUS_ORDER 对状态分组排序 */
  const sortedStatuses = [...agg.statusBreakdown.entries()].sort(
    (a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0])
  );

  for (const [status, statusFiles] of sortedStatuses) {
    /** 输出状态标题，包含该状态下的文件数 */
    lines.push(`## ${status} (${statusFiles.length})`);
    lines.push("");

    /** 同一状态内按创建时间倒序排列（最新的在前） */
    const sorted = [...statusFiles].sort(
      (a, b) => String(b.created || "").localeCompare(String(a.created || ""))
    );

    for (const f of sorted) {
      /** TechNote 类型显示 📝 标记 */
      const badge = f.type === "TechNote" ? " 📝" : "";
      /** Blocked 状态且有 blocked_by 时显示阻塞信息 */
      const blocked =
        status === "🚧 Blocked" && f.blocked_by
          ? ` ⛔ ${f.blocked_by}`
          : "";
      /** 有任务进度时显示 (完成数/总数) */
      const progress =
        f.todo_total > 0 ? ` (${f.todo_done}/${f.todo_total})` : "";
      lines.push(`- [[${f.fileName}]]${badge}${blocked}${progress}`);
    }
    lines.push("");
  }

  // ── TechNotes 索引（独立区域） ──
  if (agg.techNotes.length > 0) {
    lines.push(`## 📚 TechNotes (${agg.techNotes.length})`);
    lines.push("");
    for (const t of agg.techNotes) {
      /** 显示 wikilink 和创建日期 */
      lines.push(`- [[${t.fileName}]] — ${t.created}`);
    }
    lines.push("");
  }

  // ── 阻塞依赖链（独立区域） ──
  if (agg.blockedItems.length > 0) {
    lines.push("## ⛔ 依赖链");
    lines.push("");
    for (const b of agg.blockedItems) {
      /** 如果有依赖链，用 → 连接展示 */
      const chain =
        b.chain.length > 0 ? ` → ${b.chain.join(" → ")}` : "";
      lines.push(`- [[${b.file}]] ⛔ ${b.blocked_by}${chain}`);
    }
    lines.push("");
  }

  // ── 知识交叉链接（独立区域） ──
  if (agg.knowledgeLinks.length > 0) {
    lines.push("## 🔗 相关知识");
    lines.push("");
    for (const link of agg.knowledgeLinks) {
      lines.push(`- [[${link}]]`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 渲染 Work 根目录的总索引 INDEX.md
 *
 * 生成一个项目目录列表，展示所有项目及其文档数量。
 * 按文件数量降序排列，便于快速识别大项目。
 *
 * @param projects - 项目列表，每个元素包含项目名和文件数
 * @returns 渲染后的 Markdown 内容字符串
 *
 * 生成的结构：
 *   - YAML frontmatter
 *   - 总览信息（总文档数、总项目数）
 *   - 项目列表（每个项目链接到各自的 INDEX.md）
 */
export function renderRootIndex(
  projects: { name: string; fileCount: number }[]
): string {
  /** 按文件数量降序排列 */
  const sorted = [...projects].sort((a, b) => b.fileCount - a.fileCount);
  /** 计算所有项目的文件总数 */
  const total = sorted.reduce((s, p) => s + p.fileCount, 0);

  const lines: string[] = [
    // ── YAML Frontmatter ──
    "---",
    'title: "Work 项目总索引"',
    "type: TechNote",
    "project: General",
    "status: 🍂 Completed",
    `created: ${today()}`,
    `updated: ${today()}`,
    "---",
    "",
    // ── 标题和概览 ──
    "# Work 项目总索引",
    "",
    `> 📊 **${total}** 个文档，**${sorted.length}** 个项目`,
    "",
    "## 项目列表",
    "",
  ];

  /** 遍历项目列表，生成 wikilink 链接 */
  for (const p of sorted) {
    /** 链接格式：[[项目名/INDEX|显示名]] — 文档数 个文档 */
    lines.push(`- [[${p.name}/INDEX|${p.name}]] — ${p.fileCount} 个文档`);
  }
  lines.push("");

  return lines.join("\n");
}
