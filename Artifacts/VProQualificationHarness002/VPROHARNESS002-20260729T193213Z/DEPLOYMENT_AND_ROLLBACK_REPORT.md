# Deployment and Rollback Report

Deployment model: run directly from the source-controlled repository under the
normal non-elevated operator identity. This retains the qualified mapped `X:`
visibility and introduces no credentials, service, scheduled task, alternate
network path, or machine policy change.

Publication consists of the runner/module, schema, reviewed configurations,
VPro acceptance source, README, and local test fixtures. Runtime attempts are
written beneath configured local lab roots and are not committed.

Rollback is Git reversion/removal of this bounded tool and configurations.
Existing direct Customer Master and Invoice History tools were not deleted or
changed. No protected installation or elevated deployment occurred.
