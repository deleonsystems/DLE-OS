using System.Data;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.SqlClient;

public sealed record ProvisionEmployeeUserRequest(
    Guid EmployeeId,
    string UserName,
    string[] RoleCodes,
    string? InitialPassword,
    bool GeneratePassword,
    bool RequirePasswordChange = true);

public sealed record ResetUserCredentialRequest(
    Guid UserId,
    string? Password,
    bool GeneratePassword,
    bool RequirePasswordChange = true);

public sealed record SetUserRolesRequest(Guid UserId, string[] RoleCodes);
public sealed record SetUserEnabledRequest(Guid UserId);
public sealed record RevokeUserSessionsRequest(Guid UserId);

public sealed record ProvisioningRole(
    string RoleCode,string DisplayName,string? Description,bool IsSuperAdmin,string[] Permissions);
public sealed record ProvisioningHistory(string EventType,string ActorIdentity,string? EventDataJson,DateTime RecordedAtUtc);
public sealed record EmployeeUserAdministration(
    Guid EmployeeId,string? EmployeeNumber,string DisplayName,string? ProposedUserName,string ProvisioningStatus,
    Guid? UserId,string? UserName,string? AccountStatus,string? KeycloakSubject,
    IReadOnlyList<ProvisioningRole> AvailableRoles,IReadOnlyList<string> AssignedRoles,
    IReadOnlyList<ProvisioningHistory> History);
public sealed record OneTimeCredentialResult(Guid UserId,string? InitialPassword,bool RequirePasswordChange);

public sealed class UserProvisioningException(string code,string message,HttpStatusCode status = HttpStatusCode.BadRequest,
    Exception? inner = null) : Exception(message,inner)
{
    public string Code { get; } = code;
    public HttpStatusCode Status { get; } = status;
}

public sealed class KeycloakProvisioningClient(HttpClient http,string clientSecret)
{
    private const string Realm = "dle-os";
    private const string ClientId = "dle-os-provisioning-bff";

    private async Task<string> TokenAsync(CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"http://127.0.0.1:8180/realms/{Realm}/protocol/openid-connect/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string,string>
            {
                ["grant_type"]="client_credentials",["client_id"]=ClientId,["client_secret"]=clientSecret
            })
        };
        using var response = await http.SendAsync(request,cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new UserProvisioningException("KEYCLOAK_ADMIN_UNAVAILABLE","The identity provider administration boundary is unavailable.",HttpStatusCode.ServiceUnavailable);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
        return document.RootElement.GetProperty("access_token").GetString() ??
            throw new UserProvisioningException("KEYCLOAK_ADMIN_TOKEN_INVALID","The identity provider returned an invalid administrative token.",HttpStatusCode.ServiceUnavailable);
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method,string path,object? body,CancellationToken cancellationToken)
    {
        var request = new HttpRequestMessage(method,"http://127.0.0.1:8180/admin/realms/dle-os"+path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer",await TokenAsync(cancellationToken));
        if (body is not null) request.Content=JsonContent.Create(body);
        var response=await http.SendAsync(request,cancellationToken);
        request.Dispose();
        return response;
    }

    public async Task<string> CreateDisabledUserAsync(string userName,string displayName,CancellationToken cancellationToken)
    {
        var parts=displayName.Split(' ',2,StringSplitOptions.RemoveEmptyEntries);
        using var response=await SendAsync(HttpMethod.Post,"/users",new
        {
            username=userName,enabled=false,firstName=parts.ElementAtOrDefault(0) ?? displayName,
            lastName=parts.ElementAtOrDefault(1) ?? "",emailVerified=false,requiredActions=Array.Empty<string>()
        },cancellationToken);
        if (response.StatusCode==HttpStatusCode.Conflict)
            throw new UserProvisioningException("DUPLICATE_KEYCLOAK_USERNAME","The username already exists in the identity provider.",HttpStatusCode.Conflict);
        if (response.StatusCode!=HttpStatusCode.Created || response.Headers.Location is null)
            throw new UserProvisioningException("KEYCLOAK_USER_CREATE_FAILED","The identity provider did not create the user.",HttpStatusCode.ServiceUnavailable);
        return response.Headers.Location.Segments.Last().Trim('/');
    }

    public async Task SetPasswordAsync(string subject,string password,bool temporary,CancellationToken cancellationToken)
    {
        using var response=await SendAsync(HttpMethod.Put,$"/users/{Uri.EscapeDataString(subject)}/reset-password",
            new {type="password",value=password,temporary},cancellationToken);
        if (response.StatusCode!=HttpStatusCode.NoContent)
            throw new UserProvisioningException("KEYCLOAK_CREDENTIAL_RESET_FAILED","The identity provider did not accept the credential change.",HttpStatusCode.ServiceUnavailable);
    }

    public async Task SetEnabledAsync(string subject,bool enabled,CancellationToken cancellationToken)
    {
        using var response=await SendAsync(HttpMethod.Put,$"/users/{Uri.EscapeDataString(subject)}",new {enabled},cancellationToken);
        if (response.StatusCode!=HttpStatusCode.NoContent)
            throw new UserProvisioningException("KEYCLOAK_USER_STATE_FAILED","The identity provider did not accept the account state change.",HttpStatusCode.ServiceUnavailable);
    }

    public async Task RevokeSessionsAsync(string subject,CancellationToken cancellationToken)
    {
        using var response=await SendAsync(HttpMethod.Post,$"/users/{Uri.EscapeDataString(subject)}/logout",null,cancellationToken);
        if (response.StatusCode!=HttpStatusCode.NoContent)
            throw new UserProvisioningException("KEYCLOAK_SESSION_REVOCATION_FAILED","The identity provider did not revoke the user sessions.",HttpStatusCode.ServiceUnavailable);
    }

    public async Task DeleteUserAsync(string subject,CancellationToken cancellationToken)
    {
        using var response=await SendAsync(HttpMethod.Delete,$"/users/{Uri.EscapeDataString(subject)}",null,cancellationToken);
        if (response.StatusCode is not (HttpStatusCode.NoContent or HttpStatusCode.NotFound))
            throw new UserProvisioningException("KEYCLOAK_COMPENSATION_FAILED","The incomplete identity-provider user could not be removed.",HttpStatusCode.ServiceUnavailable);
    }
}

