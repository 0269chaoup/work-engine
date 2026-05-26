# work-engine

Project & task management engine for Obsidian vault — MOC-driven work tracking.

## Install

```bash
npm install
npm run build
npm link
```

## Usage

```bash
work-engine --vault ~/Documents/obsidian_cache work <command>
```

## Commands

| Command | Description |
|---------|-------------|
| `work create <project> <title>` | Create a new work note |
| `work validate` | Validate all work files |
| `work fix` | Fix missing/wrong frontmatter |
| `work normalize` | Full normalization (type/fields/format) |
| `work index` | Generate/update INDEX.md per project |
| `work archive <project>` | Archive project (compact TechNotes) |
| `work task create/template` | Task callout management |
| `work report` | Project status report |

## File Structure

```
30-Projects/Work/
├── INDEX.md                  # Root index
├── ProjectA/
│   ├── INDEX.md              # Project MOC
│   ├── Task1.md              # type: Task
│   └── Architecture.md       # type: TechNote
└── ProjectB/
    ├── INDEX.md
    └── ...
```

## Frontmatter

```yaml
---
title: "Task Title"
type: Task           # Task | TechNote
project: ProjectA
status: 🌱 Planned   # 🌱 Planned | 🌿 Active | 🚧 Blocked | 🍂 Completed | 🗃️ Archived
created: 2026-05-26
blocked_by: ""       # Optional: dependency
---
```
