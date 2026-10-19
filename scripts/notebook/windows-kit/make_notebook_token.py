"""Make the NotebookLM token file for Team HQ (issue #502). Windows, Mac or Linux.

Double-click "Make NotebookLM Token.bat" on Windows (or run this file with Python 3.9 or newer).

It does three things and touches nothing else:
  1. installs the NotebookLM tool, once (pip);
  2. opens a browser, where you sign in as the team's account, and saves the sign-in the tool makes;
  3. checks that file is the master token file, and copies it to your Desktop as notebook-master-token.json.

Then, in Team HQ: Settings -> Connections -> NotebookLM -> Upload token, and choose that file. Then delete it.
The file is a full-account credential. This program sends it nowhere.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ACCOUNT = "agentic.team.grant@gmail.com"
PACKAGE = "notebooklm-py[headless,browser]"
OUT_NAME = "notebook-master-token.json"


def say(text=""):
    print(text, flush=True)


def home_dir() -> Path:
    # The tool keeps its sign-in under ~/.notebooklm unless NOTEBOOKLM_HOME says otherwise.
    custom = os.environ.get("NOTEBOOKLM_HOME")
    return Path(custom) if custom else Path.home() / ".notebooklm"


def token_path() -> Path:
    profile = os.environ.get("NOTEBOOKLM_PROFILE", "default")
    return home_dir() / "profiles" / profile / "master_token.json"


def desktop() -> Path:
    # Windows often keeps the Desktop under OneDrive; use whichever exists.
    for candidate in (Path.home() / "Desktop", Path.home() / "OneDrive" / "Desktop"):
        if candidate.is_dir():
            return candidate
    return Path.home()


def main() -> int:
    say("Team HQ: making the NotebookLM token file")
    say("")
    if sys.version_info < (3, 9):
        say("This needs Python 3.9 or newer. Install it from https://www.python.org/downloads/")
        say("(tick 'Add python.exe to PATH'), then double-click the file again.")
        return 1

    say("Step 1 of 3: installing the NotebookLM tool. The first time this takes a few minutes.")
    installed = subprocess.run([sys.executable, "-m", "pip", "install", "--upgrade", PACKAGE])
    if installed.returncode != 0:
        say("The NotebookLM tool could not be installed. Check the internet connection, then run this again.")
        return 1

    say("")
    say(f"Step 2 of 3: a browser window opens. Sign in as {ACCOUNT}, complete any two-step check,")
    say("then come back to this window. (The first time, the tool also downloads its browser: about 170 MB.)")
    login = subprocess.run(
        [sys.executable, "-m", "notebooklm", "login", "--master-token", "--account", ACCOUNT]
    )
    made = token_path()
    if login.returncode != 0 or not made.is_file():
        say("The sign-in did not finish, so nothing was saved. Run this again.")
        return 1

    say("")
    say("Step 3 of 3: checking the file and saving it to your Desktop.")
    try:
        record = json.loads(made.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        say("The sign-in made a file that is not readable. Nothing was saved. Run this again.")
        return 1
    master = record.get("master_token") if isinstance(record, dict) else None
    if not isinstance(master, str) or not master.startswith("aas_et/"):
        say("The sign-in made a file, but not the master token file. Nothing was saved. Run this again.")
        return 1

    out = desktop() / OUT_NAME
    shutil.copyfile(made, out)
    try:
        os.chmod(out, 0o600)
    except OSError:
        pass  # Windows keeps its own permissions; the file is still only in your account.

    say("")
    say(f"Saved: {out}")
    say("")
    say("Next: Team HQ -> Settings -> Connections -> NotebookLM -> Upload token, and choose that file.")
    say("Then delete the file from your Desktop. It is a full-account credential.")
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except KeyboardInterrupt:
        say("Stopped. Nothing was saved.")
        code = 1
    sys.exit(code)
