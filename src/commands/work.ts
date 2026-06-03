/**
 * @file commands/work.ts — work 子命令的定义与注册
 *
 * 本文件定义了 `work` 命令及其所有子命令，是用户与工作管理引擎交互的主要入口。
 * 每个子命令通过 commander 的链式 API 定义参数和选项，并在 action 中调用 lib 层的核心逻辑。
 *
 * 子命令列表：
 *   work create   — 创建新的工作任务文件（含 frontmatter 模板）
 *   work validate — 校验工作文件的 frontmatter 完整性和规范性
 *   work index    — 为每个项目生成/更新 MOC 增强的 INDEX.md 索引文件
 *   work archive  — 归档项目（可选将 TechNote 压实为复盘报告）
 *   work task     — 任务管理子命令组（create/template）
 *   work fix      — 修复缺失/错误的 frontmatter（自动迁移旧状态值）
 *   work normalize — 全面规范化：修正类型、移除无关字段、统一日期格式、移动孤立文件
 *   work report   — 生成项目状态报告（全局概览）
 *   work log      — 向当日日记追加日志条目（可关联工作任务）
 *
 * 依赖关系：
 *   - lib/work.ts         : 核心工作文件操作（创建、验证、归档、修复、规范化、报告）
 *   - lib/aggregator.ts   : 基于 AST 的文件扫描与项目聚合
 *   - lib/template.ts     : MOC 索引文件的模板渲染
 *   - lib/diary-bridge.ts : 日记文件的读写与任务查找
 *   - lib/cli-utils.ts    : CLI 上下文构建与工具函数
 */

import { Command } from "commander";
import fs from "fs";
import path from "path";
import { buildContext, row } from "../lib/cli-utils.js";
import {
  createWorkFile,
  validateWork,
  archiveProject,
  generateReport,
  fixWorkFrontmatter,
  normalizeWorkFiles,
  createTaskNote,
  updateTaskStatus,
} from "../lib/work.js";
import { scanWorkFilesAST, aggregateByProject } from "../lib/aggregator.js";
import { renderIndex, renderRootIndex } from "../lib/template.js";
import {
  ensureDiary,
  appendEvent,
  findTaskFile,
  findTaskFileGlobal,
  readTaskInfo,
  relativeToVault,
  toWikilink,
  formatTime,
  EVENT_ICONS,
  formatEventLine,
} from "../lib/diary-bridge.js";

/**
 * 创建并返回 work 命令实例（含所有子命令）
 *
 * 这是整个 CLI 的命令注册中心。每个子命令的 action 回调负责：
 *   1. 通过 buildContext() 构建 CLI 上下文（包含 vault 路径和 LLM 实例）
 *   2. 调用 lib 层的核心函数执行业务逻辑
 *   3. 格式化输出结果到控制台
 *
 * @returns {Command} commander 命令实例，包含所有已注册的子命令
 */
