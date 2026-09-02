using Microsoft.Data.Sqlite;

internal static class SimOperationsEndpoints
{
    internal static void Map(WebApplication app, SimStateStore state,
        SimOperationsDataStore data, SimPersonaSessionStore personas, SimFaultStore faults)
    {
        app.MapPost("/api/operations-center/v1/verified-statuses/latest",
            (SimLineVerifiedStatusLatestRequest request, HttpContext context) =>
            {
                var denied = Denied(context, state, data, personas, "sync.operations");
                if (denied is not null) return denied;
                if (faults.TriggerPersistent(SimFaultStore.VerifiedStatusReadUnavailable))
                    return VerifiedStatusReadUnavailable(faults);
                return Results.Json(new { records = Array.Empty<object>() });
            });

        app.MapPost("/api/operations-center/v1/work-orders/verified-statuses/latest",
            async Task<IResult> (SimWorkOrderVerifiedStatusLatestRequest request, HttpContext context) =>
                await VerifiedStatus(context, state, data, personas, faults,
                    () => data.ReadWorkOrderVerifiedStatusLatestAsync(request.WorkOrderNumbers)));

        app.MapGet("/api/operations-center/v1/work-orders/{workOrderNumber}/verified-status-history",
            async Task<IResult> (string workOrderNumber, HttpContext context) =>
                await VerifiedStatus(context, state, data, personas, faults,
                    () => data.ReadWorkOrderVerifiedStatusHistoryAsync(workOrderNumber)));

        app.MapPost("/api/operations-center/v1/work-orders/{workOrderNumber}/verified-status-events",
            async Task<IResult> (string workOrderNumber, SimWorkOrderVerifiedStatusAppendRequest request,
                HttpContext context) =>
            {
                var denied = Denied(context, state, data, personas,
                    "operations-center.verified-status.write");
                if (denied is not null) return denied;
                try
                {
                    var persona = personas.Resolve(context);
                    var result = await data.AppendWorkOrderVerifiedStatusAsync(workOrderNumber,
                        request, persona, state.Current.Metadata!, () =>
                            faults.TriggerPersistent(SimFaultStore.VerifiedStatusWriteUnavailable));
                    if (!result.Duplicate && faults.ConsumeOnce(SimFaultStore.VerifiedStatusResponseLost))
                        return Results.Json(new
                        {
                            code = "DLE_OS_SIM_VERIFIED_STATUS_RESPONSE_LOST",
                            message = "The local SIM write committed, but the caller received an intentionally ambiguous response.",
                            outcome = "UNKNOWN_TO_CALLER",
                            retryWithSameCorrelationId = true,
                            environment = "SIM",
                            fault = faults.StateContract()
                        }, statusCode: StatusCodes.Status503ServiceUnavailable);
                    return Results.Json(result, statusCode: StatusCodes.Status201Created);
                }
                catch (SimVerifiedStatusProblem problem)
                {
                    return Results.Json(new { code = problem.Code, message = problem.Message },
                        statusCode: problem.StatusCode);
                }
                catch (SimFaultInjectedException problem)
                {
                    return Results.Json(new
                    {
                        code = problem.Code,
                        message = problem.Message,
                        environment = "SIM",
                        fault = faults.StateContract()
                    }, statusCode: StatusCodes.Status503ServiceUnavailable);
                }
                catch (Exception exception) when (exception is IOException or InvalidOperationException or SqliteException)
                {
                    return Unavailable(data, exception.Message);
                }
            });

        app.MapGet("/api/operations-center/v1/lines/{masterRecordKey}/verified-status-history",
            (string masterRecordKey, HttpContext context) =>
            {
                var denied = Denied(context, state, data, personas, "sync.operations");
                if (denied is not null) return denied;
                if (faults.TriggerPersistent(SimFaultStore.VerifiedStatusReadUnavailable))
                    return VerifiedStatusReadUnavailable(faults);
                return Results.Json(new { masterRecordKey = Uri.UnescapeDataString(masterRecordKey), records = Array.Empty<object>() });
            });

        app.MapGet("/api/kitting-cases/v1/work-orders/{workOrderNumber}",
            async Task<IResult> (string workOrderNumber, HttpContext context) =>
                await KittingCase(context, state, data, personas, workOrderNumber));

        app.MapGet("/api/platform/live/v1/invoice-history/metadata",
            async Task<IResult> (HttpContext context) =>
                await InvoiceMetadata(context, state, data, personas));

        app.MapGet("/api/platform/live/v1/invoice-history",
            async Task<IResult> (HttpContext context) =>
                await List(context, state, data, personas, "sync.operations",
                    (query, generation) => data.ReadInvoiceHistoryAsync(query, generation)));

        app.MapGet("/api/platform/live/v1/invoice-history/{invoiceHistoryLineId}",
            async Task<IResult> (string invoiceHistoryLineId, HttpContext context) =>
                await Record(context, state, data, personas, "sync.operations",
                    () => data.ReadRecordAsync("InvoiceHistoryLine", "InvoiceHistoryLineId", invoiceHistoryLineId)));

        app.MapGet("/api/platform/refresh/invoice-history/v1/status", (HttpContext context) =>
        {
            var denied = Denied(context, state, data, personas, "sync.operations");
            if (denied is not null) return denied;
            return Results.Json(new
            {
                authorized = false,
                running = false,
                status = "UNAVAILABLE_IN_SIM",
                message = "Invoice History refresh is unavailable in SIM Phase 7. The synthetic baseline remains read-only.",
                environment = "SIM",
                synthetic = true,
                generation = state.Current.Metadata!.Generation
            });
        });

        app.MapPost("/api/platform/refresh/invoice-history/v1/run", (HttpContext context) =>
        {
            var denied = Denied(context, state, data, personas, "sync.operations");
            if (denied is not null) return denied;
            return Results.Json(new
            {
                code = "INVOICE_HISTORY_EXECUTION_DISABLED",
                message = "Invoice History refresh execution is disabled in SIM Phase 7.",
                environment = "SIM"
            }, statusCode: StatusCodes.Status501NotImplemented);
        });

        app.MapGet("/api/platform/live/v1/sales-orders",
            async Task<IResult> (HttpContext context) =>
                await List(context, state, data, personas, "kitting.view",
                    (query, generation) => data.ReadSalesOrderLinesAsync(query, generation)));

        app.MapGet("/api/platform/live/v1/sales-orders/{salesOrderLineId}",
            async Task<IResult> (string salesOrderLineId, HttpContext context) =>
                await Record(context, state, data, personas, "kitting.view",
                    () => data.ReadRecordAsync("SalesOrderLine", "SalesOrderLineId", salesOrderLineId)));

        app.MapGet("/api/platform/live/v1/work-orders",
            async Task<IResult> (HttpContext context) =>
                await List(context, state, data, personas, "work_orders.view",
                    (query, generation) => data.ReadWorkOrdersAsync(query, generation), ["kitting.view"]));

        app.MapGet("/api/platform/live/v1/work-orders/{workOrderNumber}",
            async Task<IResult> (string workOrderNumber, HttpContext context) =>
                await Record(context, state, data, personas, "work_orders.view",
                    () => data.ReadRecordAsync("WorkOrder", "WorkOrderNumber", workOrderNumber), ["kitting.view"]));

        app.MapGet("/api/platform/live/v1/sales-order-work-order-relationships",
            async Task<IResult> (HttpContext context) =>
                await List(context, state, data, personas, "work_orders.view",
                    (query, generation) => data.ReadRelationshipsAsync(query, generation), ["kitting.view"]));
    }

