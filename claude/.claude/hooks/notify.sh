#!/usr/bin/env bash
# Desktop notification (dunst/notify-send) when Claude finishes or needs input.
# Suppressed when this terminal window is focused in Sway. Port of pi's notify.ts.
input=$(cat)
event=$(jq -r '.hook_event_name // empty' <<<"$input")
dir=$(basename "$(jq -r '.cwd // empty' <<<"$input")")

if [ "$event" = "Notification" ]; then
  body=$(jq -r '.message // "Needs your attention"' <<<"$input")
  urgency=critical
else
  body="Finished in ${dir:-session}"
  urgency=normal
fi

focused=$(swaymsg -t get_tree 2>/dev/null | jq -r '.. | objects | select(.focused == true) | .pid // empty' 2>/dev/null | head -n1)
if [ -n "$focused" ]; then
  pid=$$
  while [ "${pid:-1}" -gt 1 ]; do
    [ "$pid" = "$focused" ] && exit 0
    pid=$(awk '{print $4}' "/proc/$pid/stat" 2>/dev/null)
  done
fi

notify-send -a "Claude Code" -u "$urgency" "Claude Code" "$body"
exit 0
