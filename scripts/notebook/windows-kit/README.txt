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
  5. A Google Chrome window opens on the Google sign-in page. Sign in with that
     account in THAT window and complete any two-step check.
  6. Keep that Chrome window open. The black window says when the sign-in is
     done, and then the Chrome window can be closed.
  7. The file notebook-master-token.json is saved to your Desktop.
  8. In Team HQ go to Settings -> Services -> NotebookLM, choose that file,
     and press "Upload token".
  9. Delete notebook-master-token.json from your Desktop.

If Google Chrome is not installed, the tool opens its own browser instead. If
that window closes before the sign-in is done, install Google Chrome from
https://www.google.com/chrome/ and run the batch file again.

The file is a full-account credential. Do not email it or paste it anywhere.
