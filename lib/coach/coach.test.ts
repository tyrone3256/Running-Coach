import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { runCoach, NOT_CONFIGURED, type CoachOptions, type CreateMessage } from "./agent";
import { TOOLS, executeTool, toolDefinitions, type CoachDeps, type ToolContext } from "./tools";
import { buildCoachAction } from "./actions";
import { STOP_MESSAGE } from "@/lib/log/safety";
import { computeHold } from "@/lib/engine/rules";
import { applyChanges } from "@/lib/engine/snapshot";
import { plannedZ4Minutes } from "@/lib/engine/pace";
import { baseSnapshot, mkLog, mkState, session } from "@/test/engine-fixtures";
import type { EngineState } from "@/lib/engine/model";

// ------------------------------------------------------------------ helper mock LLM
type Msg = Anthropic.Beta.BetaMessage;
const msg = (content: Msg["content"], stop_reason: Msg["stop_reason"]): Msg =>
  ({ id: "m", type: "message", role: "assistant", model: "x", content, stop_reason, stop_sequence: null, usage: {} } as unknown as Msg);
const text = (t: string) => msg([{ type: "text", text: t, citations: null } as never], "end_turn");
const call = (name: string, input: unknown, id = `tu_${name}`) =>
  msg([{ type: "tool_use", id, name, input } as never], "tool_use");

function scripted(...replies: Msg[]) {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const fn: CreateMessage = vi.fn(async (p) => {
    calls.push(structuredClone(p));
    const r = replies.shift();
    if (!r) throw new Error("script habis");
    return r;
  });
  return { fn, calls };
}

function fakeDeps(st: EngineState, over: Partial<CoachDeps> = {}) {
  const recordSafetyEvent = vi.fn(async () => {});
  const deps = {
    loadState: async () => st,
    saveLog: vi.fn(),
    propose: vi.fn(async (i) => ({ id: "chg-1", mode: "pending", size: i.size, title: i.title, diff: [], ...i })),
    apply: vi.fn(async () => ({ ok: true })),
    submitTest: vi.fn(),
    recordSafetyEvent,
    ...over,
  } as unknown as CoachOptions["deps"];
  return deps;
}

const opts = (st: EngineState, createMessage: CreateMessage | null, over: Partial<CoachOptions> = {}): CoachOptions => ({
  deps: fakeDeps(st), createMessage, model: "claude-opus-5-5", today: st.today, ...over,
});

const TODAY = "2027-01-04"; // Senin W07

