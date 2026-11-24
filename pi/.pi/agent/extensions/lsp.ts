/**
 * Language Server Protocol (LSP) Extension for Pi
 *
 * Provides IDE code intelligence (diagnostics, definition, references, hover, symbols, rename)
 * by communicating with language servers over JSON-RPC via stdio.
 *
 * Integrates directly with Neovim / Mason by checking `~/.local/share/nvim/mason/bin` first,
 * then falling back to `$PATH`. If a server is missing, directs the user to install it via Neovim.
 */

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// =============================================================================
// Server Mapping & Binary Resolution
// =============================================================================

interface ServerDescriptor {
  name: string;
  command: string;
  fallbacks?: string[];
  args?: string[];
  languageId: string;
  rootMarkers: string[];
}

const LANGUAGE_SERVERS: Record<string, ServerDescriptor> = {
  // C / C++
  c: {
    name: "clangd",
    command: "clangd",
    args: ["--background-index", "--clang-tidy"],
    languageId: "c",
    rootMarkers: ["compile_commands.json", "compile_flags.txt", ".git"],
  },
  cpp: {
    name: "clangd",
    command: "clangd",
    args: ["--background-index", "--clang-tidy"],
    languageId: "cpp",
    rootMarkers: ["compile_commands.json", "compile_flags.txt", ".git"],
  },
  // Rust
  rust: {
    name: "rust-analyzer",
    command: "rust-analyzer",
    languageId: "rust",
    rootMarkers: ["Cargo.toml", ".git"],
  },
  // Python
  python: {
    name: "basedpyright",
    command: "basedpyright-langserver",
    fallbacks: ["basedpyright", "pyright-langserver", "pyright"],
    args: ["--stdio"],
    languageId: "python",
    rootMarkers: ["pyproject.toml", "setup.py", "requirements.txt", ".git"],
  },
  // Go
  go: {
    name: "gopls",
    command: "gopls",
    languageId: "go",
    rootMarkers: ["go.mod", "go.work", ".git"],
  },
  // TypeScript / JavaScript
  typescript: {
    name: "typescript-language-server",
    command: "typescript-language-server",
    fallbacks: ["vtsls"],
    args: ["--stdio"],
    languageId: "typescript",
    rootMarkers: ["tsconfig.json", "package.json", ".git"],
  },
  javascript: {
    name: "typescript-language-server",
    command: "typescript-language-server",
    fallbacks: ["vtsls"],
    args: ["--stdio"],
    languageId: "javascript",
    rootMarkers: ["jsconfig.json", "package.json", ".git"],
  },
};

const EXTENSION_MAP: Record<string, string> = {
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".rs": "rust",
  ".py": "python",
  ".go": "go",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
};

/**
 * Checks if an executable exists in a given directory or directly as a path.
 */
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

/**
 * Searches Mason directory first (~/.local/share/nvim/mason/bin), then $PATH.
 */
function resolveServerBinary(command: string): string | null {
  const masonDir = path.join(os.homedir(), ".local/share/nvim/mason/bin");
  const masonBin = path.join(masonDir, command);
  if (isExecutable(masonBin)) {
    return masonBin;
  }

  const envPath = process.env.PATH || "";
  const dirs = envPath.split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const full = path.join(dir, command);
    if (isExecutable(full)) {
      return full;
    }
  }

  return null;
}

/**
 * Finds project root by ascending looking for root markers.
 */
