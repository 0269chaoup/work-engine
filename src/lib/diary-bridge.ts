/**
 * diary-bridge.ts — Lightweight diary read/write for work-engine.
 *
 * Replicates the essential diary format from daily-engine so work-engine
 * can append log entries to the daily diary without depending on daily-engine.
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";

// ── Constants ──────────────────────────────────────────────────────────────

const DAILY_DIR = "20-Daily";

// ── ISO Week ───────────────────────────────────────────────────────────────

export function getISOWeek(date: Date): { weekYear: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const weekYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { weekYear, week };
}

// ── Path Helpers ───────────────────────────────────────────────────────────

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Diary path: 20-Daily/YYYY/MM/第NN周/YYYY-MM-DD.md */
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

export function relativeToVault(vaultRoot: string, absPath: string): string {
  return path.relative(vaultRoot, absPath).replace(/\\/g, "/");
}

export function toWikilink(relativePath: string, alias?: string): string {
  const noExt = relativePath.replace(/\.md$/, "");
  return alias ? `[[${noExt}|${alias}]]` : `[[${noExt}]]`;
}

// ── Event Format ───────────────────────────────────────────────────────────

export interface DiaryEvent {
  time: string;
  icon: string;
  description: string;
  links: string[];
  tags: string[];
}

export const EVENT_ICONS = {
  created: "🆕",
  completed: "✅",
  log: "📝",
  blocked: "🚧",
  unblocked: "🔓",
  insight: "💡",
  note: "📌",
} as const;

export function formatEventLine(event: DiaryEvent): string {
  const linksStr = event.links.length > 0 ? " " + event.links.join(" ") : "";
  const tagsStr = event.tags.length > 0 ? " " + event.tags.join(" ") : "";
  return `- \`${event.time}\` ${event.icon} ${event.description}${linksStr}${tagsStr}`;
}

// ── Diary File Operations ──────────────────────────────────────────────────

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

/** Ensure diary file exists (create with template if missing). Returns abs path. */
export function ensureDiary(vaultRoot: string, date: Date): string {
  const absPath = getDiaryPath(vaultRoot, date);
  if (fs.existsSync(absPath)) return absPath;

  // Create parent dirs
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const dateStr = formatDate(date);
  const { weekYear, week } = getISOWeek(date);
  const weekStr = String(week).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const yearView = `[[${date.getFullYear()}_年视图]]`;
  const monthView = `[[${date.getFullYear()}-${month}_月视图]]`;
  const weekReview = `[[${weekYear}-W${weekStr}_周复盘]]`;

  fs.writeFileSync(absPath, DIARY_TEMPLATE(dateStr, yearView, monthView, weekReview), "utf-8");
  return absPath;
}

// ── Task File Lookup ───────────────────────────────────────────────────────

const WORK_DIR = "30-Projects/Work";

/** Find a task file by project + fuzzy title match. Returns abs path or null. */
export function findTaskFile(vaultRoot: string, project: string, title: string): string | null {
  const workDir = path.join(vaultRoot, WORK_DIR, project);
  if (!fs.existsSync(workDir)) return null;

  // Exact match
  const sanitized = title.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "-");
  const exactPath = path.join(workDir, `${sanitized}.md`);
  if (fs.existsSync(exactPath)) return exactPath;

  // Fuzzy search
  const files = fs.readdirSync(workDir).filter(f => f.endsWith(".md") && f !== "INDEX.md");
  const titleWords = title.toLowerCase().split(/\s+/);

  for (const file of files) {
    const name = file.replace(/\.md$/, "").toLowerCase();
    if (titleWords.every(w => name.includes(w))) {
      return path.join(workDir, file);
    }
  }

  return null;
}

/** Find a task file across all projects. Returns abs path or null. */
export function findTaskFileGlobal(vaultRoot: string, title: string): string | null {
  const workRoot = path.join(vaultRoot, WORK_DIR);
  if (!fs.existsSync(workRoot)) return null;

  const projects = fs.readdirSync(workRoot).filter(d => {
    const full = path.join(workRoot, d);
    return fs.statSync(full).isDirectory();
  });

  for (const project of projects) {
    const absPath = findTaskFile(vaultRoot, project, title);
    if (absPath) return absPath;
  }

  return null;
}

/** Read task frontmatter and build wikilink info. */
export function readTaskInfo(
  vaultRoot: string,
  absPath: string
): { relPath: string; wikilink: string; alias: string; project: string; title: string } | null {
  if (!fs.existsSync(absPath)) return null;

  const raw = fs.readFileSync(absPath, "utf-8");
  let title = path.basename(absPath, ".md");
  let project = "General";

  try {
    const parsed = matter(raw);
    title = parsed.data.title ?? title;
  } catch {
    const headingMatch = raw.match(/^#\s+(.+)/m);
    if (headingMatch) title = headingMatch[1];
  }

  const relPath = relativeToVault(vaultRoot, absPath);
  const parts = relPath.split("/");
  project = parts.length >= 4 ? parts[2] : "General";

  return {
    relPath,
    wikilink: toWikilink(relPath),
    alias: `${project}: ${title}`,
    project,
    title: String(title),
  };
}

/** Append an event to the ## 日志 section of a diary file. */
export function appendEvent(vaultRoot: string, date: Date, event: DiaryEvent): string {
  const absPath = ensureDiary(vaultRoot, date);
  const eventLine = formatEventLine(event);

  const raw = fs.readFileSync(absPath, "utf-8");
  const lines = raw.split("\n");

  // Find "## 日志" line
  let logSectionIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "## 日志") {
      logSectionIdx = i;
      break;
    }
  }

  if (logSectionIdx === -1) {
    // No 日志 section — append one
    lines.push("", "## 日志", eventLine);
  } else {
    // Find end of 日志 section
    let endIdx = logSectionIdx + 1;
    // Skip empty lines right after heading
    while (endIdx < lines.length && lines[endIdx].trim() === "") {
      endIdx++;
    }
    // Scan to next ## heading or end of file
    while (endIdx < lines.length) {
      if (lines[endIdx].trim().startsWith("## ") && endIdx > logSectionIdx) break;
      endIdx++;
    }
    lines.splice(endIdx, 0, eventLine);
  }

  fs.writeFileSync(absPath, lines.join("\n"), "utf-8");
  return absPath;
}
