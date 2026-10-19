#!/bin/bash
# Double-click this on a Mac to make the NotebookLM token file for upload in Team HQ (Settings → Connections → NotebookLM).
# It signs in to the team's NotebookLM account in a browser and saves master_token.json to your Desktop.
# It writes nothing to the office.

cd "$(dirname "$0")/../.." || exit 1
npm run -s notebook:make-token
status=$?
echo ""
if [ "$status" -eq 0 ]; then
  echo "Finished."
else
  echo "Did not finish. Read the message above, then run this again."
fi
read -r -p "Press Return to close." _
exit "$status"