function findProjectRoot(startPath: string, rootMarkers: string[]): string {
  let current = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  while (true) {
    for (const marker of rootMarkers) {
      if (fs.existsSync(path.join(current, marker))) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

/**
 * Accurately translates (line, character) 0-based coordinates to a character offset.
 */
function positionToOffset(lines: string[], line: number, character: number): number {
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for '\n'
  }
  return offset + character;
}

/**
 * Applies a list of text edits safely to a document string in reverse offset order.
 */
function applyEditsToDocument(content: string, edits: any[]): string {
  const lines = content.split("\n");
  const mapped = edits.map((e) => {
    const startLine = e.range.start.line ?? 0;
    const startChar = e.range.start.character ?? 0;
    const endLine = e.range.end.line ?? startLine;
    const endChar = e.range.end.character ?? startChar;

    return {
      startOffset: positionToOffset(lines, startLine, startChar),
      endOffset: positionToOffset(lines, endLine, endChar),
      newText: e.newText ?? "",
    };
  });

  // Sort descending by start offset to avoid shifting upcoming replacement ranges
  mapped.sort((a, b) => b.startOffset - a.startOffset);

  let result = content;
  for (const edit of mapped) {
    result = result.slice(0, edit.startOffset) + edit.newText + result.slice(edit.endOffset);
  }
  return result;
}

// =============================================================================
// JSON-RPC LSP Client
// =============================================================================

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

class LspClient {
  private proc: ChildProcessWithoutNullStreams;
  private messageId = 1;
  private pendingRequests = new Map<
    number | string,
    { resolve: (res: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private buffer = Buffer.alloc(0);
  private diagnosticsCache = new Map<string, any[]>();
  public isInitialized = false;

  public readonly commandPath: string;
  public readonly args: string[];
  public readonly rootDir: string;
  public onExit?: () => void;

  constructor(commandPath: string, args: string[], rootDir: string) {
    this.commandPath = commandPath;
    this.args = args;
    this.rootDir = rootDir;

    this.proc = spawn(commandPath, args, {
      cwd: rootDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.proc.stdout.on("data", (chunk: Buffer) => this.handleData(chunk));
    this.proc.stderr.on("data", () => {
      // Drain stderr to prevent process stall
    });

    this.proc.stdin.on("error", () => {
      // Handled via proc exit/error
    });

    this.proc.on("error", (err) => {
      for (const req of this.pendingRequests.values()) {
        clearTimeout(req.timer);
        req.reject(new Error(`LSP server process error: ${err.message}`));
      }
      this.pendingRequests.clear();
      this.onExit?.();
    });

    this.proc.on("exit", (code, signal) => {
      for (const req of this.pendingRequests.values()) {
        clearTimeout(req.timer);
        req.reject(new Error(`LSP server exited with code ${code} / signal ${signal}`));
      }
      this.pendingRequests.clear();
      this.onExit?.();
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
        // Discard until header end if no Content-Length header is found
        this.buffer = this.buffer.subarray(headerEndIndex + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const messageStartIndex = headerEndIndex + 4;
      const messageEndIndex = messageStartIndex + contentLength;

      if (this.buffer.length < messageEndIndex) {
        // Wait for remainder of the payload
        break;
      }

      const messageJson = this.buffer.subarray(messageStartIndex, messageEndIndex).toString("utf8");
      this.buffer = this.buffer.subarray(messageEndIndex);

      try {
        const msg = JSON.parse(messageJson) as JsonRpcMessage;
        this.handleMessage(msg);
      } catch (err: any) {
        console.error(`[LSP Client] Failed to parse JSON message: ${err?.message}`);
      }
    }
  }

  private handleMessage(msg: JsonRpcMessage) {
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const handler = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      clearTimeout(handler.timer);

      if (msg.error) {
        handler.reject(new Error(`LSP Error (${msg.error.code}): ${msg.error.message}`));
      } else {
        handler.resolve(msg.result);
      }
      return;
    }

    if (msg.method === "textDocument/publishDiagnostics" && msg.params) {
      const uri = msg.params.uri;
      try {
        const filePath = fileURLToPath(uri);
        this.diagnosticsCache.set(filePath, msg.params.diagnostics || []);
      } catch {
        this.diagnosticsCache.set(uri, msg.params.diagnostics || []);
      }
    }
  }

  public sendNotification(method: string, params: any) {
    const payload: JsonRpcMessage = { jsonrpc: "2.0", method, params };
    const json = JSON.stringify(payload);
    const message = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
    if (!this.proc.stdin.destroyed && this.proc.stdin.writable) {
      this.proc.stdin.write(message);
    }
  }

  public sendRequest<T = any>(method: string, params: any, timeoutMs = 15000): Promise<T> {
    const id = this.messageId++;
    const payload: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    const json = JSON.stringify(payload);
    const message = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LSP request '${method}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      if (!this.proc.stdin.destroyed && this.proc.stdin.writable) {
        this.proc.stdin.write(message);
      } else {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`Cannot send request '${method}': stdin is closed`));
      }
    });
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const rootUri = pathToFileURL(this.rootDir).href;
    await this.sendRequest("initialize", {
      processId: process.pid,
      rootUri,
      rootPath: this.rootDir,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, openClose: true, change: 1 },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
          rename: { dynamicRegistration: false, prepareSupport: true },
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: {
          symbol: { dynamicRegistration: false },
        },
      },
      initializationOptions: {},
    });

    this.sendNotification("initialized", {});
    this.isInitialized = true;
  }

  public notifyFileOpen(filePath: string, languageId: string) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      this.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri: pathToFileURL(filePath).href,
          languageId,
          version: 1,
          text: content,
        },
      });
    } catch {
      // Ignored if file cannot be read
    }
  }

  public getDiagnostics(filePath: string): any[] {
    return this.diagnosticsCache.get(filePath) || [];
  }

  public async shutdown(): Promise<void> {
    try {
      await this.sendRequest("shutdown", {}, 3000);
      this.sendNotification("exit", {});
    } catch {
      // Fallback
    } finally {
      this.proc.kill("SIGTERM");
    }
  }
}

