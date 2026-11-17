import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@/lib/data/store";
import {
  applyCoachChange, loadState, processTrigger, proposeCoachChange, recordSafetyEvent, submitTest,
} from "@/lib/data/engine-service";
import { summarizeOutcome } from "@/lib/data/outcome";
import { todayIso } from "@/lib/dates";
import type { CoachOptions, CreateMessage } from "./agent";

/** Model dari env ANTHROPIC_MODEL; default Claude Opus 5.5. */
export const coachModel = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";

let client: Anthropic | null = null;
function createMessage(): CreateMessage | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ maxRetries: 2, timeout: 120_000 });
  return (params) => client!.beta.messages.create(params);
}

export function coachOptions(extra: Partial<CoachOptions> = {}): CoachOptions {
  return {
    model: coachModel(),
    today: todayIso(),
    createMessage: createMessage(),
    deps: {
      loadState: () => loadState(),
      async saveLog(input) {
        const { log, duplicate } = await getStore().saveLog(input);
        const outcome = duplicate ? null : summarizeOutcome(await processTrigger({ kind: "log", logId: log.id }));
        return { log, duplicate, outcome };
      },
      propose: proposeCoachChange,
      apply: applyCoachChange,
      submitTest,
      recordSafetyEvent: (reasons) => recordSafetyEvent(reasons),
    },
    ...extra,
  };
}
