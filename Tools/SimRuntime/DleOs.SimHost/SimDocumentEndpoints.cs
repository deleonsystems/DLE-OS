internal static class SimDocumentEndpoints
{
    private const string Route = "/api/development/kitting-documents/v1/work-orders";

    internal static void Map(WebApplication app, SimStateStore state,
        SimPersonaSessionStore personas, SimDocumentStore documents)
    {
        app.MapGet(Route + "/{workOrderNumber}", (string workOrderNumber, HttpContext context) =>
        {
            var denied = Denied(context, state, personas);
            if (denied is not null) return denied;
            if (context.Request.Query.Count != 0)
                return Results.BadRequest(new { error = "Query parameters are not supported." });
            try
            {
                var normalized = SimDocumentStore.NormalizeWorkOrder(workOrderNumber);
                var document = documents.Get(normalized);
                return Results.Json(new
                {
                    workOrderNumber = normalized,
                    aliases = normalized.TrimStart('0') == normalized
                        ? new[] { normalized }
                        : new[] { normalized, normalized.TrimStart('0') },
                    evidenceStatus = document is null ? "NO_KITTED_BOM_EVIDENCE" : "KIT_COMPLETE_EVIDENCE",
                    displayLabel = document is null ? "No Kitted BOM Found" : "Kit Complete - SIM Synthetic",
                    priorShortageEvidenceExists = false,
                    primaryDocument = document is null ? null : new
                    {
                        documentType = document.DocumentType,
                        fileName = document.FileName,
                        folder = document.Folder,
                        openUrl = $"{Route}/{normalized}/documents/{document.DocumentType}",
                        sha256 = document.Sha256,
                        synthetic = true,
                        environment = "SIM"
                    },
                    secondaryPriorShortageDocument = (object?)null,
                    synthetic = true,
                    environment = "SIM"
                });
            }
            catch (ArgumentException exception)
            {
                return Results.BadRequest(new { error = exception.Message });
            }
        });

        app.MapGet(Route + "/{workOrderNumber}/documents/{documentType}",
            (string workOrderNumber, string documentType, HttpContext context) =>
        {
            var denied = Denied(context, state, personas);
            if (denied is not null) return denied;
            if (context.Request.Query.Count != 0)
                return Results.BadRequest(new { error = "Query parameters are not supported." });
            try
            {
                var document = documents.Get(workOrderNumber, documentType);
                if (document is null)
                    return Results.NotFound(new { error = "Synthetic Kitted BOM PDF was not found." });
                var stream = new FileStream(document.FullPath, FileMode.Open, FileAccess.Read,
                    FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
                return Results.Stream(stream, "application/pdf", enableRangeProcessing: true);
            }
            catch (ArgumentException exception)
            {
                return Results.BadRequest(new { error = exception.Message });
            }
            catch (IOException)
            {
                return Results.Json(new
                {
                    code = "DLE_OS_SIM_DOCUMENT_UNAVAILABLE",
                    message = "The local synthetic document is temporarily unavailable.",
                    environment = "SIM"
                }, statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });
    }

    private static IResult? Denied(HttpContext context, SimStateStore state,
        SimPersonaSessionStore personas)
    {
        if (!state.Current.IsHealthy)
            return Results.Json(new
            {
                code = state.Current.ErrorCode,
                message = state.Current.Message,
                resetAvailable = true,
                environment = "SIM"
            }, statusCode: StatusCodes.Status409Conflict);
        var persona = personas.Resolve(context);
        if (persona.Can("kitting.view")) return null;
        return Results.Json(new
        {
            code = persona.IsActive ? "DLE_OS_PERMISSION_DENIED" : "DLE_OS_USER_DISABLED",
            message = persona.IsActive
                ? "The selected synthetic persona does not have the required permission."
                : "The selected synthetic persona is disabled.",
            requiredPermission = "kitting.view",
            personaId = persona.Id,
            environment = "SIM"
        }, statusCode: StatusCodes.Status403Forbidden);
    }
}