    private static async Task<IResult> VerifiedStatus(HttpContext context, SimStateStore state,
        SimOperationsDataStore data, SimPersonaSessionStore personas, SimFaultStore faults,
        Func<Task<object>> read)
    {
        var denied = Denied(context, state, data, personas, "sync.operations");
        if (denied is not null) return denied;
        try
        {
            if (faults.TriggerPersistent(SimFaultStore.VerifiedStatusReadUnavailable))
                return VerifiedStatusReadUnavailable(faults);
            return Results.Json(await read());
        }
        catch (SimVerifiedStatusProblem problem)
        {
            return Results.Json(new { code = problem.Code, message = problem.Message },
                statusCode: problem.StatusCode);
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or SqliteException)
        {
            return Unavailable(data, exception.Message);
        }
    }

    private static IResult VerifiedStatusReadUnavailable(SimFaultStore faults) =>
        Results.Json(new
        {
            code = "DLE_OS_SIM_VERIFIED_STATUS_READ_UNAVAILABLE",
            message = "Verified Status reads are intentionally unavailable under the active SIM fault profile.",
            environment = "SIM",
            fault = faults.StateContract()
        }, statusCode: StatusCodes.Status503ServiceUnavailable);

    private static async Task<IResult> KittingCase(HttpContext context, SimStateStore state,
        SimOperationsDataStore data, SimPersonaSessionStore personas, string workOrderNumber)
    {
        var denied = Denied(context, state, data, personas, "kitting.view");
        if (denied is not null) return denied;
        try
        {
            var result = await data.ReadKittingCaseAsync(workOrderNumber, state.Current.Metadata!.Generation);
            return result is null
                ? Results.Json(new
                {
                    code = "DLE_OS_SIM_RECORD_NOT_FOUND",
                    message = "The requested synthetic Kitting read state does not exist.",
                    environment = "SIM"
                }, statusCode: StatusCodes.Status404NotFound)
                : Results.Json(result);
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or SqliteException)
        {
            return Unavailable(data, exception.Message);
        }
    }

