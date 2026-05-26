# work-engine

Project & task management engine for Obsidian vault — action-oriented work tracking, decoupled from knowledge.

> Companion to [wiki-engine](https://github.com/0269chaoup/wiki-engine). Work = action (怎么做/做了什么). Knowledge = reference (是什么/为什么).

## Install

```bash
git clone git@github.com:0269chaoup/work-engine.git
cd work-engine
npm install
npm run build
npm link
```

## Quick Start

```bash
# Create a work note
work-engine --vault ~/Documents/obsidian_cache work create MyProject "Architecture Design"

# Validate all work files
work-engine --vault ~/Documents/obsidian_cache work validate

# Generate MOC-enhanced INDEX.md per project
work-engine --vault ~/Documents/obsidian_cache work index

# Full normalization (type/fields/format)
work-engine --vault ~/Documents/obsidian_cache work normalize

# Project status report
work-engine --vault ~/Documents/obsidian_cache work report
```

## Commands

| Command | Description | LLM? |
|---------|-------------|------|
| `work create <project> <title>` | Create a new work note with proper frontmatter | No |
| `work validate` | Validate all work files — frontmatter, type, status | No |
| `work fix` | Fix missing/wrong frontmatter (auto-migrate old status) | No |
| `work normalize` | Full normalization: fix types, strip Knowledge fields, unify format, move orphan files | No |
| `work index` | Generate/update MOC-enhanced INDEX.md per project | No |
| `work archive <project>` | Archive project (compact TechNotes into post-mortem) | No |
| `work task create/template` | Task callout management | No |
| `work report` | Project status report — overview of all projects | No |

## File Structure

```
30-Projects/Work/
├── INDEX.md                  # Root index (auto-generated)
├── ProjectA/
│   ├── INDEX.md              # Project MOC (status, progress, TechNote index)
│   ├── Task1.md              # type: Task
│   ├── Architecture.md       # type: TechNote
│   └── POSTMORTEM.md         # Archived TechNotes (compact)
└── ProjectB/
    ├── INDEX.md
    └── ...
```

## Frontmatter

### Task

```yaml
---
title: "Task Title"
type: Task
project: ProjectA
status: 🌱 Planned   # 🌱 Planned | 🌿 Active | 🚧 Blocked | 🍂 Completed | 🗃️ Archived
created: 2026-05-27
blocked_by: ""       # Optional: dependency
---
```

### TechNote

```yaml
---
title: "Architecture Decision"
type: TechNote
project: ProjectA
status: 🌿 Active
created: 2026-05-27
---
```

### Status Lifecycle

```
🌱 Planned → 🌿 Active → 🍂 Completed → 🗃️ Archived
                ↓
            🚧 Blocked (with blocked_by)
```

## Task Format

Tasks use Obsidian callout syntax:

```markdown
> [!todo] 任务组名
> - **前端**
>   - [ ] 组件 A 开发
>   - [ ] 组件 B 开发
> - **后端**
>   - [ ] API 接口
```

## MOC-Enhanced INDEX.md

`work index` generates a rich project dashboard:

- **Status grouping** — Active/Planned/Blocked/Completed sections
- **Progress stats** — completion percentage, file counts
- **Blocked dependency chain** — tracks what's blocking what
- **TechNote index** — all technical notes with status
- **Knowledge cross-links** — wikilinks to related wiki-engine content

## Architecture

```
src/
├── index.ts              # CLI entry (with LLM options)
├── commands/
│   └── work.ts           # 8 subcommands
├── lib/
│   ├── work.ts           # Core logic (types, validation, normalization)
│   ├── cli-utils.ts      # CLI helpers (LLM integration)
│   ├── ast-parser.ts     # AST parser (frontmatter + body)
│   ├── aggregator.ts     # In-memory project aggregation + dependency tracking
│   └── template.ts       # MOC template rendering
└── llm/                  # LLM integration (same pattern as wiki-engine)
    ├── provider.ts       # Interface
    ├── api-provider.ts   # Direct API
    ├── pipe-provider.ts  # Agent pipe protocol
    └── factory.ts        # Provider factory
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Only `Task` and `TechNote` types | Simplified from 16 types — normalize auto-maps old types |
| No `domain` or `tags` fields | Work files are action-oriented, not knowledge-classified |
| Status 5-state model | Planned → Active → Blocked → Completed → Archived |
| Pure semantic naming | No timestamps in filenames — time lives in YAML `created` |
| Decoupled from wiki-engine | Work = action. Knowledge = reference. Independent CLIs, independent repos. |

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `gray-matter` | YAML frontmatter parsing |
| `glob` | File pattern matching |
| `chalk` | Terminal colors |
| `cli-table3` | Table output |

## License

GPL-3.0
