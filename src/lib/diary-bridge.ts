/**
 * @file lib/diary-bridge.ts — 日记文件读写桥接模块
 *
 * 本文件是 work-engine 与 Obsidian 日记系统之间的桥接层。
 * 它复制了 daily-engine 中的关键日记格式和操作，使得 work-engine
 * 能够独立地向日记追加日志条目，无需依赖 daily-engine 模块。
 *
 * 核心功能模块：
 *
 * 1. ISO 周计算（getISOWeek）：
 *    根据 ISO 8601 标准计算日期所属的年份和周数，用于构建日记文件路径。
 *
 * 2. 路径工具函数：
 *    - formatDate():     格式化日期为 YYYY-MM-DD
 *    - formatTime():     格式化时间为 HH:MM
 *    - getDiaryPath():   根据日期计算日记文件的绝对路径
 *    - relativeToVault(): 将绝对路径转为相对于 Vault 的路径
 *    - toWikilink():     生成 Obsidian wikilink 格式链接
 *
 * 3. 事件格式化（DiaryEvent）：
 *    定义日记事件的数据结构和格式化方法，支持时间、图标、描述、链接和标签。
 *
 * 4. 日记文件操作：
 *    - ensureDiary():  确保日记文件存在（不存在则按模板创建）
 *    - appendEvent():  向日记的 "## 日志" 区域追加事件条目
 *
 * 5. 任务文件查找：
 *    - findTaskFile():       在指定项目目录中查找任务文件（支持精确匹配和模糊搜索）
 *    - findTaskFileGlobal(): 在所有项目中全局搜索任务文件
 *    - readTaskInfo():       读取任务文件的 frontmatter 信息，生成 wikilink
 *
 * 日记文件路径格式：20-Daily/YYYY/MM/第NN周/YYYY-MM-DD.md
 * 例如：20-Daily/2026/06/第23周/2026-06-03.md
 *
 * 依赖关系：
 *   - 被 commands/work.ts 的 "work log" 子命令调用
 *   - 独立于 daily-engine，可单独运行
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";

// ── Constants ──────────────────────────────────────────────────────────────

/** 日记文件在 Vault 中的相对根目录 */
const DAILY_DIR = "20-Daily";

// ── ISO Week ───────────────────────────────────────────────────────────────

/**
 * 计算日期的 ISO 8601 周数
 *
 * ISO 8601 标准定义：
 *   - 一周从周一开始
 *   - 一年的第一周是包含该年第一个星期四的那一周
 *   - 因此 12 月 31 日可能属于下一年的第 1 周
 *
 * @param date - 要计算的日期
 * @returns { weekYear: 周所属年份, week: 周数（1-53） }
 *
 * 算法说明：
 *   1. 将日期转为 UTC 时间（避免时区偏移影响）
 *   2. 调整到本周的星期四（ISO 标准的参考日）
 *   3. 用星期四所在的年份作为 weekYear
 *   4. 用该年 1 月 1 日到星期四的天数计算周数
 */
export function getISOWeek(date: Date): { weekYear: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  /** getUTCDay() 返回 0(周日)-6(周六)，ISO 中周一=1，周日=7 */
  const dayNum = d.getUTCDay() || 7;
  /** 调整到本周的星期四 */
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const weekYear = d.getUTCFullYear();
  /** 计算该年 1 月 1 日 */
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  /** 计算周数：(距年初天数 + 1) / 7 向上取整 */
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { weekYear, week };
}

// ── Path Helpers ───────────────────────────────────────────────────────────

/**
 * 格式化日期为 YYYY-MM-DD 字符串
 * @param date - Date 对象
 * @returns 格式化后的日期字符串，如 "2026-06-03"
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 格式化时间为 HH:MM 字符串（24 小时制）
 * @param date - Date 对象
 * @returns 格式化后的时间字符串，如 "14:30"
 */
export function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * 计算日记文件的绝对路径
 *
 * 路径格式：{vaultRoot}/20-Daily/{year}/{month}/第{week}周/{YYYY-MM-DD}.md
 * 例如：/vault/20-Daily/2026/06/第23周/2026-06-03.md
 *
 * 设计意图：
 *   按年/月/周的层级组织日记文件，便于 Obsidian 中的文件浏览和管理。
 *   使用 ISO 周数确保跨年时的周数连续性。
 *
 * @param vaultRoot - Vault 根目录绝对路径
 * @param date      - 目标日期
 * @returns 日记文件的绝对路径
 */
