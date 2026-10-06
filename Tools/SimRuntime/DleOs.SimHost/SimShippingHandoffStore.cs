using Microsoft.Data.Sqlite;
using System.Text.Json;

internal sealed partial class SimProductionStore
{
    // The immutable event journal also stores each complete version. There is no browser-owned queue.
    internal async Task<T> ShippingTransaction<T>(bool write,Func<SqliteConnection,SqliteTransaction,Task<T>> action){
        await gate.WaitAsync();try{
            await using var c=Open(write);await c.OpenAsync();await using var t=c.BeginTransaction(deferred:!write);
            if(write)await Exec(c,t,"""
                CREATE TABLE IF NOT EXISTS SimShippingHandoffEvent(
                    EventId TEXT PRIMARY KEY,WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,
                    Sequence INTEGER NOT NULL,RequestId TEXT NOT NULL,PayloadJson TEXT NOT NULL,
                    UNIQUE(WorkOrderNumber,Generation,Sequence),UNIQUE(Generation,RequestId));
                CREATE TRIGGER IF NOT EXISTS SimShippingHandoffNoUpdate BEFORE UPDATE ON SimShippingHandoffEvent BEGIN SELECT RAISE(ABORT,'Shipping handoff history is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS SimShippingHandoffNoDelete BEFORE DELETE ON SimShippingHandoffEvent BEGIN SELECT RAISE(ABORT,'Shipping handoff history is append-only'); END;
                """);
            var result=await action(c,t);await t.CommitAsync();return result;
        }finally{gate.Release();}
    }
    internal static async Task<SimShippingEvent[]> ShippingEvents(SqliteConnection c,SqliteTransaction t,string wo,long gen){
        if(!await Exists(c,t,"SimShippingHandoffEvent"))return [];
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT PayloadJson FROM SimShippingHandoffEvent WHERE WorkOrderNumber=@wo AND Generation=@g ORDER BY Sequence";
        q.Parameters.AddWithValue("@wo",wo);q.Parameters.AddWithValue("@g",gen);var events=new List<SimShippingEvent>();
        await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())events.Add(JsonSerializer.Deserialize<SimShippingEvent>(r.GetString(0),Json)!);return events.ToArray();
    }
    internal static Task ShippingEvent(SqliteConnection c,SqliteTransaction t,SimShippingEvent e)=>Exec(c,t,
        "INSERT INTO SimShippingHandoffEvent VALUES(@id,@wo,@gen,@seq,@request,@json)",("@id",e.Id.ToString()),("@wo",e.WorkOrderNumber),
        ("@gen",e.Generation),("@seq",e.Sequence),("@request",e.RequestId.ToString()),("@json",JsonSerializer.Serialize(e,Json)));
    internal static async Task<JsonElement> ShippingErp(SqliteConnection c,SqliteTransaction t,string wo){
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT PayloadJson FROM WorkOrder WHERE WorkOrderNumber=@wo";q.Parameters.AddWithValue("@wo",wo);
        var text=await q.ExecuteScalarAsync() as string??throw KittingCaseProblem.Conflict("shipping_wo_missing","Work Order is unavailable.");
        var work=JsonDocument.Parse(text).RootElement;
        q.Parameters.Clear();q.CommandText="SELECT PayloadJson FROM SalesOrderLine WHERE CustomerNumber=@customer AND SalesOrderNumber=@so AND LineNumber=@line";
        q.Parameters.AddWithValue("@customer",work.GetProperty("customerNumber").GetString());q.Parameters.AddWithValue("@so",work.GetProperty("salesOrderNumber").GetString());q.Parameters.AddWithValue("@line",work.GetProperty("salesOrderLineNumber").GetString());
        var line=await q.ExecuteScalarAsync() as string??throw KittingCaseProblem.Conflict("shipping_so_missing","Sales Order line is unavailable.");
        return JsonSerializer.SerializeToElement(new{workOrder=work,line=JsonDocument.Parse(line).RootElement},Json);
    }
    internal async Task<string[]> ShippingWorkOrders(long generation)=>await ShippingTransaction(false,async(c,t)=>{
        if(!await Exists(c,t,"SimWoTraveler"))return Array.Empty<string>();
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT WorkOrderNumber FROM SimWoTraveler WHERE Generation=@g ORDER BY WorkOrderNumber";q.Parameters.AddWithValue("@g",generation);
        var list=new List<string>();await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())list.Add(r.GetString(0));return list.ToArray();
    });
}