// Active client pool: key = `${serverName}:${rootDir}`
const activeClients = new Map<string, LspClient>();

function cleanupClients() {
  for (const client of activeClients.values()) {
    client.shutdown().catch(() => {});
  }
  activeClients.clear();
}

let signalHandlersRegistered = false;
function ensureSignalHandlers() {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;
  process.on("exit", cleanupClients);
  process.on("SIGINT", cleanupClients);
  process.on("SIGTERM", cleanupClients);
}

async function getOrStartClient(
  server: ServerDescriptor,
  commandPath: string,
  rootDir: string,
  filePath: string
): Promise<LspClient> {
  ensureSignalHandlers();
  const key = `${server.name}:${rootDir}`;
  let client = activeClients.get(key);
  if (!client) {
    client = new LspClient(commandPath, server.args || [], rootDir);
    client.onExit = () => {
      activeClients.delete(key);
    };
    await client.initialize();
    activeClients.set(key, client);
  }

  client.notifyFileOpen(filePath, server.languageId);
  return client;
}

// =============================================================================
// Extension Registration
// =============================================================================

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "lsp",
    label: "Language Server Protocol (LSP)",
    description:
      "Language Server Protocol (LSP) tool for code intelligence. Supports diagnostics, definition jump, references, hover documentation, document/workspace symbols, and semantic symbol rename.",
    promptSnippet: "Perform semantic code operations via Language Server Protocol",
    promptGuidelines: [
      "Use lsp (diagnostics, references, definition, rename) when appropriate on supported programming language files to ensure semantic correctness and type safety.",
      "When an LSP server is not installed, do NOT attempt to install it yourself using package managers or scripts. Politely instruct the user to open Neovim, install it (e.g. :MasonInstall <name>), and report back.",
    ],
    parameters: Type.Object({
      operation: Type.Union([
        Type.Literal("diagnostics"),
        Type.Literal("definition"),
        Type.Literal("references"),
        Type.Literal("hover"),
        Type.Literal("symbols"),
        Type.Literal("rename"),
      ], { description: "The LSP operation to execute" }),
      path: Type.String({ description: "Target source file path (relative to cwd or absolute)" }),
      line: Type.Optional(Type.Integer({ description: "Line number (1-based, required for definition, references, hover, rename)" })),
      character: Type.Optional(Type.Integer({ description: "Column offset (1-based, required for definition, references, hover, rename)" })),
      newName: Type.Optional(Type.String({ description: "New symbol name for rename operation" })),
      query: Type.Optional(Type.String({ description: "Search query for workspace symbols" })),
      apply: Type.Optional(Type.Boolean({ description: "Whether to apply rename edits directly to files on disk (default: false)" })),
    }),
    async execute(toolCallId, params, signal) {
      const rawPath = params.path.trim();
      const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);

      if (!fs.existsSync(resolvedPath)) {
        return {
          content: [{ type: "text", text: `Error: File not found: ${rawPath}` }],
          details: { path: rawPath, error: "file_not_found" },
        };
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      const langKey = EXTENSION_MAP[ext];
      if (!langKey || !LANGUAGE_SERVERS[langKey]) {
        return {
          content: [
            {
              type: "text",
              text: `No configured language server for extension '${ext}'. Supported languages: C/C++, Rust, Python, Go, TypeScript/JavaScript.`,
            },
          ],
          details: { extension: ext, supported: false },
        };
      }

      const serverDesc = LANGUAGE_SERVERS[langKey];
      let binaryPath = resolveServerBinary(serverDesc.command);

      if (!binaryPath && serverDesc.fallbacks) {
        for (const fb of serverDesc.fallbacks) {
          binaryPath = resolveServerBinary(fb);
          if (binaryPath) break;
        }
      }

      // Missing server guardrail
      if (!binaryPath) {
        return {
          content: [
            {
              type: "text",
              text: `Error: LSP server '${serverDesc.name}' is not installed.\nPlease open Neovim, run ':MasonInstall ${serverDesc.name}', and report back once installation is complete.`,
            },
          ],
          details: { server: serverDesc.name, installed: false },
        };
      }

      const rootDir = findProjectRoot(resolvedPath, serverDesc.rootMarkers);
      const client = await getOrStartClient(serverDesc, binaryPath, rootDir, resolvedPath);
      const uri = pathToFileURL(resolvedPath).href;

      try {
        switch (params.operation) {
          case "diagnostics": {
            await new Promise((r) => setTimeout(r, 600));
            const diags = client.getDiagnostics(resolvedPath);
            if (diags.length === 0) {
              return {
                content: [{ type: "text", text: `No diagnostics (clean) for ${path.relative(process.cwd(), resolvedPath)}.` }],
                details: { count: 0 },
              };
            }

            const formatted = diags
              .map((d: any) => {
                const severity = d.severity === 1 ? "ERROR" : d.severity === 2 ? "WARNING" : "INFO";
                const line = (d.range?.start?.line ?? 0) + 1;
                const col = (d.range?.start?.character ?? 0) + 1;
                return `[${severity}] Line ${line}:${col} - ${d.message}`;
              })
              .join("\n");

            return {
              content: [{ type: "text", text: `### Diagnostics for ${path.relative(process.cwd(), resolvedPath)}\n\n${formatted}` }],
              details: { count: diags.length, diagnostics: diags },
            };
          }

          case "definition": {
            if (params.line === undefined || params.character === undefined) {
              return { content: [{ type: "text", text: "Error: 'line' and 'character' (1-based) are required for definition jump." }] };
            }
            const res = await client.sendRequest("textDocument/definition", {
              textDocument: { uri },
              position: { line: params.line - 1, character: params.character - 1 },
            });

            if (!res || (Array.isArray(res) && res.length === 0)) {
              return { content: [{ type: "text", text: "No definition found." }] };
            }

            const locs = Array.isArray(res) ? res : [res];
            const formatted = locs
              .map((loc: any) => {
                const targetUri = loc.targetUri || loc.uri;
                const range = loc.targetSelectionRange || loc.targetRange || loc.range;
                const file = fileURLToPath(targetUri);
                const l = (range?.start?.line ?? 0) + 1;
                const c = (range?.start?.character ?? 0) + 1;
                return `- ${path.relative(process.cwd(), file)}:${l}:${c}`;
              })
              .join("\n");

            return {
              content: [{ type: "text", text: `### Definition Location(s):\n${formatted}` }],
              details: { locations: locs },
            };
          }

          case "references": {
            if (params.line === undefined || params.character === undefined) {
              return { content: [{ type: "text", text: "Error: 'line' and 'character' (1-based) are required for references." }] };
            }
            const res = await client.sendRequest("textDocument/references", {
              textDocument: { uri },
              position: { line: params.line - 1, character: params.character - 1 },
              context: { includeDeclaration: true },
            });

            if (!res || res.length === 0) {
              return { content: [{ type: "text", text: "No references found." }] };
            }

            const formatted = res
              .map((loc: any) => {
                const file = fileURLToPath(loc.uri);
                const l = (loc.range?.start?.line ?? 0) + 1;
                const c = (loc.range?.start?.character ?? 0) + 1;
                return `- ${path.relative(process.cwd(), file)}:${l}:${c}`;
              })
              .join("\n");

            return {
              content: [{ type: "text", text: `### References (${res.length} found):\n${formatted}` }],
              details: { count: res.length, references: res },
            };
          }

          case "hover": {
            if (params.line === undefined || params.character === undefined) {
              return { content: [{ type: "text", text: "Error: 'line' and 'character' (1-based) are required for hover." }] };
            }
            const res = await client.sendRequest("textDocument/hover", {
              textDocument: { uri },
              position: { line: params.line - 1, character: params.character - 1 },
            });

            if (!res || !res.contents) {
              return { content: [{ type: "text", text: "No hover information available." }] };
            }

            let text = "";
            if (typeof res.contents === "string") {
              text = res.contents;
            } else if (Array.isArray(res.contents)) {
              text = res.contents.map((c: any) => (typeof c === "string" ? c : c.value)).join("\n\n");
            } else if (res.contents.value) {
              text = res.contents.value;
            }

            return {
              content: [{ type: "text", text: `### Hover Documentation:\n\n${text}` }],
              details: { hover: res },
            };
          }

          case "symbols": {
            if (params.query) {
              const res = await client.sendRequest("workspace/symbol", { query: params.query });
              if (!res || res.length === 0) {
                return { content: [{ type: "text", text: `No symbols found matching "${params.query}".` }] };
              }
              const formatted = res
                .slice(0, 30)
                .map((s: any) => {
                  const file = s.location?.uri ? fileURLToPath(s.location.uri) : "";
                  const l = (s.location?.range?.start?.line ?? 0) + 1;
                  return `- **${s.name}** (${s.containerName || "root"}) at ${path.relative(process.cwd(), file)}:${l}`;
                })
                .join("\n");
              return {
                content: [{ type: "text", text: `### Workspace Symbols for "${params.query}":\n${formatted}` }],
                details: { count: res.length },
              };
            }

            const res = await client.sendRequest("textDocument/documentSymbol", { textDocument: { uri } });
            if (!res || res.length === 0) {
              return { content: [{ type: "text", text: "No document symbols found." }] };
            }

            const formatSymbol = (s: any, indent = 0): string => {
              const prefix = "  ".repeat(indent);
              const l = (s.range?.start?.line ?? s.location?.range?.start?.line ?? 0) + 1;
              let line = `${prefix}- **${s.name}** (line ${l})`;
              if (s.children && s.children.length > 0) {
                line += "\n" + s.children.map((child: any) => formatSymbol(child, indent + 1)).join("\n");
              }
              return line;
            };

            const formatted = res.map((s: any) => formatSymbol(s)).join("\n");
            return {
              content: [{ type: "text", text: `### Document Symbols:\n${formatted}` }],
              details: { count: res.length },
            };
          }

          case "rename": {
            if (params.line === undefined || params.character === undefined || !params.newName) {
              return {
                content: [{ type: "text", text: "Error: 'line', 'character' (1-based), and 'newName' are required for rename." }],
              };
            }

            const res = await client.sendRequest("textDocument/rename", {
              textDocument: { uri },
              position: { line: params.line - 1, character: params.character - 1 },
              newName: params.newName.trim(),
            });

            if (!res || (!res.changes && !res.documentChanges)) {
              return { content: [{ type: "text", text: "Rename produced no workspace edits." }] };
            }

            const fileEdits = new Map<string, any[]>();
            if (res.changes) {
              for (const [docUri, edits] of Object.entries(res.changes)) {
                fileEdits.set(fileURLToPath(docUri), edits as any[]);
              }
            }
            if (res.documentChanges) {
              for (const docChange of res.documentChanges) {
                if (docChange.textDocument?.uri && docChange.edits) {
                  fileEdits.set(fileURLToPath(docChange.textDocument.uri), docChange.edits);
                }
              }
            }

            let summary = `### Semantic Rename Proposed (${params.newName}):\n\n`;
            for (const [filePath, edits] of fileEdits.entries()) {
              summary += `**${path.relative(process.cwd(), filePath)}** (${edits.length} replacement${edits.length === 1 ? "" : "s"}):\n`;
              for (const edit of edits) {
                const l = (edit.range?.start?.line ?? 0) + 1;
                const c = (edit.range?.start?.character ?? 0) + 1;
                summary += `  - Line ${l}:${c} -> "${edit.newText}"\n`;
              }
            }

            if (params.apply) {
              for (const [filePath, edits] of fileEdits.entries()) {
                const currentContent = fs.readFileSync(filePath, "utf8");
                const newContent = applyEditsToDocument(currentContent, edits);
                fs.writeFileSync(filePath, newContent, "utf8");
              }
              summary += `\n**Successfully applied all edits to disk.**`;
            } else {
              summary += `\n*(Pass apply: true to write these changes to disk)*`;
            }

            return {
              content: [{ type: "text", text: summary }],
              details: { filesModified: fileEdits.size, applied: Boolean(params.apply) },
            };
          }

          default:
            return { content: [{ type: "text", text: `Unknown operation: ${params.operation}` }] };
        }
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `LSP operation '${params.operation}' failed: ${err.message || String(err)}` }],
          details: { error: err.message },
        };
      }
    },
  });
}
