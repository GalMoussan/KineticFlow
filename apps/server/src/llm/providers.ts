/**
 * LLM providers behind one call: JSON out, constrained by a JSON schema (PLAN.md §11). `fetch` only, no SDKs.
 * - Gemini: REST `generateContent` with `responseMimeType: application/json` + `responseSchema`.
 * - Claude: Messages API with one forced tool whose `input_schema` is the schema.
 * Keys come from `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` (also read from `<repo>/.env`); models from
 * `REEL_GEMINI_MODEL` / `REEL_CLAUDE_MODEL`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmProvider } from '@reel/api';
import { REPO } from '../paths.ts';

export const GEMINI_MODEL = 'gemini-3.8-flash';
export const CLAUDE_MODEL = 'claude-sonnet-5-5';
const TIMEOUT_MS = 30_000;

/** A JSON-schema subset both providers accept: object/array/string/number/integer/boolean, enum, required. */
export interface Schema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  items?: Schema;
}

/** Sets variables from `<repo>/.env` (KEY=VALUE lines) that the environment does not already define. */
export function loadDotEnv(path = join(REPO, '.env')): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
  }
}

/** Providers with a key, Gemini first. */
export function configuredProviders(): LlmProvider[] {
  return [...(process.env.GEMINI_API_KEY ? ['gemini' as const] : []), ...(process.env.ANTHROPIC_API_KEY ? ['claude' as const] : [])];
}

export interface JsonCall {
  system: string;
  prompt: string;
  schema: Schema;
  /** Tool name (Claude) / label in errors. */
  name: string;
}

/** Gemini's schema dialect: OpenAPI type names in upper case. */
function geminiSchema(s: Schema): Record<string, unknown> {
  return {
    type: s.type.toUpperCase(),
    ...(s.description ? { description: s.description } : {}),
    ...(s.enum ? { enum: s.enum } : {}),
    ...(s.properties ? { properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, geminiSchema(v)])) } : {}),
    ...(s.required ? { required: s.required } : {}),
    ...(s.items ? { items: geminiSchema(s.items) } : {}),
  };
}

async function post(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as unknown;
}

async function gemini(call: JsonCall): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.REEL_GEMINI_MODEL || GEMINI_MODEL;
  const data = (await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': key },
    {
      systemInstruction: { parts: [{ text: call.system }] },
      contents: [{ role: 'user', parts: [{ text: call.prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: geminiSchema(call.schema), temperature: 0.4 },
    },
    `gemini ${model}`,
  )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error(`gemini ${model}: empty response`);
  return JSON.parse(text) as unknown;
}

async function claude(call: JsonCall): Promise<unknown> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const model = process.env.REEL_CLAUDE_MODEL || CLAUDE_MODEL;
  const data = (await post(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: 4096,
      system: call.system,
      messages: [{ role: 'user', content: call.prompt }],
      tools: [{ name: call.name, description: 'Return the result.', input_schema: call.schema }],
      tool_choice: { type: 'tool', name: call.name },
    },
    `claude ${model}`,
  )) as { content?: { type: string; input?: unknown }[] };
  const use = data.content?.find((c) => c.type === 'tool_use');
  if (!use?.input) throw new Error(`claude ${model}: no tool_use in the response`);
  return use.input;
}

export function callJson(provider: LlmProvider, call: JsonCall): Promise<unknown> {
  return provider === 'gemini' ? gemini(call) : claude(call);
}
