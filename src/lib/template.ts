import type { ProjectAggregation } from "./aggregator.js";
import type { ParsedWorkFile } from "./ast-parser.js";

// ── Template ───────────────────────────────────────────────────────────────
// Renders ProjectAggregation into MOC-enhanced INDEX.md

const STATUS_ORDER = [
  "🚧 Blocked",
  "🌿 Active",
  "🌱 Planned",
  "🍂 Completed",
  "🗃️ Archived",
  "未标注",
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Render a single project INDEX.md */
export function renderIndex(agg: ProjectAggregation): string {
  const pct = Math.round(agg.completionRate * 100);
  const taskPct = agg.taskProgress.total > 0
    ? Math.round((agg.taskProgress.done / agg.taskProgress.total) * 100)
    : 0;

  const lines: string[] = [
    "---",
    `title: "${agg.name} 项目索引"`,
    "type: TechNote",
    `project: ${agg.name}`,
    "status: 🍂 Completed",
    `created: ${today()}`,
    `updated: ${today()}`,
    "---",
    "",
    `# ${agg.name}`,
    "",
    `> 📊 **${agg.totalFiles}** 个文档`,
  ];

  // Progress summary
  if (agg.taskProgress.total > 0) {
    lines.push(
      `> ✅ ${pct}% 完成 | 📋 任务 ${taskPct}%（${agg.taskProgress.done}/${agg.taskProgress.total}）`
    );
  } else {
    lines.push(`> ✅ ${pct}% 完成`);
  }

  // Blocked count
  if (agg.blockedItems.length > 0) {
    lines.push(`> ⛔ **${agg.blockedItems.length}** 个阻塞`);
  }
  lines.push("");

  // Status groups (ordered)
  const sortedStatuses = [...agg.statusBreakdown.entries()].sort(
    (a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0])
  );

  for (const [status, statusFiles] of sortedStatuses) {
    lines.push(`## ${status} (${statusFiles.length})`);
    lines.push("");

    const sorted = [...statusFiles].sort(
      (a, b) => String(b.created || "").localeCompare(String(a.created || ""))
    );

    for (const f of sorted) {
      const badge = f.type === "TechNote" ? " 📝" : "";
      const blocked =
        status === "🚧 Blocked" && f.blocked_by
          ? ` ⛔ ${f.blocked_by}`
          : "";
      const progress =
        f.todo_total > 0 ? ` (${f.todo_done}/${f.todo_total})` : "";
      lines.push(`- [[${f.fileName}]]${badge}${blocked}${progress}`);
    }
    lines.push("");
  }

  // TechNotes index (independent section)
  if (agg.techNotes.length > 0) {
    lines.push(`## 📚 TechNotes (${agg.techNotes.length})`);
    lines.push("");
    for (const t of agg.techNotes) {
      lines.push(`- [[${t.fileName}]] — ${t.created}`);
    }
    lines.push("");
  }

  // Blocked dependency chain
  if (agg.blockedItems.length > 0) {
    lines.push("## ⛔ 依赖链");
    lines.push("");
    for (const b of agg.blockedItems) {
      const chain =
        b.chain.length > 0 ? ` → ${b.chain.join(" → ")}` : "";
      lines.push(`- [[${b.file}]] ⛔ ${b.blocked_by}${chain}`);
    }
    lines.push("");
  }

  // Knowledge cross-links
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

/** Render the root-level INDEX.md (project directory listing) */
export function renderRootIndex(
  projects: { name: string; fileCount: number }[]
): string {
  const sorted = [...projects].sort((a, b) => b.fileCount - a.fileCount);
  const total = sorted.reduce((s, p) => s + p.fileCount, 0);

  const lines: string[] = [
    "---",
    'title: "Work 项目总索引"',
    "type: TechNote",
    "project: General",
    "status: 🍂 Completed",
    `created: ${today()}`,
    `updated: ${today()}`,
    "---",
    "",
    "# Work 项目总索引",
    "",
    `> 📊 **${total}** 个文档，**${sorted.length}** 个项目`,
    "",
    "## 项目列表",
    "",
  ];

  for (const p of sorted) {
    lines.push(`- [[${p.name}/INDEX|${p.name}]] — ${p.fileCount} 个文档`);
  }
  lines.push("");

  return lines.join("\n");
}
