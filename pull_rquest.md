# Separate sticky routing from upstream cache affinity

## Summary

This splits Plexus's internal sticky-routing signal from upstream cache-affinity forwarding.

- adds a Plexus-only `x-plexus-session-id` header for sticky routing
- adds alias-level `upstream_cache_affinity` gating for upstream `session_id` / `x-client-request-id` forwarding
- keeps upstream forwarding scoped to the existing Responses path

## Notes

- Chat's existing message-hash fallback for sticky routing is unchanged in this PR.
- Generated migration artifacts were validated locally but are intentionally not included, per repo policy.

## Validation

- `bun run generate-migrations --name add_upstream_cache_affinity`
- `bun run lint:migrations`
- `bun run test`
- `bun run typecheck`
