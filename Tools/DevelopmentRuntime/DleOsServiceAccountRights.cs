using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Principal;

public static class DleOsServiceAccountRights
{
    private const uint PolicyCreateAccount = 0x00000010;
    private const uint PolicyLookupNames = 0x00000800;

    [StructLayout(LayoutKind.Sequential)]
    private struct LsaObjectAttributes
    {
        internal int Length;
        internal IntPtr RootDirectory;
        internal IntPtr ObjectName;
        internal uint Attributes;
        internal IntPtr SecurityDescriptor;
        internal IntPtr SecurityQualityOfService;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LsaUnicodeString
    {
        internal ushort Length;
        internal ushort MaximumLength;
        internal IntPtr Buffer;
    }

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaOpenPolicy(
        IntPtr systemName,
        ref LsaObjectAttributes objectAttributes,
        uint desiredAccess,
        out IntPtr policyHandle);

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaAddAccountRights(
        IntPtr policyHandle,
        IntPtr accountSid,
        LsaUnicodeString[] userRights,
        uint countOfRights);

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaRemoveAccountRights(
        IntPtr policyHandle,
        IntPtr accountSid,
        [MarshalAs(UnmanagedType.Bool)] bool allRights,
        LsaUnicodeString[] userRights,
        uint countOfRights);

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaEnumerateAccountRights(
        IntPtr policyHandle,
        IntPtr accountSid,
        out IntPtr userRights,
        out uint countOfRights);

    [DllImport("advapi32.dll")]
    private static extern uint LsaNtStatusToWinError(uint status);

    [DllImport("advapi32.dll")]
    private static extern uint LsaClose(IntPtr policyHandle);

    [DllImport("advapi32.dll")]
    private static extern uint LsaFreeMemory(IntPtr buffer);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LogonUser(
        string userName,
        string domain,
        IntPtr password,
        int logonType,
        int logonProvider,
        out IntPtr token);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    public static void ValidateCredential(string accountName, SecureString password)
    {
        var separator = accountName.IndexOf('\\');
        if (separator <= 0 || separator == accountName.Length - 1)
            throw new ArgumentException("A machine-qualified account is required.", "accountName");
        var domain = accountName.Substring(0, separator);
        var user = accountName.Substring(separator + 1);
        var passwordPointer = Marshal.SecureStringToGlobalAllocUnicode(password);
        IntPtr token;
        try
        {
            if (!LogonUser(user, domain, passwordPointer, 3, 0, out token))
                throw new Win32Exception(Marshal.GetLastWin32Error(),
                    "The supplied DLE-OS service credential is invalid.");
            CloseHandle(token);
        }
        finally
        {
            Marshal.ZeroFreeGlobalAllocUnicode(passwordPointer);
        }
    }

    public static bool HasRight(string accountName, string right)
    {
        return WithPolicyAndSid(accountName, (policy, sid) =>
        {
            IntPtr rights;
            uint count;
            var status = LsaEnumerateAccountRights(policy, sid, out rights, out count);
            if (status != 0)
            {
                var error = LsaNtStatusToWinError(status);
                if (error == 2) return false;
                throw new Win32Exception((int)error);
            }

            try
            {
                var size = Marshal.SizeOf<LsaUnicodeString>();
                for (var index = 0; index < count; index++)
                {
                    var item = Marshal.PtrToStructure<LsaUnicodeString>(IntPtr.Add(rights, index * size));
                    var name = Marshal.PtrToStringUni(item.Buffer, item.Length / 2);
                    if (string.Equals(name, right, StringComparison.OrdinalIgnoreCase)) return true;
                }
                return false;
            }
            finally
            {
                if (rights != IntPtr.Zero) LsaFreeMemory(rights);
            }
        });
    }

    public static void AddRight(string accountName, string right)
    {
        ChangeRight(accountName, right, true);
    }

    public static void RemoveRight(string accountName, string right)
    {
        ChangeRight(accountName, right, false);
    }

    private static void ChangeRight(string accountName, string right, bool add)
    {
        WithPolicyAndSid(accountName, (policy, sid) =>
        {
            var value = NewLsaString(right);
            try
            {
                var values = new[] { value };
                var status = add
                    ? LsaAddAccountRights(policy, sid, values, 1)
                    : LsaRemoveAccountRights(policy, sid, false, values, 1);
                ThrowIfFailed(status);
                return true;
            }
            finally
            {
                Marshal.FreeHGlobal(value.Buffer);
            }
        });
    }

    private static T WithPolicyAndSid<T>(string accountName, Func<IntPtr, IntPtr, T> action)
    {
        var attributes = new LsaObjectAttributes { Length = Marshal.SizeOf<LsaObjectAttributes>() };
        IntPtr policy;
        ThrowIfFailed(LsaOpenPolicy(IntPtr.Zero, ref attributes,
            PolicyCreateAccount | PolicyLookupNames, out policy));
        var sid = (SecurityIdentifier)new NTAccount(accountName).Translate(typeof(SecurityIdentifier));
        var sidBytes = new byte[sid.BinaryLength];
        sid.GetBinaryForm(sidBytes, 0);
        var sidPointer = Marshal.AllocHGlobal(sidBytes.Length);
        Marshal.Copy(sidBytes, 0, sidPointer, sidBytes.Length);
        try
        {
            return action(policy, sidPointer);
        }
        finally
        {
            Marshal.FreeHGlobal(sidPointer);
            LsaClose(policy);
        }
    }

    private static LsaUnicodeString NewLsaString(string value)
    {
        return new LsaUnicodeString
        {
            Buffer = Marshal.StringToHGlobalUni(value),
            Length = checked((ushort)(value.Length * 2)),
            MaximumLength = checked((ushort)((value.Length + 1) * 2))
        };
    }

    private static void ThrowIfFailed(uint status)
    {
        if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status));
    }
}
