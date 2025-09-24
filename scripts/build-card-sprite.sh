#!/usr/bin/env bash
set -euo pipefail
CARD_PNG="assets/images/cards/cards-sprite.png"
BASE="assets/images/cards/cards-sprite"
if [ -f "$CARD_PNG" ]; then
  cwebp -q 85 "$CARD_PNG" -o "$BASE.webp"
  avifenc --min 20 --max 35 "$CARD_PNG" "$BASE.avif"
else
  echo "PNG sheet not found at $CARD_PNG" 1>&2; exit 1
fi
