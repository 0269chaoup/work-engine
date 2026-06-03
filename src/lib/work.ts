/**
 * @file lib/work.ts — 工作文件核心操作模块
 *
 * 本文件是 work-engine 的核心业务逻辑层，提供对 Obsidian 工作文件的
 * 完整 CRUD（创建、读取、更新、删除）操作和管理功能。
 *
 * 模块功能概览：
 *
 * 1. 常量与配置：
 *    - WORK_DIR:              工作文件的相对根目录
 *    - VALID_WORK_TYPES:      合法的工作文件类型（Task、TechNote）
 *    - TYPE_NORMALIZE_MAP:    非标准类型到标准类型的映射表
 *    - KNOWLEDGE_ONLY_FIELDS: 仅属于 Knowledge 的字段列表（规范化时移除）
 *    - VALID_WORK_STATUS:     合法的工作状态值
 *    - STATUS_ORDER:          状态排序优先级
 *
 * 2. 数据接口：
 *    - WorkFile:              工作文件的基本信息
 *    - WorkValidationIssue:   校验问题
 *    - WorkValidationResult:  校验结果
 *    - ProjectSummary:        项目摘要
 *    - WorkReport:            工作报告
 *    - CreateWorkOptions:     创建工作文件的选项
 *    - TaskGroup:             任务组数据结构
 *    - NormalizeResult:       规范化结果
 *
 * 3. 核心函数：
 *    - createWorkFile():      创建新的工作文件
 *    - validateWork():        校验工作文件的规范性
 *    - generateIndex():       生成项目索引文件
 *    - archiveProject():      归档项目（含可选的 TechNote 压实）
 *    - createTaskNote():      创建带 [!todo] 的任务笔记
 *    - fixWorkFrontmatter():  修复缺失/错误的 frontmatter
 *    - normalizeWorkFiles():  全面规范化工作文件
 *    - generateReport():      生成项目状态报告
 *
 * 4. 辅助函数：
 *    - parseWorkFile():       解析单个工作文件的 frontmatter（带容错）
 *    - scanWorkFiles():       扫描并解析所有工作文件
 *    - buildTaskCallout():    构建 [!todo] callout 格式内容
 *
 * 设计决策：
 *    - 区分 Task 和 TechNote 两种合法类型，其他类型通过 TYPE_NORMALIZE_MAP 自动映射
 *    - 状态使用 emoji 前缀的中文名（如 "🌿 Active"），便于在 Obsidian 中直观显示
 *    - 所有文件操作都支持 dry-run 模式，便于预览变更
 *
 * 依赖关系：
 *    - 被 commands/work.ts 中的所有子命令调用
 *    - 与 aggregator.ts 共享部分常量定义（WORK_DIR、STATUS_ORDER）
 *    - 与 diary-bridge.ts 共享路径构建逻辑
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";

// ── Constants ───────────────────────────────────────────────────────────────

/** 工作文件在 Vault 中的相对根目录 */
const WORK_DIR = "30-Projects/Work";

/**
 * 合法的工作文件类型
 *
 * 只有 Task（任务）和 TechNote（技术笔记）是合法的工作类型。
 * 其他类型（如 Knowledge 系列的 WorkNote、MeetingNote 等）
 * 不应出现在 Work 目录中，如果出现会通过 TYPE_NORMALIZE_MAP 自动转换。
 */
const VALID_WORK_TYPES = ["Task", "TechNote"];

/**
 * 类型规范化映射表
 *
 * 用于自动迁移旧版或非标准的文档类型到合法的工作类型。
 * 映射规则：
 *   - 偏任务性质的类型 → Task（如 WorkNote、Note、Concept、Story 等）
 *   - 偏参考性质的类型 → TechNote（如 ChangeNote、MeetingNote、Guide 等）
 */
const TYPE_NORMALIZE_MAP: Record<string, string> = {
  // Knowledge 类型 → Task（它们是工作项，不是参考资料）
  WorkNote: "Task",
  ChangeNote: "TechNote",
  MeetingNote: "TechNote",
  DebugNote: "TechNote",
  Guide: "TechNote",
  Note: "Task",
  GuideNote: "TechNote",
  Proposal: "TechNote",
  TroubleshootingNote: "TechNote",
  Insight: "TechNote",
  Reference: "TechNote",
  Skill: "TechNote",
  // Knowledge 本体类型 → Task（这些类型不应该出现在 Work 目录中）
  Concept: "Task",
  Story: "Task",
  Event: "Task",
  Entity: "Task",
};

/**
 * 仅属于 Knowledge 的字段列表
 *
 * 这些字段在 Knowledge 笔记中有意义，但在 Work 文件中不应出现。
 * normalizeWorkFiles() 会在规范化过程中自动移除这些字段。
 */
const KNOWLEDGE_ONLY_FIELDS = [
  "source",    // 来源
  "related",   // 相关笔记
  "aliases",   // 别名
  "keywords",  // 关键词
  "summary",   // 摘要
  "domain",    // 领域
  "tags",      // 标签
];

/**
 * 合法的工作状态值
 *
 * 每个状态用 emoji + 中文名表示，便于在 Obsidian 中直观区分。
 * 状态流转：Planned → Active → Completed → Archived
 * 特殊状态：Blocked（被阻塞，需解除后继续）
 */
