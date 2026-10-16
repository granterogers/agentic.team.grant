#!/bin/bash
# Double-click this on a Mac to reconnect NotebookLM for Team HQ.
# It signs in to the team's NotebookLM account in a browser, then saves the sign-in to the office vault.
# The vault write is a production write, so it asks you to type YES first. Nothing is changed unless you do.

cd "$(dirname "$0")/../.." || exit 1

echo "Reconnect NotebookLM for Team HQ"
echo ""
echo "This signs in to the team's NotebookLM account and saves the sign-in to the office vault."
echo "It changes the live office, so it needs your confirmation."
echo ""
read -r -p "Type YES to continue: " answer
if [ "$answer" != "YES" ]; then
  echo "Stopped. Nothing was changed."
  read -r -p "Press Return to close." _
  exit 0
fi

# The two production flags are set for this one run only, after the YES above.
ALLOW_PRODUCTION_WRITES=1 ALLOW_PRODUCTION_CHECKS=1 npm run -s notebook:reconnect
status=$?
echo ""
if [ "$status" -eq 0 ]; then
  echo "Finished."
else
  echo "Did not finish. Read the message above, then run this again."
fi
read -r -p "Press Return to close." _
exit "$status"
