import { glob } from "glob";
import { parseWorkFileAST, type ParsedWorkFile } from "./ast-parser.js";

// ── Aggregator ─────────────────────────────────────────────────────────────
// Collects parsed files into project-level aggregations for MOC rendering.

export interface ProjectAggregation {
  name: string;
  totalFiles: number;
  // Status distribution
  statusBreakdown: Map<string, ParsedWorkFile[]>;
  // Progress
  completionRate: number;       // Completed / (Total - Archived)
  taskProgress: { total: number; done: number };  // [!todo] completion
  // Blocked dependency chain
  blockedItems: {
    file: string;
    blocked_by: string;
    chain: string[];
  }[];
  // Classified files
  techNotes: ParsedWorkFile[];  // type=TechNote, sorted by created desc
  tasks: ParsedWorkFile[];      // type=Task, sorted by status
  // Knowledge cross-links
  knowledgeLinks: string[];
}

const STATUS_ORDER = [
  "🚧 Blocked",
  "🌿 Active",
  "🌱 Planned",
  "🍂 Completed",
  "🗃️ Archived",
  "未标注",
];

const WORK_DIR = "30-Projects/Work";

/** Scan all Work files and parse them via AST */
export async function scanWorkFilesAST(vaultRoot: string): Promise<ParsedWorkFile[]> {
  const exclude = [".obsidian", ".git", ".trash", "node_modules"];
  const pattern = `${WORK_DIR}/**/*.md`;
  const files = await glob(pattern, {
    cwd: vaultRoot,
    ignore: exclude.map(d => `**/${d}/**`),
    absolute: false,
  });

  return files
    .filter(f => !f.endsWith("INDEX.md"))
    .map(f => parseWorkFileAST(vaultRoot, f))
    .filter(Boolean) as ParsedWorkFile[];
}

/** Aggregate files into per-project summaries */
export function aggregateByProject(
  files: ParsedWorkFile[]
): Map<string, ProjectAggregation> {
  const byProject = new Map<string, ParsedWorkFile[]>();

  for (const f of files) {
    const existing = byProject.get(f.project) ?? [];
    existing.push(f);
    byProject.set(f.project, existing);
  }

  const result = new Map<string, ProjectAggregation>();

  for (const [name, projectFiles] of byProject) {
    // Status breakdown
    const statusBreakdown = new Map<string, ParsedWorkFile[]>();
    for (const f of projectFiles) {
      const st = f.status || "未标注";
      const existing = statusBreakdown.get(st) ?? [];
      existing.push(f);
      statusBreakdown.set(st, existing);
    }

    // Completion rate: Completed / (Total - Archived)
    const archived = statusBreakdown.get("🗃️ Archived")?.length ?? 0;
    const completed = statusBreakdown.get("🍂 Completed")?.length ?? 0;
    const nonArchived = projectFiles.length - archived;
    const completionRate = nonArchived > 0 ? completed / nonArchived : 0;

    // Task progress: aggregate [!todo] counts
    let todoTotal = 0;
    let todoDone = 0;
    for (const f of projectFiles) {
      todoTotal += f.todo_total;
      todoDone += f.todo_done;
    }

    // Blocked items with dependency chain tracking
    const blockedFiles = statusBreakdown.get("🚧 Blocked") ?? [];
    const blockedItems = blockedFiles.map(f => ({
      file: f.title,
      blocked_by: f.blocked_by ?? "",
      chain: resolveBlockedChain(f, projectFiles),
    }));

    // TechNotes: sorted by created desc
    const techNotes = projectFiles
      .filter(f => f.type === "TechNote")
      .sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));

    // Tasks: sorted by status priority
    const tasks = projectFiles
      .filter(f => f.type === "Task")
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

    // Knowledge cross-links (deduplicated)
    const knowledgeLinks = [
      ...new Set(projectFiles.flatMap(f => f.knowledge_links)),
    ];

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

/** Resolve blocked_by dependency chain (max depth 10 to prevent cycles) */
function resolveBlockedChain(
  file: ParsedWorkFile,
  allFiles: ParsedWorkFile[],
  depth = 0
): string[] {
  if (depth > 10 || !file.blocked_by) return [];

  const blocker = allFiles.find(
    f => f.title === file.blocked_by || f.fileName === file.blocked_by
  );

  if (!blocker) return [file.blocked_by];

  if (blocker.blocked_by) {
    return [blocker.title, ...resolveBlockedChain(blocker, allFiles, depth + 1)];
  }

  return [blocker.title];
}