// ------------------------------------------------------------------ keselamatan
describe("coach: pre-filter keselamatan (sebelum LLM)", () => {
  it.each([
    "tadi pas tempo nyeri dada, lanjut besok?",
    "Dada terasa sesak dan tertekan waktu rep 2",
    "hampir pingsan di km 8",
    "jantung berdebar tidak teratur setelah interval",
  ])("'%s' → STOP + rujuk dokter, LLM tidak dipanggil, hold dicatat", async (q) => {
    const st = mkState({ today: TODAY });
    const llm = scripted(text("saran latihan"));
    const o = opts(st, llm.fn);
    const r = await runCoach([{ role: "user", content: q }], o);
    expect(r.safetyStop).toBe(true);
    expect(r.text).toContain(STOP_MESSAGE);
    expect(r.text).toMatch(/dokter/);
    expect(r.text).toMatch(/EKG/);
    expect(llm.fn).not.toHaveBeenCalled();
    expect(o.deps.recordSafetyEvent).toHaveBeenCalledOnce();
  });

  it("STOP tetap jalan walau API key tidak ada", async () => {
    const st = mkState({ today: TODAY });
    const r = await runCoach([{ role: "user", content: "nyeri dada" }], opts(st, null));
    expect(r.safetyStop).toBe(true);
  });

  it("tanpa API key & tanpa red flag → pesan belum aktif", async () => {
    const st = mkState({ today: TODAY });
    const r = await runCoach([{ role: "user", content: "sesi hari ini apa?" }], opts(st, null));
    expect(r.text).toBe(NOT_CONFIGURED);
  });

  it("'berat di tempo, HR 172' bukan red flag → diteruskan ke LLM", async () => {
    const st = mkState({ today: TODAY });
    const llm = scripted(text("Itu normal di threshold."));
    const r = await runCoach([{ role: "user", content: "tempo tadi berat, HR 172, napas ngos-ngosan" }], opts(st, llm.fn));
    expect(r.safetyStop).toBe(false);
    expect(llm.fn).toHaveBeenCalledOnce();
  });

  it("red flag dari chat ikut memicu hold sampai clearance", () => {
    const st = mkState({ today: TODAY, safety_events: [{ created_at: "2027-01-04T01:00:00Z", date: TODAY, reasons: ["nyeri dada"], source: "chat" }] });
    expect(computeHold(st)).toMatchObject({ active: true, reasons: ["nyeri dada"] });
    expect(computeHold({ ...st, clearances: ["2027-01-05T00:00:00Z"] }).active).toBe(false);
  });

  it("saat hold aktif, propose_plan_change ditolak", async () => {
    const st = mkState({ today: TODAY, safety_events: [{ created_at: "2027-01-04T01:00:00Z", date: TODAY, reasons: ["pingsan"], source: "chat" }] });
    const ctx: ToolContext = { deps: fakeDeps(st), effects: [] };
    const r = await executeTool("propose_plan_change", { change: { action: "make_easy", session_id: "W07-thu" }, reason: "capek sekali" }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/ditahan/);
    expect(ctx.deps.propose).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ loop & request
describe("coach: loop tool use", () => {
  it("menjalankan tool, mengirim tool_result, lalu menjawab", async () => {
    const st = mkState({ today: TODAY });
    const llm = scripted(call("explain_session", { date: "2027-01-07" }), text("Kamis: tempo."));
    const r = await runCoach([{ role: "user", content: "Kamis ngapain?" }], opts(st, llm.fn));
    expect(r.text).toBe("Kamis: tempo.");
    expect(r.tools).toEqual(["explain_session"]);
    const second = llm.calls[1].messages;
    const last = second[second.length - 1];
    const block = (last.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(block.type).toBe("tool_result");
    const out = JSON.parse(block.content as string);
    expect(out.id).toBe("W07-thu");
    expect(out.cue_hr170?.length).toBeGreaterThan(0);
  });

  it("input tool tidak valid → tool_result is_error, tanpa crash", async () => {
    const st = mkState({ today: TODAY });
    const llm = scripted(call("get_plan", { from: "besok" }), text("ok"));
    await runCoach([{ role: "user", content: "plan?" }], opts(st, llm.fn));
    const res = (llm.calls[1].messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(res.is_error).toBe(true);
  });

  it("request: model dari opsi, fallback default, effort, prompt di-cache, tanpa tool_choice paksa/thinking disabled", async () => {
    const st = mkState({ today: TODAY });
    const llm = scripted(text("hai"));
    await runCoach([{ role: "user", content: "halo" }], opts(st, llm.fn, { model: "claude-opus-5-5" }));
    const p = llm.calls[0];
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.tool_choice).toBeUndefined();
    expect(p.thinking).toBeUndefined();
    expect(p.output_config?.effort).toBe("medium");
    expect((p.system as Array<{ cache_control?: unknown }>)[0].cache_control).toBeTruthy();
  });

  it("model lain (env) tanpa parameter fallback", async () => {
    const st = mkState({ today: TODAY });
    const llm = scripted(text("hai"));
    await runCoach([{ role: "user", content: "halo" }], opts(st, llm.fn, { model: "claude-haiku-5-5" }));
    expect((llm.calls[0] as unknown as Record<string, unknown>).fallbacks).toBeUndefined();
  });

  it("refusal → pesan sopan, bukan crash", async () => {
    const st = mkState({ today: TODAY });
    const llm = scripted(msg([], "refusal"));
    const r = await runCoach([{ role: "user", content: "x" }], opts(st, llm.fn));
    expect(r.text).toMatch(/tidak bisa/);
  });

  it("mode feedback: tool ubah plan tidak dikirim & ditolak bila dipanggil", async () => {
    const st = mkState({ today: TODAY });
    const llm = scripted(call("apply_plan_change", { change_id: "x" }), text("ok"));
    const o = opts(st, llm.fn, { allowedTools: ["get_logs"] });
    await runCoach([{ role: "user", content: "feedback" }], o);
    expect(llm.calls[0].tools!.map((t) => (t as { name: string }).name)).toEqual(["get_logs"]);
    expect(o.deps.apply).not.toHaveBeenCalled();
  });

  it("riwayat diawali pesan assistant → dipotong sampai pesan user pertama", async () => {
    const st = mkState({ today: TODAY });
    const llm = scripted(text("ok"));
    await runCoach([{ role: "assistant", content: "hai" }, { role: "user", content: "halo" }], opts(st, llm.fn));
    expect(llm.calls[0].messages[0].role).toBe("user");
  });
});

// ------------------------------------------------------------------ definisi tool
describe("coach: definisi tool", () => {
  it("11 tool sesuai SPEC, schema object tanpa $schema", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "apply_plan_change", "explain_session", "get_athlete_profile", "get_logs", "get_metrics", "get_plan",
      "get_readiness", "get_z4_tolerance", "log_workout", "propose_plan_change", "recalc_from_test",
    ]);
    for (const t of toolDefinitions) {
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema).not.toHaveProperty("$schema");
    }
  });

  it("get_logs menandai cadence lock (HR 172 = cadence 172, pergelangan)", async () => {
    const st = mkState({ today: TODAY, logs: [mkLog({ date: "2027-01-03", avg_hr: 172, avg_cadence: 172, hr_source: "wrist" })] });
    const r = await executeTool("get_logs", {}, { deps: fakeDeps(st), effects: [] });
    expect(JSON.parse(r.content).logs[0].sensor_curiga).toMatch(/cadence/i);
  });

  it("get_athlete_profile memuat LTHR, zona bpm, dan pace profile", async () => {
    const st = mkState({ today: TODAY });
    const out = JSON.parse((await executeTool("get_athlete_profile", {}, { deps: fakeDeps(st), effects: [] })).content);
    expect(out.lthr).toBe(170);
    expect(out.zona_hr).toHaveLength(5);
    expect(out.pace_profile.E).toBe("5:50–6:30");
  });
});

// ------------------------------------------------------------------ aksi perubahan (deterministik)
describe("coach: aksi perubahan plan", () => {
  const snap = baseSnapshot();

  it("tempo Kamis tidak bisa dipindah ke Jumat (H-1 long run)", () => {
    for (const s of snap.sessions.filter((x) => x.day === "thu" && x.is_hard)) {
      const fri = new Date(`${s.date}T00:00:00Z`);
      fri.setUTCDate(fri.getUTCDate() + 1);
      const r = buildCoachAction(snap, { action: "move", session_id: s.id, to_date: fri.toISOString().slice(0, 10) }, "2026-11-17");
      expect(r.ok, s.id).toBe(false);
    }
  });

  it("split_reps menjaga total menit Z4", () => {
    const s = snap.sessions.find((x) => x.type === "tempo" && x.z4_target_min && x.z4_target_min >= 20)!;
    const r = buildCoachAction(snap, { action: "split_reps", session_id: s.id, rep_min: 5 }, "2026-11-17");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = applyChanges(snap, r.changes);
    expect(Math.round(plannedZ4Minutes(session(after, s.id), after.paceProfile))).toBe(s.z4_target_min);
    expect(r.size).toBe("small");
  });

  it("mempercepat pace selalu large; memperlambat ≤10 dtk small", () => {
    const fast = buildCoachAction(snap, { action: "shift_pace", codes: ["E"], delta_s: -5 }, "2026-11-17");
    const slow = buildCoachAction(snap, { action: "shift_pace", codes: ["E", "L"], delta_s: 10 }, "2026-11-17");
    expect(fast.ok && fast.size).toBe("large");
    expect(slow.ok && slow.size).toBe("small");
  });

  it("sesi yang sudah lewat tidak bisa diubah", () => {
    const r = buildCoachAction(snap, { action: "make_easy", session_id: "W01-thu" }, "2027-01-04");
    expect(r.ok).toBe(false);
  });

  it("rest & pindah tanggal = large", () => {
    const rest = buildCoachAction(snap, { action: "rest", session_id: "W07-wed" }, TODAY);
    expect(rest.ok && rest.size).toBe("large");
  });
});

// ------------------------------------------------------------------ integrasi engine-service (file store)
describe("coach: usulan & penerapan lewat engine-service", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rc-coach-"));
  beforeAll(() => { process.env.LOCAL_DATA_DIR = dir; });
  afterAll(() => { delete process.env.LOCAL_DATA_DIR; rmSync(dir, { recursive: true, force: true }); });

  it("small: pending → apply_plan_change → versi baru; large: apply ditolak", async () => {
    const svc = await import("@/lib/data/engine-service");
    const { getPlanStore } = await import("@/lib/data/plan-store");
    const snap0 = await getPlanStore().getActive();
    const small = buildCoachAction(snap0, { action: "make_easy", session_id: "W02-thu" }, "2026-11-17");
    if (!small.ok) throw new Error(small.error);
    const rec = await svc.proposeCoachChange({ ...small, reason: "test" });
    expect(rec.mode).toBe("pending");
    expect((await getPlanStore().getActive()).version).toBe(snap0.version); // belum berubah
    expect((await svc.applyCoachChange(rec.id)).ok).toBe(true);
    const after = await getPlanStore().getActive();
    expect(after.version).toBe(snap0.version + 1);
    expect(session(after, "W02-thu").is_hard).toBe(false);

    const large = buildCoachAction(after, { action: "rest", session_id: "W02-wed" }, "2026-11-17");
    if (!large.ok) throw new Error(large.error);
    const rec2 = await svc.proposeCoachChange({ ...large, reason: "test" });
    await expect(svc.applyCoachChange(rec2.id)).rejects.toThrow(/disetujui atlet/);
  });

  it("chat red flag tersimpan & mengaktifkan hold di loadState", async () => {
    const svc = await import("@/lib/data/engine-service");
    await svc.recordSafetyEvent(["nyeri dada"], "2026-11-17");
    expect(computeHold(await svc.loadState("2026-11-17")).active).toBe(true);
  });
});
