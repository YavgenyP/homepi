import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { IntentSchema, type Intent } from "../../discord/intent.schema.js";
import { parseIntent } from "../../discord/intent.parser.js";
import { matchesExpected, type EvalResult } from "./score.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET = path.resolve(__dirname, "../dataset/intents.jsonl");
const LIVE_MODE = process.env.EVAL_MODE === "live";

type GoldenEntry = {
  message: string;
  expected: Record<string, unknown>;
  fixture: Record<string, unknown>;
};

function loadDataset(): GoldenEntry[] {
  return fs
    .readFileSync(DATASET, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line) as GoldenEntry;
      } catch {
        throw new Error(`intents.jsonl line ${i + 1}: invalid JSON`);
      }
    });
}

async function evalEntry(
  entry: GoldenEntry,
  client: OpenAI | null,
  model: string
): Promise<EvalResult> {
  let actual: Intent | null = null;
  let error: string | null = null;

  try {
    if (LIVE_MODE && client) {
      actual = await parseIntent(entry.message, client, model);
    } else {
      actual = IntentSchema.parse(entry.fixture);
    }
  } catch (e) {
    error = String(e);
  }

  const schemaValid = actual !== null;

  const { pass, failures } = schemaValid
    ? matchesExpected(actual as unknown as Record<string, unknown>, entry.expected)
    : { pass: false, failures: ["schema validation failed"] };

  return {
    message: entry.message,
    schemaValid,
    correct: pass,
    failures,
    actual,
    error,
  };
}

async function main() {
  const entries = loadDataset();
  const model = process.env.LLM_MODEL ?? "gpt-4o";

  let client: OpenAI | null = null;
  if (LIVE_MODE) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      console.error("EVAL_MODE=live requires OPENAI_API_KEY");
      process.exit(1);
    }
    client = new OpenAI({ apiKey: key });
    console.log(`Running evals in LIVE mode (model: ${model})\n`);
  } else {
    console.log("Running evals in FIXTURE mode (no OpenAI calls)\n");
  }

  const results: EvalResult[] = [];
  for (const entry of entries) {
    const result = await evalEntry(entry, client, model);
    results.push(result);
  }

  const total = results.length;
  const schemaOk = results.filter((r) => r.schemaValid).length;
  const correct = results.filter((r) => r.correct).length;
  const failed = results.filter((r) => !r.correct);

  console.log(`Results: ${correct}/${total} correct, ${schemaOk}/${total} schema valid\n`);

  if (failed.length > 0) {
    console.log("Failures:");
    for (const r of failed) {
      console.log(`  [FAIL] "${r.message}"`);
      if (r.error) console.log(`         error: ${r.error}`);
      for (const f of r.failures) console.log(`         ${f}`);
    }
  } else {
    console.log("All evals passed.");
  }

  if (correct < total) process.exit(1);
}

main();
