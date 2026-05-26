import fs from "fs";
import path from "path";
import matter from "gray-matter";

// ── AST Parser ─────────────────────────────────────────────────────────────
// Parses Work files into structured data by extracting:
//   - Frontmatter: type, status, project, created, blocked_by
//   - Body stats: todo counts, heading counts, word count, knowledge links

export interface ParsedWorkFile {
  // Frontmatter
  title: string;
  type: string;
  status: string;
  project: string;
  created: string;
  blocked_by?: string;
  // Path
  relativePath: string;
  fileName: string;
  // Body stats
  todo_total: number;      // [!todo] 中 [ ] + [x] 总数
  todo_done: number;       // [x] 数量
  headings: number;        // ## 级别标题数
  words: number;           // 正文字数
  knowledge_links: string[];  // → 指向 Knowledge 的链接
}

/** Parse a single Work file via AST (frontmatter + body stats) */
export function parseWorkFileAST(
  vaultRoot: string,
  relativePath: string
): ParsedWorkFile | null {
  const abs = path.resolve(vaultRoot, relativePath);
  if (!fs.existsSync(abs)) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf-8");
  } catch {
    return null;
  }

  // ── Frontmatter AST ──
  let data: Record<string, unknown>;
  let content: string;

  try {
    ({ data, content } = matter(raw));
  } catch {
    // Broken YAML recovery
    let fixed = raw;
    fixed = fixed.replace(/^source::\s*/gm, "source: ");
    fixed = fixed.replace(/^related::\s*\n(?:\s+-\s+.+\n)*/gm, "");
    try {
      ({ data, content } = matter(fixed));
    } catch {
      return null;
    }
  }

  // ── Body AST ──
  // Todo items: match `- [ ]` and `- [x]` (inside or outside callouts)
  const todoAll = content.match(/- \[[ x]\]/g) ?? [];
  const todoDone = content.match(/- \[x\]/g) ?? [];

  // Headings: count `## ` level (h2)
  const headings = (content.match(/^##\s/gm) ?? []).length;

  // Word count: strip markdown syntax, count whitespace-separated tokens
  const plainText = content
    .replace(/[#>`\-\[\]()|*_~]/g, "")
    .replace(/!\[\[.*?\]\]/g, "")  // images
    .replace(/\[\[.*?\]\]/g, "")    // wikilinks
    .replace(/https?:\/\/\S+/g, "") // URLs
    .trim();
  const words = plainText.length > 0
    ? plainText.split(/\s+/).filter(w => w.length > 0).length
    : 0;

  // Knowledge links: extract `→ 50-Knowledge/...` references
  const knowledgeLinks: string[] = [];
  const linkMatches = content.matchAll(/→\s*(50-Knowledge\/[^\n\]]+)/g);
  for (const m of linkMatches) {
    knowledgeLinks.push(m[1].trim());
  }

  // ── Construct result ──
  const relFromWork = relativePath.replace(/^30-Projects\/Work\//, "");
  const parts = relFromWork.split("/");
  const project = parts.length > 1 ? parts[0] : "General";

  return {
    title: (data.title as string) ?? (data.name as string) ?? path.basename(relativePath, ".md"),
    type: (data.type as string) ?? "",
    status: (data.status as string) ?? "",
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