    private static async Task<IResult> InvoiceMetadata(HttpContext context, SimStateStore state,
        SimOperationsDataStore data, SimPersonaSessionStore personas)
    {
        var denied = Denied(context, state, data, personas, "sync.operations");
        if (denied is not null) return denied;
        try
        {
            return Results.Json(await data.ReadInvoiceHistoryMetadataAsync(state.Current.Metadata!.Generation));
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or SqliteException)
        {
            return Unavailable(data, exception.Message);
        }
    }

    private static async Task<IResult> List(HttpContext context, SimStateStore state,
        SimOperationsDataStore data, SimPersonaSessionStore personas, string permission,
        Func<IQueryCollection, long, Task<SimPageResult>> read, string[]? alternativePermissions = null)
    {
        var denied = Denied(context, state, data, personas, permission, alternativePermissions ?? []);
        if (denied is not null) return denied;
        try
        {
            return Results.Json(await read(context.Request.Query, state.Current.Metadata!.Generation));
        }
        catch (ArgumentException exception)
        {
            return Results.Json(new
            {
                code = "DLE_OS_SIM_QUERY_INVALID",
                message = exception.Message,
                environment = "SIM"
            }, statusCode: StatusCodes.Status400BadRequest);
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or SqliteException)
        {
            return Unavailable(data, exception.Message);
        }
    }

    private static async Task<IResult> Record(HttpContext context, SimStateStore state,
        SimOperationsDataStore data, SimPersonaSessionStore personas, string permission,
        Func<Task<object?>> read, string[]? alternativePermissions = null)
    {
        var denied = Denied(context, state, data, personas, permission, alternativePermissions ?? []);
        if (denied is not null) return denied;
        try
        {
            var record = await read();
            return record is null
                ? Results.Json(new
                {
                    code = "DLE_OS_SIM_RECORD_NOT_FOUND",
                    message = "The requested synthetic record does not exist.",
                    environment = "SIM"
                }, statusCode: StatusCodes.Status404NotFound)
                : Results.Json(record);
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or SqliteException)
        {
            return Unavailable(data, exception.Message);
        }
    }

    private static IResult? Denied(HttpContext context, SimStateStore? state,
        SimOperationsDataStore data, SimPersonaSessionStore personas, string permission,
        params string[] alternativePermissions)
    {
        if (state is not null && !state.Current.IsHealthy)
            return Results.Json(new
            {
                code = state.Current.ErrorCode,
                message = state.Current.Message,
                environment = "SIM",
                resetAvailable = true
            }, statusCode: StatusCodes.Status503ServiceUnavailable);
        if (!data.IsHealthy) return Unavailable(data, data.ErrorMessage);
        var persona = personas.Resolve(context);
        if (!persona.IsActive)
            return Results.Json(new
            {
                code = "DLE_OS_USER_DISABLED",
                message = "The selected synthetic persona is disabled.",
                environment = "SIM"
            }, statusCode: StatusCodes.Status403Forbidden);
        if (!persona.Can(permission) && !alternativePermissions.Any(persona.Can))
            return Results.Json(new
            {
                code = "DLE_OS_PERMISSION_DENIED",
                message = "The selected synthetic persona does not have the required DLE-OS permission.",
                requiredPermission = permission,
                environment = "SIM"
            }, statusCode: StatusCodes.Status403Forbidden);
        return null;
    }

    private static IResult Unavailable(SimOperationsDataStore data, string? detail) =>
        Results.Json(new
        {
            code = data.ErrorCode ?? "DLE_OS_SIM_OPERATIONS_DATA_UNAVAILABLE",
            message = detail ?? data.ErrorMessage ?? "SIM Operations Center data is unavailable.",
            environment = "SIM",
            resetAvailable = true
        }, statusCode: StatusCodes.Status503ServiceUnavailable);
}

internal sealed record SimLineVerifiedStatusLatestRequest(string[]? MasterRecordKeys);
internal sealed record SimWorkOrderVerifiedStatusLatestRequest(string[]? WorkOrderNumbers);
internal sealed record SimWorkOrderVerifiedStatusAppendRequest(
    string? StatusText,
    Dictionary<string, object?>? EvidenceSnapshot,
    Guid? RequestCorrelationId);
