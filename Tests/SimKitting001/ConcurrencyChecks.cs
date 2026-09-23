internal static class SimKittingConcurrencyChecks
{
    internal static async Task<(object Case,int Checks)> Start(SimKittingCases service,SimRfqIntakeStore intakes,
        string workOrder,SimKittingStartRequest request,SimPersona actor,string isolatedIntakePath)
    {
        var original=await File.ReadAllTextAsync(isolatedIntakePath);
        var intake=(SimRfqIntakeRecord)(await intakes.ReadAsync("RFQI-SIM-0043"))!;
        var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Task<SimOrderBridge>? bridgeChange=null;
        service.BeforeStartCommitForTest=async()=>{entered.SetResult();await release.Task;};
        var start=service.Start(workOrder,request,actor);
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
            bridgeChange=intakes.UpdateOrderBridge(intake.IntakeId,new(Guid.NewGuid().ToString(),
                intake.OrderEntry!.Bridge.Revision,"REOPEN",Reason:"Isolated concurrent Start guard test"),SimPersonaCatalog.Default);
            await Task.Delay(100);
            if(bridgeChange.IsCompleted)throw new Exception("Bridge changed between Kitting source validation and Start commit.");
            release.SetResult();
            var created=await start.WaitAsync(TimeSpan.FromSeconds(10));
            var bridge=await bridgeChange.WaitAsync(TimeSpan.FromSeconds(10));
            if(bridge.State.Status!="IN_PROGRESS")throw new Exception("Queued bridge action did not execute after Start released the source lock.");
            Console.WriteLine("PASS concurrent bridge reopening waits until source-bound Start commits");
            return(created,1);
        }
        finally
        {
            release.TrySetResult();service.BeforeStartCommitForTest=null;
            try{await start;}catch{}
            if(bridgeChange is not null)try{await bridgeChange;}catch{}
            // This helper receives only the suite's disposable copied Intake file.
            await File.WriteAllTextAsync(isolatedIntakePath,original);
        }
    }
}
