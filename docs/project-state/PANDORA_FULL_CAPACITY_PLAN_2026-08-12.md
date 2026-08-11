# Pandora Full-Capacity Plan — Canonical Memory Mirror

**Effective date:** 2026-08-12  
**Project:** Pandora's Box / MCPMaster  
**Status:** durable source mirror for a newer owner directive; live semantic Memory write still requires independent runtime proof  
**Canonical implementation source repository:** `banataosystems/Pandoras-box`  
**Exact implementation-source commit:** `c6beae9e03d7602ac6d041206f0dadd21de712e4`  
**Implementation branch:** `feature/flutterflow-pandora-mobile-v1`

## Decision

Pandora's Box is to operate the current app at maximum practical capacity while keeping the implementation provider invisible to the owner.

The user-facing lifecycle is:

**Build → Preview → Fix → Publish → Live → Undo**

The owner must never see the word `FlutterFlow` anywhere in the Pandora app, including Advanced mode. MCP, YAML, CI, provider, token, and similar infrastructure terms are translated into plain owner language before display. The hidden app builder is not shown in the Connections surface.

## Release architecture

Pandora will not depend on the hidden builder's hosted Publish button. The target release flow is:

1. snapshot exact project state and rollback target;
2. validate proposed app changes;
3. apply only validated, governed changes and verify exact read-back;
4. automatically export the real generated Flutter source;
5. create a content-addressed source manifest and preserve the export in GitHub with parent lineage;
6. run dependency resolution, Flutter static analysis, automated tests, secret/terminology scans, responsive/visual/accessibility checks, and target builds;
7. deploy the exact tested artifact to a protected preview using the configured host adapter;
8. verify the preview;
9. request a new explicit owner approval bound to that exact candidate;
10. promote the exact approved artifact without source drift where the host supports it;
11. verify the live destination independently;
12. preserve release provenance and rollback evidence;
13. restore the last production-verified version if post-release verification fails and the release approval/policy preauthorized that rollback.

Vercel is the default web-host adapter where already configured, but the user workflow remains host-agnostic.

## New production-release rule

`productionReleaseAuthorized = false` for the current planning state.

A prior broad instruction to deploy the app is superseded for future candidates by the newer explicit owner directive: **no production/live release may occur without a separate explicit owner approval for the exact tested candidate after preview verification.**

This correction preserves the earlier authorization as historical provenance rather than deleting it.

## Premium UI/UX decision

The current project `pandoras-box-gj9hnb` is retained and redesigned rather than replaced. The visual target is Apple-level discipline and finish without copying Apple identity: phone-first, institutional, near-black/white foundation, restrained Pandora red, Light/Dark/System, precise typography/spacing, minimal motion, complete state design, accessibility, one-handed navigation, and minimum 48dp Android / 44 logical point touch targets.

Primary bottom navigation remains exactly:

- Home
- Actions
- Approvals
- Activity
- Safety

Ask Pandora is prominent, but is not a sixth bottom-navigation item.

### Current screen map

- `SplashConnection` → Launch Gate
- `SignIn` → Sign In
- `CommandCenter` → Home
- `ProjectDetails` → Project Detail
- `ActionsCatalog` → Actions
- `ActionBuilder` → Ask Pandora / Build / Fix
- `ApprovalCenter` → Approvals
- `PlansExecution` → Preview / Action Progress
- `ActivityAuditTrail` → Activity
- `SecurityOperations` → Safety

Supporting surfaces to add or standardize include Projects, Publish, Live Version, Version History/Undo, Memory Search, Settings, Roadmap, and Proof.

## Exact plan artifacts

At implementation-source commit `c6beae9e03d7602ac6d041206f0dadd21de712e4`:

- `docs/product/PANDORA_FULL_CAPACITY_MASTER_PLAN.md`
- `docs/product/PANDORA_PREMIUM_MOBILE_UX_SPEC.md`
- `docs/product/PANDORA_FULL_CAPACITY_ROADMAP.json`
- `docs/flutterflow/PANDORA_FLUTTERFLOW_BUILD_STATE.json`

The updated build-state record sets the new release rule and preserves the prior authorization under a supersession record.

## Current verified project state

The following is backed by the implementation repository's current evidence and is not upgraded by this planning record:

- documented: yes;
- implementation prepared: yes;
- exact app project ID: `pandoras-box-gj9hnb`;
- project partitioner version: 9;
- recorded schema fingerprint: `f237da5d53110b3aa14501753ed13f6687ce0033`;
- previous project defects repaired and provider read-back recorded: yes;
- rollback snapshot recorded: `15e6d5e8-bbcb-4812-b507-f20fbed88ef8`;
- governed Owner API bridge implemented/tested/deployed: yes;
- page layer fully wired to truthful live owner data: not yet proven;
- Android-first visual/navigation/accessibility QA: not yet proven;
- protected approval/extra-identity flow verified end-to-end in app: not yet proven;
- automatic generated-source release pipeline: not yet proven;
- application tested as a complete release candidate: no;
- deployed: no;
- production verified: no.

No completion percentage is recorded because the weighted roadmap/task/proof state has not yet been committed into the live canonical Memory task model. Unknown proof must not be treated as complete.

## Current phase

Planning/canon correction is implemented in the source repository. Execution should now proceed in dependency order:

1. provider-invisibility firewall and error translator;
2. premium shared design system and current-screen redesign;
3. truthful live Owner API wiring and removal of misleading mock values;
4. governed read/write/snapshot/rollback hardening;
5. automatic source export and GitHub candidate versioning;
6. Flutter analyze/tests/builds and Android-first visual/accessibility QA;
7. protected preview hosting and verification;
8. exact-candidate release approval surface and protected identity check;
9. only after separate owner approval: exact live promotion, independent live verification, and rollback evidence;
10. Android/iOS distribution and operational hardening.

## Blocker / canon caveat

This record is a durable GitHub mirror in the canonical Memory repository. During the run that created it, the ChatGPT session did **not** expose an operable Pandora Memory semantic-write connector. Therefore this document must not be misrepresented as proof that the live Memory database hard-canon item was inserted or superseded.

Required follow-up when the Memory write path is available:

- create/update the project decision/roadmap record in live Memory;
- link it to implementation-source commit `c6beae9e03d7602ac6d041206f0dadd21de712e4` and this mirror commit;
- record content hashes;
- supersede the older release-authorization decision without deleting history;
- calculate completion percentage only from the resulting weighted task/proof state;
- verify retrieval returns this newer directive.

## Next autonomous action

Continue with the provider-invisibility lint/translation layer and premium shared UI component system on the existing app candidate while completing truthful owner-data wiring. Do not promote a production/live release.
