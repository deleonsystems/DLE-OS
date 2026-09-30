using System.Text.Json;
using Microsoft.Data.Sqlite;

internal sealed partial class SimProductionStore
{
    internal static async Task<SimWoRevisionState> ReadRevisions(SqliteConnection c,SqliteTransaction t,string wo,long gen){
        var bound=await One<SimWoTraveler>(c,t,"SimWoTraveler",wo,gen);
        var approval=bound is null?null:(await Approval(c,t,bound.DefinitionId,bound.DefinitionVersion))?.Approval;
        if(!await Exists(c,t,"SimWoTravelerRevisionHead"))return new(null,null,[],[],approval);
        return new(await One<SimWoRevisionHead>(c,t,"SimWoTravelerRevisionHead",wo,gen),
            await One<SimWoTravelerRevision>(c,t,"SimWoTravelerDraft",wo,gen),
            await Many<SimWoTravelerRevision>(c,t,"SimWoTravelerRevision",wo,gen),await Many<SimWoRevisionEvent>(c,t,"SimWoTravelerRevisionEvent",wo,gen),approval);
    }
    private static async Task<T[]> Many<T>(SqliteConnection c,SqliteTransaction t,string table,string wo,long gen){
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText=$"SELECT PayloadJson FROM {table} WHERE WorkOrderNumber=@wo AND Generation=@gen ORDER BY rowid";
        q.Parameters.AddWithValue("@wo",wo);q.Parameters.AddWithValue("@gen",gen);var rows=new List<T>();await using var r=await q.ExecuteReaderAsync();
        while(await r.ReadAsync())rows.Add(JsonSerializer.Deserialize<T>(r.GetString(0),Json)!);return rows.ToArray();
    }
    internal static async Task RevisionSchema(SqliteConnection c,SqliteTransaction t)=>await Exec(c,t,"""
        CREATE TABLE IF NOT EXISTS SimWoTravelerRevisionHead(WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(WorkOrderNumber,Generation));
        CREATE TABLE IF NOT EXISTS SimWoTravelerDraft(WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(WorkOrderNumber,Generation));
        CREATE TABLE IF NOT EXISTS SimWoTravelerRevision(RevisionId TEXT PRIMARY KEY,TravelerId TEXT NOT NULL,Version INTEGER NOT NULL,WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL,UNIQUE(TravelerId,Version));
        CREATE TABLE IF NOT EXISTS SimWoTravelerRevisionEvent(EventId TEXT PRIMARY KEY,WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS SimWoRevisionNoUpdate BEFORE UPDATE ON SimWoTravelerRevision BEGIN SELECT RAISE(ABORT,'Approved WO revisions are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS SimWoRevisionNoDelete BEFORE DELETE ON SimWoTravelerRevision BEGIN SELECT RAISE(ABORT,'Approved WO revisions are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS SimWoRevisionEventNoUpdate BEFORE UPDATE ON SimWoTravelerRevisionEvent BEGIN SELECT RAISE(ABORT,'WO revision history is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS SimWoRevisionEventNoDelete BEFORE DELETE ON SimWoTravelerRevisionEvent BEGIN SELECT RAISE(ABORT,'WO revision history is append-only'); END;
        """);
    internal static Task SaveHead(SqliteConnection c,SqliteTransaction t,SimWoRevisionHead h)=>Exec(c,t,
        "INSERT INTO SimWoTravelerRevisionHead VALUES(@wo,@gen,@json) ON CONFLICT(WorkOrderNumber,Generation) DO UPDATE SET PayloadJson=excluded.PayloadJson",
        ("@wo",h.WorkOrderNumber),("@gen",h.Generation),("@json",JsonSerializer.Serialize(h,Json)));
    internal static Task SaveWoDraft(SqliteConnection c,SqliteTransaction t,SimWoTravelerRevision d)=>Exec(c,t,
        "INSERT INTO SimWoTravelerDraft VALUES(@wo,@gen,@json) ON CONFLICT(WorkOrderNumber,Generation) DO UPDATE SET PayloadJson=excluded.PayloadJson",
        ("@wo",d.WorkOrderNumber),("@gen",d.Generation),("@json",JsonSerializer.Serialize(d,Json)));
    internal static Task FreezeRevision(SqliteConnection c,SqliteTransaction t,SimWoTravelerRevision d)=>Exec(c,t,
        "INSERT INTO SimWoTravelerRevision VALUES(@id,@traveler,@version,@wo,@gen,@json); DELETE FROM SimWoTravelerDraft WHERE WorkOrderNumber=@wo AND Generation=@gen;",
        ("@id",d.Id.ToString()),("@traveler",d.TravelerId.ToString()),("@version",d.Version),("@wo",d.WorkOrderNumber),("@gen",d.Generation),("@json",JsonSerializer.Serialize(d,Json)));
    internal static Task RevisionEvent(SqliteConnection c,SqliteTransaction t,SimWoRevisionEvent e)=>Exec(c,t,
        "INSERT INTO SimWoTravelerRevisionEvent VALUES(@id,@wo,@gen,@json)",("@id",e.Id.ToString()),("@wo",e.WorkOrderNumber),("@gen",e.Generation),("@json",JsonSerializer.Serialize(e,Json)));

    // No execution writer exists yet. Future execution must persist WO-keyed evidence in this
    // same database/transaction boundary before exposing a start. Also recognize operation /
    // Traveler execution tables; any record (including voided evidence) blocks pre-start edits.
    internal static async Task<bool> ExecutionExists(SqliteConnection c,SqliteTransaction t,string wo){
        var tables=new List<string>();await using(var q=c.CreateCommand()){
            q.Transaction=t;q.CommandText="SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%Production%Execution%' OR name LIKE '%Traveler%Execution%' OR name LIKE '%Operation%Execution%')";
            await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())tables.Add(r.GetString(0));
        }
        static string Quote(string s)=>"\""+s.Replace("\"","\"\"")+"\"";
        foreach(var table in tables){
            var columns=new List<string>();await using(var q=c.CreateCommand()){
                q.Transaction=t;q.CommandText="PRAGMA table_info("+Quote(table)+")";await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())columns.Add(r.GetString(1));
            }
            var key=columns.FirstOrDefault(x=>x.Equals("WorkOrderNumber",StringComparison.OrdinalIgnoreCase));
            // Unknown execution schemas are deliberately fail-closed until explicitly integrated.
            await using var count=c.CreateCommand();count.Transaction=t;count.CommandText="SELECT COUNT(*) FROM "+Quote(table)+(key is null?"":" WHERE "+Quote(key)+"=@wo");
            if(key is not null)count.Parameters.AddWithValue("@wo",wo);
            if(Convert.ToInt64(await count.ExecuteScalarAsync())>0)return true;
        }
        return false;
    }
}
