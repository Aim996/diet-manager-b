# INSTALL-FIRST-RUN-001 — first-install prerequisite and Task 15 regression contract

## Symptom

On a fresh gateway without the plugin configuration entry, installation failed schema validation because `official_data_root` was absent. After adding the required entry, tool calls returned `PLUGIN_RUNTIME_UNAVAILABLE` until the configured runtime root already existed.

## Component-boundary evidence

The CLI schema boundary requires the plugin configuration field before installation can validate. Passing that boundary alone does not create the application runtime prerequisite. The plugin runtime boundary requires an existing, absolute, backend-owned official data root accessible to its runtime user. Once a dedicated existing root with mode `0700` was present, the same smoke route passed.

This is evidence of an installer/bootstrap boundary, not a business-action defect: the healthy installed plugin accepted the smoke route after its runtime prerequisite existed.

## Root cause

The current package assumes an already-provisioned official runtime root while a clean environment has neither a valid plugin configuration entry nor that root. The present CLI flow validates configuration but does not atomically provision and verify the corresponding runtime state before activation.

## Verified interim preconditions

For the completed interim hotfix acceptance, an operator prepared all of the following before smoke testing:

- a supported plugin configuration entry containing an absolute official runtime root;
- an existing backend-owned dedicated runtime root, created by the runtime user with mode `0700`;
- an initialized SQLite database and authority-secret file within the private runtime boundary; and
- enabled plugin state, followed by a healthy tool smoke.

This is an interim manual-environment procedure, not the future public installation interface. It must not be represented as a recommendation to edit configuration data directly.

## Mandatory Task 15 regression requirements

Task 15 must add and keep automated regression coverage proving all of the following:

1. Missing required configuration or runtime root fails before any partial activation.
2. The supported installer creates a dedicated, resolved, non-root runtime path with safe permissions.
3. The installer writes configuration only through the supported OpenClaw interface.
4. The initial database has zero business rows.
5. The installer restarts the plugin and proves a tool smoke after activation.
6. A failure rolls back configuration, plugin/program state, and data as applicable, leaving no partial installation.

Acceptance of this work item requires a clean-environment test that exercises both failure and success paths without embedding paths, access material, or production data in repository evidence.
