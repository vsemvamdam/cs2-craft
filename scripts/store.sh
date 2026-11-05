#!/usr/bin/env bash
# Keeps the price/history stores as assets of the "data-store" GitHub release, so the git
# history stays small. Usage: scripts/store.sh pull|push <name>  (prices, history, nades-raw, nades-proc, nades-site)   (needs GH_TOKEN)
set -euo pipefail
action="$1"; name="$2"
TAG="data-store"
FILE="$name-store.tar.gz"
mkdir -p store
if [ "$action" = "pull" ]; then
  if gh release download "$TAG" -p "$FILE" -D /tmp --clobber 2>/dev/null; then
    tar -xzf "/tmp/$FILE" -C store
    echo "restored $FILE ($(du -sh store/$name | cut -f1))"
  else
    echo "no $FILE yet — starting empty"
  fi
else
  if [ ! -d "store/$name" ]; then echo "nothing to save for $name"; exit 0; fi
  tar -czf "/tmp/$FILE" -C store "$name"
  if ! gh release view "$TAG" >/dev/null 2>&1; then
    gh release create "$TAG" --title "Хранилище данных (автоматически)" --notes "Служебный релиз: архивы цен и истории для сайта. Обновляется GitHub Actions, не удаляйте." --latest=false
  fi
  gh release upload "$TAG" "/tmp/$FILE" --clobber
  echo "saved $FILE ($(du -h /tmp/$FILE | cut -f1))"
fi
