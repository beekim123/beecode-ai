# Skill Management

Project skills use two ownership models:

- **Committed skills** are project-specific or locally adapted instructions. Their complete directories stay in `.agents/skills/` and their Claude Code entries are committed symbolic links.
- **Locked skills** are unmodified third-party skills. Their source repository, immutable Git commit, and source directory are recorded in `.agents/skills/skills.lock.json`; their installed directories are ignored by Git.

After cloning the repository, install locked skills and create their Claude Code links:

```bash
pnpm skills:install
pnpm skills:check
```

`pnpm skills:install` never replaces an existing skill. Use `pnpm skills:install --force` only after reviewing a lock-file update or when repairing an installation. `pnpm skills:sync` recreates missing Claude Code links without downloading sources.

## Adding skills

Keep a shared custom skill in `.agents/skills/<skill-name>/` and add `.claude/skills/<skill-name>` as a symbolic link to it. Commit both entries and update `.agents/skills/INDEX.md`.

For an unmodified third-party skill, pin a full Git commit in `skills.lock.json`, add its directory and Claude link to `.gitignore`, and add it to `INDEX.md` as a locked install. Verify the upstream source directory contains `SKILL.md`, then run `pnpm skills:install` and `pnpm skills:check`.

Personal-only skills belong in the agent's user-level skill directory and should not be added to this repository. A private shared skill follows the locked-skill flow with its private Git repository; do not put credentials in `skills.lock.json`.
