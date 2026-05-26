import fs from "fs";
import { createLLM } from "../llm/factory.js";
import type { LLMOptions } from "../llm/factory.js";
import type { LLMProvider } from "../llm/provider.js";

export interface CLIContext {
  vault: { root: string };
  llm: LLMProvider | null;
  verbose: boolean;
}

/** Build CLI context from parent command options */
export function buildContext(opts: any): CLIContext {
  const vaultRoot: string = opts.vault ?? process.env.OBSIDIAN_VAULT ?? process.cwd();
  if (!fs.existsSync(vaultRoot)) {
    throw new Error(`Vault not found: ${vaultRoot}`);
  }

  const llmOpts: LLMOptions = {
    provider: opts.llm ?? "api",
    apiProvider: opts.apiProvider ?? "anthropic",
    model: opts.model,
    apiKey: opts.apiKey,
  };
  const llm = createLLM(llmOpts);

  return { vault: { root: vaultRoot }, llm, verbose: opts.verbose ?? false };
}

/** Require LLM — throw if not available */
export function requireLLM(ctx: CLIContext): LLMProvider {
  if (!ctx.llm) {
    throw new Error("This command requires an LLM provider. Set ANTHROPIC_AUTH_TOKEN or use --llm agent");
  }
  return ctx.llm;
}

/** Print a table row */
export function row(label: string, value: string | number, color?: string): void {
  const c = color ? `\x1b[${color}m` : "";
  const r = "\x1b[0m";
  console.log(`  ${c}${label.padEnd(24)}${r} ${value}`);
}
