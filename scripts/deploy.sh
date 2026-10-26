#!/usr/bin/env bash
# Updates a VPS install (docs/deploy-vps.md): pulls the code, rebuilds API and worker and,
# when WEB_DIR is set in .env, rebuilds the web app and publishes it to that folder.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env here. See docs/deploy-vps.md, step 5."; exit 1; }
# Read single values instead of sourcing .env (values may contain characters a shell would interpret).
value() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
WEB_DIR=$(value WEB_DIR || true)
VITE_API_URL=$(value VITE_API_URL || true)

git pull --ff-only
docker compose -f docker-compose.prod.yml up -d --build

if [ -n "$WEB_DIR" ]; then
  [ -n "$VITE_API_URL" ] || { echo "Set VITE_API_URL in .env to publish the web app."; exit 1; }
  [ -d "$WEB_DIR" ] || { echo "WEB_DIR $WEB_DIR doesn't exist. Create the static site in CloudPanel first (step 8)."; exit 1; }
  out=$(mktemp -d)
  trap 'rm -rf "$out"' EXIT
  docker build --target web --build-arg VITE_API_URL="$VITE_API_URL" --output "type=local,dest=$out" .
  # Copy over the old files instead of replacing the folder: a tab still open on the previous
  # version can keep loading its own chunks.
  cp -r "$out"/. "$WEB_DIR"/
  chown -R "$(stat -c %U:%G "$WEB_DIR")" "$WEB_DIR"
  echo "Web app published to $WEB_DIR"
fi

docker image prune -f >/dev/null
echo "Done."
