#!/bin/sh
# One line at session start: what the wv plugin needs and what is missing. Never blocks; the whop-setup skill does the rest.
missing=""
node_v=$(node -v 2>/dev/null | sed 's/^v//')
if [ -z "$node_v" ]; then
  missing="$missing node 22.6+ (https://nodejs.org);"
else
  major=${node_v%%.*}; rest=${node_v#*.}; minor=${rest%%.*}
  if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 6 ]; }; then missing="$missing node 22.6+ (have $node_v);"; fi
fi
command -v whop >/dev/null 2>&1 || missing="$missing the whop CLI (curl -fsSL https://whop.sh | sh, then whop login);"
if [ -n "$missing" ]; then
  echo "wv: not ready yet. Missing:$missing Then ask for the whop-setup skill."
else
  echo "wv: ready. The wv tools plan every write and ask you before it runs. Start with \"how is my Whop business doing\" or \"set up my Whop business\"."
fi
exit 0