export function getDiaryPath(vaultRoot: string, date: Date): string {
  const { weekYear, week } = getISOWeek(date);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const weekStr = String(week).padStart(2, "0");
  const dateStr = formatDate(date);

  return path.join(
    vaultRoot,
    DAILY_DIR,
    String(year),
    month,
    `第${weekStr}周`,
    `${dateStr}.md`
  );
}

/**
 * 将绝对路径转换为相对于 Vault 根目录的路径
 *
 * @param vaultRoot - Vault 根目录
 * @param absPath   - 绝对路径
 * @returns 使用 "/" 分隔的相对路径
 *
 * 注意：将 Windows 的反斜杠 (\) 统一替换为正斜杠 (/)
 */
export function relativeToVault(vaultRoot: string, absPath: string): string {
  return path.relative(vaultRoot, absPath).replace(/\\/g, "/");
}

/**
 * 生成 Obsidian wikilink 格式的链接
 *
 * Obsidian 使用 [[文件名]] 格式的内部链接。
 * 如果提供了 alias（别名），则生成 [[文件名|别名]] 格式。
 *
 * @param relativePath - 相对路径（含 .md 扩展名）
 * @param alias        - 可选的显示别名
 * @returns wikilink 字符串，如 "[[30-Projects/Work/MyProject/task]]"
 *
 * 示例：
 *   toWikilink("30-Projects/Work/MyProject/task.md") → "[[30-Projects/Work/MyProject/task]]"
 *   toWikilink("task.md", "我的任务") → "[[task|我的任务]]"
 */
export function toWikilink(relativePath: string, alias?: string): string {
  const noExt = relativePath.replace(/\.md$/, "");
  return alias ? `[[${noExt}|${alias}]]` : `[[${noExt}]]`;
}

// ── Event Format ───────────────────────────────────────────────────────────

/**
 * 日记事件数据接口
 *
 * 表示日记中的一条事件记录，用于 appendEvent() 函数。
 * 最终格式化为：- `HH:MM` 📝 描述 [[链接]] #标签
 */
export interface DiaryEvent {
  /** 事件发生时间，格式 "HH:MM" */
  time: string;
  /** 事件图标（emoji），如 📝、✅、🚧 等 */
  icon: string;
  /** 事件描述文本 */
  description: string;
  /** 关联的 wikilink 链接数组（可为空） */
  links: string[];
  /** 标签数组，如 ["#log", "#重要"] */
  tags: string[];
}

/**
 * 预定义的事件图标常量
 *
 * 提供一组语义化的事件图标，用于不同类型的日志记录：
 *   - created:   🆕 新建任务
 *   - completed: ✅ 完成任务
 *   - log:       📝 普通日志
 *   - blocked:   🚧 任务被阻塞
 *   - unblocked: 🔓 解除阻塞
 *   - insight:   💡 灵感/想法
 *   - note:      📌 重要笔记
 *
 * 使用 as const 确保类型推断为字面量类型
 */
export const EVENT_ICONS = {
  created: "🆕",
  completed: "✅",
  log: "📝",
  blocked: "🚧",
  unblocked: "🔓",
  insight: "💡",
  note: "📌",
} as const;

/**
 * 将 DiaryEvent 格式化为日记中的 Markdown 行
 *
 * 输出格式：- `HH:MM` 📝 描述 [[链接1]] [[链接2]] #log #标签
 *
 * @param event - 日记事件数据
 * @returns 格式化后的 Markdown 列表行
 */
export function formatEventLine(event: DiaryEvent): string {
  /** 如果有链接，在描述后追加所有 wikilink */
  const linksStr = event.links.length > 0 ? " " + event.links.join(" ") : "";
  /** 如果有标签，在链接后追加所有标签 */
  const tagsStr = event.tags.length > 0 ? " " + event.tags.join(" ") : "";
  return `- \`${event.time}\` ${event.icon} ${event.description}${linksStr}${tagsStr}`;
}

// ── Diary File Operations ──────────────────────────────────────────────────

/**
 * 日记文件模板函数
 *
 * 生成新日记文件的初始内容，包含：
 *   - YAML frontmatter（date 字段）
 *   - 导航面包屑（年视图 / 月视图 / 周复盘）
 *   - 标准分区结构：任务、日志、学习、Note
 *
 * @param dateStr    - 日期字符串（YYYY-MM-DD）
 * @param yearView   - 年视图的 wikilink
 * @param monthView  - 月视图的 wikilink
 * @param weekReview - 周复盘的 wikilink
 * @returns 日记文件的完整内容
 */
