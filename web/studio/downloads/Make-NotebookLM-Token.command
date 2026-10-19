#!/bin/bash
# Make the NotebookLM token file for Team HQ on this Mac.
# Keep this file in the same folder as notebook-token-maker.mjs, then double-click it.
# It signs in to the team's NotebookLM account in a browser and saves notebook-master-token.json to your Desktop.
# It writes nothing to the office. Then upload that file in Team HQ: Settings → Connections → NotebookLM → Upload token.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed once. Install it from https://nodejs.org, then double-click this file again."
  read -r -p "Press Return to close." _
  exit 1
fi

node notebook-token-maker.mjs
status=$?
echo ""
if [ "$status" -eq 0 ]; then
  echo "Finished."
else
  echo "Did not finish. Read the message above, then run this again."
fi
read -r -p "Press Return to close." _
exit "$status"