const VALID_WORK_STATUS = [
  "🌱 Planned",    // 计划中
  "🌿 Active",     // 进行中
  "🚧 Blocked",    // 被阻塞
  "🍂 Completed",  // 已完成
  "🗃️ Archived",   // 已归档
];

/**
 * 状态排序优先级（从高到低）
 *
 * 用于在报告和索引中按重要性排列状态分组。
 * 被阻塞的项目需要最多关注，因此排在最前。
 */
const STATUS_ORDER = [
  "🚧 Blocked",
  "🌿 Active",
  "🌱 Planned",
  "🍂 Completed",
  "🗃️ Archived",
  "未标注",
];

// ── Interfaces ──────────────────────────────────────────────────────────────

/**
 * 工作文件的基本信息接口
 *
 * 表示从单个工作文件中解析出的结构化数据。
 * 与 ParsedWorkFile（ast-parser.ts）的区别是：
 *   - WorkFile 是轻量级的，只包含 frontmatter 信息
 *   - ParsedWorkFile 包含完整的正文统计数据
 */
export interface WorkFile {
  /** 相对于 Vault 根目录的路径 */
  relativePath: string;
  /** 所属项目名（从路径或 frontmatter 推断） */
  project: string;
  /** 文档标题 */
  title: string;
  /** 文档类型（Task/TechNote 等） */
  type: string;
  /** 工作状态 */
  status: string;
  /** 创建日期（YYYY-MM-DD） */
  created: string;
  /** 阻塞依赖（可选） */
  blocked_by?: string;
}

/**
 * 校验问题接口
 *
 * 表示在校验过程中发现的一个问题。
 * 每个问题关联到一个文件的一个字段，有错误和警告两种严重级别。
 */
export interface WorkValidationIssue {
  /** 问题所在的文件相对路径 */
  file: string;
  /** 严重级别：error（必须修复）或 warning（建议修复） */
  severity: "error" | "warning";
  /** 有问题的字段名（如 "type"、"status"、"created"） */
  field: string;
  /** 问题的详细描述 */
  detail: string;
}

/**
 * 校验结果接口
 *
 * 包含校验过程的完整结果：文件统计、问题列表和分类计数。
 */
export interface WorkValidationResult {
  /** 扫描到的文件总数 */
  totalFiles: number;
  /** 无任何问题的文件数 */
  clean: number;
  /** 警告数量 */
  warnings: number;
  /** 错误数量 */
  errors: number;
  /** 所有问题的列表 */
  issues: WorkValidationIssue[];
}

/**
 * 项目摘要接口
 *
 * 用于 generateReport() 生成的报告中，描述单个项目的概况。
 */
export interface ProjectSummary {
  /** 项目名称 */
  name: string;
  /** 项目下的文件总数 */
  fileCount: number;
  /** 状态分布：{ 状态名: 文件数 } */
  statusBreakdown: Record<string, number>;
  /** 被阻塞的项列表 */
  blockedItems: { file: string; blocked_by: string }[];
  /** 项目下的所有文件 */
  files: WorkFile[];
}

/**
 * 工作报告接口
 *
 * 由 generateReport() 生成，包含所有项目的全局视图。
 */