export function workCommand(): Command {
  /** 创建 work 父命令，所有子命令挂载在此命令下 */
  const work = new Command("work")
    .description("Manage work/project notes in 30-Projects/Work");

  // ── work create ─────────────────────────────────────────────────────────
  /**
   * 子命令：work create
   * 功能：创建一个新的工作任务文件
   *
   * 参数：
   *   project — 项目名称（对应 30-Projects/Work/ 下的子目录）
   *   title   — 文档标题（同时用作文件名，特殊字符会被替换为下划线）
   *
   * 选项：
   *   -t, --type <type>     — 文档类型：Task（任务）或 TechNote（技术笔记），默认 Task
   *   --status <status>     — 初始状态，默认 "🌱 Planned"（计划中）
   *
   * 依赖：调用 createWorkFile() 生成带标准 frontmatter 的 Markdown 文件
   */
  work
    .command("create")
    .description("Create a new work note with proper frontmatter")
    .argument("<project>", "Project name (directory under 30-Projects/Work)")
    .argument("<title>", "Document title")
    .option("-t, --type <type>", "Document type: Task | TechNote", "Task")
    .option("--status <status>", "Status: 🌱 Planned | 🌿 Active | 🚧 Blocked | 🍂 Completed", "🌱 Planned")
    .action(async (project, title, opts) => {
      /** 从父命令选项中构建 CLI 上下文（vault 路径、LLM 实例等） */
      const ctx = buildContext(work.parent!.opts());

      /** 调用核心函数创建工作文件 */
      const result = createWorkFile(ctx.vault.root, {
        project,
        title,
        type: opts.type,
        status: opts.status,
      });

      /** 根据创建结果显示不同的提示信息 */
      if (result.created) {
        console.log(`\n✅ Created: ${result.filePath}`);
      } else {
        console.log(`\n⚠️ Already exists: ${result.filePath}`);
      }
    });

  // ── work validate ───────────────────────────────────────────────────────
  /**
   * 子命令：work validate
   * 功能：校验所有工作文件的 frontmatter 完整性和规范性
   *
   * 检查项：
   *   - type 字段是否存在且为合法值（Task/TechNote）
   *   - status 字段是否存在
   *   - created 字段是否存在
   *
   * 选项：
   *   -p, --project <name>  — 限定到特定项目
   *   --errors-only         — 仅显示错误，不显示警告
   *
   * 依赖：调用 validateWork() 执行校验逻辑
   */
  work
    .command("validate")
    .description("Validate work files — frontmatter, type, status")
    .option("-p, --project <name>", "Limit to a specific project")
    .option("--errors-only", "Show only errors, not warnings", false)
    .action(async (opts) => {
      const ctx = buildContext(work.parent!.opts());

      console.log("\n🔍 Validating work files...\n");
      const result = await validateWork(ctx.vault.root, {
        project: opts.project,
      });

      /** 如果没有问题，直接输出成功信息 */
      if (result.issues.length === 0) {
        console.log(`✅ All ${result.totalFiles} files are valid.`);
        return;
      }

      /** 按文件分组问题，方便逐文件展示 */
      const byFile = new Map<string, typeof result.issues>();
      for (const issue of result.issues) {
        /** 如果开启了 errors-only 模式，跳过警告级别的问题 */
        if (opts.errorsOnly && issue.severity === "warning") continue;
        const existing = byFile.get(issue.file) ?? [];
        existing.push(issue);
        byFile.set(issue.file, existing);
      }

      /** 逐文件输出问题详情 */
      for (const [file, issues] of byFile) {
        console.log(`📄 ${file}`);
        for (const issue of issues) {
          const icon = issue.severity === "error" ? "❌" : "⚠️";
          console.log(`   ${icon} [${issue.field}] ${issue.detail}`);
        }
        console.log();
      }

      /** 输出汇总统计 */
      console.log("═".repeat(50));
      console.log(
        `Total: ${result.totalFiles} | Clean: ${result.clean} | Errors: ${result.errors} | Warnings: ${result.warnings}`
      );
    });

  // ── work index ──────────────────────────────────────────────────────────
  /**
   * 子命令：work index
   * 功能：为每个项目生成/更新 MOC 增强的 INDEX.md 索引文件
   *
   * 处理流程（AST 解析 → 聚合 → 渲染）：
   *   1. scanWorkFilesAST() — 使用 AST 解析器扫描所有工作文件
   *   2. aggregateByProject() — 按项目聚合文件数据（状态分布、完成率、阻塞链等）
   *   3. renderIndex() — 渲染每个项目的 INDEX.md（含状态分组、进度、依赖链）
   *   4. renderRootIndex() — 渲染根目录的 INDEX.md（项目总览）
   *
   * 选项：
   *   -p, --project <name>  — 限定到特定项目
   *
   * 依赖：aggregator.ts (扫描+聚合) → template.ts (渲染)
   */
  work
    .command("index")
    .description("Generate/update MOC-enhanced INDEX.md for each project")
    .option("-p, --project <name>", "Limit to a specific project")
    .action(async (opts) => {
      const ctx = buildContext(work.parent!.opts());
      /** 工作文件的相对根目录 */
      const WORK_DIR = "30-Projects/Work";

      console.log("\n📋 Generating MOC indexes...\n");

      // AST 解析 → 聚合 → 渲染 流水线
      /** 第一步：AST 扫描所有工作文件 */
      const files = await scanWorkFilesAST(ctx.vault.root);
      /** 如果指定了项目名，只处理该项目的文件 */
      const filtered = opts.project
        ? files.filter(f => f.project === opts.project)
        : files;

      /** 第二步：按项目聚合文件数据 */
      const projects = aggregateByProject(filtered);
      /** 记录每个项目的索引生成结果 */
      const results: { project: string; filePath: string; fileCount: number }[] = [];

      /** 第三步：遍历每个项目，生成 INDEX.md */
      for (const [name, agg] of projects) {
        /** General 项目直接放在 Work 根目录下，其他项目放在各自的子目录中 */
        const indexDir = name === "General"
          ? path.resolve(ctx.vault.root, WORK_DIR)
          : path.resolve(ctx.vault.root, WORK_DIR, name);

        /** 确保目录存在 */
        if (!fs.existsSync(indexDir)) {
          fs.mkdirSync(indexDir, { recursive: true });
        }

        /** 渲染并写入 INDEX.md */
        const indexPath = path.join(indexDir, "INDEX.md");
        const content = renderIndex(agg);
        fs.writeFileSync(indexPath, content, "utf-8");

        results.push({
          project: name,
          filePath: path.relative(ctx.vault.root, indexPath),
          fileCount: agg.totalFiles,
        });

        /** 计算完成百分比和阻塞数量，用于控制台输出 */
        const pct = Math.round(agg.completionRate * 100);
        const blocked = agg.blockedItems.length > 0
          ? ` | ⛔ ${agg.blockedItems.length} blocked`
          : "";
        console.log(
          `  📁 ${name}: ${agg.totalFiles} files | ✅ ${pct}%${blocked} → ${path.relative(ctx.vault.root, indexPath)}`
        );
      }

      /** 第四步：生成根目录的总索引 INDEX.md（仅在未指定项目时生成） */
      if (!opts.project) {
        const rootIndexPath = path.resolve(ctx.vault.root, WORK_DIR, "INDEX.md");
        const rootContent = renderRootIndex(
          results.map(r => ({ name: r.project, fileCount: r.fileCount }))
        );
        fs.writeFileSync(rootIndexPath, rootContent, "utf-8");
        console.log(`\n  📄 Root INDEX.md updated`);
      }

      console.log(`\n✅ Updated ${results.length} project index(es).`);
    });

  // ── work archive ────────────────────────────────────────────────────────
  /**
   * 子命令：work archive
   * 功能：归档一个项目（将所有文件状态改为 "🗃️ Archived"）
   *
   * 特性：
   *   --compact  — 归档时将所有 TechNote 压实合并为一个 POSTMORTEM 复盘报告
   *   --dry-run  — 预览模式，只显示将被归档的文件，不实际修改
   *
   * 依赖：调用 archiveProject() 执行归档逻辑
   */
  work
    .command("archive")
    .description("Archive a project (compact TechNotes into post-mortem)")
    .argument("<project>", "Project name to archive")
    .option("--compact", "Compact TechNotes into a post-mortem report", false)
    .option("--dry-run", "Show what would be archived without writing", false)
    .action(async (project, opts) => {
      const ctx = buildContext(work.parent!.opts());

      /** 预览模式：只显示将被归档的文件列表 */
      if (opts.dryRun) {
        const report = await generateReport(ctx.vault.root);
        const proj = report.projects.find((p) => p.name === project);
        if (!proj) {
          console.log(`\n❌ Project not found: ${project}`);
          return;
        }
        /** 筛选出尚未归档的文件 */
        const nonArchived = proj.files.filter(
          (f) => f.status !== "🗃️ Archived"
        );
        console.log(
          `\n📋 Would archive ${nonArchived.length} files in ${project}:`
        );
        for (const f of nonArchived) {
          console.log(`  📄 ${f.title} (${f.status || "no status"})`);
        }
        /** 如果启用了 compact 模式，显示将被压实的 TechNote 数量 */
        if (opts.compact) {
          const techNotes = proj.files.filter((f) => f.type === "TechNote");
          console.log(`\n📦 Would compact ${techNotes.length} TechNotes into post-mortem`);
        }
        return;
      }

      /** 执行实际归档操作 */
      console.log(`\n🗄️ Archiving project: ${project}...\n`);
      const result = await archiveProject(ctx.vault.root, project, {
        compact: opts.compact,
      });
      console.log(`✅ Archived: ${result.archived} | Skipped: ${result.skipped}`);
      if (result.compacted > 0) {
        console.log(`📦 Compacted: ${result.compacted} TechNotes → ${result.postMortemPath}`);
      }
    });

  // ── work task ──────────────────────────────────────────────────────────
  /**
   * 子命令组：work task
   * 功能：任务管理（基于 Obsidian [!todo] callout 格式）
   *
   * 子命令：
   *   task create   — 创建带 [!todo] callout 模板的任务笔记
   *   task template — 显示 [!todo] 任务格式模板说明
   */
  const task = work.command("task").description("Task management with [!todo] callout format");

  /**
   * 子命令：work task create
   * 功能：创建一个包含 [!todo] callout 格式的任务笔记
   *
   * 参数：
   *   project — 项目名称
   *   title   — 任务笔记标题
   *
   * 选项：
   *   --group <name> — 任务组名称（可重复指定多个组）
   *
   * 生成的文件格式示例：
   *   > [!todo] 任务组名
   *   > - **待办**
   *   >   - [ ] 待填写
   */
  task
    .command("create")
    .description("Create a task note with [!todo] callout template")
    .argument("<project>", "Project name")
    .argument("<title>", "Task note title")
    /** group 选项支持重复指定，使用累加器函数将多个值收集为数组 */
    .option("--group <name>", "Task group name (can repeat)", (val: string, prev: string[]) => [...prev, val], [] as string[])
    .action(async (project, title, opts) => {
      const ctx = buildContext(work.parent!.opts());

      /**
       * 构建任务组数据结构：
       * - 如果用户指定了 --group，为每个组名创建一个任务组
       * - 如果未指定，默认使用标题作为组名，创建一个包含默认任务的组
       */
      const groups = opts.group.length > 0
        ? opts.group.map((name: string) => ({
            name,
            categories: [{ name: "待办", tasks: [{ text: "待填写", done: false }] }],
          }))
        : [
            {
              name: title,
              categories: [{ name: "待办", tasks: [{ text: "待填写", done: false }] }],
            },
          ];

      const result = createTaskNote(ctx.vault.root, { project, title, groups });
      if (result.created) {
        console.log(`\n✅ Created task note: ${result.filePath}`);
      } else {
        console.log(`\n⚠️ Already exists: ${result.filePath}`);
      }
    });

  /**
   * 子命令：work task template
   * 功能：在控制台显示 [!todo] 任务格式的使用说明和模板
   */
  task
    .command("template")
    .description("Show the [!todo] task format template")
    .action(() => {
      console.log(`
任务格式模板：
─────────────

> [!todo] 任务组名
> - **子任务类别**
>   - [ ] 待办任务
>   - [x] 已完成任务
> - **另一类别**
>   - [ ] 待办任务

使用方式：
  work-engine work task create <项目> <标题> --group "任务组名"
`);
    });

  // ── work fix ────────────────────────────────────────────────────────────
  /**
   * 子命令：work fix
   * 功能：修复工作文件中缺失或错误的 frontmatter
   *
   * 修复内容：
   *   - 缺失的 type 字段 → 默认设为 "Task"
   *   - 缺失的 project 字段 → 根据目录结构推断
   *   - 旧版状态值自动迁移（如 "🌱 Seed" → "🌱 Planned"）
   *   - 缺失的 created 字段 → 使用文件创建时间
   *   - 移除不属于 Work 的旧字段（domain、tags）
   *
   * 选项：
   *   -p, --project <name>  — 限定到特定项目
   *   --dry-run             — 预览模式，只显示修复建议
   *
   * 依赖：调用 fixWorkFrontmatter() 执行修复逻辑
   */
  work
    .command("fix")
    .description("Fix missing/wrong frontmatter in work files (auto-migrate old status)")
    .option("-p, --project <name>", "Limit to a specific project")
    .option("--dry-run", "Show what would be fixed without writing", false)
    .action(async (opts) => {
      const ctx = buildContext(work.parent!.opts());

      console.log(`\n🔧 ${opts.dryRun ? "Checking" : "Fixing"} work frontmatter...\n`);
      const results = await fixWorkFrontmatter(ctx.vault.root, {
        project: opts.project,
        dryRun: opts.dryRun,
      });

      if (results.length === 0) {
        console.log("✅ All work files have correct frontmatter.");
        return;
      }

      /** 统计总修复数 */
      let totalFixes = 0;
      for (const r of results) {
        console.log(`📄 ${r.file}`);
        for (const fix of r.fixes) {
          console.log(`   🔧 ${fix}`);
          totalFixes++;
        }
        console.log();
      }

      /** 输出汇总信息 */
      console.log("═".repeat(50));
      console.log(`Files fixed: ${results.length} | Total fixes: ${totalFixes}`);
    });

  // ── work normalize ─────────────────────────────────────────────────────
  /**
   * 子命令：work normalize
   * 功能：全面规范化工作文件（比 fix 更彻底）
   *
   * 规范化内容：
   *   1. 修正非标准 type 为 Task 或 TechNote（如 WorkNote→Task, MeetingNote→TechNote）
   *   2. 移除仅属于 Knowledge 的字段（source, related, aliases, keywords, summary, domain, tags）
   *   3. 统一 created 日期格式为 YYYY-MM-DD
   *   4. 将 date 字段迁移为 created 字段
   *   5. 检测 project 字段与目录结构的不一致
   *   6. 将孤立文件（根目录级别但有具体项目名的文件）移动到对应的项目目录
   *
   * 选项：
   *   -p, --project <name>  — 限定到特定项目
   *   --dry-run             — 预览模式
   *
   * 依赖：调用 normalizeWorkFiles() 执行规范化逻辑
   */
  work
    .command("normalize")
    .description(
      "Full normalization: fix types (→ Task/TechNote), strip Knowledge fields, " +
      "unify created format, move orphan files to project dirs"
    )
    .option("-p, --project <name>", "Limit to a specific project")
    .option("--dry-run", "Show what would change without writing", false)
    .action(async (opts) => {
      const ctx = buildContext(work.parent!.opts());

      console.log(
        `\n🔄 ${opts.dryRun ? "Previewing" : "Running"} full normalization...\n`
      );
      const results = await normalizeWorkFiles(ctx.vault.root, {
        project: opts.project,
        dryRun: opts.dryRun,
      });

      if (results.length === 0) {
        console.log("✅ All work files are already normalized.");
        return;
      }

      /** 统计总变更数 */
      let totalChanges = 0;
      for (const r of results) {
        console.log(`📄 ${r.file}`);
        for (const change of r.changes) {
          console.log(`   🔧 ${change}`);
          totalChanges++;
        }
        /** 如果文件被移动了，显示新路径 */
        if (r.moved) {
          console.log(`   📁 → ${r.moved}`);
        }
        console.log();
      }

      /** 输出汇总信息 */
      console.log("═".repeat(50));
      console.log(
        `Files changed: ${results.length} | Total changes: ${totalChanges}`
      );
      if (opts.dryRun) {
        console.log("\n⚠️  Dry run — no files were modified. Run without --dry-run to apply.");
      }
    });

  // ── work report ─────────────────────────────────────────────────────────
  /**
   * 子命令：work report
   * 功能：生成项目状态报告，提供所有项目的全局概览
   *
   * 输出内容：
   *   - 每个项目的文件数量和状态分布
   *   - 每个项目的阻塞项及其原因
   *   - 根目录下的孤立文件（不属于任何项目）
   *   - 总文件数和项目数
   *
   * 依赖：调用 generateReport() 生成报告数据
   */
  work
    .command("report")
    .description("Project status report — overview of all projects")
    .action(async () => {
      const ctx = buildContext(work.parent!.opts());

      console.log("\n📊 Work Projects Report\n");
      const report = await generateReport(ctx.vault.root);

      /** 遍历每个项目，输出状态分布 */
      for (const proj of report.projects) {
        /** 将状态分布对象转为 "状态:数量" 格式的字符串 */
        const statusLine = Object.entries(proj.statusBreakdown)
          .map(([s, c]) => `${s}:${c}`)
          .join(" ");
        console.log(`📁 ${proj.name} (${proj.fileCount} files)`);
        console.log(`   ${statusLine}`);

        // 显示被阻塞的项
        if (proj.blockedItems.length > 0) {
          console.log(`   ⛔ Blocked:`);
          for (const item of proj.blockedItems) {
            console.log(`      - ${item.file}: ${item.blocked_by}`);
          }
        }
        console.log();
      }

      /** 显示不属于任何项目的孤立文件 */
      if (report.orphanFiles.length > 0) {
        console.log(`📎 Root-level files (${report.orphanFiles.length}):`);
        for (const f of report.orphanFiles) {
          console.log(`  ${f.title} [${f.type || "no type"}]`);
        }
        console.log();
      }

      /** 输出总计信息 */
      console.log("═".repeat(50));
      console.log(
        `Total: ${report.totalFiles} files across ${report.totalProjects} projects`
      );
    });

  // ── work log ──────────────────────────────────────────────────────────────
  /**
   * 子命令：work log
   * 功能：向当日的 Obsidian 日记追加一条日志记录，可选择关联工作任务
   *
   * 参数：
   *   message — 日志消息内容
   *
   * 选项：
   *   -p, --project <name>  — 项目名称（用于定位任务文件）
   *   -t, --task <title>    — 任务标题（用于创建 wikilink 关联）
   *   --date <date>         — 日期（YYYY-MM-DD 格式），默认当天
   *   --icon <icon>         — 事件图标，默认 📝
   *   --tag <tag>           — 附加标签（可重复指定）
   *
   * 工作流程：
   *   1. 如果指定了 --task，在项目目录中查找对应的文件
   *   2. 读取任务文件信息，生成 wikilink
   *   3. 调用 appendEvent() 将日志条目追加到日记的 "## 日志" 区域
   *
   * 依赖：diary-bridge.ts 提供日记读写和任务查找功能
   */
  work
    .command("log")
    .description("Append a log entry to today's diary, optionally linked to a work task")
    .argument("<message>", "Log message")
    .option("-p, --project <name>", "Project name (for linking to a task)")
    .option("-t, --task <title>", "Task title (for linking)")
    .option("--date <date>", "Date (YYYY-MM-DD), default: today")
    .option("--icon <icon>", "Event icon", "📝")
    /** tag 选项支持重复指定，累加为数组 */
    .option("--tag <tag>", "Additional tag (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
    .action((message, opts) => {
      const ctx = buildContext(work.parent!.opts());
      const now = new Date();
      /** 确定目标日期：使用指定日期或当天 */
      const date = opts.date ? new Date(opts.date + "T00:00:00") : now;

      // 查找关联的任务文件
      const links: string[] = [];
      if (opts.task) {
        /**
         * 根据是否指定了项目名，选择不同的查找策略：
         * - 指定了项目：在该项目目录下精确查找
         * - 未指定项目：在所有项目中全局搜索
         */
        if (opts.project) {
          /** 指定了项目：精确查找，返回 string | null */
          const absPath = findTaskFile(ctx.vault.root, opts.project, opts.task);
          if (absPath) {
            const task = readTaskInfo(ctx.vault.root, absPath);
            if (task) links.push(task.wikilink);
          } else {
            console.warn(`⚠️  Task not found: ${opts.task}`);
          }
        } else {
          /** 未指定项目：全局搜索，返回 TaskInfo | null（已含 wikilink） */
          const task = findTaskFileGlobal(ctx.vault.root, opts.task);
          if (task) {
            links.push(task.wikilink);
          } else {
            console.warn(`⚠️  Task not found: ${opts.task}`);
          }
        }
      }

      // 追加日志事件到日记文件
      const tags = ["#log", ...opts.tag];
      const diaryPath = appendEvent(ctx.vault.root, date, {
        time: formatTime(now),
        icon: opts.icon,
        description: message,
        links,
        tags,
      });

      /** 输出确认信息 */
      const relDiary = relativeToVault(ctx.vault.root, diaryPath);
      console.log(`\n📝 Log entry added to ${relDiary}`);
      console.log(`   ${formatEventLine({ time: formatTime(now), icon: opts.icon, description: message, links, tags })}\n`);
    });

  // ── work status ────────────────────────────────────────────────────────────
  /**
   * 子命令：work status
   * 功能：更新任务文件的 status 字段，状态变更为 completed 时自动写入日记
   *
   * 参数：
   *   project — 项目名称
   *   title   — 任务标题
   *   status  — 新状态值（支持简写：planned/active/blocked/completed/archived）
   *
   * 特性：
   *   - 状态变更为 "🍂 Completed" 时，自动在当日日记追加完成事件
   *   - 事件格式：`- HH:MM ✅ 完成 [[任务wikilink]] #task`
   */
  /** 状态简写映射表 */
  const STATUS_SHORTCUTS: Record<string, string> = {
    planned: "🌱 Planned",
    active: "🌿 Active",
    blocked: "🚧 Blocked",
    completed: "🍂 Completed",
    archived: "🗃️ Archived",
  };

  work
    .command("status")
    .description("Update task status; auto-logs to diary on completion")
    .argument("<project>", "Project name")
    .argument("<title>", "Task title")
    .argument("<status>", "New status (planned | active | blocked | completed | archived)")
    .action((project, title, statusArg) => {
      const ctx = buildContext(work.parent!.opts());

      /** 解析状态值：支持简写和完整写法 */
      const newStatus = STATUS_SHORTCUTS[statusArg.toLowerCase()] ?? statusArg;

      /** 校验状态值 */
      const validStatuses = Object.values(STATUS_SHORTCUTS);
      if (!validStatuses.includes(newStatus)) {
        console.error(`\n❌ Invalid status: "${statusArg}"`);
        console.error(`   Valid values: ${Object.keys(STATUS_SHORTCUTS).join(" | ")}`);
        return;
      }

      /** 更新任务状态 */
      const result = updateTaskStatus(ctx.vault.root, project, title, newStatus);
      if (!result) {
        console.error(`\n❌ Task not found: ${project}/${title}`);
        return;
      }

      console.log(`\n📋 ${result.title}`);
      console.log(`   ${result.oldStatus || "(none)"} → ${result.newStatus}`);

      /** 状态变更为 completed 时，自动写入日记 */
      if (newStatus === "🍂 Completed") {
        const now = new Date();
        /** 构建 wikilink：使用 [[title]] 格式 */
        const wikilink = `[[${result.title}]]`;
        const diaryPath = appendEvent(ctx.vault.root, now, {
          time: formatTime(now),
          icon: "✅",
          description: `完成 ${wikilink}`,
          links: [],
          tags: ["#task"],
        });
        const relDiary = relativeToVault(ctx.vault.root, diaryPath);
        console.log(`\n📝 Diary: ${relDiary}`);
        console.log(`   ${formatEventLine({ time: formatTime(now), icon: "✅", description: `完成 ${wikilink}`, links: [], tags: ["#task"] })}`);
      }
    });

  return work;
}
