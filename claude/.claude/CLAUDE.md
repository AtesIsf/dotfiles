# Global Operating Rules

Host system facts: @HOST-SYSTEM.md

- **Public files**: `~/.claude` is backed up in a public dotfiles repo.
  Never write private info (names, emails, hostnames, keys, tokens)
  into any file under it.
- **80 columns**: no line of code or config you write may exceed 80
  columns (my Neovim `colorcolumn=80`).
- **No self-installs**: never install anything yourself (pip, cargo,
  npm, curl | sh, emerge, ...). Tell me the package to install instead.
  Exception: downloading into `/tmp` is fine.
- **Git Safety**: Never execute git commands that modify or publish repository history—including `git add`, `git commit`, `git push`, or modifying remote branches—unless the user has given explicit permission within the current session.
- **Shell Operations**: Use Bash for things like `ls`, `rg`, `find`.
- **Code Intelligence**: When an LSP tool is available for the file's language, use it (diagnostics, definition, references, hover, symbols) to check semantic correctness and type safety.
- **Debugging**: When diagnosing crashes, segfaults, hangs, or subtle state bugs in compiled binaries, prefer a real debugger (`gdb`/`lldb` in batch mode, e.g. `gdb -batch -ex run -ex bt --args ./prog`) over speculative print statements or guesses.
- **Language Server & Debug Adapter Installation Policy (Strict)**:
  - Language servers and debug adapters are managed centrally via Neovim/Mason (`~/.local/share/nvim/mason/bin`).
  - When one is missing, do NOT install it via bash, package managers, pip, cargo, or npm. Ask the user to open Neovim, run `:MasonInstall <package>`, and report back.
- **Ogur by default**: On any coding task (writing, fixing, refactoring, reviewing, planning, choosing dependencies) follow the `ogur` skill at level `full` unless I pick another level or say "stop ogur". Load it with the Skill tool if it isn't already loaded. Delegated agents: `worker`, `planner` and `reviewer` preload it; when spawning any other agent for coding work, tell it to follow ogur.
- **Communication Style**:
  - Be concise in your responses.
  - Show file paths clearly when working with files.

# Subagents & workflows

- Agents `scout` (haiku/low), `worker` (sonnet/medium), `planner` and `reviewer` (opus/xhigh) carry their own model and effort; don't override them unless asked.
- Saved workflows in `~/.claude/workflows/`: `garv`, `implement`, `scout-and-plan`. The `/garv`, `/implement` and `/scout-and-plan` commands are the user's opt-in to run them.
