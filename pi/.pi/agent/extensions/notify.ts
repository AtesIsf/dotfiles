/**
 * Dunst Notification Extension for Pi
 *
 * Sends a desktop notification via dunst (notify-send) when a task finishes,
 * automatically suppressing notifications when the current terminal window is focused in Sway.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Traverses /proc/<pid>/stat upwards to gather all ancestor PIDs of a process.
 */
function getProcessAncestors(pid: number): Set<number> {
  const ancestors = new Set<number>();
  let curr = pid;
  while (curr > 1) {
    ancestors.add(curr);
    try {
      const stat = fs.readFileSync(`/proc/${curr}/stat`, "utf8");
      const lastParen = stat.lastIndexOf(")");
      if (lastParen === -1) break;
      const parts = stat.slice(lastParen + 2).split(" ");
      const ppid = parseInt(parts[1], 10);
      if (!ppid || ppid === curr) break;
      curr = ppid;
    } catch {
      break;
    }
  }
  return ancestors;
}

/**
 * Queries Sway IPC to find the PID of the currently focused container/window.
 */
function getSwayFocusedPid(): Promise<number | null> {
  return new Promise((resolve) => {
    if (!process.env.SWAYSOCK && !process.env.WAYLAND_DISPLAY) {
      resolve(null);
      return;
    }
    execFile("swaymsg", ["-t", "get_tree"], { timeout: 1000 }, (error, stdout) => {
      if (error || !stdout) {
        resolve(null);
        return;
      }
      try {
        const root = JSON.parse(stdout);
        const findFocused = (node: any): number | null => {
          if (node.focused) return node.pid ?? null;
          const children = [...(node.nodes || []), ...(node.floating_nodes || [])];
          for (const child of children) {
            const found = findFocused(child);
            if (found !== null) return found;
          }
          return null;
        };
        resolve(findFocused(root));
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Checks if the current terminal window currently has focus in Sway.
 * Returns true if focused, false if unfocused or indeterminate.
 */
async function isCurrentTerminalFocused(): Promise<boolean> {
  try {
    const focusedPid = await getSwayFocusedPid();
    if (focusedPid === null) {
      // If unable to query Sway (e.g. non-Sway environment), default to unfocused so alerts are delivered
      return false;
    }
    const ancestors = getProcessAncestors(process.pid);
    return ancestors.has(focusedPid);
  } catch {
    return false;
  }
}

/**
 * Formats elapsed duration into human-readable shorthand (e.g. 14s, 1m 22s).
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 1) {
    return "<1s";
  }
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

/**
 * Sends a desktop notification via notify-send to dunst.
 */
function sendNotification(title: string, body: string): void {
  execFile(
    "notify-send",
    ["--app-name=Pi", "--urgency=normal", "--icon=dialog-information", title, body],
    () => {
      // Silently discard any execution error
    }
  );
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let startTime: number | null = null;

  // Track initial task start time
  pi.on("agent_start", async () => {
    if (startTime === null) {
      startTime = Date.now();
    }
  });

  // Handle final task completion
  pi.on("agent_settled", async (event, ctx) => {
    const elapsed = startTime !== null ? Date.now() - startTime : null;
    startTime = null;

    if (!enabled) return;

    // Check if the user is already looking at this terminal
    const focused = await isCurrentTerminalFocused();
    if (focused) return;

    const dirName = path.basename(ctx.cwd || process.cwd());
    const title = `Pi - ${dirName}`;
    const statusText = event.aborted ? "Task aborted" : "Task complete";
    const body = elapsed !== null ? `${statusText} in ${formatDuration(elapsed)}` : statusText;

    sendNotification(title, body);
  });

  // Slash command to toggle or check notification status
  pi.registerCommand("notify", {
    description: "Toggle or configure task completion notifications (via dunst)",
    getArgumentCompletions: (prefix) => {
      const options = ["on", "off", "status"];
      const filtered = options.filter((o) => o.startsWith(prefix));
      return filtered.map((o) => ({ value: o, label: o }));
    },
    handler: async (args, ctx) => {
      const lower = (args || "").trim().toLowerCase();
      if (lower === "on") {
        enabled = true;
        ctx.ui.notify("Notifications enabled (only alerts when unfocused)", "info");
      } else if (lower === "off") {
        enabled = false;
        ctx.ui.notify("Notifications disabled", "info");
      } else if (lower === "status") {
        ctx.ui.notify(`Notifications are currently ${enabled ? "enabled" : "disabled"}`, "info");
      } else {
        enabled = !enabled;
        ctx.ui.notify(`Notifications ${enabled ? "enabled" : "disabled"}`, "info");
      }
    },
  });
}
