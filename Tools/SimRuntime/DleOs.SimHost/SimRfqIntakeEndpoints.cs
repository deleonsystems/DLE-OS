internal static class SimRfqIntakeEndpoints
{
    private static readonly object[] Customers =
    [
        new
        {
            customerId = "SIM-CUSTOMER-ABBOTT",
            customerNumber = "990100",
            customerName = "Abbott",
            aliases = new[] { "Abbott Laboratories" },
            sources = new[] { "SIM Qualification Fixture" },
            synthetic = true
        }
    ];

    internal static void Map(WebApplication app, SimStateStore state,
        SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        app.MapGet("/api/platform/live/v1/customer-directory/search", (HttpContext context) =>
        {
            var denied = Denied(context, state, personas, write: false);
            if (denied is not null) return denied;
            var query = context.Request.Query["q"].ToString().Trim();
            var items = Customers.Where(item => string.IsNullOrWhiteSpace(query) ||
                item.ToString()!.Contains(query, StringComparison.OrdinalIgnoreCase)).ToArray();
            return Results.Json(new
            {
                query,
                items,
                returnedCount = items.Length,
                totalItems = items.Length,
                page = 1,
                pageSize = 25,
                totalPages = items.Length == 0 ? 0 : 1,
                hasMore = false,
                environment = "SIM",
                synthetic = true
            });
        });

        app.MapPost("/api/sim/rfq-intakes", async Task<IResult> (
            SimRfqIntakeCreateRequest request, HttpContext context) =>
        {
            var denied = Denied(context, state, personas, write: true);
            if (denied is not null) return denied;
            try
            {
                var result = await store.CreateAsync(request, personas.Resolve(context), state.Current.Metadata!);
                return Results.Json(result, statusCode: StatusCodes.Status201Created);
            }
            catch (SimRfqIntakeProblem problem)
            {
                return Results.Json(new { code = problem.Code, message = problem.Message, environment = "SIM" },
                    statusCode: problem.StatusCode);
            }
        });

        app.MapGet("/api/sim/rfq-intakes/{intakeId}", async Task<IResult> (
            string intakeId, HttpContext context) =>
        {
            var denied = Denied(context, state, personas, write: false);
            if (denied is not null) return denied;
            var record = await store.ReadAsync(intakeId);
            return record is null
                ? Results.Json(new { code = "DLE_OS_SIM_RFQ_INTAKE_NOT_FOUND", message = "The SIM RFQ Intake does not exist." }, statusCode: 404)
                : Results.Json(record);
        });
    }

    private static IResult? Denied(HttpContext context, SimStateStore state,
        SimPersonaSessionStore personas, bool write)
    {
        if (!state.Current.IsHealthy)
            return Results.Json(new { code = state.Current.ErrorCode, message = state.Current.Message, environment = "SIM" }, statusCode: 503);
        var persona = personas.Resolve(context);
        if (!persona.IsActive)
            return Results.Json(new { code = "DLE_OS_USER_DISABLED", message = "The selected synthetic persona is disabled." }, statusCode: 403);
        if (write && !persona.Can("rfq.intake.create"))
            return Results.Json(new { code = "DLE_OS_PERMISSION_DENIED", message = "The selected SIM persona cannot create RFQ intakes.", requiredPermission = "rfq.intake.create" }, statusCode: 403);
        return null;
    }
}
