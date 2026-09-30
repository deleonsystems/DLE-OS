using System.Text.Json;
using Microsoft.Data.Sqlite;

// Additive tables in the existing SIM database. Read-only projection does not create tables or seed records.
internal sealed partial class SimProductionStore(string databasePath)
{
    internal static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim gate=new(1,1);
    internal SqliteConnection Open(bool write)=>new(new SqliteConnectionStringBuilder{DataSource=databasePath,
        Mode=write?SqliteOpenMode.ReadWrite:SqliteOpenMode.ReadOnly,Pooling=false}.ToString());
    private static async Task<bool> Exists(SqliteConnection c,SqliteTransaction? t,string name){
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=@name";
        q.Parameters.AddWithValue("@name",name);return Convert.ToInt32(await q.ExecuteScalarAsync())==1;
    }
    internal async Task<(SimTravelerDefinition? Definition,SimWoTraveler? Bound,SimTravelerEvent[] History,SimWoRevisionState Revisions,bool Execution)> Read(string wo,long generation)
    {
        await using var c=Open(false);await c.OpenAsync();await using var t=c.BeginTransaction(deferred:true);
        if(!await Exists(c,t,"SimTravelerDefinition"))return(null,null,[],new(null,null,[],[]),await ExecutionExists(c,t,wo));
        var d=await One<SimTravelerDefinition>(c,t,"SimTravelerDefinition",wo,generation);
        var b=await One<SimWoTraveler>(c,t,"SimWoTraveler",wo,generation);
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT PayloadJson FROM SimTravelerEvent WHERE WorkOrderNumber=@wo AND Generation=@gen ORDER BY rowid";
        q.Parameters.AddWithValue("@wo",wo);q.Parameters.AddWithValue("@gen",generation);var history=new List<SimTravelerEvent>();
        await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())history.Add(JsonSerializer.Deserialize<SimTravelerEvent>(r.GetString(0),Json)!);
        await r.DisposeAsync();
        return(d,b,history.ToArray(),await ReadRevisions(c,t,wo,generation),await ExecutionExists(c,t,wo));
    }
    internal static async Task<T?> One<T>(SqliteConnection c,SqliteTransaction? t,string table,string wo,long generation){
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText=$"SELECT PayloadJson FROM {table} WHERE WorkOrderNumber=@wo AND Generation=@gen";
        q.Parameters.AddWithValue("@wo",wo);q.Parameters.AddWithValue("@gen",generation);var value=await q.ExecuteScalarAsync();
        return value is string text?JsonSerializer.Deserialize<T>(text,Json):default;
    }
    internal async Task Change(string wo,long generation,Func<SqliteConnection,SqliteTransaction,SimTravelerDefinition?,SimWoTraveler?,Task> change){
        await gate.WaitAsync();try{
            await using var c=Open(true);await c.OpenAsync();await using var t=c.BeginTransaction();
            await Exec(c,t,"""
                CREATE TABLE IF NOT EXISTS SimTravelerDefinition(DefinitionId TEXT PRIMARY KEY,WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL,UNIQUE(WorkOrderNumber,Generation));
                CREATE TABLE IF NOT EXISTS SimTravelerApprovedVersion(DefinitionId TEXT NOT NULL,Version INTEGER NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(DefinitionId,Version));
                CREATE TABLE IF NOT EXISTS SimWoTraveler(TravelerId TEXT PRIMARY KEY,WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL,UNIQUE(WorkOrderNumber,Generation));
                CREATE TABLE IF NOT EXISTS SimTravelerEvent(EventId TEXT PRIMARY KEY,WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS SimTravelerApprovalNoUpdate BEFORE UPDATE ON SimTravelerApprovedVersion BEGIN SELECT RAISE(ABORT,'Approved Traveler versions are immutable'); END;
                CREATE TRIGGER IF NOT EXISTS SimTravelerApprovalNoDelete BEFORE DELETE ON SimTravelerApprovedVersion BEGIN SELECT RAISE(ABORT,'Approved Traveler versions are immutable'); END;
                CREATE TRIGGER IF NOT EXISTS SimWoTravelerNoUpdate BEFORE UPDATE ON SimWoTraveler BEGIN SELECT RAISE(ABORT,'Frozen WO Travelers require an explicit new revision'); END;
                CREATE TRIGGER IF NOT EXISTS SimWoTravelerNoDelete BEFORE DELETE ON SimWoTraveler BEGIN SELECT RAISE(ABORT,'Frozen WO Travelers are immutable'); END;
                CREATE TRIGGER IF NOT EXISTS SimTravelerEventNoUpdate BEFORE UPDATE ON SimTravelerEvent BEGIN SELECT RAISE(ABORT,'Traveler history is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS SimTravelerEventNoDelete BEFORE DELETE ON SimTravelerEvent BEGIN SELECT RAISE(ABORT,'Traveler history is append-only'); END;
                """);
            if(await ExecutionExists(c,t,wo))throw KittingCaseProblem.Conflict("traveler_execution_exists","Production execution evidence exists. Pre-start Traveler changes are no longer permitted.");
            await change(c,t,await One<SimTravelerDefinition>(c,t,"SimTravelerDefinition",wo,generation),await One<SimWoTraveler>(c,t,"SimWoTraveler",wo,generation));
            await t.CommitAsync();
        }finally{gate.Release();}
    }
    internal static Task Save(SqliteConnection c,SqliteTransaction t,SimTravelerDefinition d)=>Exec(c,t,
        "INSERT INTO SimTravelerDefinition VALUES(@id,@wo,@gen,@json) ON CONFLICT(DefinitionId) DO UPDATE SET PayloadJson=excluded.PayloadJson",
        ("@id",d.Id.ToString()),("@wo",d.WorkOrderNumber),("@gen",d.Generation),("@json",JsonSerializer.Serialize(d,Json)));
    internal static Task Approve(SqliteConnection c,SqliteTransaction t,SimTravelerApprovedVersion a)=>Exec(c,t,
        "INSERT INTO SimTravelerApprovedVersion VALUES(@id,@version,@json)",("@id",a.DefinitionId.ToString()),("@version",a.Version),("@json",JsonSerializer.Serialize(a,Json)));
    internal static async Task<SimTravelerApprovedVersion?> Approval(SqliteConnection c,SqliteTransaction t,Guid id,int version){
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT PayloadJson FROM SimTravelerApprovedVersion WHERE DefinitionId=@id AND Version=@version";
        q.Parameters.AddWithValue("@id",id.ToString());q.Parameters.AddWithValue("@version",version);var value=await q.ExecuteScalarAsync();
        return value is string text?JsonSerializer.Deserialize<SimTravelerApprovedVersion>(text,Json):null;
    }
    internal static Task Bind(SqliteConnection c,SqliteTransaction t,SimWoTraveler b)=>Exec(c,t,
        "INSERT INTO SimWoTraveler VALUES(@id,@wo,@gen,@json)",("@id",b.Id.ToString()),("@wo",b.WorkOrderNumber),("@gen",b.Generation),("@json",JsonSerializer.Serialize(b,Json)));
    internal static Task Event(SqliteConnection c,SqliteTransaction t,SimTravelerEvent e)=>Exec(c,t,
        "INSERT INTO SimTravelerEvent VALUES(@id,@wo,@gen,@json)",("@id",e.Id.ToString()),("@wo",e.WorkOrderNumber),("@gen",e.Generation),("@json",JsonSerializer.Serialize(e,Json)));
    private static async Task Exec(SqliteConnection c,SqliteTransaction t,string sql,params(string Name,object Value)[] args){
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText=sql;foreach(var a in args)q.Parameters.AddWithValue(a.Name,a.Value);await q.ExecuteNonQueryAsync();
    }
}
