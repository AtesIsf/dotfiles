#!/usr/bin/env bash
# Rosé Pine status line: <model> | <effort> | <context %>
in=$(cat)

rose=$'\e[38;2;235;188;186m' iris=$'\e[38;2;196;167;231m' foam=$'\e[38;2;156;207;216m'
gold=$'\e[38;2;246;193;119m' love=$'\e[38;2;235;111;146m' muted=$'\e[38;2;110;106;134m' r=$'\e[0m'

IFS=$'\t' read -r model effort ctx < <(jq -r '[
  (.model.display_name // "?"),
  ((.effort | if type == "object" then .level else . end) // .effort_level // "-"),
  ((.context_window.used_percentage // 0) | floor)
] | @tsv' <<<"$in")

c=$foam; [ "$ctx" -ge 60 ] && c=$gold; [ "$ctx" -ge 85 ] && c=$love
sep=" ${muted}|${r} "
printf '%s' "${rose}${model}${r}${sep}${iris}${effort}${r}${sep}${c}${ctx}%${r}"
