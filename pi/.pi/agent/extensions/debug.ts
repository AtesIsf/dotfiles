/**
 * Debug Adapter Protocol (DAP) Extension for Pi
 *
 * Provides interactive step-debugging, breakpoints, stack frame analysis,
 * variable inspection, and expression evaluation by communicating with
 * DAP debug adapters over stdio.
 *
 * Integrates directly with Neovim / Mason by checking `~/.local/share/nvim/mason/bin` first,
 * then falling back to `$PATH`. If an adapter is missing, directs the user to install it via Neovim.
 */

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// =============================================================================
// Adapter Mapping & Binary Resolution
// =============================================================================

interface AdapterDescriptor {
  name: string;
  command: string;
  fallbacks?: string[];
  masonPackage: string;
  defaultArgs?: string[];
  targetType: "native" | "python" | "node";
}

const DEBUG_ADAPTERS: Record<string, AdapterDescriptor> = {
  native: {
    name: "lldb-dap",
    command: "lldb-dap",
    fallbacks: ["lldb-vscode", "codelldb"],
    masonPackage: "codelldb",
    targetType: "native",
  },
  python: {
    name: "debugpy",
    command: "debugpy-adapter",
    fallbacks: ["debugpy"],
    masonPackage: "debugpy",
    targetType: "python",
  },
};

function isExecutable(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === "win32") return true;
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function resolveAdapterBinary(descriptor: AdapterDescriptor): string | null {
  const masonDir = path.join(os.homedir(), ".local/share/nvim/mason/bin");

  const candidates = [descriptor.command, ...(descriptor.fallbacks || [])];
  for (const cmd of candidates) {
    const masonBin = path.join(masonDir, cmd);
    if (isExecutable(masonBin)) return masonBin;
  }

  const envPath = process.env.PATH || "";
  const dirs = envPath.split(path.delimiter);
  for (const cmd of candidates) {
    for (const dir of dirs) {
      if (!dir) continue;
      const full = path.join(dir, cmd);
      if (isExecutable(full)) return full;
    }
  }

  return null;
}

// =============================================================================
// DAP Client Implementation
// =============================================================================

interface DapMessage {
  seq: number;
  type: "request" | "response" | "event";
  command?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  event?: string;
  body?: any;
  arguments?: any;
}

class DapSession {
  private proc: ChildProcessWithoutNullStreams;
  private seq = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (res: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout; command: string }
  >();
  private buffer = Buffer.alloc(0);
  private eventEmitter = new EventEmitter();

  public isInitialized = false;
  public isConfigurationDone = false;
  public isStopped = false;
  public stoppedDetails: any = null;
  public lastStoppedThreadId: number | null = null;
  public outputLogs: string[] = [];

  public readonly commandPath: string;
  public readonly cwd: string;

  constructor(commandPath: string, args: string[] = [], cwd: string = process.cwd()) {
    this.commandPath = commandPath;
    this.cwd = cwd;
    this.proc = spawn(commandPath, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.proc.stdout.on("data", (chunk: Buffer) => this.handleData(chunk));
    this.proc.stderr.on("data", (chunk: Buffer) => {
      this.outputLogs.push(`[stderr] ${chunk.toString("utf8")}`);
    });

    this.proc.stdin.on("error", () => {
      // Handled via proc exit
    });

    this.proc.on("error", (err) => {
      for (const req of this.pendingRequests.values()) {
        clearTimeout(req.timer);
        req.reject(new Error(`DAP adapter error: ${err.message}`));
      }
      this.pendingRequests.clear();
      this.eventEmitter.emit("terminated");
    });

    this.proc.on("exit", (code, signal) => {
      for (const req of this.pendingRequests.values()) {
        clearTimeout(req.timer);
        req.reject(new Error(`DAP adapter exited (code ${code}, signal ${signal})`));
      }
      this.pendingRequests.clear();
      this.isStopped = true;
      this.eventEmitter.emit("terminated");
    });
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEndIndex = this.buffer.indexOf("\r\n\r\n");
      if (headerEndIndex === -1) break;

      const headerText = this.buffer.subarray(0, headerEndIndex).toString("ascii");
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEndIndex + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const messageStartIndex = headerEndIndex + 4;
      const messageEndIndex = messageStartIndex + contentLength;

      if (this.buffer.length < messageEndIndex) break;

      const messageJson = this.buffer.subarray(messageStartIndex, messageEndIndex).toString("utf8");
      this.buffer = this.buffer.subarray(messageEndIndex);

      try {
        const msg = JSON.parse(messageJson) as DapMessage;
        this.handleMessage(msg);
      } catch (err: any) {
        console.error(`[DAP Client] Failed to parse JSON message: ${err?.message}`);
      }
    }
  }

