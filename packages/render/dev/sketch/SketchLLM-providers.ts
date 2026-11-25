/**
 * P0 spike S1 — Gemini and Claude JSON calls, copied from `apps/server/src/llm/providers.ts` (the spike must not edit
 * the server) with what P3 adds to `JsonCall`: a larger output budget, temperature/seed for variants, optional images,
 * and the usage numbers. Same request shapes otherwise: Gemini `responseSchema`, Claude one forced tool.
 * Keys: `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` (environment or `<repo>/.env`); models: `REEL_GEMINI_MODEL` / `REEL_CLAUDE_MODEL`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Request, Schema } from './SketchLLM-prompt.ts';

export type Provider = 'gemini' | 'claude';
export const GEMINI_MODEL = 'gemini-3.8-flash';
export const CLAUDE_MODEL = 'claude-sonnet-5-5';
const TIMEOUT_MS = 180_000;
const REPO = resolve(import.meta.dirname, '../../../..');

export interface CallOptions {
  /** Output-token budget. A detail-5 sketch is ~1 200 points ≈ 5 k tokens; the server's 4 096 is too small. */
  maxTokens: number;
  temperature: number;
  /** Gemini only (Claude has no seed). */
  seed?: number;
  images?: { mime: string; base64: string }[];
}

export interface CallResult {
  raw: unknown;
  model: string;
  outputTokens: number | null;
  inputTokens: number | null;
}

/** Same rule as the server's `loadDotEnv`: `<repo>/.env` fills variables the environment does not define. */
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

export const KEY: Record<Provider, string> = { gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY' };

export function hasKey(p: Provider): boolean {
  return !!process.env[KEY[p]];
}

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

async function gemini(call: Request, o: CallOptions): Promise<CallResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.REEL_GEMINI_MODEL || GEMINI_MODEL;
  const parts: Record<string, unknown>[] = [
    ...(o.images ?? []).map((im) => ({ inlineData: { mimeType: im.mime, data: im.base64 } })),
    { text: call.prompt },
  ];
  const data = (await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': key },
    {
      systemInstruction: { parts: [{ text: call.system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: geminiSchema(call.schema),
        temperature: o.temperature,
        maxOutputTokens: o.maxTokens,
        ...(o.seed !== undefined ? { seed: o.seed } : {}),
      },
    },
    `gemini ${model}`,
  )) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { candidatesTokenCount?: number; promptTokenCount?: number; thoughtsTokenCount?: number };
  };
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error(`gemini ${model}: empty response (${cand?.finishReason ?? 'no candidate'})`);
  const u = data.usageMetadata;
  const out = u?.candidatesTokenCount === undefined ? null : u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`gemini ${model}: invalid JSON (${cand?.finishReason ?? '?'}, ${text.length} chars)`);
  }
  return { raw, model, outputTokens: out, inputTokens: u?.promptTokenCount ?? null };
}

async function claude(call: Request, o: CallOptions): Promise<CallResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const model = process.env.REEL_CLAUDE_MODEL || CLAUDE_MODEL;
  const content = o.images?.length
    ? [...o.images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } })), { type: 'text', text: call.prompt }]
    : call.prompt;
  const data = (await post(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: o.maxTokens,
      temperature: o.temperature,
      system: call.system,
      messages: [{ role: 'user', content }],
      tools: [{ name: call.name, description: 'Return the result.', input_schema: call.schema }],
      tool_choice: { type: 'tool', name: call.name },
    },
    `claude ${model}`,
  )) as { content?: { type: string; input?: unknown }[]; stop_reason?: string; usage?: { output_tokens?: number; input_tokens?: number } };
  const use = data.content?.find((c) => c.type === 'tool_use');
  if (!use?.input) throw new Error(`claude ${model}: no tool_use in the response (${data.stop_reason ?? '?'})`);
  if (data.stop_reason === 'max_tokens') throw new Error(`claude ${model}: hit max_tokens ${o.maxTokens}`);
  return { raw: use.input, model, outputTokens: data.usage?.output_tokens ?? null, inputTokens: data.usage?.input_tokens ?? null };
}

export function callJson(p: Provider, call: Request, o: CallOptions): Promise<CallResult> {
  return p === 'gemini' ? gemini(call, o) : claude(call, o);
}
