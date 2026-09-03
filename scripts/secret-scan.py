#!/usr/bin/env python3
"""Secret scan — run before every commit, and in CI.

Two independent checks over git-tracked files:

1. **Exact-value scan.** Every environment variable value in this session is
   searched for verbatim. This is the check that actually catches a real leak,
   because it needs no pattern to be right.
2. **Pattern scan.** Known credential shapes, which catches secrets that were
   never in this session's environment (a value pasted from elsewhere).

Exit 1 on any finding. Never prints a secret value — findings report the
variable name and file only.
"""
from __future__ import annotations
import os, re, subprocess, sys

# Environment variables whose values are not secrets and legitimately appear in
# documentation: branch names, paths, hostnames, public identifiers.
NON_SECRET_VARS = {
    "PATH", "HOME", "PWD", "OLDPWD", "SHELL", "TERM", "LANG", "LS_COLORS", "_",
    "no_proxy", "NO_PROXY", "http_proxy", "https_proxy", "HTTP_PROXY",
    "HTTPS_PROXY", "npm_config_noproxy", "npm_config_https_proxy",
    "GLOBAL_AGENT_NO_PROXY", "GLOBAL_AGENT_HTTPS_PROXY", "JAVA_TOOL_OPTIONS",
    "YARN_HTTPS_PROXY", "DOCKER_HTTPS_PROXY", "CLOUDSDK_PROXY_TYPE",
    "CLOUDSDK_PROXY_ADDRESS", "CLOUDSDK_PROXY_PORT",
    "CLAUDE_CODE_BASE_REF", "CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE",
    "CLAUDE_CODE_PROXY_RESOLVES_HOSTS", "PLAYWRIGHT_BROWSERS_PATH",
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "ELECTRON_GET_USE_PROXY",
    # Public by design: the Supabase URL and publishable/anon key are meant to
    # reach browser code. The *secret* key is not, and is deliberately absent.
    "NEXT_PUBLIC_SUPABASE_URL",
    # Public Slack identifiers. The client ID is published in the install URL
    # and the app ID in every dashboard link, so both legitimately appear in
    # documentation. SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET are NOT here.
    "SLACK_CLIENT_ID", "SLACK_APP_ID", "SLACK_TEAM_ID",
    # Non-secret halves of the backup target: the S3 endpoint, region and bucket
    # name are configuration. The key id and secret are not listed.
    "BACKUP_S3_ENDPOINT", "BACKUP_S3_REGION", "BACKUP_S3_BUCKET",
}

# CI runners inject their own metadata: GITHUB_REPOSITORY, GITHUB_SERVER_URL,
# GITHUB_ACTOR and friends. Those values are public by definition and appear
# legitimately in documentation, so scanning for them verbatim produces nothing
# but false positives.
#
# Rather than enumerate them — a list that goes stale the moment GitHub adds a
# variable — exclude these namespaces EXCEPT where the name looks credential-
# bearing. That fails safe in the direction that matters: a newly added public
# variable is ignored, while GITHUB_TOKEN, ACTIONS_RUNTIME_TOKEN and
# ACTIONS_ID_TOKEN_REQUEST_TOKEN stay scanned. The prefixes are deliberately
# narrow so this can never swallow an application credential.
CI_METADATA_PREFIXES = ("GITHUB_", "RUNNER_", "ACTIONS_")
CREDENTIAL_WORDS = ("TOKEN", "SECRET", "KEY", "PASSWORD", "PASSWD", "CREDENTIAL", "AUTH")


def is_ci_metadata(name: str) -> bool:
    """True for a CI-injected variable whose value is public by definition."""
    if not name.startswith(CI_METADATA_PREFIXES):
        return False
    return not any(word in name for word in CREDENTIAL_WORDS)


# Values shorter than this are too collision-prone to scan for.
MIN_VALUE_LEN = 12

PATTERNS = {
    "slack token":            r"xox[abposr]-[A-Za-z0-9-]{10,}",
    "slack config token":     r"xoxe(?:\.xox[pb])?-[A-Za-z0-9-]{10,}",
    "openai key":             r"sk-proj-[A-Za-z0-9_\-]{20,}",
    "openrouter key":         r"sk-or-v1-[a-f0-9]{20,}",
    "supabase access token":  r"sbp_[a-f0-9]{20,}",
    "supabase secret key":    r"sb_secret_[A-Za-z0-9_\-]{20,}",
    "jwt":                    r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}",
    "google api key":         r"AIza[A-Za-z0-9_\-]{30,}",
    "telegram bot token":     r"\b\d{8,12}:[A-Za-z0-9_\-]{30,}\b",
    "postgres url password":  r"postgres(?:ql)?://[^:\s/@]+:[^@\s]+@",
    "aws access key id":      r"\bAKIA[0-9A-Z]{16}\b",
    "private key block":      r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----",
}

# Documentation must be able to describe a credential's *shape* without tripping
# the scanner. A line carrying this marker is exempt from the pattern scan only;
# the exact-value scan still applies and cannot be opted out of.
ALLOW_MARKER = "secret-scan:allow-shape"


def tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z"], capture_output=True, text=True, check=True
    ).stdout
    return [f for f in out.split("\0") if f and os.path.isfile(f)]


def main() -> int:
    findings: list[str] = []
    files = tracked_files()

    env = {
        k: v
        for k, v in os.environ.items()
        if k not in NON_SECRET_VARS and not is_ci_metadata(k) and len(v) >= MIN_VALUE_LEN
    }

    for path in files:
        try:
            text = open(path, "rb").read().decode("utf-8", "replace")
        except OSError as exc:
            findings.append(f"{path}: unreadable ({exc})")
            continue

        for name, value in env.items():
            if value in text:
                line = next(
                    (i for i, l in enumerate(text.splitlines(), 1) if value in l), 0
                )
                findings.append(f"{path}:{line}: value of ${name} appears verbatim")

        for lineno, line in enumerate(text.splitlines(), 1):
            if ALLOW_MARKER in line:
                continue
            for label, pattern in PATTERNS.items():
                if re.search(pattern, line):
                    findings.append(f"{path}:{lineno}: looks like a {label}")

    if findings:
        print(f"SECRET SCAN FAILED — {len(findings)} finding(s):", file=sys.stderr)
        for f in findings:
            print(f"  {f}", file=sys.stderr)
        print(
            "\nNo secret value is printed above. Inspect the named line yourself.",
            file=sys.stderr,
        )
        return 1

    print(f"Secret scan clean: {len(files)} tracked files, {len(env)} env values checked.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
