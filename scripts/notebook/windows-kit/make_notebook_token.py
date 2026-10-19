"""Make the NotebookLM token file for Team HQ (issue #502). Windows, Mac or Linux.

Double-click "Make NotebookLM Token.bat" on Windows (or run this file with Python 3.9 or newer).

It does three things and touches nothing else:
  1. installs the NotebookLM tool, once (pip);
  2. opens a Google Chrome window, where you sign in as the account that holds your notebooks, and
     saves the sign-in the tool makes;
  3. checks that file is the master token file, and copies it to your Desktop as notebook-master-token.json.

Step 2 uses your own Chrome, not the tool's browser. The tool's browser was closed by the library during
sign-in ("Target page, context or browser has been closed"), so this kit starts Chrome itself with a
debugging port and the tool attaches to that window. The window stays open until the tool says it is done.

Then, in Team HQ: Settings -> Services -> NotebookLM -> Upload token, and choose that file. Then delete it.
The file is a full-account credential. This program sends it nowhere.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

DEFAULT_ACCOUNT = "agentic.team.grant@gmail.com"
PACKAGE = "notebooklm-py[headless,browser]"
OUT_NAME = "notebook-master-token.json"
# The port Chrome listens on for the tool. Loopback only: Chrome refuses other addresses for this.
DEBUG_PORT = 9222
DEBUG_URL = f"http://127.0.0.1:{DEBUG_PORT}"
# How long to wait for the Chrome window to answer on the port before giving up on it.
CHROME_WAIT_SECONDS = 30


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


def chrome_path() -> Path | None:
    """Google Chrome's program file, in the places Windows installs it, or None if it is not there."""
    for variable in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        root = os.environ.get(variable)
        if not root:
            continue
        candidate = Path(root) / "Google" / "Chrome" / "Application" / "chrome.exe"
        if candidate.is_file():
            return candidate
    return None


def debugger_running() -> bool:
    """True when a Chrome with the debugging port open is answering on it."""
    try:
        with urllib.request.urlopen(DEBUG_URL + "/json/version", timeout=2):
            return True
    except (OSError, ValueError):
        return False


def wait_for_debugger(seconds: int) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if debugger_running():
            return True
        time.sleep(1)
    return debugger_running()


def open_chrome(chrome: Path) -> None:
    """Start Chrome with the debugging port, in its own profile folder, on the Google sign-in page."""
    profile = Path.home() / "team-hq-chrome"
    subprocess.Popen(
        [
            str(chrome),
            f"--remote-debugging-port={DEBUG_PORT}",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "https://accounts.google.com/",
        ]
    )


def ask_account():
    """The Google account that holds the NotebookLM notebooks. It is not necessarily the team's address."""
    say("Which Google account holds your NotebookLM notebooks?")
    say("Type its email address, or press Enter to use " + DEFAULT_ACCOUNT + ".")
    typed = input("Google account: ").strip()
    account = typed or DEFAULT_ACCOUNT
    if "@" not in account or " " in account:
        say("That does not look like an email address.")
        return None
    return account


def run_login(account: str, attach: bool) -> int:
    command = [sys.executable, "-m", "notebooklm", "login", "--master-token", "--account", account]
    if attach:
        command += ["--cdp-url", DEBUG_URL]
    return subprocess.run(command).returncode


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
    account = ask_account()
    if account is None:
        say("No account was given. Nothing was changed. Run this again.")
        return 1

    say("")
    say(f"Step 2 of 3: sign in as {account}.")
    attach = debugger_running()
    if attach:
        say("Using the Chrome window that is already open for this.")
    else:
        chrome = chrome_path()
        if chrome is None:
            say("Google Chrome was not found, so the tool will open its own browser instead.")
            say("If that window closes before the sign-in is done, install Google Chrome and run this again.")
        else:
            open_chrome(chrome)
            say("A Google Chrome window opens on the Google sign-in page.")
            attach = wait_for_debugger(CHROME_WAIT_SECONDS)
            if not attach:
                say("That Chrome window did not start in time, so the tool will open its own browser instead.")
    say("Sign in as " + account + " in that window and complete any two-step check.")
    say("Keep the window open until this black window says the sign-in is done.")
    say("(The first time, the tool also downloads its browser: about 170 MB.)")
    login_code = run_login(account, attach)

    made = token_path()
    if login_code != 0 or not made.is_file():
        say("")
        say("The sign-in did not finish, so nothing was saved. Run this again.")
        if attach:
            say("The Chrome window can be closed now.")
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
    say("Next: Team HQ -> Settings -> Services -> NotebookLM -> Upload token, and choose that file.")
    say("Then delete the file from your Desktop. It is a full-account credential.")
    if attach:
        say("The Chrome window can be closed now.")
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except KeyboardInterrupt:
        say("Stopped. Nothing was saved.")
        code = 1
    sys.exit(code)
