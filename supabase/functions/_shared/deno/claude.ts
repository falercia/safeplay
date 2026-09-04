/**
 * Adaptador mínimo para a Messages API da Anthropic (sem SDK, sem dependências).
 * Uma chamada curta e estruturada por análise, com timeout rígido.
 */
export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  model: string;
}

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
}

export function claudeConfigFromEnv(): ClaudeConfig | null {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  return {
    apiKey,
    model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5",
    timeoutMs: Number(Deno.env.get("LLM_TIMEOUT_MS") ?? 8000),
    maxTokens: Number(Deno.env.get("LLM_MAX_TOKENS") ?? 1400),
  };
}

export class ClaudeError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

export async function callClaude(cfg: ClaudeConfig, system: string, user: string, forceFailure = false): Promise<ClaudeResult> {
  if (forceFailure) throw new ClaudeError("forced_failure", "Falha forçada pelo apresentador");
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: 0,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const code = res.status === 429 ? "rate_limited" : res.status === 401 ? "unauthorized" : res.status >= 500 ? "provider_unavailable" : `http_${res.status}`;
      throw new ClaudeError(code);
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    return {
      text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - started,
      model: data.model ?? cfg.model,
    };
  } catch (e) {
    if (e instanceof ClaudeError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") throw new ClaudeError("timeout");
    throw new ClaudeError("network_error");
  } finally {
    clearTimeout(timer);
  }
}

/** Preço estimado por milhão de tokens (US$). Configurável por ambiente; padrão = Claude Haiku 4.5. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const inPerM = Number(Deno.env.get("LLM_PRICE_INPUT_PER_M") ?? (model.includes("haiku") ? 1 : model.includes("sonnet") ? 3 : 15));
  const outPerM = Number(Deno.env.get("LLM_PRICE_OUTPUT_PER_M") ?? (model.includes("haiku") ? 5 : model.includes("sonnet") ? 15 : 75));
  return Math.round(((inputTokens * inPerM + outputTokens * outPerM) / 1_000_000) * 1_000_000) / 1_000_000;
}
