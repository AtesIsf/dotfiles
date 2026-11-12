/**
 * Web Tools Extension for Pi
 *
 * Provides native tools for fetching and reading web pages (converting HTML to clean Markdown)
 * and searching the web.
 *
 * Tools:
 * - fetch_web_page: Retrieves and converts web pages, GitHub repositories, and docs into clean Markdown.
 * - search_web: Performs web searches and returns structured titles, snippets, and URLs.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_CONTENT_LENGTH = 50 * 1024; // 50 KB text cap
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";

/** Clean and convert HTML to structured Markdown text */
function htmlToMarkdown(html: string, url: string): string {
  let title = "";
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
  }

  // Strip non-content tags
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "");

  // Prioritize article, main, or GitHub markdown body if available
  const mainMatch =
    cleaned.match(/<article[\s\S]*?<\/article>/i) ||
    cleaned.match(/<main[\s\S]*?<\/main>/i) ||
    cleaned.match(/<div[^>]*class="[^"]*markdown-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  if (mainMatch) {
    cleaned = mainMatch[0];
  }

  // Format Headings
  cleaned = cleaned.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, level, text) => "\n\n" + "#".repeat(Number(level)) + " " + text.replace(/<[^>]+>/g, "").trim() + "\n\n"
  );

  // Format Code Blocks
  cleaned = cleaned.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
    return "\n```\n" + code.replace(/<[^>]+>/g, "") + "\n```\n";
  });
  cleaned = cleaned.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => "`" + code.replace(/<[^>]+>/g, "") + "`");

  // Format Links
  cleaned = cleaned.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const linkText = text.replace(/<[^>]+>/g, "").trim();
    if (!linkText || href.startsWith("javascript:") || href.startsWith("#")) return linkText || "";
    let fullUrl = href;
    if (href.startsWith("/")) {
      try {
        const u = new URL(url);
        fullUrl = `${u.protocol}//${u.host}${href}`;
      } catch {
        fullUrl = href;
      }
    }
    return `[${linkText}](${fullUrl})`;
  });

  // Format Lists
  cleaned = cleaned.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => {
    return "\n- " + text.replace(/<[^>]+>/g, "").trim();
  });

  // Format Paragraphs and Linebreaks
  cleaned = cleaned.replace(/<p[^>]*>/gi, "\n\n").replace(/<\/p>/gi, "");
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n");
  cleaned = cleaned.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => {
    return "\n> " + text.replace(/<[^>]+>/g, "").trim() + "\n";
  });

  // Strip remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Normalize whitespace
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, "\n\n").trim();

  let result = (title ? `# ${title}\n\nURL: ${url}\n\n` : `URL: ${url}\n\n`) + cleaned;
  if (result.length > MAX_CONTENT_LENGTH) {
    result = result.slice(0, MAX_CONTENT_LENGTH) + "\n\n[...Content truncated after 50KB...]";
  }
  return result;
}

/** Check if URL is a GitHub repo and try fetching raw README first */
async function tryFetchGitHubReadme(urlStr: string): Promise<string | null> {
  const match = urlStr.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/?$/i);
  if (!match) return null;

  const [, owner, repo] = match;
  const branches = ["main", "master", "HEAD"];

  for (const branch of branches) {
    for (const file of ["README.md", "readme.md", "README"]) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file}`;
        const res = await fetch(rawUrl, {
          headers: { "User-Agent": USER_AGENT },
        });
        if (res.ok) {
          const text = await res.text();
          return `# ${owner}/${repo} (README from GitHub)\nURL: ${urlStr}\n\n${text}`;
        }
      } catch {
        // Continue to next branch/file
      }
    }
  }
  return null;
}

