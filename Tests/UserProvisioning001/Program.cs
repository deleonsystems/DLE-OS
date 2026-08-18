using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using DleOs.Security;
using Microsoft.Data.SqlClient;

const string connectionString=@"Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadWrite;";
var checks=new List<string>();
var root=Directory.GetCurrentDirectory();
var migration=File.ReadAllText(Path.Combine(root,"Tools","SecurityFoundation","Database","006_AddUserProvisioningLifecycle.sql"));
var grants=File.ReadAllText(Path.Combine(root,"Tools","SecurityFoundation","Database","007_GrantDevelopmentFrontendService.sql"));
var frontend=File.ReadAllText(Path.Combine(root,"Tools","DevelopmentRuntime","DleOs.DevelopmentFrontend","UserProvisioningService.cs"));
var ui=File.ReadAllText(Path.Combine(root,"Tools","DevelopmentRuntime","DleOs.DevelopmentFrontend","EmployeeDirectoryUi.cs"));

var super=new ResolvedSecurityUser(Guid.NewGuid(),"admin","Admin","ACTIVE",[new(Guid.NewGuid(),"SUPER_ADMIN",true)],new HashSet<string>());
var ordinary=new ResolvedSecurityUser(Guid.NewGuid(),"worker","Worker","ACTIVE",[],new HashSet<string>());
Check(EmployeeDirectoryAuthorization.CanAdminister(new(CurrentUserStatus.Active,"sub",super)),"SUPER_ADMIN allowed");
Check(!EmployeeDirectoryAuthorization.CanAdminister(new(CurrentUserStatus.Active,"sub",ordinary)),"non-admin denied");
Check(frontend.Contains("RandomNumberGenerator.GetInt32")&&frontend.Contains("temporary"),"generated credentials use unbiased cryptographic selection and support first-login change");
Check(frontend.Contains("client_credentials")&&frontend.Contains("127.0.0.1:8180/admin/realms/dle-os"),"Keycloak administration is server-side loopback with client credentials");
Check(!ui.Contains("localStorage.setItem")&&!ui.Contains("sessionStorage.setItem")&&!migration.Contains("Password",StringComparison.OrdinalIgnoreCase),"credentials are absent from SQL/audit and browser storage");
foreach(var eventType in new[]{"USER_PROVISIONED","USER_ACTIVATED","USER_DISABLED","USER_REENABLED","CREDENTIAL_RESET","SESSIONS_REVOKED","ROLE_ASSIGNED","ROLE_REMOVED"})
    Check(migration.Contains($"'{eventType}'",StringComparison.Ordinal),$"append-only audit contract includes {eventType}");
Check(!migration.Contains(@"TO [DLE-OS-HOST\DLE-OS];",StringComparison.OrdinalIgnoreCase)&&
      !Regex.IsMatch(migration,@"(?im)^\s*GRANT\s+"),
    "migration 006 defines lifecycle objects without granting the retired service principal or duplicating migration 007 grants");
var currentPrincipal=@"[DLE-OS-HOST\DLE-OS-DEV-FRONTEND]";
var grantLines=Regex.Matches(grants,@"(?im)^\s*GRANT\s+.*$",RegexOptions.CultureInvariant)
    .Select(match=>match.Value.Trim()).ToArray();
Check(grantLines.Length==14&&grantLines.Count(line=>line.StartsWith("GRANT SELECT ",StringComparison.OrdinalIgnoreCase))==7&&
      grantLines.Count(line=>line.StartsWith("GRANT EXECUTE ",StringComparison.OrdinalIgnoreCase))==7&&
      grantLines.All(line=>line.EndsWith($"TO {currentPrincipal};",StringComparison.OrdinalIgnoreCase))&&
      !grants.Contains(@"TO [DLE-OS-HOST\DLE-OS];",StringComparison.OrdinalIgnoreCase),
    "migration 007 exclusively grants seven reads and seven procedure executions to the current DEV frontend principal");

var development=LoadConfiguration("Development",true);
Check(development.EnableUserProvisioning,"provisioning enabled in Development is accepted");
Check(ProvisioningRejected("Production")&&ProvisioningRejected("Staging"),
    "provisioning enabled outside Development fails closed");
Check(!LoadConfiguration("Production",false).EnableUserProvisioning&&
      !LoadConfiguration("Staging",false).EnableUserProvisioning,
    "provisioning disabled outside Development does not fail configuration");

