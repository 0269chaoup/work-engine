/**
 * @file lib/diary-bridge.ts — 日记文件读写桥接模块（re-export 包装器）
 *
 * 本文件是 work-engine 与 Obsidian 日记系统之间的桥接层。
 * 所有共享逻辑已迁移至 @hermes/vault-utils 包，此处仅做 re-export，
 * 保持现有 import 路径不变，避免其他文件需要修改。
 *
 * @see @hermes/vault-utils — 共享工具库
 */

export {
  // ── Constants ──
  DAILY_DIR,
  WORK_DIR,

  // ── ISO Week & Date Formatting ──
  getISOWeek,
  formatDate,
  formatTime,

  // ── Path Helpers ──
  getDiaryPath,
  relativeToVault,
  toWikilink,

  // ── Task File Lookup ──
  findTaskFile,
  findTaskFileGlobal,
  readTaskInfo,

  // ── Event Format ──
  EVENT_ICONS,
  formatEventLine,

  // ── Diary File Operations ──
  ensureDiary,
  appendEvent,
} from "@hermes/vault-utils";

export type {
  DiaryEvent,
} from "@hermes/vault-utils";
