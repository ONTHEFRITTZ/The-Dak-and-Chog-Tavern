Branching Model
===============

Branches
- main: Live production. Protected; deploys only from approved merges.
- experimental: Day-to-day work. Create PRs from here; merge into `main` when ready.

Quick Setup (Preferred)
- Run the script: `scripts/setup-branches.ps1`
- Push to remote too: `scripts/setup-branches.ps1 -Push`
- The script creates `experimental` if missing.

Manual Setup (Alternative)
Run these from the repo root:

1) Ensure you are on your main line (replace `main` with `master` if needed):

   git checkout main

2) Create `experimental` from `main`:

   git branch experimental main

3) Optionally switch to `experimental` to continue work:

   git checkout experimental

Pushing to Remote (optional)
- Push the branch the first time:

  git push -u origin experimental

Recommended Workflow
- Work on `experimental` (or feature branches off it).
- Open a PR into `main` when ready; require 1 approval.
- Merge via squash with commit message containing `deploy: yes` (see CI gate below).
- GitHub Actions deploys after environment approval (production).

Deployment Safety
- CI requires explicit intent when pushing to `main`:
  - Add `deploy: yes` or `[deploy]` to the merge commit message, OR
  - Manually run the workflow from the Actions tab.
- Protect `main` in GitHub Settings > Branches:
  - Require pull request, 1 approval, linear history.
  - Restrict who can push.
- Protect the `production` Environment (Settings > Environments) to require manual approval.

Notes
- If your default branch is `master`, substitute `main` with `master` above.
- Consider making `experimental` your default branch in repo settings so local clones start there.

