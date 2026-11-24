#!/usr/bin/env bash
# Rosé Pine status line: dir · git branch (pure-style) · model · effort · context used
in=$(cat)
q() { jq -r "$1 // empty" <<<"$in"; }

rose=$'\e[38;2;235;188;186m' foam=$'\e[38;2;156;207;216m' iris=$'\e[38;2;196;167;231m'
gold=$'\e[38;2;246;193;119m' love=$'\e[38;2;235;111;146m' muted=$'\e[38;2;110;106;134m' r=$'\e[0m'

model=$(q '.model.display_name')
effort=$(q '.effort_level // .effort')
[ -z "$effort" ] && effort=$(jq -r '.effortLevel // empty' ~/.claude/settings.json 2>/dev/null)
dir=$(q '.workspace.current_dir // .cwd')
branch=$(git -C "$dir" branch --show-current 2>/dev/null)
ctx=$(q '.context_window.used_percentage')

dirty="" ab=""
if [ -n "$branch" ]; then
  [ -n "$(git --no-optional-locks -C "$dir" status --porcelain 2>/dev/null | head -n1)" ] && dirty="*"
  read -r behind ahead < <(git --no-optional-locks -C "$dir" rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null)
  [ "${behind:-0}" -gt 0 ] && ab+="⇣"
  [ "${ahead:-0}" -gt 0 ] && ab+="⇡"
fi

# Pure-style order: dir, git branch (dirty/ahead/behind), then Claude info
out="${foam}${dir/#$HOME/\~}${r}"
[ -n "$branch" ] && out+=" ${muted}${branch}${dirty}${r}${ab:+ ${foam}${ab}${r}}"
out+=" ${muted}·${r} ${rose}${model}${r}"
[ -n "$effort" ] && out+=" ${muted}·${r} ${iris}${effort}${r}"
if [ -n "$ctx" ]; then
  c=$foam; [ "${ctx%.*}" -ge 60 ] && c=$gold; [ "${ctx%.*}" -ge 85 ] && c=$love
  out+=" ${muted}·${r} ${c}ctx ${ctx%.*}%${r}"
fi
printf '%s' "$out"