export interface WorkReport {
  /** 文件总数 */
  totalFiles: number;
  /** 项目总数 */
  totalProjects: number;
  /** 各项目的摘要列表（按文件数降序排列） */
  projects: ProjectSummary[];
  /** 不属于任何项目的孤立文件 */
  orphanFiles: WorkFile[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * 获取当天日期的 YYYY-MM-DD 格式字符串
 * @returns 当天日期，如 "2026-06-03"
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 解析单个工作文件的 frontmatter 信息（轻量级版本）
 *
 * 与 ast-parser.ts 的 parseWorkFileAST() 不同，此函数只解析 frontmatter，
 * 不对正文进行统计分析。适用于不需要正文数据的场景（如 validate、report）。
 *
 * 容错机制：
 *   1. 尝试直接解析 YAML frontmatter
 *   2. 如果失败，尝试修复常见的格式错误（source:: 双冒号、related 格式）
 *   3. 修复 Windows 路径中的反斜杠转义问题
 *   4. 处理重复的 YAML mapping key
 *   5. 如果所有修复都失败，返回 null
 *
 * @param vaultRoot    - Vault 根目录
 * @param relativePath - 文件相对路径
 * @returns WorkFile 对象，解析失败返回 null
 */
function parseWorkFile(
  vaultRoot: string,
  relativePath: string
): WorkFile | null {
  const abs = path.resolve(vaultRoot, relativePath);
  if (!fs.existsSync(abs)) return null;

  let raw = fs.readFileSync(abs, "utf-8");
  let data: Record<string, unknown>;

  try {
    ({ data } = matter(raw));
  } catch {
    // ── YAML 修复尝试 ──
    // 1. 修复 source:: / related:: 双冒号格式
    raw = raw.replace(/^source::\s*/gm, "source: ");
    raw = raw.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
    // 2. 修复 Windows 路径中的反斜杠：转义双引号字符串内的反斜杠
    raw = raw.replace(/: "([^"]*\\[^"]*)"/g, (_match: string, inner: string) => {
      return `: "${inner.replace(/\\/g, "\\\\")}"`;
    });
    // 3. 修复重复的 YAML mapping key（第二个出现的 key 前加 _ 前缀）
    const seenKeys = new Set<string>();
    raw = raw.replace(/^(\w[\w-]*):/gm, (match: string, key: string) => {
      if (seenKeys.has(key)) return `_${key}:`;
      seenKeys.add(key);
      return match;
    });
    try {
      ({ data } = matter(raw));
    } catch {
      /** 所有修复尝试都失败，放弃该文件 */
      return null;
    }
  }

  /** 从路径中推断项目名 */
  const relFromWork = relativePath.replace(`${WORK_DIR}/`, "");
  const parts = relFromWork.split("/");
  const project = parts.length > 1 ? parts[0] : "General";
  /** 标题优先级：frontmatter.title > frontmatter.name > 文件名 */
  const title =
    (data.title as string) ??
    (data.name as string) ??
    path.basename(relativePath, ".md");

  return {
    relativePath,
    project,
    title,
    type: (data.type as string) ?? "",
    status: (data.status as string) ?? "",
    created: (data.created as string) ?? "",
    blocked_by: (data.blocked_by as string) ?? undefined,
  };
}

/**
 * 扫描并解析所有工作文件（轻量级版本）
 *
 * 使用 glob 匹配 30-Projects/Work 下所有 .md 文件（递归），
 * 排除系统目录后逐个解析 frontmatter。
 *
 * @param vaultRoot - Vault 根目录
 * @returns 解析成功的工作文件数组
 */
async function scanWorkFiles(vaultRoot: string): Promise<WorkFile[]> {
  const exclude = [".obsidian", ".git", ".trash", "node_modules"];
  const pattern = `${WORK_DIR}/**/*.md`;
  const files = await glob(pattern, {
    cwd: vaultRoot,
    ignore: exclude.map((d) => `**/${d}/**`),
    absolute: false,
  });

  return files
    .map((f) => parseWorkFile(vaultRoot, f))
    .filter(Boolean) as WorkFile[];
}

// ── Create ──────────────────────────────────────────────────────────────────

/**
 * 创建工作文件的选项接口
 */
export interface CreateWorkOptions {
  /** 项目名称（对应目录名，"General" 表示根目录） */
  project: string;
  /** 文档标题（同时用作文件名，特殊字符会被替换） */
  title: string;
  /** 文档类型，默认 "Task" */
  type?: string;
  /** 初始状态，默认 "🌱 Planned" */
  status?: string;
}

/**
 * 创建一个新的工作任务文件
 *
 * 生成一个带标准 frontmatter 模板的 Markdown 文件。
 * 如果文件已存在，不会覆盖，返回 created=false。
 *
 * @param vaultRoot - Vault 根目录
 * @param opts      - 创建选项（项目名、标题、类型、状态）
 * @returns { filePath: 文件相对路径, created: 是否新创建 }
 *
 * 生成的文件结构：
 *   ---
 *   title: "标题"
 *   type: Task
 *   project: 项目名
 *   status: 🌱 Planned
 *   created: 2026-06-03
 *   ---
 *   # 标题
 *   ---
 */
export function createWorkFile(
  vaultRoot: string,
  opts: CreateWorkOptions
): { filePath: string; created: boolean } {
  const type = opts.type ?? "Task";
  const status = opts.status ?? "🌱 Planned";
  const created = today();

  /** 确定项目目录：General 直接在 Work 根目录，其他在子目录中 */
  const projectDir =
    opts.project === "General"
      ? path.resolve(vaultRoot, WORK_DIR)
      : path.resolve(vaultRoot, WORK_DIR, opts.project);

  /** 确保目录存在 */
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  /** 将标题中的文件系统不允许的字符替换为下划线 */
  const safeName = opts.title.replace(/[<>:"\/\\|?*]/g, "_");
  const filePath = path.join(projectDir, `${safeName}.md`);

  /** 如果文件已存在，返回 created=false */
  if (fs.existsSync(filePath)) {
    return { filePath: path.relative(vaultRoot, filePath), created: false };
  }

  /** 构建 frontmatter 内容 */
  const fm = [
    "---",
    `title: "${opts.title}"`,
    `type: ${type}`,
    `project: ${opts.project}`,
    `status: ${status}`,
    `created: ${created}`,
    "---",
    "",
    `# ${opts.title}`,
    "",
    "---",
    "",
  ].join("\n");

  fs.writeFileSync(filePath, fm, "utf-8");
  return { filePath: path.relative(vaultRoot, filePath), created: true };
}

// ── Validate ────────────────────────────────────────────────────────────────

/**
 * 校验工作文件的规范性
 *
 * 检查所有工作文件是否符合规范，包括：
 *   - type 字段必须存在且为合法值（Task/TechNote）
 *   - status 字段必须存在
 *   - created 字段必须存在
 *
 * @param vaultRoot - Vault 根目录
 * @param opts      - 可选配置：project（限定项目名）
 * @returns 校验结果，包含问题列表和统计信息
 *
 * 被调用场景：work validate 命令
 */
export async function validateWork(
  vaultRoot: string,
  opts?: { project?: string }
): Promise<WorkValidationResult> {
  let files = await scanWorkFiles(vaultRoot);

  /** 如果指定了项目名，只校验该项目的文件 */
  if (opts?.project) {
    files = files.filter((f) => f.project === opts.project);
  }

  const issues: WorkValidationIssue[] = [];

  for (const f of files) {
    // ── 类型检查 ──
    if (!f.type) {
      /** 缺失 type 字段视为错误 */
      issues.push({
        file: f.relativePath,
        severity: "error",
        field: "type",
        detail: "Missing type field",
      });
    } else if (!VALID_WORK_TYPES.includes(f.type)) {
      /** 非标准类型视为警告，并给出建议 */
      const suggestion = TYPE_NORMALIZE_MAP[f.type] ?? "Task";
      issues.push({
        file: f.relativePath,
        severity: "warning",
        field: "type",
        detail: `Non-canonical type "${f.type}" → should be "${suggestion}"`,
      });
    }

    // ── 状态检查 ──
    if (!f.status) {
      issues.push({
        file: f.relativePath,
        severity: "warning",
        field: "status",
        detail: "Missing status field",
      });
    }

    // ── 创建日期检查 ──
    if (!f.created) {
      issues.push({
        file: f.relativePath,
        severity: "warning",
        field: "created",
        detail: "Missing created date",
      });
    }
  }

  /** 统计错误和警告数量 */
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;

  return {
    totalFiles: files.length,
    /** clean = 无任何问题的文件数（总数 - 有问题的文件数） */
    clean: files.length - new Set(issues.map((i) => i.file)).size,
    warnings: warnCount,
    errors: errorCount,
    issues,
  };
}

// ── Index ───────────────────────────────────────────────────────────────────

/**
 * 为每个项目生成 INDEX.md 索引文件（简化版）
 *
 * 注意：此函数是旧版实现，新的 work index 命令使用
 * aggregator.ts 的 scanWorkFilesAST() + aggregateByProject()
 * 配合 template.ts 的 renderIndex() 来生成更丰富的索引。
 *
 * @param vaultRoot - Vault 根目录
 * @param opts      - 可选配置：project（限定项目名）
 * @returns 每个项目的索引生成结果
 *
 * @deprecated 新代码应使用 aggregator.ts + template.ts 的流水线
 */
export async function generateIndex(
  vaultRoot: string,
  opts?: { project?: string }
): Promise<{ project: string; filePath: string; fileCount: number }[]> {
  const files = await scanWorkFiles(vaultRoot);
  const results: { project: string; filePath: string; fileCount: number }[] =
    [];

  /** 按项目分组 */
  const byProject = new Map<string, WorkFile[]>();
  for (const f of files) {
    if (opts?.project && f.project !== opts.project) continue;
    const existing = byProject.get(f.project) ?? [];
    existing.push(f);
    byProject.set(f.project, existing);
  }

  for (const [project, projectFiles] of byProject) {
    const indexDir =
      project === "General"
        ? path.resolve(vaultRoot, WORK_DIR)
        : path.resolve(vaultRoot, WORK_DIR, project);

    if (!fs.existsSync(indexDir)) {
      fs.mkdirSync(indexDir, { recursive: true });
    }

    const indexPath = path.join(indexDir, "INDEX.md");

    // 按状态分组
    const byStatus = new Map<string, WorkFile[]>();
    for (const f of projectFiles) {
      const st = f.status || "未标注";
      const existing = byStatus.get(st) ?? [];
      existing.push(f);
      byStatus.set(st, existing);
    }

    // 构建 INDEX 内容
    const lines: string[] = [
      "---",
      `title: "${project} 项目索引"`,
      `type: TechNote`,
      `project: ${project}`,
      `status: 🍂 Completed`,
      `created: ${today()}`,
      `updated: ${today()}`,
      "---",
      "",
      `# ${project}`,
      "",
      `> 📊 **${projectFiles.length}** 个文档`,
      "",
    ];

    /** 按状态优先级排序 */
    const sortedStatuses = [...byStatus.entries()].sort(
      (a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0])
    );

    for (const [status, statusFiles] of sortedStatuses) {
      lines.push(`## ${status} (${statusFiles.length})`);
      lines.push("");
      for (const f of statusFiles.sort(
        (a, b) => String(b.created || "").localeCompare(String(a.created || ""))
      )) {
        const name = path.basename(f.relativePath, ".md");
        const blocked =
          status === "🚧 Blocked" && f.blocked_by
            ? ` ⛔ ${f.blocked_by}`
            : "";
        lines.push(`- [[${name}]]${blocked}`);
      }
      lines.push("");
    }

    fs.writeFileSync(indexPath, lines.join("\n"), "utf-8");
    results.push({
      project,
      filePath: path.relative(vaultRoot, indexPath),
      fileCount: projectFiles.length,
    });
  }

  return results;
}

// ── Archive with Compaction ─────────────────────────────────────────────────

/**
 * 归档一个项目
 *
 * 将项目下所有非归档文件的状态改为 "🗃️ Archived"。
 * 可选地将 TechNote 压实合并为一个 POSTMORTEM 复盘报告。
 *
 * @param vaultRoot   - Vault 根目录
 * @param projectName - 要归档的项目名
 * @param opts        - 可选配置：compact（是否压实 TechNote）
 * @returns 归档结果，包含：
 *   - archived:       成功归档的文件数
 *   - skipped:        跳过的文件数（已归档或解析失败）
 *   - compacted:      被压实的 TechNote 数
 *   - postMortemPath: 复盘报告的相对路径（如有）
 *
 * 压实逻辑：
 *   当 compact=true 时，在归档前收集所有 TechNote 的正文内容，
 *   然后合并生成一个 POSTMORTEM-{日期}.md 复盘报告。
 *   这样即使原始文件被归档，其内容仍保留在复盘报告中。
 *
 * 被调用场景：work archive 命令
 */
export async function archiveProject(
  vaultRoot: string,
  projectName: string,
  opts?: { compact?: boolean }
): Promise<{
  archived: number;
  skipped: number;
  compacted: number;
  postMortemPath?: string;
}> {
  const files = await scanWorkFiles(vaultRoot);
  const projectFiles = files.filter((f) => f.project === projectName);

  let archived = 0;
  let skipped = 0;
  let compacted = 0;

  /** 收集 TechNote 内容用于压实（compact 模式） */
  const techNotes: { title: string; content: string }[] = [];

  for (const f of projectFiles) {
    const abs = path.resolve(vaultRoot, f.relativePath);
    if (!fs.existsSync(abs)) {
      skipped++;
      continue;
    }

    const raw = fs.readFileSync(abs, "utf-8");
    let data: Record<string, unknown>;
    let content: string;

    try {
      const parsed = matter(raw);
      data = parsed.data;
      content = parsed.content;
    } catch {
      skipped++;
      continue;
    }

    /** 已归档的文件跳过 */
    if (data.status === "🗃️ Archived") {
      skipped++;
      continue;
    }

    /** 在归档前收集 TechNote 内容 */
    if (opts?.compact && f.type === "TechNote") {
      techNotes.push({ title: f.title, content });
      compacted++;
    }

    /** 修改状态为已归档并写回文件 */
    data.status = "🗃️ Archived";
    const newRaw = matter.stringify(content, data);
    fs.writeFileSync(abs, newRaw, "utf-8");
    archived++;
  }

  /** 如果启用了压实且有 TechNote，生成复盘报告 */
  let postMortemPath: string | undefined;
  if (opts?.compact && techNotes.length > 0) {
    const projectDir =
      projectName === "General"
        ? path.resolve(vaultRoot, WORK_DIR)
        : path.resolve(vaultRoot, WORK_DIR, projectName);

    postMortemPath = path.join(projectDir, `POSTMORTEM-${today()}.md`);

    const lines = [
      "---",
      `title: "${projectName} 项目复盘"`,
      `type: TechNote`,
      `project: ${projectName}`,
      `status: 🍂 Completed`,
      `created: ${today()}`,
      "---",
      "",
      `# ${projectName} 项目复盘`,
      "",
      `> 自动生成于 ${today()}，包含 ${techNotes.length} 个技术笔记的压实内容`,
      "",
      "---",
      "",
    ];

    /** 将每个 TechNote 的内容作为二级标题区域追加 */
    for (const note of techNotes) {
      lines.push(`## ${note.title}`);
      lines.push("");
      lines.push(note.content.trim());
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    fs.writeFileSync(postMortemPath, lines.join("\n"), "utf-8");
  }

  return {
    archived,
    skipped,
    compacted,
    postMortemPath: postMortemPath
      ? path.relative(vaultRoot, postMortemPath)
      : undefined,
  };
}

// ── Task ────────────────────────────────────────────────────────────────────

/**
 * 任务组数据结构接口
 *
 * 用于描述 [!todo] callout 格式的任务层次结构：
 *   TaskGroup → Category → Task
 *
 * 在 Obsidian 中渲染为：
 *   > [!todo] 任务组名
 *   > - **分类名**
 *   >   - [ ] 待办任务
 *   >   - [x] 已完成任务
 */
export interface TaskGroup {
  /** 任务组名称（对应 [!todo] 后面的文本） */
  name: string;
  /** 任务组下的分类列表 */
  categories: {
    /** 分类名称（渲染为加粗文本） */
    name: string;
    /** 该分类下的任务列表 */
    tasks: { text: string; done: boolean }[];
  }[];/**
   * 构建 [!todo] callout 格式的任务内容
   *
   * 将 TaskGroup 数据结构转换为 Obsidian 兼容的 Markdown callout 格式。
   * 使用 Obsidian 的 [!todo] callout 语法，支持嵌套的 checkbox 列表。
   *
   * @param groups - 任务组数组
   * @returns 格式化后的 Markdown 字符串
   *
   * 输出格式示例：
   *   > [!todo] 任务组名
   *   > - **分类名**
   *   >   - [ ] 待办任务
   *   >   - [x] 已完成任务
   */
}

export function buildTaskCallout(groups: TaskGroup[]): string {
  const lines: string[] = [];

  for (const group of groups) {
    /** 每个任务组以 [!todo] callout 开始 */
    lines.push(`> [!todo] ${group.name}`);
    for (const cat of group.categories) {
      /** 分类名称渲染为加粗文本 */
      lines.push(`> - **${cat.name}**`);
      for (const task of cat.tasks) {
        /** 根据完成状态选择 checkbox 标记 */
        const check = task.done ? "[x]" : "[ ]";
        lines.push(`>   - ${check} ${task.text}`);
      }
    }
    /** 每个任务组后加空行分隔 */
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 创建带 [!todo] callout 的任务笔记
 *
 * 生成一个包含标准 frontmatter 和 [!todo] 任务结构的 Markdown 文件。
 *
 * @param vaultRoot - Vault 根目录
 * @param opts      - 创建选项：project（项目名）、title（标题）、groups（任务组数据）
 * @returns { filePath: 文件相对路径, created: 是否新创建 }
 *
 * 被调用场景：work task create 命令
 */
export function createTaskNote(
  vaultRoot: string,
  opts: {
    project: string;
    title: string;
    groups: TaskGroup[];
  }
): { filePath: string; created: boolean } {
  /** 确定项目目录 */
  const projectDir =
    opts.project === "General"
      ? path.resolve(vaultRoot, WORK_DIR)
      : path.resolve(vaultRoot, WORK_DIR, opts.project);

  /** 确保目录存在 */
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  /** 将标题转为安全文件名 */
  const safeName = opts.title.replace(/[<>:"\/\\|?*]/g, "_");
  const filePath = path.join(projectDir, `${safeName}.md`);

  /** 如果文件已存在，返回 created=false */
  if (fs.existsSync(filePath)) {
    return { filePath: path.relative(vaultRoot, filePath), created: false };
  }

  /** 构建 [!todo] callout 内容 */
  const taskContent = buildTaskCallout(opts.groups);

  /** 构建完整的文件内容（frontmatter + 标题 + 任务内容） */
  const fm = [
    "---",
    `title: "${opts.title}"`,
    `type: Task`,
    `project: ${opts.project}`,
    `status: 🌱 Planned`,
    `created: ${today()}`,
    "---",
    "",
    `# ${opts.title}`,
    "",
    taskContent,
    "---",
    "",
  ].join("\n");

  fs.writeFileSync(filePath, fm, "utf-8");
  return { filePath: path.relative(vaultRoot, filePath), created: true };
}

// ── Fix Frontmatter ─────────────────────────────────────────────────────────

/**
 * 修复工作文件中缺失或错误的 frontmatter
 *
 * 逐一检查文件并修复以下问题：
 *   - 缺失 type 字段 → 默认添加 "Task"
 *   - 缺失 project 字段 → 从目录结构推断
 *   - 旧版状态值自动迁移（如 "🌱 Seed" → "🌱 Planned"）
 *   - 缺失 created 字段 → 使用文件创建时间
 *   - 移除不属于 Work 的旧字段（domain、tags）
 *   - 修复损坏的 YAML 格式
 *
 * @param vaultRoot - Vault 根目录
 * @param opts      - 可选配置：project（限定项目名）、dry-run（预览模式）
 * @returns 每个被修复文件的修复详情列表
 *
 * 被调用场景：work fix 命令
 */
export async function fixWorkFrontmatter(
  vaultRoot: string,
  opts?: { project?: string; dryRun?: boolean }
): Promise<{ file: string; fixes: string[] }[]> {
  const files = await scanWorkFiles(vaultRoot);
  const results: { file: string; fixes: string[] }[] = [];

  /** 如果指定了项目名，只处理该项目的文件 */
  const targetFiles = opts?.project
    ? files.filter((f) => f.project === opts.project)
    : files;

  for (const f of targetFiles) {
    const abs = path.resolve(vaultRoot, f.relativePath);
    if (!fs.existsSync(abs)) continue;

    let raw = fs.readFileSync(abs, "utf-8");
    let data: Record<string, unknown>;
    const fixes: string[] = [];

    /** 检查文件是否有 frontmatter */
    const hasFrontmatter = raw.startsWith("---");

    if (hasFrontmatter) {
      try {
        ({ data } = matter(raw));
      } catch {
        /** YAML 解析失败，尝试修复 */
        raw = raw.replace(/^source::\s*/gm, "source: ");
        raw = raw.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
        try {
          ({ data } = matter(raw));
          fixes.push("fixed broken YAML");
        } catch {
          results.push({ file: f.relativePath, fixes: ["failed to fix YAML"] });
          continue;
        }
      }
    } else {
      /** 文件没有 frontmatter，将创建一个全新的 */
      data = {};
    }

    /** 复制一份数据用于修改 */
    const changes: Record<string, unknown> = { ...data };

    // ── 修复 type ──
    if (!changes.type) {
      changes.type = "Task";
      fixes.push("added type: Task");
    }

    // ── 修复 project ──
    if (!changes.project) {
      changes.project = f.project;
      fixes.push(`added project: ${f.project}`);
    }

    // ── 修复 status（迁移旧状态值） ──
    /** 旧版状态到新版状态的映射 */
    const statusMap: Record<string, string> = {
      "🌱 Seed": "🌱 Planned",
      "🌿 Growing": "🌿 Active",
      "🌲 Evergreen": "🍂 Completed",
    };
    if (!changes.status) {
      changes.status = "🌱 Planned";
      fixes.push("added status: 🌱 Planned");
    } else if (statusMap[String(changes.status)]) {
      const old = changes.status;
      changes.status = statusMap[String(changes.status)];
      fixes.push(`status: ${old} → ${changes.status}`);
    }

    // ── 修复 created ──
    if (!changes.created) {
      /** 使用文件的创建时间（birthtime）作为 created 值 */
      const stat = fs.statSync(abs);
      changes.created = stat.birthtime.toISOString().slice(0, 10);
      fixes.push(`added created: ${changes.created}`);
    }

    // ── 移除旧字段（从 Knowledge 格式迁移遗留的字段） ──
    if (changes.domain) {
      delete changes.domain;
      fixes.push("removed domain (Work不需要)");
    }
    if (changes.tags) {
      delete changes.tags;
      fixes.push("removed tags (Work不需要)");
    }

    /** 如果没有任何修复，跳过该文件 */
    if (fixes.length === 0) continue;

    /** 非 dry-run 模式下，将修改写回文件 */
    if (!opts?.dryRun) {
      const fmLines = ["---"];
      for (const [key, val] of Object.entries(changes)) {
        /** 跳过空值 */
        if (val === undefined || val === null || val === "") continue;
        if (Array.isArray(val)) {
          fmLines.push(`${key}: [${val.join(", ")}]`);
        } else if (
          typeof val === "string" &&
          (val.includes(":") || val.includes("#") || val.includes('"'))
        ) {
          /** 包含特殊字符的值需要用引号包裹，并转义内部的引号 */
          fmLines.push(`${key}: "${val.replace(/"/g, '\\"')}"`);
        } else {
          fmLines.push(`${key}: ${val}`);
        }
      }
      fmLines.push("---");

      if (hasFrontmatter) {
        /** 替换已有的 frontmatter 部分 */
        const fmStart = raw.indexOf("---");
        const fmEnd = raw.indexOf("---", 3);
        const body = raw.slice(fmEnd + 3);
        const newRaw = fmLines.join("\n") + body;
        fs.writeFileSync(abs, newRaw, "utf-8");
      } else {
        /** 在文件开头添加新的 frontmatter */
        const newRaw = fmLines.join("\n") + "\n\n" + raw;
        fs.writeFileSync(abs, newRaw, "utf-8");
      }
    }

    results.push({ file: f.relativePath, fixes });
  }

  return results;
}

// ── Normalize ──────────────────────────────────────────────────────────────

/**
 * 规范化结果接口
 *
 * 表示单个文件在规范化过程中的变更情况。
 */
export interface NormalizeResult {
  /** 文件相对路径 */
  file: string;
  /** 变更描述列表 */
  changes: string[];
  /** 如果文件被移动了，记录新的相对路径 */
  moved?: string;
}

/**
 * 全面规范化工作文件
 *
 * 比 fixWorkFrontmatter() 更彻底的规范化操作，包括：
 *   1. 修复损坏的 YAML 格式
 *   2. 规范化 type 字段（非标准类型 → Task/TechNote）
 *   3. 移除仅属于 Knowledge 的字段（source, related, aliases 等）
 *   4. 迁移 date 字段为 created 字段
 *   5. 统一 created 日期格式为 YYYY-MM-DD
 *   6. 确保 project 字段与目录结构一致
 *   7. 移动孤立文件（根目录但有具体项目名的文件）到对应项目目录
 *
 * @param vaultRoot - Vault 根目录
 * @param opts      - 可选配置：project（限定项目名）、dry-run（预览模式）
 * @returns 每个被规范化文件的变更详情列表
 *
 * 被调用场景：work normalize 命令
 */
export async function normalizeWorkFiles(
  vaultRoot: string,
  opts?: { project?: string; dryRun?: boolean }
): Promise<NormalizeResult[]> {
  const files = await scanWorkFiles(vaultRoot);
  const results: NormalizeResult[] = [];

  const targetFiles = opts?.project
    ? files.filter((f) => f.project === opts.project)
    : files;

  for (const f of targetFiles) {
    const abs = path.resolve(vaultRoot, f.relativePath);
    if (!fs.existsSync(abs)) continue;

    let raw = fs.readFileSync(abs, "utf-8");
    const changes: string[] = [];

    // ── 步骤 1: 解析 frontmatter（带损坏修复） ──
    let data: Record<string, unknown>;
    try {
      ({ data } = matter(raw));
    } catch {
      raw = raw.replace(/^source::\s*/gm, "source: ");
      raw = raw.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
      try {
        ({ data } = matter(raw));
        changes.push("fixed broken YAML");
      } catch {
        continue; // 跳过无法解析的文件
      }
    }

    // ── 步骤 2: 规范化 type 字段 ──
    if (data.type && !VALID_WORK_TYPES.includes(String(data.type))) {
      const mapped = TYPE_NORMALIZE_MAP[String(data.type)] ?? "Task";
      changes.push(`type: ${data.type} → ${mapped}`);
      data.type = mapped;
    }

    // ── 步骤 3: 移除 Knowledge 专属字段 ──
    for (const field of KNOWLEDGE_ONLY_FIELDS) {
      if (data[field] !== undefined) {
        delete data[field];
        changes.push(`removed ${field}`);
      }
    }

    // ── 步骤 4: 迁移 date → created ──
    if (data.date && !data.created) {
      const dateVal = String(data.date);
      /** 尝试解析为标准日期格式 */
      const parsed = new Date(dateVal);
      if (!isNaN(parsed.getTime())) {
        data.created = parsed.toISOString().slice(0, 10);
      } else {
        data.created = dateVal;
      }
      delete data.date;
      changes.push(`date → created: ${data.created}`);
    } else if (data.date && data.created) {
      /** 两个字段都存在时，移除多余的 date */
      delete data.date;
      changes.push("removed redundant date (kept created)");
    }

    // ── 步骤 5: 统一 created 日期格式 ──
    if (data.created && typeof data.created === "string") {
      const c = data.created;
      /** 如果是长日期格式（含 GMT 或 T），转为 YYYY-MM-DD */
      if (c.includes("GMT") || c.includes("T")) {
        const parsed = new Date(c);
        if (!isNaN(parsed.getTime())) {
          const normalized = parsed.toISOString().slice(0, 10);
          if (normalized !== c) {
            changes.push(`created: "${c}" → ${normalized}`);
            data.created = normalized;
          }
        }
      }
    }

    // ── 步骤 6: 确保 project 字段与目录一致 ──
    if (!data.project) {
      data.project = f.project;
      changes.push(`added project: ${f.project}`);
    } else if (data.project !== f.project) {
      /**
       * 目录结构和 frontmatter 中的 project 不一致
       * 保留 frontmatter 的值，但记录警告
       */
      changes.push(`project mismatch: dir=${f.project}, fm=${data.project}`);
    }

    /** 如果没有任何变更，跳过该文件 */
    if (changes.length === 0) continue;

    // ── 步骤 7: 写回文件 ──
    if (!opts?.dryRun) {
      const content = matter.stringify(raw, data);
      fs.writeFileSync(abs, content, "utf-8");
    }

    results.push({ file: f.relativePath, changes });
  }

  // ── 步骤 8: 移动孤立文件 ──
  /**
   * 孤立文件：位于 Work 根目录（project=General）但 frontmatter 中
   * 指定了具体项目的文件。将它们移动到正确的项目目录中。
   */
  const orphans = targetFiles.filter(
    (f) => f.project === "General" && !f.relativePath.endsWith("INDEX.md")
  );

  for (const f of orphans) {
    const abs = path.resolve(vaultRoot, f.relativePath);
    if (!fs.existsSync(abs)) continue;

    /** 读取 frontmatter 检查是否指定了具体项目 */
    let raw: string;
    try {
      raw = fs.readFileSync(abs, "utf-8");
    } catch {
      continue;
    }

    let data: Record<string, unknown>;
    try {
      ({ data } = matter(raw));
    } catch {
      continue;
    }

    /** 如果 frontmatter 中有具体项目名，移动文件 */
    if (data.project && data.project !== "General") {
      const targetDir = path.resolve(vaultRoot, WORK_DIR, String(data.project));
      const targetPath = path.join(targetDir, path.basename(f.relativePath));

      if (!opts?.dryRun) {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.renameSync(abs, targetPath);
      }

      /** 更新或追加移动记录到结果列表 */
      const result = results.find((r) => r.file === f.relativePath);
      const moveNote = `moved to ${data.project}/${path.basename(f.relativePath)}`;
      if (result) {
        result.moved = `${data.project}/${path.basename(f.relativePath)}`;
        result.changes.push(moveNote);
      } else {
        results.push({
          file: f.relativePath,
          changes: [moveNote],
          moved: `${data.project}/${path.basename(f.relativePath)}`,
        });
      }
    }
  }

  return results;
}

// ── Report ──────────────────────────────────────────────────────────────────

/**
 * 生成项目状态报告
 *
 * 扫描所有工作文件，按项目分组后生成全局报告。
 * 报告包含每个项目的文件数、状态分布、阻塞项和孤立文件列表。
 *
 * @param vaultRoot - Vault 根目录
 * @returns 工作报告，包含：
 *   - totalFiles:    文件总数
 *   - totalProjects: 项目总数
 *   - projects:      各项目的摘要（按文件数降序排列）
 *   - orphanFiles:   不属于任何项目的孤立文件
 *
 * 被调用场景：work report 和 work archive --dry-run 命令
 */
export async function generateReport(
  vaultRoot: string
): Promise<WorkReport> {
  const files = await scanWorkFiles(vaultRoot);

  const byProject = new Map<string, WorkFile[]>();
  const orphans: WorkFile[] = [];

  /** 将文件分为项目文件和孤立文件 */
  for (const f of files) {
    if (f.project === "General") {
      orphans.push(f);
    } else {
      const existing = byProject.get(f.project) ?? [];
      existing.push(f);
      byProject.set(f.project, existing);
    }
  }

  /** 为每个项目构建摘要 */
  const projects: ProjectSummary[] = [];
  for (const [name, projectFiles] of byProject) {
    const statusBreakdown: Record<string, number> = {};
    const blockedItems: { file: string; blocked_by: string }[] = [];

    /** 统计状态分布和阻塞项 */
    for (const f of projectFiles) {
      const st = f.status || "未标注";
      statusBreakdown[st] = (statusBreakdown[st] ?? 0) + 1;

      if (st === "🚧 Blocked" && f.blocked_by) {
        blockedItems.push({ file: f.title, blocked_by: f.blocked_by });
      }
    }

    projects.push({
      name,
      fileCount: projectFiles.length,
      statusBreakdown,
      blockedItems,
      files: projectFiles,
    });
  }

  /** 按文件数降序排列 */
  projects.sort((a, b) => b.fileCount - a.fileCount);

  return {
    totalFiles: files.length,
    totalProjects: byProject.size,
    projects,
    orphanFiles: orphans,
  };
}
