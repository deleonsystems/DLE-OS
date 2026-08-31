import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/TestIdentitiesUi.cs', 'utf8');
const program = fs.readFileSync('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/Program.cs', 'utf8');
const identityUi = fs.readFileSync('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/DevelopmentIdentityUi.cs', 'utf8');
const migration = fs.readFileSync('Tools/SecurityFoundation/Database/009_AddDevKittingTestPersona.sql', 'utf8');
const provisioner = fs.readFileSync('Tools/DevelopmentRuntime/Provision-DevTestKittingIdentity.ps1', 'utf8');

assert.match(program, /html = TestIdentitiesUi\.Inject\(html\)/,
  'the registry is injected only by the isolated DEV frontend');
assert.match(ui, /id="dle-test-identities-open"[^>]*hidden>Test Identities<\/button>/);
assert.match(ui, /getElementById\('dleDevControlsUtilities'\)/);
assert.match(ui, /event\.detail\?\.isSuperAdmin!==true/,
  'only SUPER_ADMIN can open the Development Tools registry');
assert.match(ui, /Object\.freeze\(\[\s*Object\.freeze\(\{/,
  'personas are represented by a small reusable immutable registry');
for (const value of [
  "name:'Kitting Operator'", "username:'dev.kitting'", "type:'DEV TEST PERSONA'",
  "workspace:'Kitting'", "privilege:'Operator'", "superAdmin:'No'", "status:'Active'",
  "purpose:'Simulates a normal Kitting operator during development.'"
]) assert.match(ui, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(ui, /copy\.textContent='Copy Username'/);
assert.match(ui, /navigator\.clipboard\.writeText\(persona\.username\)/);
assert.doesNotMatch(ui, /password|credential|secret/i,
  'the Test Identities UI contains no credential surface');
assert.match(identityUi, /kittingWorkspaceAvailable:body\.isSuperAdmin===true\|\|granted\.has\('kitting\.view'\)/);
assert.match(identityUi, /workspaceRules=Object\.freeze\(\{'dle-home':null,kitting:'kitting\.view',production:'kitting\.view',purchasing:'kitting\.view','operations-center':'sync\.operations'\}\)/);

assert.match(migration, /DB_NAME\(\) <> N'DLE_OS_SECURITY_DEV'/);
assert.match(migration, /RoleCode='DEV_KITTING_OPERATOR'/);
assert.match(migration, /IsSystemRole,IsSuperAdmin,IsActive[\s\S]*?1,0,1,@Actor/);
for (const permission of ['kitting.view','kitting.disposition','work_orders.view','pick_list.view','rma_rework.view'])
  assert.match(migration, new RegExp(`\\('${permission.replace('.', '\\.')}'`));
assert.match(migration, /A DEV test persona must not be linked to an employee/);
assert.match(migration, /dev\.kitting must not receive SUPER_ADMIN/);
assert.doesNotMatch(migration, /INSERT\s+security\.UserEmployeeLink/i);
assert.doesNotMatch(migration, /dev\.purchasing|dev\.receiving|dev\.production|dev\.quality/i);

assert.match(provisioner, /Read-Host 'Initial password' -AsSecureString/);
assert.match(provisioner, /Read-Host 'Confirm initial password' -AsSecureString/);
assert.match(provisioner, /temporary=\$false/,
  'the operator-chosen credential is stored only in Keycloak and does not require a DLE-OS reveal step');
assert.match(provisioner, /CredentialRecorded=\$false/);
assert.match(provisioner, /Get-RealIdentitySnapshot/);
assert.match(provisioner, /NormalizedUserName IN \(N'MIGUEL',N'DANIEL'\)/);
assert.match(provisioner, /Provisioning-Client\|v1/,
  'the established scoped Keycloak provisioning client is reused');
assert.doesNotMatch(provisioner, /SUPER_ADMIN.*INSERT|INSERT.*SUPER_ADMIN/i);

console.log('DEV Test Identities registry contracts: PASS');
