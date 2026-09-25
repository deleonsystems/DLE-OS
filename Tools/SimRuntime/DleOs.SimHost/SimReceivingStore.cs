using System.Text.Json;
using Microsoft.Data.Sqlite;

internal sealed partial class SimOperationsDataStore
{
    private static readonly string[] ReceivingTables = ["SimReceivingDelivery","SimAcceptedMaterial","SimReceivingRequirementReview","SimReceivingStage","SimReceivingDocument","SimReceivingEvent"];
    private static async Task EnsureReceivingSchema(SqliteConnection connection,SqliteTransaction transaction)
    {
        foreach(var table in ReceivingTables) {
            await ExecuteAsync(connection,transaction,$"CREATE TABLE IF NOT EXISTS {table}(Id TEXT PRIMARY KEY,PayloadJson TEXT NOT NULL);");
            await ExecuteAsync(connection,transaction,$"CREATE TRIGGER IF NOT EXISTS {table}NoUpdate BEFORE UPDATE ON {table} BEGIN SELECT RAISE(ABORT,'Operational Receiving evidence is append-only'); END;");
            await ExecuteAsync(connection,transaction,$"CREATE TRIGGER IF NOT EXISTS {table}NoDelete BEFORE DELETE ON {table} BEGIN SELECT RAISE(ABORT,'Operational Receiving evidence is append-only'); END;");
        }
        await ExecuteAsync(connection,transaction,"CREATE TABLE IF NOT EXISTS SimReceivingCommand(RequestId TEXT PRIMARY KEY,RequestHash TEXT NOT NULL,ResponseJson TEXT NOT NULL);");
        await ExecuteAsync(connection,transaction,"CREATE TRIGGER IF NOT EXISTS SimReceivingCommandNoUpdate BEFORE UPDATE ON SimReceivingCommand BEGIN SELECT RAISE(ABORT,'Receiving commands are immutable'); END;");
        await ExecuteAsync(connection,transaction,"CREATE TRIGGER IF NOT EXISTS SimReceivingCommandNoDelete BEFORE DELETE ON SimReceivingCommand BEGIN SELECT RAISE(ABORT,'Receiving commands are immutable'); END;");
    }
    internal async Task<SimReceivingSnapshot> ReadReceiving(SimStateMetadata runtime)
    {
        EnsurePacketPath();EnsureHealthy();await using var connection=OpenReadOnly();await connection.OpenAsync();
        await using var transaction=connection.BeginTransaction();await ValidatePacketDatabaseAsync(connection,transaction,runtime);
        var result=await ReceivingSnapshot(connection,transaction);await transaction.CommitAsync();return result;
    }
    internal async Task<(SimPurchasingView Purchasing,SimReceivingSnapshot Receiving)> ReadPurchasingAndReceiving(SimStateMetadata runtime,bool canManage)
    {
        EnsurePacketPath();EnsureHealthy();await using var connection=OpenReadOnly();await connection.OpenAsync();
        await using var transaction=connection.BeginTransaction();await ValidatePacketDatabaseAsync(connection,transaction,runtime);
        var purchasing=await PurchasingView(connection,transaction,runtime,canManage);
        var receiving=await ReceivingSnapshot(connection,transaction);await transaction.CommitAsync();return(purchasing,receiving);
    }
    internal async Task<SimReceivingPoView> ReadReceivingPo(SimStateMetadata runtime,Guid id,bool canReceive)
    {
        EnsurePacketPath();EnsureHealthy();await using var connection=OpenReadOnly();await connection.OpenAsync();
        await using var transaction=connection.BeginTransaction();await ValidatePacketDatabaseAsync(connection,transaction,runtime);
        var result=SimReceivingService.PoView(await PurchasingView(connection,transaction,runtime,false),await ReceivingSnapshot(connection,transaction),id,canReceive);
        await transaction.CommitAsync();return result;
    }
    private static async Task<SimReceivingSnapshot> ReceivingSnapshot(SqliteConnection connection,SqliteTransaction transaction)
    {
        var materials=await PurchasingRows<SimAcceptedMaterial>(connection,transaction,"SimAcceptedMaterial");
        var stages=await PurchasingRows<SimReceivingStage>(connection,transaction,"SimReceivingStage");
        materials=materials.Select(m=> {
            var stage=stages.Where(s=>s.ReceiptLineId==m.ReceiptLineId).OrderByDescending(s=>s.ResultingVersion).FirstOrDefault();
            return stage is null?m:m with{StagingLocation=stage.Location,StagedAtUtc=stage.AtUtc,Version=stage.ResultingVersion,AvailableQuantity=m.AcceptedQuantity};
        }).ToArray();
        return new(await PurchasingRows<SimReceivingDelivery>(connection,transaction,"SimReceivingDelivery"),materials,
            await PurchasingRows<SimReceivingRequirementReview>(connection,transaction,"SimReceivingRequirementReview"),stages,
            await PurchasingRows<SimReceivingDocument>(connection,transaction,"SimReceivingDocument"),
            (await PurchasingRows<SimReceivingEvent>(connection,transaction,"SimReceivingEvent")).OrderBy(e=>e.AtUtc).ToArray());
    }
    internal async Task<T> ChangeReceiving<T>(SimStateMetadata runtime,string action,Guid requestId,object request,
        SimPersona actor,DateTimeOffset now,Func<SimPurchasingView,SimReceivingSnapshot,DateTimeOffset,Task<SimReceivingChange<T>>> mutate)
    {
        await gate.WaitAsync();
        try {
            EnsurePacketPath();EnsureHealthy();await using var connection=OpenReadWrite();await connection.OpenAsync();
            await using var transaction=connection.BeginTransaction();await ValidatePacketDatabaseAsync(connection,transaction,runtime);
            await EnsureReceivingSchema(connection,transaction);
            var hash=SimPurchasingService.Hash(new{action,request,actor.Id,runtime.Generation});
            await using(var replay=connection.CreateCommand()) {
                replay.Transaction=transaction;replay.CommandText="SELECT RequestHash,ResponseJson FROM SimReceivingCommand WHERE RequestId=@id;";
                replay.Parameters.AddWithValue("@id",requestId.ToString());await using var reader=await replay.ExecuteReaderAsync();
                if(await reader.ReadAsync()) {
                    if(reader.GetString(0)!=hash)throw SimPurchasingProblem.Conflict("request_reused","This request ID belongs to different Receiving input or another actor.");
                    return JsonSerializer.Deserialize<T>(reader.GetString(1),PurchasingJson)!;
                }
            }
            var change=await mutate(await PurchasingView(connection,transaction,runtime,false),await ReceivingSnapshot(connection,transaction),now);
            async Task Insert(string table,string id,object value)=>await ExecuteAsync(connection,transaction,$"INSERT INTO {table}(Id,PayloadJson) VALUES(@id,@json);",
                ("@id",id),("@json",JsonSerializer.Serialize(value,PurchasingJson)));
            if(change.Delivery is {} delivery)await Insert("SimReceivingDelivery",delivery.DeliveryId.ToString(),delivery);
            foreach(var material in change.Materials??[])await Insert("SimAcceptedMaterial",material.ReceiptLineId,material);
            if(change.Review is {} review)await Insert("SimReceivingRequirementReview",review.ReviewId.ToString(),review);
            if(change.Stage is {} stage)await Insert("SimReceivingStage",stage.StageId.ToString(),stage);
            if(change.Document is {} doc)await Insert("SimReceivingDocument",doc.DocumentId,doc);
            if(change.Event is {} audit)await Insert("SimReceivingEvent",audit.EventId.ToString(),audit);
            await ExecuteAsync(connection,transaction,"INSERT INTO SimReceivingCommand VALUES(@id,@hash,@response);",
                ("@id",requestId.ToString()),("@hash",hash),("@response",JsonSerializer.Serialize(change.Result,PurchasingJson)));
            await transaction.CommitAsync();return change.Result;
        } finally {gate.Release();}
    }
    // Overlay physical receiving facts for read models; immutable Purchasing payloads remain untouched.
    private static async Task<SimPurchaseLine[]> ReceivingPurchases(SqliteConnection connection,SqliteTransaction transaction,SimPurchaseLine[] purchases)
    {
        var materials=await PurchasingRows<SimAcceptedMaterial>(connection,transaction,"SimAcceptedMaterial");
        return purchases.Select(p=> {
            var received=p.ReceivedQuantity+materials.Where(m=>m.PurchaseId==p.PurchaseId).Sum(m=>m.ReceivedQuantity);
            return received<=0?p:p with{ReceivedQuantity=received,OpenQuantity=Math.Max(0,p.OrderedQuantity-received),
                Status=received>=p.OrderedQuantity?"RECEIVED":"PARTIALLY_RECEIVED",
                ReceiptState=received>=p.OrderedQuantity?"RECEIVED":"PARTIALLY_RECEIVED"};
        }).ToArray();
    }
}
