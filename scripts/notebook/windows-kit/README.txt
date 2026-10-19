NotebookLM token maker for Team HQ (Windows)
=============================================

This makes the file Team HQ needs to reconnect NotebookLM. You do it on your own PC,
and the file is then uploaded in Team HQ.

ONE-TIME SETUP
  1. Install Python 3.9 or newer from https://www.python.org/downloads/
     On the first screen tick "Add python.exe to PATH".

EACH TIME
  2. Unzip NotebookLM-Token-Maker.zip into any folder.
  3. Double-click "Make NotebookLM Token.bat".
  4. The window asks which Google account holds your NotebookLM notebooks. Type
     its email address (it is not necessarily the team's address), or press Enter
     for the default.
  5. A browser opens. Sign in with that account and complete any two-step check.
     Then come back to the black window.
  6. The file notebook-master-token.json is saved to your Desktop.
  7. In Team HQ go to Settings -> Connections -> NotebookLM, choose that file,
     and press "Upload token".
  8. Delete notebook-master-token.json from your Desktop.

The file is a full-account credential. Do not email it or paste it anywhere.