const DIARY_TEMPLATE = (dateStr: string, yearView: string, monthView: string, weekReview: string) =>
  `---
date: ${dateStr}
---

${yearView} / ${monthView} / ${weekReview}

# ${dateStr}

## 任务

## 日志

## 学习

## Note
`;

/**
 * 确保指定日期的日记文件存在
 *
 * 如果日记文件不存在，会：
 *   1. 创建所有必需的父目录（年/月/周）
 *   2. 使用 DIARY_TEMPLATE 模板创建新文件
 *
 * @param vaultRoot - Vault 根目录绝对路径
 * @param date      - 目标日期
 * @returns 日记文件的绝对路径（无论新创建还是已存在）
 *
 * 被调用场景：
 *   - appendEvent() 在写入前调用，确保目标文件存在
 *   - "work log" 命令的间接调用
 */
export function ensureDiary(vaultRoot: string, date: Date): string {
  const absPath = getDiaryPath(vaultRoot, date);
  /** 文件已存在，直接返回路径 */
  if (fs.existsSync(absPath)) return absPath;

  /** 创建所有必需的父目录（年/月/周层级） */
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** 生成导航面包屑所需的 wikilink */
  const dateStr = formatDate(date);
  const { weekYear, week } = getISOWeek(date);
  const weekStr = String(week).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const yearView = `[[${date.getFullYear()}_年视图]]`;
  const monthView = `[[${date.getFullYear()}-${month}_月视图]]`;
  const weekReview = `[[${weekYear}-W${weekStr}_周复盘]]`;

  /** 使用模板创建日记文件 */
  fs.writeFileSync(absPath, DIARY_TEMPLATE(dateStr, yearView, monthView, weekReview), "utf-8");
  return absPath;
}

// ── Task File Lookup ───────────────────────────────────────────────────────

/** 工作文件在 Vault 中的相对根目录 */
const WORK_DIR = "30-Projects/Work";

/**
 * 在指定项目目录中查找任务文件
 *
 * 查找策略（两步）：
 *   1. 精确匹配：将标题中的特殊字符替换为下划线，空格替换为连字符，直接查找
 *   2. 模糊搜索：遍历项目目录下的所有 .md 文件，按标题词匹配
 *
 * @param vaultRoot - Vault 根目录绝对路径
 * @param project   - 项目名称（对应子目录名）
 * @param title     - 任务标题（用于匹配文件名）
 * @returns 匹配文件的绝对路径，未找到返回 null
 *
 * 被调用场景：
 *   - "work log --task" 命令中查找关联的任务文件
 */
