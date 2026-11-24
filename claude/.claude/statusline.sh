#!/usr/bin/env bash
# Rosé Pine status line: model · effort · dir · git branch · context used
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

out="${rose}${model}${r}"
[ -n "$effort" ] && out+=" ${muted}·${r} ${iris}${effort}${r}"
out+=" ${muted}·${r} ${foam}${dir/#$HOME/\~}${r}"
[ -n "$branch" ] && out+=" ${muted}·${r} ${gold} ${branch}${r}"
if [ -n "$ctx" ]; then
  c=$foam; [ "${ctx%.*}" -ge 60 ] && c=$gold; [ "${ctx%.*}" -ge 85 ] && c=$love
  out+=" ${muted}·${r} ${c}ctx ${ctx%.*}%${r}"
fi
printf '%s' "$out"
