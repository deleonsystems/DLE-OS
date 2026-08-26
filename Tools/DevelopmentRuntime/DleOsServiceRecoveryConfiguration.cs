using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public sealed class DleOsServiceRecoveryAction
{
    public int Type { get; set; }
    public uint DelayMilliseconds { get; set; }
}

public sealed class DleOsServiceRecoveryState
{
    public uint ResetPeriodSeconds { get; set; }
    public DleOsServiceRecoveryAction[] Actions { get; set; }
}

public static class DleOsServiceRecoveryConfiguration
{
    private const uint ScManagerConnect = 0x0001;
    private const uint ServiceQueryConfig = 0x0001;
    private const uint ServiceChangeConfig = 0x0002;
    private const int ServiceConfigFailureActions = 2;
    private const int ServiceConfigFailureActionsFlag = 4;
    private const int ScActionNone = 0;
    private const int ScActionRestart = 1;
    private const int ErrorInsufficientBuffer = 122;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ServiceFailureActions
    {
        internal uint ResetPeriod;
        internal IntPtr RebootMessage;
        internal IntPtr Command;
        internal uint ActionCount;
        internal IntPtr Actions;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceFailureActionsFlag
    {
        [MarshalAs(UnmanagedType.Bool)] internal bool FailureActionsOnNonCrashFailures;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ScAction
    {
        internal int Type;
        internal uint Delay;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenSCManager(string machineName, string databaseName, uint desiredAccess);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenService(IntPtr scm, string serviceName, uint desiredAccess);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ChangeServiceConfig2(IntPtr service, int infoLevel, IntPtr info);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryServiceConfig2(
        IntPtr service, int infoLevel, IntPtr buffer, uint bufferSize, out uint bytesNeeded);

    [DllImport("advapi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseServiceHandle(IntPtr handle);

    public static void ConfigureBoundedRecovery(string serviceName, uint resetPeriodSeconds, uint restartDelayMilliseconds)
    {
        IntPtr scm = IntPtr.Zero;
        IntPtr service = IntPtr.Zero;
        IntPtr actionsPointer = IntPtr.Zero;
        IntPtr configurationPointer = IntPtr.Zero;
        IntPtr flagPointer = IntPtr.Zero;
        try
        {
            scm = OpenSCManager(null, null, ScManagerConnect);
            if (scm == IntPtr.Zero) ThrowLastError("OpenSCManager");
            service = OpenService(scm, serviceName, ServiceChangeConfig | ServiceQueryConfig);
            if (service == IntPtr.Zero) ThrowLastError("OpenService");

            var actions = new[]
            {
                new ScAction { Type = ScActionRestart, Delay = restartDelayMilliseconds },
                new ScAction { Type = ScActionRestart, Delay = restartDelayMilliseconds },
                new ScAction { Type = ScActionRestart, Delay = restartDelayMilliseconds },
                new ScAction { Type = ScActionRestart, Delay = restartDelayMilliseconds },
                new ScAction { Type = ScActionNone, Delay = 0 }
            };
            var actionSize = Marshal.SizeOf(typeof(ScAction));
            actionsPointer = Marshal.AllocHGlobal(actionSize * actions.Length);
            for (var index = 0; index < actions.Length; index++)
                Marshal.StructureToPtr(actions[index], IntPtr.Add(actionsPointer, index * actionSize), false);
            var configuration = new ServiceFailureActions
            {
                ResetPeriod = resetPeriodSeconds,
                RebootMessage = IntPtr.Zero,
                Command = IntPtr.Zero,
                ActionCount = (uint)actions.Length,
                Actions = actionsPointer
            };
            configurationPointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ServiceFailureActions)));
            Marshal.StructureToPtr(configuration, configurationPointer, false);
            if (!ChangeServiceConfig2(service, ServiceConfigFailureActions, configurationPointer))
                ThrowLastError("ChangeServiceConfig2(SERVICE_CONFIG_FAILURE_ACTIONS)");

            flagPointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ServiceFailureActionsFlag)));
            Marshal.StructureToPtr(new ServiceFailureActionsFlag
            {
                FailureActionsOnNonCrashFailures = true
            }, flagPointer, false);
            if (!ChangeServiceConfig2(service, ServiceConfigFailureActionsFlag, flagPointer))
                ThrowLastError("ChangeServiceConfig2(SERVICE_CONFIG_FAILURE_ACTIONS_FLAG)");
        }
        finally
        {
            if (flagPointer != IntPtr.Zero) Marshal.FreeHGlobal(flagPointer);
            if (configurationPointer != IntPtr.Zero) Marshal.FreeHGlobal(configurationPointer);
            if (actionsPointer != IntPtr.Zero) Marshal.FreeHGlobal(actionsPointer);
            if (service != IntPtr.Zero) CloseServiceHandle(service);
            if (scm != IntPtr.Zero) CloseServiceHandle(scm);
        }
    }

    public static DleOsServiceRecoveryState Query(string serviceName)
    {
        IntPtr scm = IntPtr.Zero;
        IntPtr service = IntPtr.Zero;
        IntPtr buffer = IntPtr.Zero;
        try
        {
            scm = OpenSCManager(null, null, ScManagerConnect);
            if (scm == IntPtr.Zero) ThrowLastError("OpenSCManager");
            service = OpenService(scm, serviceName, ServiceQueryConfig);
            if (service == IntPtr.Zero) ThrowLastError("OpenService");
            uint required;
            QueryServiceConfig2(service, ServiceConfigFailureActions, IntPtr.Zero, 0, out required);
            var error = Marshal.GetLastWin32Error();
            if (required == 0 || error != ErrorInsufficientBuffer)
                throw new Win32Exception(error, "QueryServiceConfig2 did not return a buffer size.");
            buffer = Marshal.AllocHGlobal((int)required);
            if (!QueryServiceConfig2(service, ServiceConfigFailureActions, buffer, required, out required))
                ThrowLastError("QueryServiceConfig2(SERVICE_CONFIG_FAILURE_ACTIONS)");
            var configuration = Marshal.PtrToStructure<ServiceFailureActions>(buffer);
            var actionSize = Marshal.SizeOf(typeof(ScAction));
            var actions = new DleOsServiceRecoveryAction[configuration.ActionCount];
            for (var index = 0; index < actions.Length; index++)
            {
                var action = Marshal.PtrToStructure<ScAction>(IntPtr.Add(configuration.Actions, index * actionSize));
                actions[index] = new DleOsServiceRecoveryAction
                {
                    Type = action.Type,
                    DelayMilliseconds = action.Delay
                };
            }
            return new DleOsServiceRecoveryState
            {
                ResetPeriodSeconds = configuration.ResetPeriod,
                Actions = actions
            };
        }
        finally
        {
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            if (service != IntPtr.Zero) CloseServiceHandle(service);
            if (scm != IntPtr.Zero) CloseServiceHandle(scm);
        }
    }

    private static void ThrowLastError(string operation)
    {
        throw new Win32Exception(Marshal.GetLastWin32Error(), operation + " failed.");
    }
}
