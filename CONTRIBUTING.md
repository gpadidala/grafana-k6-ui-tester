# Contributing to Heimdall

Thanks for considering a contribution! Heimdall is maintained by [Gopal Rao](https://github.com/gpadidala) and built for the Grafana community — every PR is reviewed personally.

## Reporting bugs

Open a [bug report](.github/ISSUE_TEMPLATE/bug_report.md) with: your Grafana version, Heimdall version, the category that failed, the exact error message, and reproduction steps. Screenshots help a lot.

## Requesting features

Open a [feature request](.github/ISSUE_TEMPLATE/feature_request.md) describing the problem you're trying to solve (not the solution). Real-world use cases get prioritized.

## Submitting pull requests

1. **Fork** the repo and create a branch from `main` (`feature/your-feature` or `fix/your-fix`)
2. **Install deps**: `cd backend && npm install && cd ../frontend && npm install`
3. **Run locally**: backend on `:4000`, frontend on `:3001` — see the [Quick Start](README.md#-quick-start)
4. **Add tests** for new test categories under `backend/src/tests/{category}/index.js` — follow the existing module shape
5. **Keep PRs focused** — one feature or one fix per PR
6. **Write clear commit messages** — `feat: add X`, `fix: handle Y`, `docs: clarify Z`
7. **Open the PR** against `main` and link any related issues

## Code style

- Backend: plain CommonJS, no TypeScript, keep runners side-effect free
- Frontend: React function components + hooks, inline styles (no CSS-in-JS lib)
- No new dependencies without discussion in an issue first

## Questions

Open a [discussion](https://github.com/gpadidala/heimdall/discussions) or reach out via the links in the [README](README.md#-license--author).
