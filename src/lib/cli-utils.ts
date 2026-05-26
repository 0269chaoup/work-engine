import fs from "fs";

export interface CLIContext {
  vault: { root: string };
  verbose: boolean;
}

/** Build CLI context from parent command options */
export function buildContext(opts: any): CLIContext {
  const vaultRoot: string = opts.vault ?? process.env.OBSIDIAN_VAULT ?? process.cwd();
  if (!fs.existsSync(vaultRoot)) {
    throw new Error(`Vault not found: ${vaultRoot}`);
  }
  return { vault: { root: vaultRoot }, verbose: opts.verbose ?? false };
}

/** Print a table row */
export function row(label: string, value: string | number, color?: string): void {
  const c = color ? `\x1b[${color}m` : "";
  const r = "\x1b[0m";
  console.log(`  ${c}${label.padEnd(24)}${r} ${value}`);
}
