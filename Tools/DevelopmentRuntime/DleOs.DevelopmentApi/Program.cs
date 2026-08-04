using DLE_OS_Server.Controllers.Platform;
using DLE_OS_Server.Data.Platform.Live;
using DLE_OS_Server.Options;

var builder = WebApplication.CreateBuilder(args);
string[] developmentOrigins = [
    "http://dle-os-host:5051",
    "http://localhost:5051",
    "http://127.0.0.1:5051"];
const string qualifiedLiveConfiguration =
    @"C:\Program Files\DLE-OS\LiveCanonicalApi\appsettings.Live.json";
var liveBoundaryConfiguration = new ConfigurationBuilder()
    .AddJsonFile(
        qualifiedLiveConfiguration,
        optional: false,
        reloadOnChange: false)
    .Build();

builder.Services.AddControllers();
builder.Services.AddScoped<PlatformApiExceptionFilter>();
builder.Services.AddCors(options => options.AddPolicy(
    "DevelopmentExactOrigin",
    policy => policy
        .WithOrigins(developmentOrigins)
        .WithMethods(HttpMethods.Get)
        .WithHeaders("Accept")));

builder.Services.AddSingleton<LivePlatformSqlConnectionFactory>();
builder.Services.AddScoped<ILiveBillOfMaterialRepository, LiveBillOfMaterialRepository>();
builder.Services.AddScoped<ILiveInventoryItemRepository, LiveInventoryItemRepository>();
builder.Services.AddScoped<ILiveWorkOrderRepository, LiveWorkOrderRepository>();
builder.Services.AddScoped<ILiveGeneralLedgerAccountRepository, LiveGeneralLedgerAccountRepository>();
builder.Services.AddScoped<ILiveSalesOrderRepository, LiveSalesOrderRepository>();
builder.Services.AddScoped<
    ILiveSalesOrderWorkOrderRelationshipRepository,
    LiveSalesOrderWorkOrderRelationshipRepository>();
builder.Services.AddScoped<ILiveInvoiceHistoryRepository, LiveInvoiceHistoryRepository>();
builder.Services.AddScoped<ILivePlatformStatusRepository, LivePlatformStatusRepository>();
builder.Services.AddSingleton<DevelopmentReadOnlyGuard>();
builder.Services.AddOptions<LiveApiOptions>()
    .Bind(liveBoundaryConfiguration.GetSection(LiveApiOptions.SectionName));

var app = builder.Build();
var guard = app.Services.GetRequiredService<DevelopmentReadOnlyGuard>();
await guard.ValidateAsync(CancellationToken.None);

app.UseCors("DevelopmentExactOrigin");
app.MapControllers();
app.MapGet("/api/development/v1/security", () => guard.Evidence);
app.Run();
