Branching Model
===============

Branches
- stable: Production‑ready, reviewed changes only. Protected from direct commits.
- experimental: Work‑in‑progress changes. Merge to `stable` via PR once verified.

Quick Setup (Preferred)
- Run the script: `scripts/setup-branches.ps1`
- Push to remote too: `scripts/setup-branches.ps1 -Push`
- The script picks `main`, then `master`, else current branch as base, then creates `stable` and `experimental` if missing.

Manual Setup (Alternative)
Run these from the repo root:

1) Ensure you are on your main line (replace `main` with `master` if needed):

   git checkout main

2) Create `stable` from main:

   git branch stable

3) Create `experimental` from `stable`:

   git branch experimental stable

4) Optionally switch to `experimental` to continue work:

   git checkout experimental

Pushing to Remote (optional)
- Push branches the first time:

  git push -u origin stable
  git push -u origin experimental

Recommended Workflow
- Do feature work on short‑lived branches off `experimental`.
- Test, then open a PR from feature → experimental.
- After validation, open a PR from experimental → stable.
- Tag releases from `stable` (e.g., v1.2.3).

Notes
- If your default branch is `master`, substitute `main` with `master` above.
- Default branch changes (e.g., making `stable` default) happen on the hosting platform (GitHub/GitLab) settings.