export function findTaskFile(vaultRoot: string, project: string, title: string): string | null {
  const workDir = path.join(vaultRoot, WORK_DIR, project);
  if (!fs.existsSync(workDir)) return null;

  /** 第一步：精确匹配 — 将标题转为安全文件名后直接查找 */
  const sanitized = title.replace(/[<>"\/\\|?*]/g, "_").replace(/\s+/g, "-");
  const exactPath = path.join(workDir, `${sanitized}.md`);
  if (fs.existsSync(exactPath)) return exactPath;

  /** 第二步：模糊搜索 — 将标题拆为词组，检查每个文件名是否包含所有词 */
  const files = fs.readdirSync(workDir).filter(f => f.endsWith(".md") && f !== "INDEX.md");
  const titleWords = title.toLowerCase().split(/\s+/);

  for (const file of files) {
    const name = file.replace(/\.md$/, "").toLowerCase();
    /** 如果文件名包含标题中的所有词，则认为匹配 */
    if (titleWords.every(w => name.includes(w))) {
      return path.join(workDir, file);
    }
  }

  return null;
}

/**
 * 在所有项目中全局搜索任务文件
 *
 * 遍历 30-Projects/Work/ 下的所有项目子目录，
 * 对每个项目调用 findTaskFile() 进行查找。
 *
 * @param vaultRoot - Vault 根目录绝对路径
 * @param title     - 任务标题
 * @returns 第一个匹配文件的绝对路径，未找到返回 null
 *
 * 被调用场景：
 *   - "work log --task <title>" 命令中未指定 --project 时使用
 */
export function findTaskFileGlobal(vaultRoot: string, title: string): string | null {
  const workRoot = path.join(vaultRoot, WORK_DIR);
  if (!fs.existsSync(workRoot)) return null;

  /** 获取所有项目子目录 */
  const projects = fs.readdirSync(workRoot).filter(d => {
    const full = path.join(workRoot, d);
    return fs.statSync(full).isDirectory();
  });

  /** 遍历每个项目，返回第一个找到的结果 */
  for (const project of projects) {
    const absPath = findTaskFile(vaultRoot, project, title);
    if (absPath) return absPath;
  }

  return null;
}

/**
 * 读取任务文件的元数据信息
 *
 * 解析任务文件的 frontmatter，提取标题和项目名，
 * 并生成用于日志关联的 wikilink。
 *
 * @param vaultRoot - Vault 根目录绝对路径
 * @param absPath   - 任务文件的绝对路径
 * @returns 任务信息对象，包含：
 *   - relPath:   相对于 Vault 的路径
 *   - wikilink:  Obsidian wikilink 格式的链接
 *   - alias:     别名（格式为 "项目名: 标题"）
 *   - project:   项目名
 *   - title:     标题
 *   如果文件不存在返回 null
 *
 * 被调用场景：
 *   - "work log" 命令中读取关联任务的信息以生成 wikilink
 */
export function readTaskInfo(
  vaultRoot: string,
  absPath: string
): { relPath: string; wikilink: string; alias: string; project: string; title: string } | null {
  if (!fs.existsSync(absPath)) return null;

  const raw = fs.readFileSync(absPath, "utf-8");
  /** 默认使用文件名作为标题 */
  let title = path.basename(absPath, ".md");
  let project = "General";

  try {
    /** 尝试从 frontmatter 中提取标题 */
    const parsed = matter(raw);
    title = parsed.data.title ?? title;
  } catch {
    /** frontmatter 解析失败时，尝试从第一个 # 标题中提取 */
    const headingMatch = raw.match(/^#\s+(.+)/m);
    if (headingMatch) title = headingMatch[1];
  }

  /** 从路径中推断项目名 */
  const relPath = relativeToVault(vaultRoot, absPath);
  const parts = relPath.split("/");
  /** 路径格式：30-Projects/Work/项目名/文件.md，第 3 段（索引 2）为项目名 */
  project = parts.length >= 4 ? parts[2] : "General";

  return {
    relPath,
    wikilink: toWikilink(relPath),
    /** 别名格式：项目名: 标题，便于在日志中快速识别 */
    alias: `${project}: ${title}`,
    project,
    title: String(title),
  };
}

/**
 * 向日记的 "## 日志" 区域追加一条事件记录
 *
 * 处理流程：
 *   1. 调用 ensureDiary() 确保日记文件存在
 *   2. 读取日记文件内容
 *   3. 查找 "## 日志" 标题行
 *   4. 在该区域的末尾（下一个 ## 标题之前）插入事件行
 *   5. 如果没有 "## 日志" 区域，则追加到文件末尾
 *
 * @param vaultRoot - Vault 根目录绝对路径
 * @param date      - 目标日期
 * @param event     - 要追加的事件数据
 * @returns 日记文件的绝对路径
 *
 * 被调用场景：
 *   - "work log" 命令的 action 中调用
 */
export function appendEvent(vaultRoot: string, date: Date, event: DiaryEvent): string {
  /** 确保日记文件存在，获取其绝对路径 */
  const absPath = ensureDiary(vaultRoot, date);
  /** 将事件格式化为 Markdown 列表行 */
  const eventLine = formatEventLine(event);

  const raw = fs.readFileSync(absPath, "utf-8");
  const lines = raw.split("\n");

  // 查找 "## 日志" 标题行的位置
  let logSectionIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "## 日志") {
      logSectionIdx = i;
      break;
    }
  }

  if (logSectionIdx === -1) {
    /** 没有 "## 日志" 区域 — 在文件末尾追加一个 */
    lines.push("", "## 日志", eventLine);
  } else {
    /**
     * 找到 "## 日志" 区域的结束位置：
     *   1. 跳过标题行后的空行
     *   2. 继续扫描直到遇到下一个 ## 标题或文件末尾
     *   3. 在该位置插入事件行
     */
    let endIdx = logSectionIdx + 1;
    // 跳过标题后的空行
    while (endIdx < lines.length && lines[endIdx].trim() === "") {
      endIdx++;
    }
    // 扫描到下一个 ## 标题或文件末尾
    while (endIdx < lines.length) {
      if (lines[endIdx].trim().startsWith("## ") && endIdx > logSectionIdx) break;
      endIdx++;
    }
    /** 在区域结束位置插入事件行 */
    lines.splice(endIdx, 0, eventLine);
  }

  /** 将修改后的内容写回文件 */
  fs.writeFileSync(absPath, lines.join("\n"), "utf-8");
  return absPath;
}
