## Summary

<!-- What problem does this solve, and for whom? -->

## Type of change

- [ ] Bug fix
- [ ] Documentation
- [ ] New policy rule or health check
- [ ] ContribSpec schema change (needs RFC + migration)
- [ ] AI provider or capability
- [ ] CLI / Action change
- [ ] Internal refactor

## Testing

<!-- How did you verify it? Paste the command and the result, not "tests pass". -->

```
corepack pnpm verify
```

## Checklist

- [ ] Every commit is signed off (`git commit -s`)
- [ ] Tests cover the new behaviour (pass, fail, skip, and a hostile input where relevant)
- [ ] `docs/` and `CHANGELOG.md` updated for user-visible changes
- [ ] No new write path without a gate, an audit event, and documentation
- [ ] Determinism preserved: no wall clock, network, or randomness in rules
- [ ] No secrets, tokens, or private repository names in this PR or its tests

## Related issues

<!-- Closes #123 -->
