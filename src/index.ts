#!/usr/bin/env node
import { Command } from "commander";
import { workCommand } from "./commands/work.js";

const program = new Command();

program
  .name("work-engine")
  .description(
    "Project & task management engine for Obsidian vault — MOC-driven work tracking"
  )
  .version("1.0.0")
  .option(
    "--vault <path>",
    "vault root directory",
    process.env.OBSIDIAN_VAULT ?? process.cwd()
  )
  .option("--llm <provider>", "LLM provider: api | agent", "api")
  .option("--api-provider <name>", "API provider: anthropic | openai", "anthropic")
  .option("--model <name>", "LLM model name")
  .option("--api-key <key>", "API key (or set ANTHROPIC_AUTH_TOKEN / OPENAI_API_KEY)")
  .option("--verbose", "verbose output", false);

program.addCommand(workCommand());

program.parse();
