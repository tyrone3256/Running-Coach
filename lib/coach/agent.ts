// Loop agen coach (manual tool-use loop di atas Messages API). Server-only: dipanggil dari route.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { detectRedFlagText, STOP_MESSAGE } from "@/lib/log/safety";
import { computeHold } from "@/lib/engine/rules";
import { executeTool, toolDefinitions, type CoachDeps, type ToolContext, type ToolEffect } from "./tools";
import { SYSTEM_STATIC, systemDynamic } from "./prompt";


type BetaParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
export type CreateMessage = (params: BetaParams) => Promise<Anthropic.Beta.BetaMessage>;

export const chatHistorySchema = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
})).min(1).max(40);
export type ChatTurn = z.infer<typeof chatHistorySchema>[number];

export interface CoachReply {
  text: string;
  effects: ToolEffect[];
  /** dijawab pre-filter keselamatan tanpa memanggil LLM */
  safetyStop: boolean;
  tools: string[];
}

export interface CoachOptions {
  deps: CoachDeps & { recordSafetyEvent(reasons: string[]): Promise<void> };
  createMessage: CreateMessage | null;
  model: string;
  today: string;
  /** batasi tool (mis. feedback log: tanpa ubah plan) */
  allowedTools?: string[];
  maxIterations?: number;
}

/** Model yang mendukung parameter server-side `fallbacks: "default"`. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1", "claude-sonnet-5-5"]);

export const NOT_CONFIGURED = "Coach AI belum aktif: ANTHROPIC_API_KEY belum diisi di server. Fitur lain (plan, log, engine) tetap jalan.";

export async function runCoach(history: ChatTurn[], opt: CoachOptions): Promise<CoachReply> {
  const last = history[history.length - 1];
  const effects: ToolEffect[] = [];

  // 1) Pre-filter keselamatan: deterministik, sebelum LLM. Red flag → STOP + hold.
  if (last.role === "user") {
    const flags = detectRedFlagText(last.content);
    if (flags.length) {
      await opt.deps.recordSafetyEvent(flags);
      return { text: `${STOP_MESSAGE}\n\nTerdeteksi: ${flags.join(", ")}.`, effects, safetyStop: true, tools: [] };
    }
  }
  if (!opt.createMessage) return { text: NOT_CONFIGURED, effects, safetyStop: false, tools: [] };

  const ctx: ToolContext = { deps: opt.deps, effects };
  const state = await opt.deps.loadState();
  ctx.state = state;
  const hold = computeHold(state);

  const tools = toolDefinitions.filter((t) => !opt.allowedTools || opt.allowedTools.includes(t.name)) as Anthropic.Beta.BetaTool[];
  if (tools.length) tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: "ephemeral" } };

  // API wajib diawali pesan user
  const firstUser = history.findIndex((m) => m.role === "user");
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(firstUser).map((m) => ({ role: m.role, content: m.content }));

  const used: string[] = [];
  const max = opt.maxIterations ?? 8;
  for (let i = 0; i < max; i++) {
    const params: BetaParams = {
      model: opt.model,
      max_tokens: 16000,
      system: [
        { type: "text", text: SYSTEM_STATIC, cache_control: { type: "ephemeral" } },
        { type: "text", text: systemDynamic(opt.today, hold) },
      ],
      tools,
      messages,
      output_config: { effort: "medium" },
      ...(FALLBACK_MODELS.has(opt.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };
    const res = await opt.createMessage(params);

    if (res.stop_reason === "refusal") {
      return { text: "Maaf, coach tidak bisa menjawab permintaan itu.", effects, safetyStop: false, tools: used };
    }
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      const cut = res.stop_reason === "max_tokens" ? "\n\n(jawaban terpotong)" : "";
      return { text: (text || "(tidak ada jawaban)") + cut, effects, safetyStop: false, tools: used };
    }
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const c of calls) {
      used.push(c.name);
      const r = !opt.allowedTools || opt.allowedTools.includes(c.name)
        ? await executeTool(c.name, c.input, ctx)
        : { content: `Tool ${c.name} tidak tersedia di mode ini`, isError: true };
      results.push({ type: "tool_result", tool_use_id: c.id, content: r.content, is_error: r.isError || undefined });
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "Coach butuh terlalu banyak langkah untuk pertanyaan ini. Coba persempit pertanyaannya.", effects, safetyStop: false, tools: used };
}
