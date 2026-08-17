# GitHub MCP Actions write evidence — 2026-08-17

## Scope

This record accompanies `.github/workflows/mcp-actions-write-proof.yml`.

The workflow grants only:

- `actions: write`
- `contents: read`

It is manual-only (`workflow_dispatch`). The optional write exercise requires an explicit completed workflow run ID.

## Provider evidence

The installed GitHub MCP app has repository access to `banataosystems/pandoras-box-memory` and a real Actions write operation was accepted: workflow job `95366712885` was re-run through the GitHub connector. Workflow run `32023103208` advanced to attempt 2 and completed successfully.

This proves the external GitHub MCP installation can perform the supported Actions write operation on this repository.

## Boundary

The external GitHub MCP app permission is controlled by the GitHub App installation, not by `GITHUB_TOKEN`.

The repository-wide default `GITHUB_TOKEN` setting remains read-only. A governed attempt to change the repository-wide default to write was blocked by Pandora's break-glass control (`MCPMASTER_BREAK_GLASS_MUTATIONS=true` required), so no repository-wide permission weakening occurred.

The source workflow added by this change is narrower: it grants `actions: write` only to an explicitly dispatched job and retains `contents: read`.

## Proof stages

- documented: yes
- external MCP Actions write capability: provider-verified
- source workflow contract: implemented on the candidate branch
- exact-head repository CI: required before merge
- merged to `main`: not yet at the time this evidence was authored
- runtime deployment: not applicable
- production runtime mutation: none

## Rollback

Revert the source merge that adds the workflow and this evidence file. No database, Supabase, Vercel, Auth, application data, or production runtime rollback is required.
