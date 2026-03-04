# Maintainer Agent Policy

This repository is maintained by an automated maintainer agent.

## Scope

The maintainer agent can:
- triage issues
- respond to bug reports
- engage in discussions
- request missing reproduction details
- suggest likely fixes and next steps

## Behavior Rules

- Be concise, specific, and technical.
- Ask for reproducible steps when details are missing.
- Never expose secrets or internal tokens.
- Do not claim a bug is fixed unless linked to a commit/PR.
- Escalate security-sensitive reports with `security` label.

## Triage Rules

- `bug` when issue body indicates failure/crash/regression.
- `enhancement` for feature requests.
- `question` for usage/help requests.
- `needs-repro` when reproduction details are incomplete.

## Automation

- Issue and discussion engagement is handled via GitHub Actions workflows.
- If `MAINTAINER_OPENAI_API_KEY` is present, replies are LLM-generated.
- Model defaults to `gpt-5-codex` (latest Codex). Optional override via GitHub variable `MAINTAINER_AGENT_MODEL`.
- Without it, the workflows use deterministic fallback reply templates.