export default function webToolsExtension(pi: ExtensionAPI) {
  // 1. Register fetch_web_page
  pi.registerTool({
    name: "fetch_web_page",
    label: "Fetch Web Page",
    description: "Fetch and read the content of a web page or URL as clean markdown/text.",
    promptSnippet: "Fetch and read the content of a web page as markdown",
    promptGuidelines: [
      "Use fetch_web_page when the user provides a web URL (http:// or https://) or asks to inspect online documentation or code.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The HTTP or HTTPS URL to fetch" }),
    }),
    async execute(toolCallId, params, signal) {
      const targetUrl = params.url.trim();

      // Check GitHub repo shortcut
      const githubReadme = await tryFetchGitHubReadme(targetUrl);
      if (githubReadme) {
        return {
          content: [{ type: "text", text: githubReadme }],
          details: { url: targetUrl, source: "github-raw" },
        };
      }

      try {
        const res = await fetch(targetUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          },
          signal: signal ?? undefined,
        });

        if (!res.ok) {
          return {
            content: [{ type: "text", text: `Error: HTTP ${res.status} ${res.statusText} while fetching ${targetUrl}` }],
            details: { url: targetUrl, status: res.status },
          };
        }

        const rawText = await res.text();
        const contentType = res.headers.get("content-type") || "";

        let outputText: string;
        if (contentType.includes("application/json") || contentType.includes("text/plain")) {
          outputText = `URL: ${targetUrl}\n\n` + rawText;
          if (outputText.length > MAX_CONTENT_LENGTH) {
            outputText = outputText.slice(0, MAX_CONTENT_LENGTH) + "\n\n[...Content truncated...]";
          }
        } else {
          outputText = htmlToMarkdown(rawText, targetUrl);
        }

        return {
          content: [{ type: "text", text: outputText }],
          details: { url: targetUrl, status: res.status },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Failed to fetch ${targetUrl}: ${err?.message || String(err)}` }],
          details: { url: targetUrl, error: err?.message },
        };
      }
    },
  });

  // 2. Register search_web
  pi.registerTool({
    name: "search_web",
    label: "Search Web",
    description: "Search the web and return top relevant results with titles, snippets, and URLs.",
    promptSnippet: "Search the web for documentation, libraries, or articles",
    promptGuidelines: [
      "Use search_web when looking for online documentation, libraries, or solutions not available locally.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query string" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Maximum results (default: 5)" })),
    }),
    async execute(toolCallId, params, signal) {
      const query = params.query.trim();
      const limit = params.limit ?? 5;
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

      try {
        const res = await fetch(ddgUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          },
          signal: signal ?? undefined,
        });

        if (!res.ok) {
          return {
            content: [{ type: "text", text: `Search request returned HTTP ${res.status} ${res.statusText}` }],
            details: { query, status: res.status },
          };
        }

        const html = await res.text();
        const results: Array<{ title: string; url: string; snippet: string }> = [];

        const blocks = html.split("<div class=\"result results_links");
        for (let i = 1; i < blocks.length && results.length < limit; i++) {
          const block = blocks[i];
          const titleMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
          const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);

          if (titleMatch) {
            const rawHref = titleMatch[1];
            const title = titleMatch[2].replace(/<[^>]+>/g, "").trim();
            const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "";

            let finalUrl = rawHref;
            if (rawHref.includes("uddg=")) {
              const u = rawHref.split("uddg=")[1].split("&")[0];
              finalUrl = decodeURIComponent(u);
            }
            if (finalUrl.startsWith("//")) {
              finalUrl = "https:" + finalUrl;
            }

            results.push({ title, url: finalUrl, snippet });
          }
        }

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `No web results found for: "${query}"` }],
            details: { query, count: 0 },
          };
        }

        const formatted = results
          .map((r, idx) => `${idx + 1}. **[${r.title}](${r.url})**\n   ${r.snippet}`)
          .join("\n\n");

        return {
          content: [{ type: "text", text: `### Web Search Results for "${query}"\n\n${formatted}` }],
          details: { query, count: results.length },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Web search error for "${query}": ${err?.message || String(err)}` }],
          details: { query, error: err?.message },
        };
      }
    },
  });
}
