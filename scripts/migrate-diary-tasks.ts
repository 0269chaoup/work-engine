#!/usr/bin/env node
/**
 * migrate-diary-tasks.ts
 * 
 * 迁移旧日记中的 - [ ] 复选框到 Strategy A 的事件格式
 * 
 * 策略：
 * 1. 扫描 20-Daily/ 中所有日记文件
 * 2. 提取 ## 任务 段落中的 - [ ] 条目
 * 3. 尝试匹配 Work/ 中已有的任务文件（模糊匹配）
 * 4. 有匹配 → 在 ## 日志 中添加 #task-created 事件 + 清空 ## 任务
 * 5. 无匹配 → 保留为普通笔记（不带 #task-created）
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";

const DAILY_DIR = "20-Daily";
const WORK_DIR = "30-Projects/Work";

// ── Interfaces ─────────────────────────────────────────────────────────────

interface TaskEntry {
  text: string;
  completed: boolean;
  lineIndex: number;
  indent: number;
}

interface WorkTask {
  relPath: string;
  title: string;
  project: string;
}

interface MigrationResult {
  file: string;
  matched: number;
  unmatched: number;
  actions: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function relativeToVault(vaultRoot: string, absPath: string): string {
  return path.relative(vaultRoot, absPath).replace(/\\/g, "/");
}

function toWikilink(relativePath: string, alias?: string): string {
  const noExt = relativePath.replace(/\.md$/, "");
  return alias ? `[[${noExt}|${alias}]]` : `[[${noExt}]]`;
}

// ── Task Matching ──────────────────────────────────────────────────────────

async function loadWorkTasks(vaultRoot: string): Promise<WorkTask[]> {
  const workRoot = path.join(vaultRoot, WORK_DIR);
  if (!fs.existsSync(workRoot)) return [];

  const tasks: WorkTask[] = [];
  const projects = fs.readdirSync(workRoot).filter(d => {
    const full = path.join(workRoot, d);
    return fs.statSync(full).isDirectory();
  });

  for (const project of projects) {
    const projDir = path.join(workRoot, project);
    const files = await glob("*.md", { cwd: projDir });

    for (const file of files) {
      if (file === "INDEX.md") continue;
      const filePath = path.join(projDir, file);
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = matter(raw);
        const title = parsed.data.title ?? file.replace(/\.md$/, "");
        const relPath = relativeToVault(vaultRoot, filePath);
        tasks.push({ relPath, title: String(title), project });
      } catch {
        // skip unparseable files
      }
    }
  }

  return tasks;
}

function findBestMatch(taskText: string, workTasks: WorkTask[]): WorkTask | null {
  const normalized = taskText.toLowerCase().replace(/\s+/g, " ").trim();
  
  // Exact match
  for (const wt of workTasks) {
    if (wt.title.toLowerCase() === normalized) {
      return wt;
    }
  }

  // Fuzzy match: check if all words in taskText appear in workTask title
  const words = normalized.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return null;

  let bestMatch: WorkTask | null = null;
  let bestScore = 0;

  for (const wt of workTasks) {
    const wtTitle = wt.title.toLowerCase();
    const matchedWords = words.filter(w => wtTitle.includes(w));
    const score = matchedWords.length / words.length;
    
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = wt;
    }
  }

  return bestMatch;
}

// ── Diary Processing ───────────────────────────────────────────────────────

function parseDiaryTasks(content: string): TaskEntry[] {
  const tasks: TaskEntry[] = [];
  const lines = content.split("\n");
  
  let inTaskSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === "## 任务") {
      inTaskSection = true;
      continue;
    }
    
    if (trimmed.startsWith("## ") && inTaskSection) {
      break; // End of task section
    }
    
    if (inTaskSection) {
      const match = line.match(/^(\s*)- \[([ x])\] (.+)/);
      if (match) {
        tasks.push({
          text: match[3],
          completed: match[2] === "x",
          lineIndex: i,
          indent: match[1].length,
        });
      }
    }
  }

  return tasks;
}

function addEventToDiary(content: string, event: string): string {
  const lines = content.split("\n");
  
  // Find ## 日志 section
  let logSectionIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "## 日志") {
      logSectionIdx = i;
      break;
    }
  }

  if (logSectionIdx === -1) {
    // No 日志 section - append one
    lines.push("", "## 日志", event);
  } else {
    // Find end of 日志 section
    let endIdx = logSectionIdx + 1;
    while (endIdx < lines.length && lines[endIdx].trim() === "") {
      endIdx++;
    }
    while (endIdx < lines.length) {
      if (lines[endIdx].trim().startsWith("## ") && endIdx > logSectionIdx) break;
      endIdx++;
    }
    lines.splice(endIdx, 0, event);
  }

  return lines.join("\n");
}

function clearTaskSection(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  
  let inTaskSection = false;
  let taskSectionFound = false;
  
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    
    if (trimmed === "## 任务") {
      inTaskSection = true;
      taskSectionFound = true;
      result.push(lines[i]); // Keep the heading
      continue;
    }
    
    if (trimmed.startsWith("## ") && inTaskSection) {
      inTaskSection = false;
      result.push(""); // Add empty line before next section
    }
    
    if (!inTaskSection) {
      result.push(lines[i]);
    }
  }
  
  return result.join("\n");
}

// ── Main Migration ─────────────────────────────────────────────────────────

async function migrateDiaryTasks(vaultRoot: string, options: {
  dryRun?: boolean;
} = {}): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];
  const workTasks = await loadWorkTasks(vaultRoot);
  
  console.log(`\n📋 Loaded ${workTasks.length} Work/ task files\n`);

  // Find all diary files
  const diaryPattern = path.join(DAILY_DIR, "**", "*.md");
  const diaryFiles = await glob(diaryPattern, {
    cwd: vaultRoot,
    absolute: false,
  });

  console.log(`📂 Found ${diaryFiles.length} diary files\n`);

  for (const diaryFile of diaryFiles) {
    const absPath = path.join(vaultRoot, diaryFile);
    const raw = fs.readFileSync(absPath, "utf-8");
    const tasks = parseDiaryTasks(raw);
    
    if (tasks.length === 0) continue;

    const result: MigrationResult = {
      file: diaryFile,
      matched: 0,
      unmatched: 0,
      actions: [],
    };

    // Parse date from filename
    const dateMatch = diaryFile.match(/(\d{4}-\d{2}-\d{2})\.md$/);
    if (!dateMatch) continue;
    const dateStr = dateMatch[1];
    const date = new Date(dateStr + "T00:00:00");

    let content = raw;
    const matchedTasks: string[] = [];

    for (const task of tasks) {
      const match = findBestMatch(task.text, workTasks);
      
      if (match) {
        result.matched++;
        const wikilink = toWikilink(match.relPath, `${match.project}: ${match.title}`);
        const icon = task.completed ? "✅" : "🆕";
        const tag = task.completed ? "#task-completed" : "#task-created";
        const event = `- \`${formatTime(new Date())}\` ${icon} ${task.text} ${wikilink} ${tag}`;
        
        content = addEventToDiary(content, event);
        matchedTasks.push(task.text);
        result.actions.push(`✅ Matched: "${task.text}" → ${match.relPath}`);
      } else {
        result.unmatched++;
        // Convert unmatched tasks to simple notes in 日志 section
        const event = `- \`${formatTime(new Date())}\` 📝 ${task.text}`;
        content = addEventToDiary(content, event);
        result.actions.push(`📝 Converted: "${task.text}" → 日志 note`);
      }
    }

    // Clear the 任务 section after migration
    if (result.matched > 0 || result.unmatched > 0) {
      content = clearTaskSection(content);
    }

    if (!options.dryRun && (result.matched > 0 || result.unmatched > 0)) {
      fs.writeFileSync(absPath, content, "utf-8");
    }

    results.push(result);
  }

  return results;
}

// ── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const vaultRoot = args[0] ?? process.env.OBSIDIAN_VAULT ?? process.cwd();
  const dryRun = args.includes("--dry-run");

  console.log(`\n🔄 Migrating diary tasks to Strategy A format`);
  console.log(`   Vault: ${vaultRoot}`);
  console.log(`   Mode: ${dryRun ? "DRY RUN" : "LIVE"}\n`);

  const results = await migrateDiaryTasks(vaultRoot, { dryRun });

  // Print results
  let totalMatched = 0;
  let totalUnmatched = 0;
  let filesModified = 0;

  for (const r of results) {
    if (r.matched === 0 && r.unmatched === 0) continue;
    
    console.log(`\n📄 ${r.file}`);
    for (const action of r.actions) {
      console.log(`   ${action}`);
    }
    totalMatched += r.matched;
    totalUnmatched += r.unmatched;
    filesModified++;
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log(`Files modified: ${filesModified}`);
  console.log(`✅ Matched → #task-created events: ${totalMatched}`);
  console.log(`📝 Unmatched → 日志 notes: ${totalUnmatched}`);
  
  if (dryRun) {
    console.log(`\n⚠️  DRY RUN — no files were modified. Run without --dry-run to apply.`);
  }
}

main().catch(console.error);