public sealed class UserProvisioningService(string connectionString,KeycloakProvisioningClient keycloak)
{
    private static string GeneratePassword()
    {
        const string alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_=+";
        Span<char> result=stackalloc char[24];
        for(var index=0;index<result.Length;index++)
            result[index]=alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
        return new string(result);
    }

    private static void ValidatePassword(string password)
    {
        if (password.Length<15 || password.Length>128)
            throw new UserProvisioningException("PASSWORD_LENGTH_INVALID","Initial passwords must be between 15 and 128 characters.");
    }

    private SqlConnection Connection() => new(connectionString);

    public async Task<EmployeeUserAdministration> GetAdministrationAsync(Guid employeeId,CancellationToken cancellationToken)
    {
        await using var connection=Connection(); await connection.OpenAsync(cancellationToken);
        await using var command=new SqlCommand("security.usp_GetEmployeeUserAdministration",connection){CommandType=CommandType.StoredProcedure};
        command.Parameters.AddWithValue("@EmployeeId",employeeId);
        await using var reader=await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) throw new UserProvisioningException("EMPLOYEE_NOT_FOUND","Employee was not found.",HttpStatusCode.NotFound);
        var employee=new {Id=reader.GetGuid(0),Number=reader.IsDBNull(1)?null:reader.GetString(1),Name=reader.GetString(2),
            Proposed=reader.IsDBNull(3)?null:reader.GetString(3),Status=reader.GetString(4),UserId=reader.IsDBNull(5)?(Guid?)null:reader.GetGuid(5),
            UserName=reader.IsDBNull(6)?null:reader.GetString(6),Account=reader.IsDBNull(7)?null:reader.GetString(7),Subject=reader.IsDBNull(8)?null:reader.GetString(8)};
        var roles=new List<ProvisioningRole>(); await reader.NextResultAsync(cancellationToken);
        while(await reader.ReadAsync(cancellationToken)) roles.Add(new(reader.GetString(0),reader.GetString(1),reader.IsDBNull(2)?null:reader.GetString(2),reader.GetBoolean(3),
            reader.IsDBNull(4)?[]:reader.GetString(4).Split(',',StringSplitOptions.RemoveEmptyEntries)));
        var assigned=new List<string>(); await reader.NextResultAsync(cancellationToken); while(await reader.ReadAsync(cancellationToken))assigned.Add(reader.GetString(0));
        var history=new List<ProvisioningHistory>(); await reader.NextResultAsync(cancellationToken);
        while(await reader.ReadAsync(cancellationToken))history.Add(new(reader.GetString(0),reader.GetString(1),reader.IsDBNull(2)?null:reader.GetString(2),reader.GetDateTime(3)));
        return new(employee.Id,employee.Number,employee.Name,employee.Proposed,employee.Status,employee.UserId,employee.UserName,employee.Account,employee.Subject,roles,assigned,history);
    }

    public async Task<OneTimeCredentialResult> ProvisionAsync(ProvisionEmployeeUserRequest request,Guid actorUserId,string actorIdentity,Guid correlationId,CancellationToken cancellationToken)
    {
        var password=request.GeneratePassword?GeneratePassword():request.InitialPassword ?? ""; ValidatePassword(password);
        var admin=await GetAdministrationAsync(request.EmployeeId,cancellationToken);
        string? subject=null; Guid userId=Guid.Empty; var prepared=false;
        try
        {
            subject=await keycloak.CreateDisabledUserAsync(request.UserName,admin.DisplayName,cancellationToken);
            await keycloak.SetPasswordAsync(subject,password,request.RequirePasswordChange,cancellationToken);
            await using(var connection=Connection())
            {
                await connection.OpenAsync(cancellationToken);
                await using var command=new SqlCommand("security.usp_PrepareEmployeeUserProvisioning",connection){CommandType=CommandType.StoredProcedure};
                command.Parameters.AddWithValue("@EmployeeId",request.EmployeeId); command.Parameters.AddWithValue("@UserName",request.UserName);
                command.Parameters.AddWithValue("@KeycloakSubject",subject); command.Parameters.AddWithValue("@RoleCodesJson",JsonSerializer.Serialize(request.RoleCodes));
                command.Parameters.AddWithValue("@ActorUserId",actorUserId); command.Parameters.AddWithValue("@ActorIdentity",actorIdentity); command.Parameters.AddWithValue("@CorrelationId",correlationId);
                var output=command.Parameters.Add("@UserId",SqlDbType.UniqueIdentifier); output.Direction=ParameterDirection.Output;
                await command.ExecuteNonQueryAsync(cancellationToken); userId=(Guid)output.Value;
            }
            prepared=true;
            await keycloak.SetEnabledAsync(subject,true,cancellationToken);
            await ExecuteAsync("security.usp_ActivateProvisionedUser",userId,actorUserId,actorIdentity,correlationId,cancellationToken);
            prepared=false;
            return new(userId,request.GeneratePassword?password:null,request.RequirePasswordChange);
        }
        catch(Exception original)
        {
            try
            {
                if(prepared && subject is not null)
                    await AbortAsync(userId,subject,actorUserId,actorIdentity,correlationId,CancellationToken.None);
                if(subject is not null) await keycloak.DeleteUserAsync(subject,CancellationToken.None);
            }
            catch(Exception compensation)
            {
                throw new UserProvisioningException("PROVISIONING_COMPENSATION_FAILED",
                    "Provisioning failed and requires administrator review before retry.",HttpStatusCode.ServiceUnavailable,
                    new AggregateException(original,compensation));
            }
            throw;
        }
        finally { password=string.Empty; }
    }

    public async Task<OneTimeCredentialResult> ResetCredentialAsync(ResetUserCredentialRequest request,Guid actorUserId,string actorIdentity,Guid correlationId,CancellationToken cancellationToken)
    {
        var password=request.GeneratePassword?GeneratePassword():request.Password ?? ""; ValidatePassword(password);
        var target=await FindUserAsync(request.UserId,cancellationToken);
        await keycloak.SetPasswordAsync(target.Subject,password,request.RequirePasswordChange,cancellationToken);
        await ExecuteAsync("security.usp_RecordUserSecurityAction",request.UserId,actorUserId,actorIdentity,correlationId,cancellationToken,"CREDENTIAL_RESET");
        return new(request.UserId,request.GeneratePassword?password:null,request.RequirePasswordChange);
    }

    public async Task SetEnabledAsync(Guid userId,bool enabled,Guid actorUserId,string actorIdentity,Guid correlationId,CancellationToken cancellationToken)
    {
        var target=await FindUserAsync(userId,cancellationToken);
        if(!enabled) await keycloak.SetEnabledAsync(target.Subject,false,cancellationToken);
        else await keycloak.SetEnabledAsync(target.Subject,true,cancellationToken);
        await ExecuteAsync("security.usp_SetUserEnabledState",userId,actorUserId,actorIdentity,correlationId,cancellationToken,null,enabled);
    }

    public async Task RevokeSessionsAsync(Guid userId,Guid actorUserId,string actorIdentity,Guid correlationId,CancellationToken cancellationToken)
    {
        var target=await FindUserAsync(userId,cancellationToken); await keycloak.RevokeSessionsAsync(target.Subject,cancellationToken);
        await ExecuteAsync("security.usp_RecordUserSecurityAction",userId,actorUserId,actorIdentity,correlationId,cancellationToken,"SESSIONS_REVOKED");
    }

    public async Task SetRolesAsync(SetUserRolesRequest request,Guid actorUserId,string actorIdentity,Guid correlationId,CancellationToken cancellationToken)
    {
        await using var connection=Connection(); await connection.OpenAsync(cancellationToken);
        await using var command=new SqlCommand("security.usp_SetUserRoles",connection){CommandType=CommandType.StoredProcedure};
        command.Parameters.AddWithValue("@UserId",request.UserId); command.Parameters.AddWithValue("@RoleCodesJson",JsonSerializer.Serialize(request.RoleCodes));
        command.Parameters.AddWithValue("@ActorUserId",actorUserId); command.Parameters.AddWithValue("@ActorIdentity",actorIdentity); command.Parameters.AddWithValue("@CorrelationId",correlationId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<(string Subject,string Status)> FindUserAsync(Guid userId,CancellationToken cancellationToken)
    {
        await using var connection=Connection(); await connection.OpenAsync(cancellationToken);
        await using var command=new SqlCommand("SELECT ei.Subject,u.AccountStatus FROM security.[User] u JOIN security.ExternalIdentity ei ON ei.UserId=u.UserId AND ei.Provider='KEYCLOAK' AND ei.IsActive=1 WHERE u.UserId=@UserId",connection);
        command.Parameters.AddWithValue("@UserId",userId); await using var reader=await command.ExecuteReaderAsync(cancellationToken);
        if(!await reader.ReadAsync(cancellationToken))throw new UserProvisioningException("USER_IDENTITY_NOT_FOUND","The governed Keycloak identity was not found.",HttpStatusCode.NotFound);
        return(reader.GetString(0),reader.GetString(1));
    }

    private async Task ExecuteAsync(string procedure,Guid userId,Guid actorUserId,string actorIdentity,Guid correlationId,CancellationToken cancellationToken,string? eventType=null,bool? enable=null)
    {
        await using var connection=Connection(); await connection.OpenAsync(cancellationToken);
        await using var command=new SqlCommand(procedure,connection){CommandType=CommandType.StoredProcedure};
        command.Parameters.AddWithValue("@UserId",userId);
        if(enable.HasValue)command.Parameters.AddWithValue("@Enable",enable.Value);
        if(eventType is not null)command.Parameters.AddWithValue("@EventType",eventType);
        command.Parameters.AddWithValue("@ActorUserId",actorUserId);command.Parameters.AddWithValue("@ActorIdentity",actorIdentity);command.Parameters.AddWithValue("@CorrelationId",correlationId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task AbortAsync(Guid userId,string subject,Guid actorUserId,string actorIdentity,Guid correlationId,CancellationToken cancellationToken)
    {
        await using var connection=Connection(); await connection.OpenAsync(cancellationToken);
        await using var command=new SqlCommand("security.usp_AbortEmployeeUserProvisioning",connection){CommandType=CommandType.StoredProcedure};
        command.Parameters.AddWithValue("@UserId",userId);command.Parameters.AddWithValue("@KeycloakSubject",subject);
        command.Parameters.AddWithValue("@ActorUserId",actorUserId);command.Parameters.AddWithValue("@ActorIdentity",actorIdentity);command.Parameters.AddWithValue("@CorrelationId",correlationId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