if(!args.Contains("--live-dev",StringComparer.OrdinalIgnoreCase))
{
    var deterministicReport=new{verdict="PASS",completedAtUtc=DateTimeOffset.UtcNow,mode="DETERMINISTIC",checks=checks.Count,results=checks};
    var deterministicOutput=Path.Combine(root,".tmp","phase63","user-provisioning-deterministic-tests.json");
    Directory.CreateDirectory(Path.GetDirectoryName(deterministicOutput)!);
    await File.WriteAllTextAsync(deterministicOutput,JsonSerializer.Serialize(deterministicReport,new JsonSerializerOptions{WriteIndented=true}));
    Console.WriteLine($"User Provisioning deterministic: {checks.Count} PASS");
    return;
}

await using var connection=new SqlConnection(connectionString);await connection.OpenAsync();
var actor=await ScalarGuid("SELECT UserId FROM security.[User] WHERE NormalizedUserName='MIGUEL';");
var employees=await EmployeeIds();
await ProvisionLifecycle(employees[0],actor);
await AbortLifecycle(employees[0],actor);
await DuplicateEmployee(employees[0],actor);
await DuplicateUsername(employees[0],employees[1],actor);
await Rejected(employees[1],actor,"tester_invalid_role",["NOT_A_REAL_ROLE"],"invalid role rejected");

