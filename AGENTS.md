# easyHR repository workflow

- Canonical remote: https://github.com/mavv7/easyHR.git
- The user requests that updates be committed and pushed to this repository after relevant checks pass. This is standing authorization; do not ask for push permission again unless a new risk or conflicting instruction requires it.
- Never force-push or overwrite remote changes. Fetch and reconcile safely when needed.
- Keep environment files, credentials, node_modules and generated build output out of commits. Only placeholder `.env.example` files may be committed.
- Follow `mobile/AGENTS.md` for application changes. Run its required checks before pushing application changes.
- Report the pushed branch and commit, or clearly report any authentication/network blocker.
