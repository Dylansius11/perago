#!/usr/bin/env node
/**
 * Ships the committed HEAD (never the working tree) to the VPS, builds one
 * immutable image tagged by commit, applies migrations, and swaps the API and
 * worker only after both report healthy.
 *
 *   pnpm deploy:vps                 deploy HEAD
 *   pnpm deploy:vps --rollback <sha> restart a previous release (no migration)
 *
 * PERAGO_VPS_SSH (default `perago-vps`) is an OpenSSH host alias with key auth.
 * PERAGO_PUBLIC_API_URL (default below) is checked after the swap.
 */
import { spawn, spawnSync } from "node:child_process";

const HOST = process.env.PERAGO_VPS_SSH || "perago-vps";
const PUBLIC_API =
  process.env.PERAGO_PUBLIC_API_URL ||
  "https://perago-api.43-129-38-115.nip.io";
const KEEP_RELEASES = 3;

function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.trim();
}

/**
 * Stores the script before running it: executed from stdin, `docker compose
 * run` would read the rest of the script as its own input and skip it.
 */
function remote(script) {
  return new Promise((resolve, reject) => {
    const ssh = spawn(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        HOST,
        "umask 077; cat > perago/.deploy.sh && bash perago/.deploy.sh < /dev/null",
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    ssh.on("error", reject);
    ssh.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`remote step exited ${code}`)),
    );
    ssh.stdin.end(script);
  });
}

function upload(release) {
  return new Promise((resolve, reject) => {
    const archive = spawn("git", ["archive", "--format=tar", release], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const ssh = spawn(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        HOST,
        `set -eu; rm -rf perago/releases/${release}; mkdir -p perago/releases/${release}; tar -x -C perago/releases/${release}`,
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    archive.stdout.pipe(ssh.stdin);
    ssh.on("error", reject);
    ssh.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`upload exited ${code}`)),
    );
  });
}

const swap = (release, { build }) => `
set -euo pipefail
cd "$HOME/perago/releases/${release}"
export PERAGO_RELEASE=${release} PERAGO_SECRETS_DIR="$HOME/perago"
for f in api.env worker.env; do
  test -f "$PERAGO_SECRETS_DIR/$f" || { echo "missing $PERAGO_SECRETS_DIR/$f"; exit 1; }
done
compose="docker compose -f deploy/vps/compose.yml"
${build ? "$compose build api\n$compose run --rm migrate" : ""}
$compose up -d --wait --wait-timeout 240 api worker
ln -sfn "releases/${release}" "$HOME/perago/current"
cd "$HOME/perago/releases"
ls -1t | tail -n +$((${KEEP_RELEASES} + 1)) | while read -r old; do
  [ "$old" = "${release}" ] && continue
  rm -rf "$old"; docker image rm "perago:$old" >/dev/null 2>&1 || true
done
docker compose -p perago ps --format '{{.Name}} {{.Status}}'
`;

async function publicCheck() {
  for (const path of ["/health", "/config"]) {
    const response = await fetch(`${PUBLIC_API}${path}`);
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    const body = await response.json();
    console.log(
      `${PUBLIC_API}${path}`,
      JSON.stringify(
        path === "/config"
          ? { deploymentLabel: body.deploymentLabel, venue: body.venue }
          : body,
      ),
    );
  }
}

const rollbackIndex = process.argv.indexOf("--rollback");
if (rollbackIndex !== -1) {
  const release = process.argv[rollbackIndex + 1];
  if (!/^[0-9a-f]{12}$/u.test(release ?? "")) {
    throw new Error("--rollback needs a 12-character release commit");
  }
  await remote(swap(release, { build: false }));
} else {
  const release = git("rev-parse", "--short=12", "HEAD");
  if (git("status", "--porcelain", "--untracked-files=no")) {
    console.warn("note: uncommitted changes are not shipped; deploying HEAD");
  }
  console.log(`deploying ${release} to ${HOST}`);
  await upload(release);
  await remote(swap(release, { build: true }));
}
await publicCheck();
