# /lgtm - Ship It

Finalize and push the current changes.

## Steps

1. **Analyze changes**: Run `git diff --cached` and `git diff` to understand what's being committed
2. **Update CHANGELOG**: Add a concise entry under `## [Unreleased]` in CHANGELOG.md describing the changes. Follow the existing format (use `### Added`, `### Changed`, `### Fixed`, etc. as appropriate). Be concise - one line per logical change.
3. **Stage all changes**: Run `git add -A`
4. **Commit**: Create a commit with a clear, concise message summarizing the changes
5. **Push**: Run `git push`
6. **Confirm**: Report success or any errors

## Commit Message Format

Use conventional format:
- `Add <feature>` for new features
- `Fix <issue>` for bug fixes
- `Update <thing>` for modifications
- `Remove <thing>` for deletions

End the commit message with:
```
Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

## CHANGELOG Format

Follow Keep a Changelog format. Example entry:

```markdown
### Added

- **Feature Name**: Brief description of what was added
```

Categories: Added, Changed, Deprecated, Removed, Fixed, Security
