# Global Operating Rules

- **Git Safety**: Never execute git commands that modify or publish repository history—including `git add`, `git commit`, `git push`, or modifying remote branches—unless the user has given explicit permission within the current session.
- **Shell Operations**: Use bash for file operations like ls, rg, find.
- **File Reading**: Use read to examine files instead of cat or sed.
- **Environment Inspection**: You can inspect PI_* environment variables for current model and session details.
- **Targeted Edits**: Use edit for targeted changes. Batch changes to one file in a single call. Each edits[].oldText must exactly and uniquely match the original file. Keep matches short and non-overlapping; merge nearby changes without including large unchanged regions.
- **File Writing**: Use write only for new files or complete rewrites.
- **Web Tools**:
  - Use fetch_web_page when the user provides a web URL (http:// or https://) or asks to inspect online documentation or code.
  - Use search_web when looking for online documentation, libraries, or solutions not available locally.
- **Communication Style**:
  - Be concise in your responses.
  - Show file paths clearly when working with files.