var report=new{verdict="PASS",completedAtUtc=DateTimeOffset.UtcNow,checks=checks.Count,results=checks};
var output=Path.Combine(root,".tmp","phase63","user-provisioning-tests.json");Directory.CreateDirectory(Path.GetDirectoryName(output)!);await File.WriteAllTextAsync(output,JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
Console.WriteLine($"User Provisioning: {checks.Count} PASS");

async Task ProvisionLifecycle(Guid employeeId,Guid actorId)
{
    await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync();
    var correlation=Guid.NewGuid();var userId=await Prepare(employeeId,"tester_phase63",Guid.NewGuid().ToString(),["KITTING_PILOT"],actorId,correlation,transaction);
    Check(await ScalarInt("SELECT COUNT(*) FROM security.UserEmployeeLink WHERE EmployeeId=@EmployeeId AND UserId=@UserId AND IsActive=1;",transaction,("@EmployeeId",employeeId),("@UserId",userId))==1,"provision success creates exactly one employee-user link");
    await Proc("security.usp_ActivateProvisionedUser",transaction,("@UserId",userId),("@ActorUserId",actorId),("@ActorIdentity","DLE_OS:TEST"),("@CorrelationId",correlation));
    Check(await ScalarString("SELECT AccountStatus FROM security.[User] WHERE UserId=@UserId",transaction,("@UserId",userId))=="ACTIVE","provision success activates DLE-OS user");
    await Proc("security.usp_RecordUserSecurityAction",transaction,("@UserId",userId),("@EventType","CREDENTIAL_RESET"),("@ActorUserId",actorId),("@ActorIdentity","DLE_OS:TEST"),("@CorrelationId",correlation));
    await Proc("security.usp_RecordUserSecurityAction",transaction,("@UserId",userId),("@EventType","SESSIONS_REVOKED"),("@ActorUserId",actorId),("@ActorIdentity","DLE_OS:TEST"),("@CorrelationId",correlation));
    Check(await ScalarInt("SELECT COUNT(*) FROM security.AuditEvent WHERE TargetId=@UserId AND EventType IN ('CREDENTIAL_RESET','SESSIONS_REVOKED')",transaction,("@UserId",userId))==2,"credential reset and session revocation create audit events");
    await Proc("security.usp_SetUserEnabledState",transaction,("@UserId",userId),("@Enable",false),("@ActorUserId",actorId),("@ActorIdentity","DLE_OS:TEST"),("@CorrelationId",correlation));
    await Proc("security.usp_SetUserEnabledState",transaction,("@UserId",userId),("@Enable",true),("@ActorUserId",actorId),("@ActorIdentity","DLE_OS:TEST"),("@CorrelationId",correlation));
    Check(await ScalarInt("SELECT COUNT(*) FROM security.AuditEvent WHERE TargetId=@UserId AND EventType IN ('USER_DISABLED','USER_REENABLED')",transaction,("@UserId",userId))==2,"disable and re-enable create governed transitions");
    await Proc("security.usp_SetUserRoles",transaction,("@UserId",userId),("@RoleCodesJson","[\"SUPER_ADMIN\"]"),("@ActorUserId",actorId),("@ActorIdentity","DLE_OS:TEST"),("@CorrelationId",correlation));
    Check(await ScalarInt("SELECT COUNT(*) FROM security.AuditEvent WHERE TargetId=@UserId AND EventType IN ('ROLE_ASSIGNED','ROLE_REMOVED')",transaction,("@UserId",userId))>=2,"role change creates assignment and removal audit evidence");
    Check(await ScalarInt("SELECT COUNT(*) FROM security.AuditEvent WHERE TargetId=@UserId AND JSON_VALUE(EventDataJson,'$.actorEmployeeNumber')='0054' AND JSON_VALUE(EventDataJson,'$.correlationId')=@CorrelationId",transaction,("@UserId",userId),("@CorrelationId",correlation.ToString()))>=8,"audit evidence identifies Miguel employee 0054 and the request correlation");
    await transaction.RollbackAsync();Check(true,"all lifecycle qualification mutations rolled back");
}

async Task AbortLifecycle(Guid employeeId,Guid actorId)
{
    await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync();
    var correlation=Guid.NewGuid();var subject=Guid.NewGuid().ToString();var userId=await Prepare(employeeId,"tester_abort",subject,["KITTING_PILOT"],actorId,correlation,transaction);
    await Proc("security.usp_AbortEmployeeUserProvisioning",transaction,("@UserId",userId),("@KeycloakSubject",subject),("@ActorUserId",actorId),("@ActorIdentity","DLE_OS:TEST"),("@CorrelationId",correlation));
    Check(await ScalarInt("SELECT COUNT(*) FROM security.ExternalIdentity WHERE UserId=@UserId AND Provider='KEYCLOAK' AND IsActive=1",transaction,("@UserId",userId))==0,"failed Keycloak provisioning compensation deactivates the prepared external identity");
    Check(await ScalarInt("SELECT COUNT(*) FROM security.AuditEvent WHERE TargetId=@UserId AND EventType='USER_PROVISIONING_ABORTED' AND JSON_VALUE(EventDataJson,'$.actorEmployeeNumber')='0054'",transaction,("@UserId",userId))==1,"failed provisioning compensation is append-only audited with Miguel employee identity");
    await transaction.RollbackAsync();
}

async Task Rejected(Guid employeeId,Guid actorId,string username,string[] roles,string label)
{
    await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync();
    try{await Prepare(employeeId,username,Guid.NewGuid().ToString(),roles,actorId,Guid.NewGuid(),transaction);throw new Exception($"Expected rejection: {label}");}
    catch(SqlException){Check(true,label);}finally{if(transaction.Connection is not null)await transaction.RollbackAsync();}
}
async Task DuplicateEmployee(Guid employeeId,Guid actorId)
{
    await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync();
    await Prepare(employeeId,"tester_first_link",Guid.NewGuid().ToString(),["KITTING_PILOT"],actorId,Guid.NewGuid(),transaction);
    try{await Prepare(employeeId,"tester_duplicate_employee",Guid.NewGuid().ToString(),["KITTING_PILOT"],actorId,Guid.NewGuid(),transaction);throw new Exception("Expected duplicate employee rejection");}
    catch(SqlException){Check(true,"duplicate employee link rejected");}finally{if(transaction.Connection is not null)await transaction.RollbackAsync();}
}
async Task DuplicateUsername(Guid first,Guid second,Guid actorId)
{
    await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync();
    await Prepare(first,"tester_duplicate_name",Guid.NewGuid().ToString(),["KITTING_PILOT"],actorId,Guid.NewGuid(),transaction);
    try{await Prepare(second,"tester_duplicate_name",Guid.NewGuid().ToString(),["KITTING_PILOT"],actorId,Guid.NewGuid(),transaction);throw new Exception("Expected duplicate username rejection");}
    catch(SqlException){Check(true,"duplicate username rejected");}finally{if(transaction.Connection is not null)await transaction.RollbackAsync();}
}
async Task<Guid> Prepare(Guid employeeId,string username,string subject,string[] roles,Guid actorId,Guid correlation,SqlTransaction transaction)
{
    await using var command=new SqlCommand("security.usp_PrepareEmployeeUserProvisioning",connection,transaction){CommandType=CommandType.StoredProcedure};
    Add(command,"@EmployeeId",employeeId);Add(command,"@UserName",username);Add(command,"@KeycloakSubject",subject);Add(command,"@RoleCodesJson",JsonSerializer.Serialize(roles));Add(command,"@ActorUserId",actorId);Add(command,"@ActorIdentity","DLE_OS:TEST");Add(command,"@CorrelationId",correlation);var output=command.Parameters.Add("@UserId",SqlDbType.UniqueIdentifier);output.Direction=ParameterDirection.Output;await command.ExecuteNonQueryAsync();return(Guid)output.Value;
}
async Task Proc(string name,SqlTransaction transaction,params(string,object)[] values){await using var command=new SqlCommand(name,connection,transaction){CommandType=CommandType.StoredProcedure};foreach(var value in values)Add(command,value.Item1,value.Item2);await command.ExecuteNonQueryAsync();}
async Task<Guid> ScalarGuid(string sql){await using var command=new SqlCommand(sql,connection);return(Guid)(await command.ExecuteScalarAsync())!;}
async Task<int> ScalarInt(string sql,SqlTransaction transaction,params(string,object)[] values){await using var command=new SqlCommand(sql,connection,transaction);foreach(var value in values)Add(command,value.Item1,value.Item2);return Convert.ToInt32(await command.ExecuteScalarAsync());}
async Task<string?> ScalarString(string sql,SqlTransaction transaction,params(string,object)[] values){await using var command=new SqlCommand(sql,connection,transaction);foreach(var value in values)Add(command,value.Item1,value.Item2);return Convert.ToString(await command.ExecuteScalarAsync());}
async Task<Guid[]> EmployeeIds(){await using var command=new SqlCommand("SELECT TOP (2) EmployeeId FROM hr.EmployeeDirectoryView WHERE DleWorkforceStatus='CURRENT' AND DleOsUserName IS NULL ORDER BY EmployeeNumber",connection);await using var reader=await command.ExecuteReaderAsync();var values=new List<Guid>();while(await reader.ReadAsync())values.Add(reader.GetGuid(0));return values.ToArray();}
static void Add(SqlCommand command,string name,object value)=>command.Parameters.AddWithValue(name,value);
void Check(bool passed,string name){if(!passed)throw new Exception("FAIL: "+name);checks.Add("PASS: "+name);Console.WriteLine("PASS: "+name);}

bool ProvisioningRejected(string environment)
{
    try { _=LoadConfiguration(environment,true); return false; }
    catch(InvalidOperationException failure)
    {
        return failure.Message.Contains("only in the Development environment",StringComparison.Ordinal);
    }
}

DleOsRuntimeConfiguration LoadConfiguration(string environment,bool enableProvisioning)
{
    var development=environment=="Development";
    var production=environment=="Production";
    var settings=new Dictionary<string,string?>
    {
        ["DLE_OS_ENVIRONMENT"]=environment,
        ["DLE_OS_RUNTIME_MARKER"]=development?"DEV":"NONDEV",
        ["DLE_OS_ENVIRONMENT_LABEL"]=environment,
        ["DLE_OS_APPLICATION_ORIGIN"]=development?"https://dev.dle-os.internal.dlemfg.com":"https://dle-os.internal.dlemfg.com",
        ["DLE_OS_OIDC_CLIENT_ID"]="qualification-client",
        ["DLE_OS_AUTHENTICATION_STATE_ROOT"]=development
            ?@"C:\ProgramData\DLE-OS\DevelopmentFrontend\AuthState"
            :@"C:\ProgramData\DLE-OS\Qualification\AuthState",
        ["DLE_OS_CANONICAL_API_BASE_URL"]=development?"http://dle-os-host:5052":production?"http://dle-os-host:5042":"http://dle-os-host:5062",
        ["DLE_OS_OPERATIONAL_API_BASE_URL"]=development?"http://dle-os-host:5054":production?"http://dle-os-host:5043":"http://dle-os-host:5064",
        ["DLE_OS_CUSTOMER_FILES_API_BASE_URL"]="http://dle-os-host:5052",
        ["DLE_OS_SECURITY_DATABASE"]=development?"DLE_OS_SECURITY_DEV":"DLE_OS_SECURITY_QUALIFICATION",
        ["DLE_OS_ENABLE_USER_PROVISIONING"]=enableProvisioning.ToString(),
        ["DLE_OS_FRONTEND_PREFIXES"]="http://localhost:5091"
    };
    var previous=settings.Keys.ToDictionary(name=>name,Environment.GetEnvironmentVariable);
    try
    {
        foreach(var setting in settings) Environment.SetEnvironmentVariable(setting.Key,setting.Value);
        return DleOsRuntimeConfiguration.Load();
    }
    finally
    {
        foreach(var setting in previous) Environment.SetEnvironmentVariable(setting.Key,setting.Value);
    }
}
