using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

var action = args.FirstOrDefault()?.ToLowerInvariant() ?? "preflight";
var connectionString = Environment.GetEnvironmentVariable("DLE_OS_KITTING_QUALIFICATION_CONNECTION") ??
    @"Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=10;Application Intent=ReadWrite;";
await using var connection = new SqlConnection(connectionString);
await connection.OpenAsync();

if (action == "migrate")
{
    var migration = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "Database", "001_AddKittingDispositionEvent.sql"));
    if (!File.Exists(migration)) migration = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "Tools", "KittingDisposition", "Database", "001_AddKittingDispositionEvent.sql"));
    try
    {
        foreach (var batch in Regex.Split(await File.ReadAllTextAsync(migration), @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase).Where(x => !string.IsNullOrWhiteSpace(x)))
            await new SqlCommand(batch, connection) { CommandTimeout = 60 }.ExecuteNonQueryAsync();
    }
    catch
    {
        try { await new SqlCommand("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;", connection).ExecuteNonQueryAsync(); } catch { }
        throw;
    }
}

var inventory = await Rows("""
SELECT s.name SchemaName,o.name ObjectName,o.type_desc ObjectType
FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
WHERE s.name='operational' ORDER BY o.type_desc,o.name;
""");
var objects = await One("""
SELECT DB_NAME() DatabaseName,@@SERVERNAME ServerName,
 OBJECT_ID('operational.KittingDispositionEvent','U') EventTableId,
 OBJECT_ID('operational.vw_CurrentKittingDisposition','V') CurrentViewId,
 OBJECT_ID('operational.tr_KittingDispositionEvent_AppendOnly','TR') AppendOnlyTriggerId,
 OBJECT_ID('operational.SalesOrderLineWorkOrderDecisionEvent','U') ApprovalTableId;
""");
var canonical = await Rows("""
SELECT N'CustomerMaster' Dataset,COUNT_BIG(*) [Rows],CHECKSUM_AGG(BINARY_CHECKSUM(*)) RowChecksum FROM canonical.CustomerMaster
UNION ALL SELECT N'CustomerAddress',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.CustomerAddress
UNION ALL SELECT N'SalesOrder',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.SalesOrder
UNION ALL SELECT N'SalesOrderLine',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.SalesOrderLine
UNION ALL SELECT N'WorkOrder',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.WorkOrder
UNION ALL SELECT N'Relationship',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.SalesOrderWorkOrderRelationshipEvidence
UNION ALL SELECT N'BillOfMaterial',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.BillOfMaterial
UNION ALL SELECT N'InventoryItem',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.InventoryItem
UNION ALL SELECT N'GeneralLedgerAccount',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.GeneralLedgerAccount;
""");
var approval = await One("""
SELECT COUNT_BIG(*) EventCount,CHECKSUM_AGG(BINARY_CHECKSUM(*)) RowChecksum
FROM operational.SalesOrderLineWorkOrderDecisionEvent;
""");
object? kitting = null;
if (objects["EventTableId"] is not null)
{
    var details = await One("""
SELECT (SELECT COUNT_BIG(*) FROM operational.KittingDispositionEvent) EventCount,
 (SELECT COUNT(*) FROM sys.indexes WHERE object_id=OBJECT_ID('operational.KittingDispositionEvent') AND name IN ('IX_KittingDispositionEvent_WorkOrderHistory','UX_KittingDispositionEvent_Supersedes')) RequiredIndexCount,
 (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('operational.KittingDispositionEvent')) CheckConstraintCount,
 (SELECT COUNT(*) FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID('operational.KittingDispositionEvent')) ForeignKeyCount;
""");
    var updateBlocked = await TriggerBlocks("UPDATE operational.KittingDispositionEvent SET Note=Note WHERE 1=0;");
    var deleteBlocked = await TriggerBlocks("DELETE FROM operational.KittingDispositionEvent WHERE 1=0;");
    kitting = new { details, updateBlocked, deleteBlocked };
}
Console.WriteLine(JsonSerializer.Serialize(new { action, objects, operationalInventory=inventory, canonical, approval, kitting }, new JsonSerializerOptions { WriteIndented=true }));

async Task<Dictionary<string,object?>> One(string sql) => (await Rows(sql)).Single();
async Task<List<Dictionary<string,object?>>> Rows(string sql)
{
    var result=new List<Dictionary<string,object?>>(); await using var command=new SqlCommand(sql,connection){CommandTimeout=120}; await using var reader=await command.ExecuteReaderAsync();
    while(await reader.ReadAsync()){var row=new Dictionary<string,object?>();for(var i=0;i<reader.FieldCount;i++)row[reader.GetName(i)]=reader.IsDBNull(i)?null:reader.GetValue(i);result.Add(row);}return result;
}
async Task<object> TriggerBlocks(string sql)
{
    try { await new SqlCommand(sql,connection).ExecuteNonQueryAsync(); return new { blocked=false, errorNumber=0 }; }
    catch(SqlException e){return new { blocked=e.Number==51021,errorNumber=e.Number,message=e.Message };}
}
