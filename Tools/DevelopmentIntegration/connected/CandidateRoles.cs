using System.Text.Json;

// Application role definitions only. Persona names identify synthetic test profiles,
// never identity resolution. Fixture GUIDs remain owned by ConnectedActors.
public sealed record CandidateRole(string Code,string DisplayName,string Persona,string[] Permissions,string[] Workspaces);
public static class CandidateRoles
{
 public static readonly CandidateRole[] All=JsonSerializer.Deserialize<CandidateRole[]>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"roles.json")),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})!;
 public static CandidateRole? ForFixture(string persona)=>All.SingleOrDefault(r=>r.Persona==persona);
}
