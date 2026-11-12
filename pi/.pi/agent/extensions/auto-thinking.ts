/**
 * Auto-Thinking Extension for Pi
 *
 * Dynamically adjusts reasoning effort (thinking level) on a turn-by-turn basis
 * based on task complexity, active skills, and domain signals, while keeping the
 * active model sticky to preserve prompt caches.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

type ThinkingTier = "off" | "minimal" | "low" | "medium" | "high";

interface EvaluationResult {
  level: ThinkingTier;
  reason: string;
}

/** Evaluate task complexity from prompt text and intent cues */
function evaluatePromptComplexity(text: string): EvaluationResult {
  const lower = text.toLowerCase().trim();

  // 1. Skill Invocations
  if (lower.startsWith("/skill:garv") || lower.includes("garv")) {
    return { level: "high", reason: "garv bug hunting" };
  }
  if (lower.startsWith("/skill:brainstorming") || lower.includes("brainstorming")) {
    return { level: "medium", reason: "brainstorming design" };
  }
  if (lower.startsWith("/skill:ogur") || lower.includes("ogur")) {
    return { level: "low", reason: "ogur minimal dev" };
  }
  if (lower.startsWith("/skill:delta-checker") || lower.includes("delta-checker")) {
    return { level: "low", reason: "delta-checker diff review" };
  }

  // 2. Hardware / SID Disambiguation (Lookup vs Deep Debugging)
  if (lower.includes("sid") || lower.includes("datasheet") || lower.includes("manual")) {
    const isDebugging = /\b(trap|panic|page fault|fault|deadlock|race|hang|crash|barrier|fence|ordering|mmu|exception)\b/i.test(lower);
    if (isDebugging) {
      return { level: "high", reason: "sid trap/concurrency debugging" };
    }
    const isLookup = /\b(offset|address|bitfield|layout|what is|where is|reset value|table|register|find|search)\b/i.test(lower);
    if (isLookup) {
      return { level: "low", reason: "sid datasheet lookup" };
    }
    return { level: "medium", reason: "sid hardware analysis" };
  }

  // 3. Critical Bugs / Concurrency / Kernel / Mathematical Proofs
  if (
    /\b(kernel panic|page fault|segfault|core dump|data corruption|deadlock|race condition|concurrency|integer overflow|buffer overflow|use-after-free|vulnerability|exploit|invariant violation|formal proof|undefined behaviou?r)\b/i.test(
      lower
    )
  ) {
    return { level: "high", reason: "critical bug / concurrency" };
  }

  // 4. Mechanical / Trivial Queries (Tier 0: minimal/off)
  if (
    /^(ls|git status|git diff|git log|pwd|whoami|date|which)\b/i.test(lower) ||
    /\b(typo|rename variable|format code|add comment|whitespace|remove unused|check git)\b/i.test(lower)
  ) {
    return { level: "minimal", reason: "mechanical / inspection" };
  }

  // 5. Architecture / Refactoring / Multi-file Planning
  if (/\b(refactor|redesign|architecture|migrate|migration|plan|design doc|multi-file|subsystem|specification)\b/i.test(lower)) {
    return { level: "medium", reason: "architecture / refactoring" };
  }

  // 6. Length & Substantial Queries
  if (lower.length > 500 || lower.split("\n").length > 8) {
    return { level: "medium", reason: "detailed prompt" };
  }

  // Default baseline for everyday coding
  return { level: "low", reason: "standard implementation" };
}

export default function autoThinkingExtension(pi: ExtensionAPI) {
  let isAutoEnabled = true;

  // Evaluate on incoming user input before run starts
  pi.on("before_agent_start", async (event, ctx) => {
    if (!isAutoEnabled) return;
    if (event.messageType !== "user" || !event.prompt) return;

    const evaluation = evaluatePromptComplexity(event.prompt);
    const previous = pi.getThinkingLevel();

    if (previous !== evaluation.level) {
      pi.setThinkingLevel(evaluation.level as ThinkingLevel);
    }

    if (ctx.hasUI) {
      ctx.ui.setStatus("auto-thinking", `🧠 Auto: ${evaluation.level} (${evaluation.reason})`);
    }
  });

  // User command to toggle or check status
  pi.registerCommand("autothinking", {
    description: "Toggle or check automatic thinking level selection (on, off, toggle, status)",
    handler: async (args, ctx) => {
      const mode = args.trim().toLowerCase();

      if (mode === "off") {
        isAutoEnabled = false;
        if (ctx.hasUI) ctx.ui.setStatus("auto-thinking", "🧠 Auto: disabled");
        ctx.ui.notify("Auto-thinking disabled.", "info");
      } else if (mode === "on") {
        isAutoEnabled = true;
        if (ctx.hasUI) ctx.ui.setStatus("auto-thinking", `🧠 Auto: ${pi.getThinkingLevel()}`);
        ctx.ui.notify("Auto-thinking enabled.", "info");
      } else if (mode === "status") {
        ctx.ui.notify(
          `Auto-thinking is ${isAutoEnabled ? "enabled" : "disabled"} (current level: ${pi.getThinkingLevel()}).`,
          "info"
        );
      } else {
        // Toggle
        isAutoEnabled = !isAutoEnabled;
        if (ctx.hasUI) {
          ctx.ui.setStatus("auto-thinking", isAutoEnabled ? `🧠 Auto: ${pi.getThinkingLevel()}` : "🧠 Auto: disabled");
        }
        ctx.ui.notify(`Auto-thinking is now ${isAutoEnabled ? "enabled" : "disabled"}.`, "info");
      }
    },
  });
}
