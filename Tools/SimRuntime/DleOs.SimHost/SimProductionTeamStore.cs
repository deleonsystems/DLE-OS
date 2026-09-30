using System.Text.Json;
using Microsoft.Data.Sqlite;

internal sealed partial class SimProductionStore
{
    internal static async Task<SimProductionTeamInput[]> TeamInputs(SqliteConnection c,SqliteTransaction? t,string wo,long gen){
        if(!await Exists(c,t,"SimProductionTeamInput"))return [];
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT PayloadJson FROM SimProductionTeamInput WHERE WorkOrderNumber=@wo AND Generation=@gen ORDER BY rowid";
        q.Parameters.AddWithValue("@wo",wo);q.Parameters.AddWithValue("@gen",gen);var rows=new List<SimProductionTeamInput>();
        await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())rows.Add(JsonSerializer.Deserialize<SimProductionTeamInput>(r.GetString(0),Json)!);return rows.ToArray();
    }
    internal async Task<SimProductionTeamInput[]> TeamInputs(string wo,long gen){await using var c=Open(false);await c.OpenAsync();return await TeamInputs(c,null,wo,gen);}
    internal async Task TeamChange(string wo,long gen,Func<SqliteConnection,SqliteTransaction,SimWoTraveler,SimProductionTeamInput[],Task> action){
        await gate.WaitAsync();try{await using var c=Open(true);await c.OpenAsync();await using var t=c.BeginTransaction();
            if(!await Exists(c,t,"SimWoTraveler"))throw KittingCaseProblem.Conflict("team_traveler_required","An approved WO Traveler is required.");
            var bound=await One<SimWoTraveler>(c,t,"SimWoTraveler",wo,gen)??throw KittingCaseProblem.Conflict("team_traveler_required","An approved WO Traveler is required.");
            await Exec(c,t,"""
                CREATE TABLE IF NOT EXISTS SimProductionTeamInput(InputId TEXT NOT NULL,Version INTEGER NOT NULL,WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(InputId,Version));
                CREATE TRIGGER IF NOT EXISTS SimTeamInputNoUpdate BEFORE UPDATE ON SimProductionTeamInput BEGIN SELECT RAISE(ABORT,'Team Input history is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS SimTeamInputNoDelete BEFORE DELETE ON SimProductionTeamInput BEGIN SELECT RAISE(ABORT,'Team Input history is append-only'); END;
                """);
            await action(c,t,bound,await TeamInputs(c,t,wo,gen));await t.CommitAsync();
        }finally{gate.Release();}
    }
    internal static Task AddTeamInput(SqliteConnection c,SqliteTransaction t,SimProductionTeamInput input)=>Exec(c,t,
        "INSERT INTO SimProductionTeamInput VALUES(@id,@version,@wo,@gen,@json)",("@id",input.Id.ToString()),("@version",input.Version),("@wo",input.WorkOrderNumber),("@gen",input.Generation),("@json",JsonSerializer.Serialize(input,Json)));
}
