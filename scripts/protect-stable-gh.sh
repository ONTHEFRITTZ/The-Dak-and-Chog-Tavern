#!/usr/bin/env bash
set -euo pipefail

# Protect the 'stable' branch on GitHub via gh CLI + API
# Requirements: gh (GitHub CLI) logged in: gh auth login -w
# Usage: bash scripts/protect-stable-gh.sh [owner repo]

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) not found. Install with: sudo apt-get install -y gh" >&2
  exit 1
fi

OWNER=${1:-}
REPO=${2:-}

if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  url=$(git config --get remote.origin.url || true)
  if [[ "$url" =~ github.com[:/]{1}([^/]+)/([^/.]+) ]]; then
    OWNER="${BASH_REMATCH[1]}"
    REPO="${BASH_REMATCH[2]}"
  fi
fi

if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  echo "Could not determine owner/repo. Provide explicitly: $0 OWNER REPO" >&2
  exit 1
fi

echo "Protecting $OWNER/$REPO branch 'stable'..."
gh api \
  -X PUT \
  -H "Accept: application/vnd.github+json" \
  \
  repos/$OWNER/$REPO/branches/stable/protection \
  --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true
}
JSON

echo "Branch protection applied to 'stable'."

