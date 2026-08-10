using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.DirectoryServices;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;

public static class DleOsLegacyFileServerBootstrap
{
    private const string ExpectedComputer = "DELEON-SERVER";
    private const string AccountName = "DLE-OS-DEV-FRONTEND";
    private const string QualifiedIdentity = "DELEON-SERVER\\DLE-OS-DEV-FRONTEND";
    private const string ShareName = "Production";
    private const string DenyInteractive = "SeDenyInteractiveLogonRight";
    private const string DenyRemoteInteractive = "SeDenyRemoteInteractiveLogonRight";
    private const int ShareReadMask = 0x1200A9;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length < 1) throw new InvalidOperationException("Mode is required.");
            if (string.Equals(args[0], "bootstrap", StringComparison.OrdinalIgnoreCase))
            {
                if (args.Length != 3) throw new InvalidOperationException("bootstrap requires request and output paths.");
                Bootstrap(Path.GetFullPath(args[1]), Path.GetFullPath(args[2]));
            }
            else if (string.Equals(args[0], "rollback", StringComparison.OrdinalIgnoreCase))
            {
                if (args.Length != 2) throw new InvalidOperationException("rollback requires a protected rollback-state path.");
                Rollback(Path.GetFullPath(args[1]));
            }
            else if (string.Equals(args[0], "simulate", StringComparison.OrdinalIgnoreCase))
            {
                if (args.Length != 3) throw new InvalidOperationException("simulate requires request and output paths.");
                Simulate(Path.GetFullPath(args[1]), Path.GetFullPath(args[2]));
            }
            else throw new InvalidOperationException("Unsupported mode.");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception.ToString());
            return 1;
        }
    }

    public static int RunBootstrap(string requestPath, string outputDirectory)
    {
        return Main(new[] { "bootstrap", requestPath, outputDirectory });
    }

    private static void Simulate(string requestPath, string outputDirectory)
    {
        Directory.CreateDirectory(outputDirectory);
        BootstrapRequest request = ValidateSealedRequest(requestPath);
        char[] passwordChars = NewPassword(48); byte[] passwordBytes = Encoding.UTF8.GetBytes(passwordChars);
        try
        {
            byte[] encrypted = EncryptPassword(request.PublicKey, passwordBytes);
            try
            {
                ResponsePayload payload = new ResponsePayload {
                    Schema = "DLE-OS-DEV-FRONTEND-FILESERVER-BOOTSTRAP-RESPONSE-V2", TransactionId = request.TransactionId,
                    RequestSha256 = Sha256File(requestPath), RequestNonce = request.Nonce, ComputerName = ExpectedComputer,
                    AccountName = AccountName, QualifiedIdentity = QualifiedIdentity, ShareName = ShareName,
                    SharePath = "C:\\SIMULATION\\Production", AllowedRelativePaths = new[] { "KITTING\\KIT-SHORTAGES", "KITTING\\KIT-COMPLETE" },
                    UnrelatedProbeRelativePath = "Customer Files", ShareAccess = "Read", NtfsAccess = "ReadAndExecute only on KITTING roots",
                    DenyInteractiveLogon = true, DenyRemoteInteractiveLogon = true, ExactKittingRead = true,
                    UnrelatedProductionReadDenied = true, EncryptedPassword = Convert.ToBase64String(encrypted),
                    PasswordEncryption = "RSA-3072-OAEP-SHA1-CSP", Simulation = true,
                    AppliedAtUtc = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture)
                };
                byte[] payloadBytes = Encoding.UTF8.GetBytes(Json.Serialize(payload));
                try
                {
                    BootstrapResponse response = new BootstrapResponse { PayloadBase64 = Convert.ToBase64String(payloadBytes), PayloadSha256 = Sha256(payloadBytes), EvidenceHmacSha256 = HmacSha256(passwordBytes, payloadBytes), Verdict = "PASS", PlaintextPasswordPersisted = false };
                    string responsePath = Path.Combine(outputDirectory, "bootstrap-response.json");
                    WriteUtf8(responsePath, Json.Serialize(response));
                    WriteUtf8(Path.Combine(outputDirectory, "bootstrap-response.sha256"), Sha256File(responsePath) + "\n");
                }
                finally { Clear(payloadBytes); }
            }
            finally { Clear(encrypted); }
        }
        finally { Array.Clear(passwordChars, 0, passwordChars.Length); Clear(passwordBytes); }
    }

    private static void Bootstrap(string requestPath, string outputDirectory)
    {
        AssertLocalElevatedServer();
        Directory.CreateDirectory(outputDirectory);
        BootstrapRequest request = null;
        BootstrapState state = null;
        bool mutationStarted = false;
        char[] passwordChars = null;
        byte[] passwordBytes = null;
        string password = null;
        try
        {
            request = ValidateSealedRequest(requestPath);
            string sharePath = GetSharePath();
            string kitting = Path.Combine(sharePath, "KITTING");
            string shortages = Path.Combine(kitting, "KIT-SHORTAGES");
            string complete = Path.Combine(kitting, "KIT-COMPLETE");
            foreach (string path in new[] { kitting, shortages, complete })
                if (!Directory.Exists(path)) throw new DirectoryNotFoundException("Required Kitting path is absent: " + path);
            if (LocalUserExists()) throw new InvalidOperationException("The matching workgroup account already exists.");
            if (FindShareAces(AccountName).Count != 0) throw new InvalidOperationException("A pre-existing Production share ACE exists for the matching identity.");

            state = new BootstrapState {
                TransactionId = request.TransactionId, AccountCreated = false, DenyInteractiveAdded = false,
                DenyRemoteInteractiveAdded = false, ShareAclChanged = false, NtfsAclChanged = false,
                SharePath = sharePath, KittingRoot = kitting, ShortageRoot = shortages, CompleteRoot = complete,
                ShareDacl = CaptureShareDacl(), KittingSddl = CaptureSddl(kitting),
                ShortageSddl = CaptureSddl(shortages), CompleteSddl = CaptureSddl(complete)
            };
            passwordChars = NewPassword(48);
            password = new string(passwordChars);
            passwordBytes = Encoding.UTF8.GetBytes(passwordChars);

            mutationStarted = true;
            state.AccountCreated = true; CreateLocalUser(password);
            RemoveAllLocalGroupMemberships();
            if (!LsaRights.HasRight(QualifiedIdentity, DenyInteractive)) { state.DenyInteractiveAdded = true; LsaRights.AddRight(QualifiedIdentity, DenyInteractive); }
            if (!LsaRights.HasRight(QualifiedIdentity, DenyRemoteInteractive)) { state.DenyRemoteInteractiveAdded = true; LsaRights.AddRight(QualifiedIdentity, DenyRemoteInteractive); }
            state.ShareAclChanged = true; SetReadOnlyShareAce();
            state.NtfsAclChanged = true; SetKittingAcls(kitting, shortages, complete);

            SecurityIdentifier sid = GetLocalUserSid();
            ValidateRightsAndAcls(sid, kitting, shortages, complete);
            ValidateEffectiveSmb(password);

            byte[] encryptedPassword = EncryptPassword(request.PublicKey, passwordBytes);
            try
            {
                ResponsePayload payload = new ResponsePayload {
                    Schema = "DLE-OS-DEV-FRONTEND-FILESERVER-BOOTSTRAP-RESPONSE-V2",
                    TransactionId = request.TransactionId, RequestSha256 = Sha256File(requestPath), RequestNonce = request.Nonce,
                    ComputerName = Environment.MachineName, AccountName = AccountName, QualifiedIdentity = QualifiedIdentity,
                    ShareName = ShareName, SharePath = sharePath,
                    AllowedRelativePaths = new[] { "KITTING\\KIT-SHORTAGES", "KITTING\\KIT-COMPLETE" },
                    UnrelatedProbeRelativePath = "Customer Files", ShareAccess = "Read",
                    NtfsAccess = "ReadAndExecute only on KITTING roots", DenyInteractiveLogon = true,
                    DenyRemoteInteractiveLogon = true, ExactKittingRead = true, UnrelatedProductionReadDenied = true,
                    EncryptedPassword = Convert.ToBase64String(encryptedPassword),
                    PasswordEncryption = "RSA-3072-OAEP-SHA1-CSP", Simulation = false,
                    AppliedAtUtc = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture)
                };
                string payloadJson = Json.Serialize(payload);
                byte[] payloadData = Encoding.UTF8.GetBytes(payloadJson);
                try
                {
                    BootstrapResponse response = new BootstrapResponse {
                        PayloadBase64 = Convert.ToBase64String(payloadData), PayloadSha256 = Sha256(payloadData),
                        EvidenceHmacSha256 = HmacSha256(passwordBytes, payloadData), Verdict = "PASS",
                        PlaintextPasswordPersisted = false
                    };
                    string responsePath = Path.Combine(outputDirectory, "bootstrap-response.json");
                    WriteUtf8(responsePath, Json.Serialize(response));
                    WriteUtf8(Path.Combine(outputDirectory, "bootstrap-response.sha256"), Sha256File(responsePath) + "\n");
                    byte[] rollbackPlain = Encoding.UTF8.GetBytes(Json.Serialize(state));
                    byte[] entropy = Encoding.UTF8.GetBytes("DLE-OS|DEV-FRONTEND|" + request.TransactionId + "|FILESERVER-ROLLBACK-V2");
                    try
                    {
                        byte[] protectedState = ProtectedData.Protect(rollbackPlain, entropy, DataProtectionScope.LocalMachine);
                        try
                        {
                            string rollbackPath = Path.Combine(outputDirectory, "fileserver-rollback-state.dpapi");
                            File.WriteAllBytes(rollbackPath, protectedState);
                            RestrictSecretFile(rollbackPath);
                        }
                        finally { Clear(protectedState); }
                    }
                    finally { Clear(rollbackPlain); Clear(entropy); }
                }
                finally { Clear(payloadData); }
            }
            finally { Clear(encryptedPassword); }
            WriteUtf8(Path.Combine(outputDirectory, "bootstrap-result.json"), Json.Serialize(new ResultRecord {
                Verdict = "PASS", TransactionId = request.TransactionId, MutationStarted = true,
                RollbackVerdict = "NOT_REQUIRED", ProductionDeploymentPerformed = false,
                PlaintextPasswordPersisted = false, CompletedAtUtc = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture)
            }));
        }
        catch (Exception original)
        {
            DeleteIfExists(Path.Combine(outputDirectory, "bootstrap-response.json"));
            DeleteIfExists(Path.Combine(outputDirectory, "bootstrap-response.sha256"));
            DeleteIfExists(Path.Combine(outputDirectory, "fileserver-rollback-state.dpapi"));
            DeleteIfExists(Path.Combine(outputDirectory, "bootstrap-result.json"));
            string rollbackVerdict = "NOT_REQUIRED";
            string rollbackError = null;
            if (mutationStarted && state != null)
            {
                try { Undo(state); rollbackVerdict = "PASS"; }
                catch (Exception rollbackException) { rollbackVerdict = "FAIL"; rollbackError = rollbackException.Message; }
            }
            ResultRecord failure = new ResultRecord {
                Verdict = "FAIL", TransactionId = request == null ? null : request.TransactionId,
                Error = original.Message, MutationStarted = mutationStarted, RollbackVerdict = rollbackVerdict,
                RollbackError = rollbackError, ProductionDeploymentPerformed = false,
                PlaintextPasswordPersisted = false, CompletedAtUtc = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture)
            };
            string failurePath = Path.Combine(outputDirectory, "bootstrap-failure.json");
            WriteUtf8(failurePath, Json.Serialize(failure));
            WriteUtf8(Path.Combine(outputDirectory, "bootstrap-failure.sha256"), Sha256File(failurePath) + "\n");
            if (rollbackVerdict == "FAIL") throw new InvalidOperationException(original.Message + " | Local rollback failed: " + rollbackError, original);
            throw;
        }
        finally
        {
            if (passwordChars != null) Array.Clear(passwordChars, 0, passwordChars.Length);
            Clear(passwordBytes);
            password = null;
        }
    }

    private static void Rollback(string protectedPath)
    {
        AssertLocalElevatedServer();
        string directory = Path.GetDirectoryName(protectedPath);
        string responsePath = Path.Combine(directory, "bootstrap-response.json");
        string responseHashPath = Path.Combine(directory, "bootstrap-response.sha256");
        if (!File.Exists(responsePath) || !File.Exists(responseHashPath)) throw new InvalidOperationException("The original response evidence is incomplete.");
        if (!FixedEquals(File.ReadAllText(responseHashPath).Trim(), Sha256File(responsePath))) throw new InvalidOperationException("The response evidence checksum is invalid.");
        BootstrapResponse response = Json.Deserialize<BootstrapResponse>(File.ReadAllText(responsePath));
        byte[] responsePayload = Convert.FromBase64String(response.PayloadBase64);
        ResponsePayload payload = Json.Deserialize<ResponsePayload>(Encoding.UTF8.GetString(responsePayload));
        byte[] entropy = Encoding.UTF8.GetBytes("DLE-OS|DEV-FRONTEND|" + payload.TransactionId + "|FILESERVER-ROLLBACK-V2");
        byte[] cipher = File.ReadAllBytes(protectedPath);
        byte[] plain = null;
        try
        {
            plain = ProtectedData.Unprotect(cipher, entropy, DataProtectionScope.LocalMachine);
            BootstrapState state = Json.Deserialize<BootstrapState>(Encoding.UTF8.GetString(plain));
            if (!string.Equals(state.TransactionId, payload.TransactionId, StringComparison.Ordinal)) throw new InvalidOperationException("Rollback state transaction mismatch.");
            Undo(state);
            Console.WriteLine(Json.Serialize(new ResultRecord { Verdict = "PASS", TransactionId = state.TransactionId, RollbackVerdict = "PASS", ProductionDeploymentPerformed = false, PlaintextPasswordPersisted = false, CompletedAtUtc = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture) }));
        }
        finally { Clear(responsePayload); Clear(entropy); Clear(cipher); Clear(plain); }
    }

    private static BootstrapRequest ValidateSealedRequest(string requestPath)
    {
        string package = Path.GetDirectoryName(requestPath);
        string requestHashPath = Path.Combine(package, "bootstrap-request.sha256");
        string manifestPath = Path.Combine(package, "bootstrap-code-manifest.json");
        if (!File.Exists(requestHashPath) || !File.Exists(manifestPath)) throw new InvalidOperationException("The sealed request or code manifest is incomplete.");
        if (!FixedEquals(File.ReadAllText(requestHashPath).Trim(), Sha256File(requestPath))) throw new InvalidOperationException("Bootstrap request checksum mismatch.");
        CodeManifest manifest = Json.Deserialize<CodeManifest>(File.ReadAllText(manifestPath));
        if (manifest.Schema != "DLE-OS-DEV-FRONTEND-FILESERVER-LEGACY-CODE-MANIFEST-V2") throw new InvalidOperationException("Legacy package manifest schema is invalid.");
        foreach (ManifestFile file in manifest.Files)
        {
            string path = Path.Combine(package, file.Name);
            if (!File.Exists(path) || !FixedEquals(file.Sha256, Sha256File(path))) throw new InvalidOperationException("Server-package code checksum mismatch: " + file.Name);
        }
        BootstrapRequest request = Json.Deserialize<BootstrapRequest>(File.ReadAllText(requestPath));
        if (request.Schema != "DLE-OS-DEV-FRONTEND-FILESERVER-BOOTSTRAP-REQUEST-V2" || request.TargetComputer != ExpectedComputer ||
            request.AccountName != AccountName || request.ShareName != ShareName || request.PasswordEncryption != "RSA-3072-OAEP-SHA1-CSP")
            throw new InvalidOperationException("The request does not describe the exact approved legacy boundary.");
        if (!FixedEquals(request.CodeManifestSha256, Sha256File(manifestPath))) throw new InvalidOperationException("The request is not bound to this code manifest.");
        if (DateTimeOffset.UtcNow > DateTimeOffset.Parse(request.ExpiresAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind)) throw new InvalidOperationException("The bootstrap request has expired.");
        return request;
    }

    private static void AssertLocalElevatedServer()
    {
        if (!string.Equals(Environment.MachineName, ExpectedComputer, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("This transaction must run locally on DELEON-SERVER.");
        WindowsPrincipal principal = new WindowsPrincipal(WindowsIdentity.GetCurrent());
        if (!principal.IsInRole(WindowsBuiltInRole.Administrator)) throw new InvalidOperationException("The local bootstrap requires an elevated administrator token.");
    }

    private static bool LocalUserExists()
    {
        try { using (DirectoryEntry user = new DirectoryEntry("WinNT://" + ExpectedComputer + "/" + AccountName + ",user")) { object value = user.NativeObject; return value != null; } }
        catch (COMException) { return false; }
    }

    private static void CreateLocalUser(string password)
    {
        using (DirectoryEntry computer = new DirectoryEntry("WinNT://" + ExpectedComputer + ",computer"))
        using (DirectoryEntry user = computer.Children.Add(AccountName, "user"))
        {
            user.Invoke("SetPassword", new object[] { password });
            user.Properties["Description"].Value = "DLE-OS DEV frontend Kitting read-only workgroup identity";
            user.Properties["UserFlags"].Value = 0x10000 | 0x200 | 0x40;
            user.CommitChanges();
        }
    }

    private static void RemoveAllLocalGroupMemberships()
    {
        using (DirectoryEntry user = new DirectoryEntry("WinNT://" + ExpectedComputer + "/" + AccountName + ",user"))
        {
            List<string> groupPaths = new List<string>();
            foreach (object item in (IEnumerable)user.Invoke("Groups")) using (DirectoryEntry group = new DirectoryEntry(item)) groupPaths.Add(group.Path);
            foreach (string groupPath in groupPaths) using (DirectoryEntry group = new DirectoryEntry(groupPath)) group.Invoke("Remove", new object[] { user.Path });
        }
    }

    private static void DeleteLocalUser()
    {
        if (!LocalUserExists()) return;
        using (DirectoryEntry computer = new DirectoryEntry("WinNT://" + ExpectedComputer + ",computer"))
        using (DirectoryEntry user = new DirectoryEntry("WinNT://" + ExpectedComputer + "/" + AccountName + ",user")) computer.Children.Remove(user);
    }

    private static SecurityIdentifier GetLocalUserSid()
    {
        return (SecurityIdentifier)new NTAccount(QualifiedIdentity).Translate(typeof(SecurityIdentifier));
    }

    private static string GetSharePath()
    {
        using (ManagementObject share = new ManagementObject("Win32_Share.Name='" + ShareName.Replace("'", "''") + "'"))
        { share.Get(); return Convert.ToString(share["Path"], CultureInfo.InvariantCulture); }
    }

    private static List<ShareAce> CaptureShareDacl()
    {
        ManagementBaseObject descriptor = GetShareDescriptor();
        return ReadShareDacl(descriptor);
    }

    private static List<ShareAce> FindShareAces(string name)
    {
        return CaptureShareDacl().Where(delegate(ShareAce ace) { return string.Equals(ace.Name, name, StringComparison.OrdinalIgnoreCase) && string.Equals(ace.Domain, ExpectedComputer, StringComparison.OrdinalIgnoreCase); }).ToList();
    }

    private static ManagementBaseObject GetShareDescriptor()
    {
        using (ManagementObject security = new ManagementObject("Win32_LogicalShareSecuritySetting.Name='" + ShareName + "'"))
        {
            ManagementBaseObject result = security.InvokeMethod("GetSecurityDescriptor", null, null);
            if (Convert.ToUInt32(result["ReturnValue"], CultureInfo.InvariantCulture) != 0) throw new InvalidOperationException("Cannot read Production share security descriptor.");
            return (ManagementBaseObject)result["Descriptor"];
        }
    }

    private static List<ShareAce> ReadShareDacl(ManagementBaseObject descriptor)
    {
        List<ShareAce> result = new List<ShareAce>();
        ManagementBaseObject[] dacl = (ManagementBaseObject[])descriptor["DACL"];
        if (dacl == null) return result;
        foreach (ManagementBaseObject ace in dacl)
        {
            ManagementBaseObject trustee = (ManagementBaseObject)ace["Trustee"];
            result.Add(new ShareAce { AccessMask = Convert.ToInt32(ace["AccessMask"], CultureInfo.InvariantCulture), AceFlags = Convert.ToInt32(ace["AceFlags"], CultureInfo.InvariantCulture), AceType = Convert.ToInt32(ace["AceType"], CultureInfo.InvariantCulture), Domain = Convert.ToString(trustee["Domain"], CultureInfo.InvariantCulture), Name = Convert.ToString(trustee["Name"], CultureInfo.InvariantCulture), Sid = trustee["SID"] == null ? null : Convert.ToBase64String((byte[])trustee["SID"]) });
        }
        return result;
    }

    private static void SetReadOnlyShareAce()
    {
        List<ShareAce> entries = CaptureShareDacl();
        SecurityIdentifier sid = GetLocalUserSid(); byte[] sidBytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(sidBytes, 0);
        entries.Add(new ShareAce { AccessMask = ShareReadMask, AceFlags = 0, AceType = 0, Domain = ExpectedComputer, Name = AccountName, Sid = Convert.ToBase64String(sidBytes) });
        SetShareDacl(entries);
    }

    private static void SetShareDacl(List<ShareAce> entries)
    {
        ManagementBaseObject descriptor = GetShareDescriptor();
        ManagementClass trusteeClass = new ManagementClass("Win32_Trustee");
        ManagementClass aceClass = new ManagementClass("Win32_ACE");
        List<ManagementBaseObject> aces = new List<ManagementBaseObject>();
        foreach (ShareAce entry in entries)
        {
            ManagementBaseObject trustee = trusteeClass.CreateInstance(); trustee["Domain"] = entry.Domain; trustee["Name"] = entry.Name;
            if (!string.IsNullOrEmpty(entry.Sid)) trustee["SID"] = Convert.FromBase64String(entry.Sid);
            ManagementBaseObject ace = aceClass.CreateInstance(); ace["AccessMask"] = entry.AccessMask; ace["AceFlags"] = entry.AceFlags; ace["AceType"] = entry.AceType; ace["Trustee"] = trustee; aces.Add(ace);
        }
        descriptor["DACL"] = aces.ToArray();
        using (ManagementObject security = new ManagementObject("Win32_LogicalShareSecuritySetting.Name='" + ShareName + "'"))
        {
            ManagementBaseObject input = security.GetMethodParameters("SetSecurityDescriptor"); input["Descriptor"] = descriptor;
            ManagementBaseObject output = security.InvokeMethod("SetSecurityDescriptor", input, null);
            uint code = Convert.ToUInt32(output["ReturnValue"], CultureInfo.InvariantCulture);
            if (code != 0) throw new Win32Exception((int)code, "Cannot set Production share security descriptor.");
        }
    }

    private static string CaptureSddl(string path) { return Directory.GetAccessControl(path, AccessControlSections.All).GetSecurityDescriptorSddlForm(AccessControlSections.All); }
    private static void RestoreSddl(string path, string sddl) { DirectorySecurity acl = Directory.GetAccessControl(path); acl.SetSecurityDescriptorSddlForm(sddl, AccessControlSections.All); Directory.SetAccessControl(path, acl); }
    private static void SetKittingAcls(string kitting, string shortages, string complete)
    {
        SecurityIdentifier sid = GetLocalUserSid();
        AddExactRule(kitting, sid, InheritanceFlags.None);
        AddExactRule(shortages, sid, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit);
        AddExactRule(complete, sid, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit);
    }
    private static void AddExactRule(string path, SecurityIdentifier sid, InheritanceFlags inheritance)
    {
        DirectorySecurity acl = Directory.GetAccessControl(path); acl.PurgeAccessRules(sid);
        acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.ReadAndExecute, inheritance, PropagationFlags.None, AccessControlType.Allow));
        Directory.SetAccessControl(path, acl);
    }

    private static void ValidateRightsAndAcls(SecurityIdentifier sid, string kitting, string shortages, string complete)
    {
        if (!LsaRights.HasRight(QualifiedIdentity, DenyInteractive) || !LsaRights.HasRight(QualifiedIdentity, DenyRemoteInteractive)) throw new InvalidOperationException("Interactive/RDP deny rights were not established.");
        List<ShareAce> shareAces = FindShareAces(AccountName);
        if (shareAces.Count != 1 || shareAces[0].AceType != 0 || shareAces[0].AccessMask != ShareReadMask) throw new InvalidOperationException("The exact read-only share ACE was not established.");
        ValidateExactRule(kitting, sid, InheritanceFlags.None); ValidateExactRule(shortages, sid, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit); ValidateExactRule(complete, sid, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit);
        string unrelated = Path.Combine(Path.GetDirectoryName(kitting), "Customer Files");
        if (Directory.Exists(unrelated))
        {
            AuthorizationRuleCollection rules = Directory.GetAccessControl(unrelated).GetAccessRules(true, false, typeof(SecurityIdentifier));
            foreach (FileSystemAccessRule rule in rules) if (sid.Equals(rule.IdentityReference)) throw new InvalidOperationException("The identity received a direct NTFS ACE outside Kitting.");
        }
    }
    private static void ValidateExactRule(string path, SecurityIdentifier sid, InheritanceFlags inheritance)
    {
        List<FileSystemAccessRule> matches = new List<FileSystemAccessRule>();
        foreach (FileSystemAccessRule rule in Directory.GetAccessControl(path).GetAccessRules(true, false, typeof(SecurityIdentifier))) if (sid.Equals(rule.IdentityReference)) matches.Add(rule);
        FileSystemRights required = FileSystemRights.ReadAndExecute;
        FileSystemRights forbidden = FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
        if (matches.Count != 1 || matches[0].AccessControlType != AccessControlType.Allow ||
            (matches[0].FileSystemRights & required) != required || (matches[0].FileSystemRights & forbidden) != 0 ||
            matches[0].InheritanceFlags != inheritance) throw new InvalidOperationException("Exact read/execute Kitting ACL validation failed: " + path);
    }

    private static void ValidateEffectiveSmb(string password)
    {
        string remote = "\\\\DELEON-SERVER\\Production";
        NetResource resource = new NetResource { Scope = 2, Type = 1, DisplayType = 3, RemoteName = remote };
        int code = WNetAddConnection2(ref resource, password, QualifiedIdentity, 0);
        if (code != 0) throw new Win32Exception(code, "Effective SMB credential validation failed.");
        try
        {
            Directory.GetFileSystemEntries(Path.Combine(remote, "KITTING\\KIT-SHORTAGES"));
            Directory.GetFileSystemEntries(Path.Combine(remote, "KITTING\\KIT-COMPLETE"));
            bool unrelatedReadable = false;
            try { Directory.GetFileSystemEntries(Path.Combine(remote, "Customer Files")); unrelatedReadable = true; }
            catch (UnauthorizedAccessException) { }
            catch (IOException) { }
            if (unrelatedReadable) throw new InvalidOperationException("The matching identity can enumerate unrelated Production content.");
        }
        finally { WNetCancelConnection2(remote, 0, true); }
    }

    private static void Undo(BootstrapState state)
    {
        List<Exception> errors = new List<Exception>();
        if (state.NtfsAclChanged) TryRollback(delegate { RestoreSddl(state.KittingRoot, state.KittingSddl); RestoreSddl(state.ShortageRoot, state.ShortageSddl); RestoreSddl(state.CompleteRoot, state.CompleteSddl); }, errors);
        if (state.ShareAclChanged) TryRollback(delegate { SetShareDacl(state.ShareDacl); }, errors);
        if (state.AccountCreated)
        {
            if (state.DenyRemoteInteractiveAdded) TryRollback(delegate { if (LocalUserExists()) LsaRights.RemoveRight(QualifiedIdentity, DenyRemoteInteractive); }, errors);
            if (state.DenyInteractiveAdded) TryRollback(delegate { if (LocalUserExists()) LsaRights.RemoveRight(QualifiedIdentity, DenyInteractive); }, errors);
            TryRollback(DeleteLocalUser, errors);
        }
        if (errors.Count != 0)
        {
            StringBuilder message = new StringBuilder("One or more local rollback steps failed:");
            foreach (Exception error in errors) message.Append(" ").Append(error.Message).Append(";");
            throw new InvalidOperationException(message.ToString());
        }
    }
    private static void TryRollback(Action action, List<Exception> errors) { try { action(); } catch (Exception error) { errors.Add(error); } }

    private static byte[] EncryptPassword(RsaRecord record, byte[] passwordBytes)
    {
        CspParameters csp = new CspParameters(24); csp.Flags = CspProviderFlags.UseMachineKeyStore;
        using (RSACryptoServiceProvider rsa = new RSACryptoServiceProvider(csp))
        {
            rsa.PersistKeyInCsp = false;
            rsa.ImportParameters(new RSAParameters { Modulus = Convert.FromBase64String(record.Modulus), Exponent = Convert.FromBase64String(record.Exponent) });
            return rsa.Encrypt(passwordBytes, true);
        }
    }
    private static char[] NewPassword(int length)
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&*+-=?@";
        byte[] random = new byte[length]; char[] chars = new char[length];
        RandomNumberGenerator rng = RandomNumberGenerator.Create();
        rng.GetBytes(random);
        try { for (int i = 0; i < length; i++) chars[i] = alphabet[random[i] % alphabet.Length]; return chars; }
        finally { Clear(random); }
    }
    private static void RestrictSecretFile(string path)
    {
        FileSecurity acl = new FileSecurity(); SecurityIdentifier owner = WindowsIdentity.GetCurrent().User; acl.SetOwner(owner); acl.SetAccessRuleProtection(true, false);
        foreach (SecurityIdentifier sid in new[] { owner, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null) }) acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, AccessControlType.Allow));
        File.SetAccessControl(path, acl);
    }
    private static void WriteUtf8(string path, string text) { File.WriteAllText(path, text, new UTF8Encoding(false)); }
    private static void DeleteIfExists(string path) { try { if (File.Exists(path)) File.Delete(path); } catch { } }
    private static string Sha256File(string path) { using (FileStream stream = File.OpenRead(path)) using (SHA256 hash = SHA256.Create()) return Hex(hash.ComputeHash(stream)); }
    private static string Sha256(byte[] bytes) { using (SHA256 hash = SHA256.Create()) return Hex(hash.ComputeHash(bytes)); }
    private static string HmacSha256(byte[] key, byte[] bytes) { using (HMACSHA256 hmac = new HMACSHA256(key)) return Hex(hmac.ComputeHash(bytes)); }
    private static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", string.Empty); }
    private static bool FixedEquals(string left, string right) { if (left == null || right == null || left.Length != right.Length) return false; int diff = 0; for (int i = 0; i < left.Length; i++) diff |= char.ToUpperInvariant(left[i]) ^ char.ToUpperInvariant(right[i]); return diff == 0; }
    private static void Clear(byte[] bytes) { if (bytes != null) Array.Clear(bytes, 0, bytes.Length); }

    [DllImport("mpr.dll", CharSet = CharSet.Unicode)] private static extern int WNetAddConnection2(ref NetResource netResource, string password, string username, int flags);
    [DllImport("mpr.dll", CharSet = CharSet.Unicode)] private static extern int WNetCancelConnection2(string name, int flags, bool force);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct NetResource { public int Scope; public int Type; public int DisplayType; public int Usage; public string LocalName; public string RemoteName; public string Comment; public string Provider; }

    internal sealed class BootstrapRequest { public string Schema { get; set; } public string TransactionId { get; set; } public string ExpiresAtUtc { get; set; } public string TargetComputer { get; set; } public string AccountName { get; set; } public string ShareName { get; set; } public string Nonce { get; set; } public string PasswordEncryption { get; set; } public string CodeManifestSha256 { get; set; } public RsaRecord PublicKey { get; set; } }
    internal sealed class RsaRecord { public string Modulus { get; set; } public string Exponent { get; set; } public string D { get; set; } public string P { get; set; } public string Q { get; set; } public string DP { get; set; } public string DQ { get; set; } public string InverseQ { get; set; } }
    internal sealed class CodeManifest { public string Schema { get; set; } public ManifestFile[] Files { get; set; } }
    internal sealed class ManifestFile { public string Name { get; set; } public string Sha256 { get; set; } }
    internal sealed class ShareAce { public int AccessMask { get; set; } public int AceFlags { get; set; } public int AceType { get; set; } public string Domain { get; set; } public string Name { get; set; } public string Sid { get; set; } }
    internal sealed class BootstrapState { public string TransactionId { get; set; } public bool AccountCreated { get; set; } public bool DenyInteractiveAdded { get; set; } public bool DenyRemoteInteractiveAdded { get; set; } public bool ShareAclChanged { get; set; } public bool NtfsAclChanged { get; set; } public string SharePath { get; set; } public string KittingRoot { get; set; } public string ShortageRoot { get; set; } public string CompleteRoot { get; set; } public List<ShareAce> ShareDacl { get; set; } public string KittingSddl { get; set; } public string ShortageSddl { get; set; } public string CompleteSddl { get; set; } }
    internal sealed class ResponsePayload { public string Schema { get; set; } public string TransactionId { get; set; } public string RequestSha256 { get; set; } public string RequestNonce { get; set; } public string ComputerName { get; set; } public string AccountName { get; set; } public string QualifiedIdentity { get; set; } public string ShareName { get; set; } public string SharePath { get; set; } public string[] AllowedRelativePaths { get; set; } public string UnrelatedProbeRelativePath { get; set; } public string ShareAccess { get; set; } public string NtfsAccess { get; set; } public bool DenyInteractiveLogon { get; set; } public bool DenyRemoteInteractiveLogon { get; set; } public bool ExactKittingRead { get; set; } public bool UnrelatedProductionReadDenied { get; set; } public string EncryptedPassword { get; set; } public string PasswordEncryption { get; set; } public bool Simulation { get; set; } public string AppliedAtUtc { get; set; } }
    internal sealed class BootstrapResponse { public string PayloadBase64 { get; set; } public string PayloadSha256 { get; set; } public string EvidenceHmacSha256 { get; set; } public string Verdict { get; set; } public bool PlaintextPasswordPersisted { get; set; } }
    internal sealed class ResultRecord { public string Verdict { get; set; } public string TransactionId { get; set; } public string Error { get; set; } public bool MutationStarted { get; set; } public string RollbackVerdict { get; set; } public string RollbackError { get; set; } public bool ProductionDeploymentPerformed { get; set; } public bool PlaintextPasswordPersisted { get; set; } public string CompletedAtUtc { get; set; } }

    private static class LsaRights
    {
        private const uint PolicyCreateAccount = 0x10, PolicyLookupNames = 0x800;
        [StructLayout(LayoutKind.Sequential)] private struct LsaObjectAttributes { internal int Length; internal IntPtr RootDirectory; internal IntPtr ObjectName; internal uint Attributes; internal IntPtr SecurityDescriptor; internal IntPtr SecurityQualityOfService; }
        [StructLayout(LayoutKind.Sequential)] private struct LsaUnicodeString { internal ushort Length; internal ushort MaximumLength; internal IntPtr Buffer; }
        [DllImport("advapi32.dll")] private static extern uint LsaOpenPolicy(IntPtr systemName, ref LsaObjectAttributes attributes, uint access, out IntPtr handle);
        [DllImport("advapi32.dll")] private static extern uint LsaAddAccountRights(IntPtr handle, IntPtr sid, LsaUnicodeString[] rights, uint count);
        [DllImport("advapi32.dll")] private static extern uint LsaRemoveAccountRights(IntPtr handle, IntPtr sid, bool all, LsaUnicodeString[] rights, uint count);
        [DllImport("advapi32.dll")] private static extern uint LsaEnumerateAccountRights(IntPtr handle, IntPtr sid, out IntPtr rights, out uint count);
        [DllImport("advapi32.dll")] private static extern uint LsaNtStatusToWinError(uint status);
        [DllImport("advapi32.dll")] private static extern uint LsaClose(IntPtr handle);
        [DllImport("advapi32.dll")] private static extern uint LsaFreeMemory(IntPtr buffer);
        internal static bool HasRight(string account, string right)
        {
            return WithSid<bool>(account, delegate(IntPtr policy, IntPtr sid) { IntPtr values; uint count; uint status = LsaEnumerateAccountRights(policy, sid, out values, out count); if (status != 0) { if (LsaNtStatusToWinError(status) == 2) return false; Throw(status); } try { int size = Marshal.SizeOf(typeof(LsaUnicodeString)); for (int i = 0; i < count; i++) { LsaUnicodeString value = (LsaUnicodeString)Marshal.PtrToStructure(new IntPtr(values.ToInt64() + i * size), typeof(LsaUnicodeString)); string name = Marshal.PtrToStringUni(value.Buffer, value.Length / 2); if (string.Equals(name, right, StringComparison.OrdinalIgnoreCase)) return true; } return false; } finally { if (values != IntPtr.Zero) LsaFreeMemory(values); } });
        }
        internal static void AddRight(string account, string right) { Change(account, right, true); }
        internal static void RemoveRight(string account, string right) { Change(account, right, false); }
        private static void Change(string account, string right, bool add) { WithSid<bool>(account, delegate(IntPtr policy, IntPtr sid) { LsaUnicodeString value = NewString(right); try { uint status = add ? LsaAddAccountRights(policy, sid, new[] { value }, 1) : LsaRemoveAccountRights(policy, sid, false, new[] { value }, 1); Throw(status); return true; } finally { Marshal.FreeHGlobal(value.Buffer); } }); }
        private static T WithSid<T>(string account, Func<IntPtr, IntPtr, T> action) { LsaObjectAttributes attributes = new LsaObjectAttributes(); attributes.Length = Marshal.SizeOf(typeof(LsaObjectAttributes)); IntPtr policy; Throw(LsaOpenPolicy(IntPtr.Zero, ref attributes, PolicyCreateAccount | PolicyLookupNames, out policy)); SecurityIdentifier sid = (SecurityIdentifier)new NTAccount(account).Translate(typeof(SecurityIdentifier)); byte[] bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0); IntPtr pointer = Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes, 0, pointer, bytes.Length); try { return action(policy, pointer); } finally { Marshal.FreeHGlobal(pointer); LsaClose(policy); } }
        private static LsaUnicodeString NewString(string value) { LsaUnicodeString result = new LsaUnicodeString(); result.Buffer = Marshal.StringToHGlobalUni(value); result.Length = checked((ushort)(value.Length * 2)); result.MaximumLength = checked((ushort)((value.Length + 1) * 2)); return result; }
        private static void Throw(uint status) { if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status)); }
    }
}
