using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

internal static class NormalUserProcess
{
    private const uint SaferScopeMachine = 1;
    private const uint SaferLevelNormalUser = 0x20000;
    private const uint SaferLevelOpen = 1;
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateUnicodeEnvironment = 0x00000400;

    internal static Process Start(string executable, IReadOnlyList<string> arguments, string workingDirectory)
    {
        if (!SaferCreateLevel(SaferScopeMachine, SaferLevelNormalUser, SaferLevelOpen,
                out var level, IntPtr.Zero)) throw Win32("SaferCreateLevel");
        IntPtr token = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;
        try
        {
            if (!SaferComputeTokenFromLevel(level, IntPtr.Zero, out token, 0, IntPtr.Zero))
                throw Win32("SaferComputeTokenFromLevel");
            if (!CreateEnvironmentBlock(out environment, token, true))
                throw Win32("CreateEnvironmentBlock");
            var commandLine = new StringBuilder(string.Join(" ",
                new[] { Quote(executable) }.Concat(arguments.Select(Quote))));
            var startup = new StartupInfo { Size = Marshal.SizeOf<StartupInfo>() };
            if (!CreateProcessAsUser(token, null, commandLine, IntPtr.Zero, IntPtr.Zero,
                    false, CreateNoWindow | CreateUnicodeEnvironment, environment,
                    workingDirectory, ref startup, out var created))
                throw Win32("CreateProcessAsUser");
            try { return Process.GetProcessById(unchecked((int)created.ProcessId)); }
            finally { CloseHandle(created.Thread); CloseHandle(created.Process); }
        }
        finally
        {
            if (environment != IntPtr.Zero) DestroyEnvironmentBlock(environment);
            if (token != IntPtr.Zero) CloseHandle(token);
            SaferCloseLevel(level);
        }
    }

    private static string Quote(string value)
    {
        if (value.Length > 0 && value.All(c => !char.IsWhiteSpace(c) && c != '"')) return value;
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { result.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes).Append(character); slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }

    private static Win32Exception Win32(string operation) =>
        new(Marshal.GetLastWin32Error(), operation + " failed");

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size; public string? Reserved, Desktop, Title;
        public int X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        public short ShowWindow, Reserved2;
        public IntPtr ReservedPointer, StandardInput, StandardOutput, StandardError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SaferCreateLevel(uint scopeId, uint levelId, uint openFlags,
        out IntPtr levelHandle, IntPtr reserved);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SaferComputeTokenFromLevel(IntPtr levelHandle, IntPtr inputToken,
        out IntPtr outputToken, uint flags, IntPtr reserved);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessAsUser(IntPtr token, string? applicationName,
        StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory,
        ref StartupInfo startupInfo, out ProcessInformation processInformation);
    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);
    [DllImport("userenv.dll")] private static extern bool DestroyEnvironmentBlock(IntPtr environment);
    [DllImport("advapi32.dll")] private static extern bool SaferCloseLevel(IntPtr levelHandle);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
}
