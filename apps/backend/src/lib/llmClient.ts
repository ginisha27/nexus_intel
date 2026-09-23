// apps/backend/src/lib/llmClient.ts
//
// Unified LLM client routing to Groq or Gemini based on model selection.
//
// Groq production models (free tier, OpenAI-compatible):
//   openai/gpt-oss-120b   -- 500 t/s, 131K ctx
//   openai/gpt-oss-20b    -- ~1000 t/s, 131K ctx (fastest)
//   qwen/qwen3.6-27b      -- Groq's recommended replacement for the
//                            decommissioned Llama 3.3 70B / 3.1 8B models
//
// NOTE: llama-3.3-70b-versatile and llama-3.1-8b-instant were deprecated by
// Groq on 2026-06-17 and fully decommissioned on 2026-08-16 (see
// https://console.groq.com/docs/deprecations). Requests using them now
// return a 404 model_not_found. Do not re-add them here — use
// openai/gpt-oss-20b (Llama 3.1 8B replacement) or openai/gpt-oss-120b /
// qwen/qwen3.6-27b (Llama 3.3 70B replacement) instead.
//
// Gemini free-tier models (Google REST API, requires GEMINI_API_KEY):
//   gemini-flash-2.5-lite  -> gemini-3.5-flash-lite
//   gemini-flash-2.5       -> gemini-3.6-flash
//   gemini-flash-3.1-lite  -> gemini-3.1-flash-lite (stable GA, May 2026)

export class LlmError extends Error {}

export type SupportedModel =
  // Grok / OpenAI OSS (via Groq)
  | "openai/gpt-oss-120b"
  | "openai/gpt-oss-20b"
  // Qwen (via Groq) — replacement for decommissioned Llama 3.3 70B
  | "qwen/qwen3.6-27b"
  // Gemini
  | "gemini-flash-2.5-lite"
  | "gemini-flash-2.5"
  | "gemini-flash-3.1-lite";

  type GroqResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

export const MODEL_OPTIONS: { value: SupportedModel; label: string; group: string; note?: string }[] = [
  { value: "openai/gpt-oss-120b",     label: "GPT-OSS 120B",          group: "Grok",   note: "~500 t/s · best quality" },
  { value: "openai/gpt-oss-20b",      label: "GPT-OSS 20B",           group: "Grok",   note: "~1000 t/s · fastest" },
  { value: "qwen/qwen3.6-27b",        label: "Qwen 3.6 27B",          group: "Qwen",   note: "Groq's Llama 3.3 70B replacement" },
  { value: "gemini-flash-2.5-lite",   label: "Gemini Flash 2.5 Lite", group: "Gemini", note: "free tier" },
  { value: "gemini-flash-2.5",        label: "Gemini Flash 2.5",      group: "Gemini", note: "free tier" },
  { value: "gemini-flash-3.1-lite",   label: "Gemini Flash 3.1 Lite", group: "Gemini", note: "stable GA" },
];

export const DEFAULT_MODEL: SupportedModel = "openai/gpt-oss-120b";

function isGeminiModel(model: string): boolean {
  return model.startsWith("gemini-");
}

// Groq (OpenAI-compatible) --------------------------------------------------

const GROQ_API_BASE = "https://api.groq.com/openai/v1/chat/completions";

async function callGroq<T>(opts: {
  model: string;
  prompt: string;
  systemInstruction?: string;
}): Promise<T> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new LlmError("GROQ_API_KEY is not set");

  const messages: { role: "system" | "user"; content: string }[] = [];
  if (opts.systemInstruction) {
    messages.push({ role: "system", content: opts.systemInstruction });
  }
  messages.push({ role: "user", content: opts.prompt });

  let res: Response;
  try {
    res = await fetch(GROQ_API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    throw new LlmError(`Groq request failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LlmError(`Groq API returned ${res.status}: ${text.slice(0, 300)}`);
  }

const data = (await res.json().catch(() => {
  throw new LlmError("Groq response was not valid JSON at the HTTP level");
})) as GroqResponse;

const text = data?.choices?.[0]?.message?.content ?? undefined;
  if (!text) {
    const finishReason = data?.choices?.[0]?.finish_reason;
    throw new LlmError(
      finishReason && finishReason !== "stop"
        ? `Groq stopped with reason: ${finishReason}`
        : "Groq response had no text content"
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LlmError("Groq JSON-mode response could not be parsed");
  }
}

// Gemini (Google REST) -------------------------------------------------------

// Maps our stable slugs to the actual Gemini API model strings.
// Corrected per Google's own 404 error messages (June 2026).
const GEMINI_MODEL_MAP: Record<string, string> = {
  "gemini-flash-2.5-lite": "gemini-3.5-flash-lite",  // per Google 404: use gemini-3.5-flash-lite
  "gemini-flash-2.5":      "gemini-3.6-flash",        // per Google 404: use gemini-3.6-flash
  "gemini-flash-3.1-lite": "gemini-3.1-flash-lite",   // stable GA since May 2026
};

async function callGemini<T>(opts: {
  model: string;
  prompt: string;
  systemInstruction?: string;
}): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new LlmError("GEMINI_API_KEY is not set");

  const geminiModel = GEMINI_MODEL_MAP[opts.model] ?? opts.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: { responseMimeType: "application/json" },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LlmError(`Gemini request failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LlmError(`Gemini API returned ${res.status}: ${text.slice(0, 300)}`);
  }

const data = (await res.json().catch(() => {
  throw new LlmError("Gemini response was not valid JSON at the HTTP level");
})) as GeminiResponse;

  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new LlmError("Gemini response had no text content");

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LlmError("Gemini JSON response could not be parsed");
  }
}

// Public interface -----------------------------------------------------------

export interface LlmJsonCallOptions {
  model: SupportedModel;
  prompt: string;
  systemInstruction?: string;
}

/**
 * Routes to the correct provider based on model, calls with JSON mode,
 * and returns the parsed object. Throws LlmError on any failure.
 */
export async function callLlmForJson<T = unknown>(opts: LlmJsonCallOptions): Promise<T> {
  if (isGeminiModel(opts.model)) {
    return callGemini<T>(opts);
  }
  return callGroq<T>(opts);
}