  private handleMessage(msg: DapMessage) {
    if (msg.type === "response" && msg.request_seq !== undefined) {
      const req = this.pendingRequests.get(msg.request_seq);
      if (req) {
        this.pendingRequests.delete(msg.request_seq);
        clearTimeout(req.timer);

        if (msg.success === false) {
          req.reject(new Error(`DAP command '${req.command}' failed: ${msg.message || "Unknown error"}`));
        } else {
          req.resolve(msg.body);
        }
      }
      return;
    }

    if (msg.type === "event" && msg.event) {
      this.eventEmitter.emit(msg.event, msg.body);

      switch (msg.event) {
        case "initialized":
          this.isInitialized = true;
          break;
        case "stopped":
          this.isStopped = true;
          this.stoppedDetails = msg.body;
          if (msg.body?.threadId !== undefined) {
            this.lastStoppedThreadId = msg.body.threadId;
          }
          break;
        case "continued":
          this.isStopped = false;
          this.stoppedDetails = null;
          break;
        case "output":
          if (msg.body?.output) {
            this.outputLogs.push(msg.body.output.trim());
          }
          break;
        case "terminated":
          this.isStopped = true;
          break;
      }
    }
  }

  public sendRequest<T = any>(command: string, args?: any, timeoutMs = 15000): Promise<T> {
    const seq = this.seq++;
    const payload: DapMessage = { seq, type: "request", command, arguments: args };
    const json = JSON.stringify(payload);
    const message = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(seq)) {
          this.pendingRequests.delete(seq);
          reject(new Error(`DAP request '${command}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(seq, { resolve, reject, timer, command });
      if (!this.proc.stdin.destroyed && this.proc.stdin.writable) {
        this.proc.stdin.write(message);
      } else {
        clearTimeout(timer);
        this.pendingRequests.delete(seq);
        reject(new Error(`Cannot send DAP request '${command}': stdin is closed`));
      }
    });
  }

  /**
   * Waits for one of the specified events or times out cleanly.
   */
  public waitForAnyEvent(events: string[], timeoutMs = 1200): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const cleanups: Array<() => void> = [];

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanups.forEach((c) => c());
          resolve(null);
        }
      }, timeoutMs);

      for (const ev of events) {
        const handler = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            cleanups.forEach((c) => c());
            resolve(ev);
          }
        };
        this.eventEmitter.once(ev, handler);
        cleanups.push(() => this.eventEmitter.removeListener(ev, handler));
      }
    });
  }

  public async initialize(): Promise<any> {
    const body = await this.sendRequest("initialize", {
      clientID: "pi",
      clientName: "Pi Coding Agent",
      adapterID: "lldb",
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
    });
    return body;
  }

  public async configurationDone(): Promise<void> {
    if (!this.isConfigurationDone) {
      try {
        await this.sendRequest("configurationDone", {});
        this.isConfigurationDone = true;
      } catch {}
    }
  }

  public async terminate(): Promise<void> {
    try {
      await this.sendRequest("disconnect", { terminateDebuggee: true }, 2000);
    } catch {}
    try {
      this.proc.kill("SIGTERM");
    } catch {}
  }
}

// Active singleton DAP session
let activeDapSession: DapSession | null = null;

function cleanupDapSession() {
  if (activeDapSession) {
    activeDapSession.terminate().catch(() => {});
    activeDapSession = null;
  }
}

let dapSignalHandlersRegistered = false;
function ensureDapSignalHandlers() {
  if (dapSignalHandlersRegistered) return;
  dapSignalHandlersRegistered = true;
  process.on("exit", cleanupDapSession);
  process.on("SIGINT", cleanupDapSession);
  process.on("SIGTERM", cleanupDapSession);
}

// =============================================================================
// Extension Registration
// =============================================================================

export default function (pi: ExtensionAPI) {
  ensureDapSignalHandlers();

  pi.registerTool({
    name: "debug",
    label: "Debug Adapter Protocol (DAP)",
    description:
      "Debug Adapter Protocol (DAP) interactive debugger for step-debugging, breakpoints, stack frame analysis, and variable inspection.",
    promptSnippet: "Interactively debug native processes (breakpoints, stack traces, locals, evaluation)",
    promptGuidelines: [
      "Use debug when diagnosing crashes, segfaults, hanging processes, or subtle state bugs in compiled binaries rather than guessing.",
      "When a debug adapter is not installed, do NOT attempt to install it yourself using package managers or scripts. Instruct the user to open Neovim, install it (e.g. :MasonInstall <name>), and report back.",
    ],
    parameters: Type.Object({
      operation: Type.Union([
        Type.Literal("launch"),
        Type.Literal("attach"),
        Type.Literal("set_breakpoints"),
        Type.Literal("continue"),
        Type.Literal("step"),
        Type.Literal("stack"),
        Type.Literal("variables"),
        Type.Literal("evaluate"),
        Type.Literal("terminate"),
      ], { description: "The debug operation to execute" }),
      program: Type.Optional(Type.String({ description: "Target executable path (for launch)" })),
      args: Type.Optional(Type.Array(Type.String(), { description: "Command-line arguments for the launched executable" })),
      cwd: Type.Optional(Type.String({ description: "Working directory for the target program" })),
      pid: Type.Optional(Type.Integer({ description: "Process ID to attach to (for attach)" })),
      path: Type.Optional(Type.String({ description: "Source file path for setting breakpoints" })),
      lines: Type.Optional(Type.Array(Type.Integer(), { description: "Line numbers (1-based) to set breakpoints on" })),
      stepType: Type.Optional(Type.Union([
        Type.Literal("over"),
        Type.Literal("in"),
        Type.Literal("out"),
        Type.Literal("pause"),
      ], { description: "Step direction (for step operation)" })),
      frameId: Type.Optional(Type.Integer({ description: "Stack frame ID for variables or evaluate" })),
      expression: Type.Optional(Type.String({ description: "Expression to evaluate in current frame context" })),
      stopOnEntry: Type.Optional(Type.Boolean({ description: "Whether to pause immediately on program entry (default: false)" })),
    }),
    async execute(toolCallId, params, signal) {
      try {
        switch (params.operation) {
          case "launch": {
            if (!params.program) {
              return { content: [{ type: "text", text: "Error: 'program' path is required for launch." }] };
            }

            const rawProg = params.program.trim();
            const progPath = path.isAbsolute(rawProg) ? rawProg : path.resolve(process.cwd(), rawProg);
            if (!fs.existsSync(progPath)) {
              return { content: [{ type: "text", text: `Error: Program executable not found: ${rawProg}` }] };
            }

            if (activeDapSession) {
              await activeDapSession.terminate();
              activeDapSession = null;
            }

            const adapter = DEBUG_ADAPTERS.native;
            const adapterBin = resolveAdapterBinary(adapter);
            if (!adapterBin) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: Debug adapter '${adapter.name}' is not installed.\nPlease open Neovim, run ':MasonInstall ${adapter.masonPackage}', and report back once installation is complete.`,
                  },
                ],
                details: { adapter: adapter.name, installed: false },
              };
            }

            const targetCwd = params.cwd ? path.resolve(process.cwd(), params.cwd) : path.dirname(progPath);
            const session = new DapSession(adapterBin, adapter.defaultArgs || [], targetCwd);
            await session.initialize();

            // Set up listener for stop or exit event
            const stopPromise = session.waitForAnyEvent(["stopped", "terminated", "exited"], 1500);

            await session.sendRequest("launch", {
              program: progPath,
              args: params.args || [],
              cwd: targetCwd,
              stopOnEntry: params.stopOnEntry ?? false,
              env: process.env,
            });

            activeDapSession = session;
            await stopPromise;

            return {
              content: [
                {
                  type: "text",
                  text: `Debugger launched target: **${path.basename(progPath)}**.\nStatus: ${session.isStopped ? "Stopped (paused)" : "Running"}`,
                },
              ],
              details: { program: progPath, isStopped: session.isStopped },
            };
          }

          case "attach": {
            if (!params.pid) {
              return { content: [{ type: "text", text: "Error: 'pid' is required for attach." }] };
            }

            if (activeDapSession) {
              await activeDapSession.terminate();
              activeDapSession = null;
            }

            const adapter = DEBUG_ADAPTERS.native;
            const adapterBin = resolveAdapterBinary(adapter);
            if (!adapterBin) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: Debug adapter '${adapter.name}' is not installed.\nPlease open Neovim, run ':MasonInstall ${adapter.masonPackage}', and report back once installation is complete.`,
                  },
                ],
                details: { adapter: adapter.name, installed: false },
              };
            }

            const session = new DapSession(adapterBin, adapter.defaultArgs || [], process.cwd());
            await session.initialize();

            const attachPromise = session.waitForAnyEvent(["stopped"], 1500);
            await session.sendRequest("attach", {
              pid: params.pid,
              waitFor: false,
            });

            activeDapSession = session;
            await attachPromise;

            return {
              content: [{ type: "text", text: `Debugger attached to PID: ${params.pid}` }],
              details: { pid: params.pid },
            };
          }

          case "set_breakpoints": {
            if (!activeDapSession) {
              return { content: [{ type: "text", text: "Error: No active debug session. Launch or attach first." }] };
            }
            if (!params.path || !params.lines) {
              return { content: [{ type: "text", text: "Error: 'path' and 'lines' array are required for set_breakpoints." }] };
            }

            const filePath = path.isAbsolute(params.path) ? params.path : path.resolve(process.cwd(), params.path);
            const breakpoints = params.lines.map((line) => ({ line }));

            const res = await activeDapSession.sendRequest("setBreakpoints", {
              source: { path: filePath },
              breakpoints,
            });

            await activeDapSession.configurationDone();

            const bpList = (res?.breakpoints || [])
              .map((bp: any) => `- Line ${bp.line}: ${bp.verified ? "Verified" : "Unverified"}`)
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: `### Breakpoints set for ${path.relative(process.cwd(), filePath)}:\n${bpList || "None"}`,
                },
              ],
              details: { breakpoints: res?.breakpoints },
            };
          }

          case "continue": {
            if (!activeDapSession) {
              return { content: [{ type: "text", text: "Error: No active debug session." }] };
            }

            await activeDapSession.configurationDone();
            const eventPromise = activeDapSession.waitForAnyEvent(["stopped", "terminated", "exited"], 1500);

            await activeDapSession.sendRequest("continue", {
              threadId: activeDapSession.lastStoppedThreadId ?? 1,
            });

            const ev = await eventPromise;

            if (activeDapSession.isStopped) {
              const stopReason = activeDapSession.stoppedDetails?.reason || "breakpoint";
              return {
                content: [{ type: "text", text: `Program execution paused. Stop reason: **${stopReason}**` }],
                details: { isStopped: true, stoppedDetails: activeDapSession.stoppedDetails },
              };
            }

            return {
              content: [{ type: "text", text: `Program resumed execution (${ev || "running"}).` }],
              details: { isStopped: false },
            };
          }

          case "step": {
            if (!activeDapSession) {
              return { content: [{ type: "text", text: "Error: No active debug session." }] };
            }

            const stepType = params.stepType || "over";
            const threadId = activeDapSession.lastStoppedThreadId ?? 1;
            const eventPromise = activeDapSession.waitForAnyEvent(["stopped", "terminated", "exited"], 1500);

            if (stepType === "over") {
              await activeDapSession.sendRequest("next", { threadId });
            } else if (stepType === "in") {
              await activeDapSession.sendRequest("stepIn", { threadId });
            } else if (stepType === "out") {
              await activeDapSession.sendRequest("stepOut", { threadId });
            } else if (stepType === "pause") {
              await activeDapSession.sendRequest("pause", { threadId });
            }

            await eventPromise;

            return {
              content: [
                {
                  type: "text",
                  text: `Executed step (${stepType}). Status: ${activeDapSession.isStopped ? "Stopped" : "Running"}`,
                },
              ],
              details: { isStopped: activeDapSession.isStopped, details: activeDapSession.stoppedDetails },
            };
          }

          case "stack": {
            if (!activeDapSession) {
              return { content: [{ type: "text", text: "Error: No active debug session." }] };
            }

            const threadsRes = await activeDapSession.sendRequest("threads", {});
            const threads = threadsRes?.threads || [];

            if (threads.length === 0) {
              return { content: [{ type: "text", text: "No active threads reported." }] };
            }

            const threadId = activeDapSession.lastStoppedThreadId ?? threads[0]?.id;
            const traceRes = await activeDapSession.sendRequest("stackTrace", { threadId, levels: 15 });
            const frames = traceRes?.stackFrames || [];

            if (frames.length === 0) {
              return { content: [{ type: "text", text: `Thread ${threadId} has no active stack frames.` }] };
            }

            const formatted = frames
              .map((f: any) => {
                const src = f.source?.path ? path.relative(process.cwd(), f.source.path) : (f.source?.name || "unknown");
                return `- **Frame ${f.id}**: \`${f.name}\` at ${src}:${f.line}:${f.column}`;
              })
              .join("\n");

            return {
              content: [{ type: "text", text: `### Call Stack (Thread ${threadId}):\n${formatted}` }],
              details: { threadId, frames },
            };
          }

          case "variables": {
            if (!activeDapSession) {
              return { content: [{ type: "text", text: "Error: No active debug session." }] };
            }

            let frameId = params.frameId;
            if (frameId === undefined) {
              const threadId = activeDapSession.lastStoppedThreadId ?? 1;
              const trace = await activeDapSession.sendRequest("stackTrace", { threadId, levels: 1 });
              frameId = trace?.stackFrames?.[0]?.id;
            }

            if (frameId === undefined) {
              return { content: [{ type: "text", text: "No stack frame available to inspect variables." }] };
            }

            const scopesRes = await activeDapSession.sendRequest("scopes", { frameId });
            const scopes = scopesRes?.scopes || [];

            let output = `### Variables in Frame ${frameId}:\n\n`;
            for (const scope of scopes) {
              output += `**${scope.name}**:\n`;
              const varsRes = await activeDapSession.sendRequest("variables", {
                variablesReference: scope.variablesReference,
              });
              const vars = varsRes?.variables || [];
              if (vars.length === 0) {
                output += "  *(empty)*\n";
              } else {
                for (const v of vars.slice(0, 25)) {
                  output += `  - \`${v.name}\` (${v.type || "unknown"}) = \`${v.value}\`\n`;
                }
              }
            }

            return {
              content: [{ type: "text", text: output }],
              details: { frameId, scopes },
            };
          }

          case "evaluate": {
            if (!activeDapSession) {
              return { content: [{ type: "text", text: "Error: No active debug session." }] };
            }
            if (!params.expression) {
              return { content: [{ type: "text", text: "Error: 'expression' is required for evaluate." }] };
            }

            const evalRes = await activeDapSession.sendRequest("evaluate", {
              expression: params.expression,
              frameId: params.frameId,
              context: "repl",
            });

            return {
              content: [
                {
                  type: "text",
                  text: `**${params.expression}** = \`${evalRes?.result ?? "undefined"}\` (${evalRes?.type || "unknown"})`,
                },
              ],
              details: { expression: params.expression, result: evalRes?.result, type: evalRes?.type },
            };
          }

          case "terminate": {
            if (!activeDapSession) {
              return { content: [{ type: "text", text: "No active debug session to terminate." }] };
            }

            await activeDapSession.terminate();
            activeDapSession = null;
            return {
              content: [{ type: "text", text: "Debug session terminated successfully." }],
              details: { terminated: true },
            };
          }

          default:
            return { content: [{ type: "text", text: `Unknown operation: ${params.operation}` }] };
        }
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Debug operation '${params.operation}' failed: ${err.message || String(err)}` }],
          details: { error: err.message },
        };
      }
    },
  });
}
