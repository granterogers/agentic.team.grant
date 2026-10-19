// Generated from scripts/notebook/make-token.ts by esbuild. Edit the source, not this file.

// scripts/notebook/make-token.ts
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var ACCOUNT = "agentic.team.grant@gmail.com";
var home = process.env.NOTEBOOKLM_HOME ?? join(homedir(), ".notebooklm");
var profile = process.env.NOTEBOOKLM_PROFILE ?? "default";
var madeBy = join(home, "profiles", profile, "master_token.json");
var desktop = existsSync(join(homedir(), "Desktop")) ? join(homedir(), "Desktop") : homedir();
var out = join(desktop, "notebook-master-token.json");
var installed = spawnSync("notebooklm", ["--help"], { stdio: "ignore" });
if (installed.error !== void 0) {
  console.error(
    "The NotebookLM tool is not installed on this computer. Install it once, then run this again:"
  );
  console.error('  pip install "notebooklm-py[headless,browser]"');
  process.exit(1);
}
console.log(`A browser window opens. Sign in as ${ACCOUNT}, then come back to this window.`);
var login = spawnSync("notebooklm", ["login", "--master-token", "--account", ACCOUNT], {
  stdio: "inherit"
});
if (login.status !== 0 || !existsSync(madeBy)) {
  console.error("The sign-in did not finish. Nothing was saved. Run this again.");
  process.exit(1);
}
var token;
try {
  token = JSON.parse(readFileSync(madeBy, "utf8"));
} catch {
  console.error("The sign-in made a file that is not JSON. Nothing was saved. Run this again.");
  process.exit(1);
}
var master = token.master_token;
if (typeof master !== "string" || !master.startsWith("aas_et/")) {
  console.error(
    "The sign-in made a file, but not the master token file. Nothing was saved. Run this again."
  );
  process.exit(1);
}
copyFileSync(madeBy, out);
chmodSync(out, 384);
console.log(`Saved: ${out}`);
console.log(
  "Next: Team HQ \u2192 Settings \u2192 Connections \u2192 NotebookLM \u2192 Upload token, and choose that file."
);
console.log("Then delete the file from your Desktop. It is a full-account credential.");
