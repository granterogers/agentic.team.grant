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
import json, os, re, subprocess, sys

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

# Tooling injects its own metadata, and those values legitimately appear in
# tracked files:
#
# - CI runners set GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_ACTOR — public
#   by definition, and all over the documentation.
# - npm sets npm_package_scripts_* and npm_lifecycle_script to the literal text
#   of package.json's scripts, so every one of them "appears verbatim" in
#   package.json. Found the hard way: running this via `npm run` reported four
#   findings that running it directly did not.
#
# Rather than enumerate them — a list that goes stale the moment a tool adds a
# variable — exclude these namespaces EXCEPT where the name looks credential-
# bearing. That fails safe in the direction that matters: a newly added public
# variable is ignored automatically, while GITHUB_TOKEN, ACTIONS_RUNTIME_TOKEN,
# ACTIONS_ID_TOKEN_REQUEST_TOKEN and NPM_TOKEN stay scanned. The prefixes are
# deliberately narrow so this can never swallow an application credential.
CI_METADATA_PREFIXES = (
    "GITHUB_",
    "RUNNER_",
    "ACTIONS_",
    "npm_",
    "NPM_",
    "YARN_",
    "PNPM_",
    "VITEST_",
)
CREDENTIAL_WORDS = ("TOKEN", "SECRET", "KEY", "PASSWORD", "PASSWD", "CREDENTIAL", "AUTH")


def is_ci_metadata(name: str) -> bool:
    """True for a tool-injected variable whose value is public by definition."""
    if not name.startswith(CI_METADATA_PREFIXES):
        return False
    return not any(word in name.upper() for word in CREDENTIAL_WORDS)


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
    # This project's own MCP client tokens (ADR-0014). Prefixed `mcp_` for
    # exactly this reason: a credential shape we mint is a credential shape we
    # can teach the scanner, and one that only ever exists in a vault-adjacent
    # table and a Telegram message should never appear in a file.
    "mcp client token":       r"\bmcp_[A-Za-z0-9_\-]{32,}",
    "private key block":      r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----",
    # Google session cookies (Gate 2). Distinct from an API key in kind, not
    # just in value: these authenticate as the signed-in human across Google,
    # so a leak is a different category of incident from a leaked key.
    "google session cookie":  r"\bsidts-[A-Za-z0-9_\-]{20,}",
    "google psid cookie":     r"\bg\.a[0-9]{3}[A-Za-z0-9_\-]{40,}",
    # Gate 2's durable credentials. The master token is full-account and
    # long-lived, so it is the single most damaging string in this system.
    "google master token":    r"\baas_et/[A-Za-z0-9_\-]{20,}",
    # A service-account key file, which is what Cloud Text-to-Speech needs.
    # Matched on the two fields that only appear together in one: a leaked one
    # authenticates as the account with whatever roles it holds, and unlike a
    # session cookie it does not expire on its own.
    "google service account": r'"type"\s*:\s*"service_account"',
    "google private key id":  r'"private_key_id"\s*:\s*"[a-f0-9]{20,}"',
    "google embeddedsetup token": r"\boauth2_4/[A-Za-z0-9_\-]{20,}",
    "google oauth access token":  r"\bya29\.[A-Za-z0-9_\-]{20,}",
}

# Documentation and test fixtures must be able to state a credential's *shape*
# without tripping the scanner. A line carrying this marker — or the line
# immediately after it, since a trailing comment often will not fit — is exempt
# from the PATTERN scan only.
#
# The exact-value scan still applies and cannot be opted out of, which is the
# division that matters: the shape exemption covers fabricated examples, while
# a real environment value appearing verbatim is never excusable.
ALLOW_MARKER = "secret-scan:allow-shape"


def scanned_files() -> list[str]:
    """Tracked files PLUS untracked ones git would include.

    `git ls-files` alone lists only what is already committed, which meant a
    pre-commit run could not see the very files about to land. That is not a
    theoretical gap: a new workflow file passed the scan locally and failed it
    in CI minutes later, because locally it was still untracked.

    `--others --exclude-standard` adds untracked files while still honouring
    .gitignore, so an ignored .env is not dragged in.
    """
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    seen: dict[str, None] = {}
    for f in out.split("\0"):
        if f and os.path.isfile(f):
            seen[f] = None
    return list(seen)


def main() -> int:
    findings: list[str] = []
    files = scanned_files()

    env = {
        k: v
        for k, v in os.environ.items()
        if k not in NON_SECRET_VARS and not is_ci_metadata(k) and len(v) >= MIN_VALUE_LEN
    }

    # A credential that is itself a JSON document needs its *contents* scanned,
    # not just the whole blob. NOTEBOOK_COOKIES is a cookie export: the whole
    # document appearing verbatim in a file is unlikely, while one cookie value
    # copied into a debug line or a test fixture is exactly the plausible leak —
    # and the full-blob comparison would sail straight past it.
    #
    # Each cookie value is registered as its own secret, so the existing
    # exact-value scan covers it with no further special-casing.
    for container in ("NOTEBOOK_COOKIES", "NOTEBOOK_STORAGE_STATE", "NOTEBOOK_CANDIDATE_STATE"):
        raw = os.environ.get(container, "")
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except ValueError:
            continue
        cookies = parsed.get("cookies", []) if isinstance(parsed, dict) else parsed
        if not isinstance(cookies, list):
            continue
        for cookie in cookies:
            if not isinstance(cookie, dict):
                continue
            value = cookie.get("value")
            name = cookie.get("name", "?")
            if isinstance(value, str) and len(value) >= MIN_VALUE_LEN:
                env[f"{container}[{name}]"] = value

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

        source_lines = text.splitlines()
        for lineno, line in enumerate(source_lines, 1):
            previous = source_lines[lineno - 2] if lineno >= 2 else ""
            if ALLOW_MARKER in line or ALLOW_MARKER in previous:
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

    print(f"Secret scan clean: {len(files)} files, {len(env)} env values checked.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
