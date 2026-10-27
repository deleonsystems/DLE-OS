using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
internal static class SimExplorerPipe
{
 // Windows rejects remote clients at creation (PIPE_REJECT_REMOTE_CLIENTS), not via hostname inference.
 // Ephemeral pipe DACL grants only the SIM process user; no machine ACL/registry changes.
 internal static NamedPipeServerStream Create(){
  if(!OperatingSystem.IsWindows())throw new PlatformNotSupportedException();
  var sid=WindowsIdentity.GetCurrent().User?.Value??throw new IOException("No Windows user");
  var descriptor=new RawSecurityDescriptor($"O:{sid}D:P(A;;GA;;;{sid})");var bytes=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(bytes,0);
  var pinned=GCHandle.Alloc(bytes,GCHandleType.Pinned);
  try{var attributes=new SecurityAttributes{Length=Marshal.SizeOf<SecurityAttributes>(),Descriptor=pinned.AddrOfPinnedObject(),Inherit=false};
   // Duplex, overlapped, first-instance only; byte mode plus reject remote clients.
   var handle=CreateNamedPipe(@"\\.\pipe\"+SimExplorerProtocol.Pipe,0x40080003,0x8,1,4096,4096,0,ref attributes);
   if(handle.IsInvalid){handle.Dispose();throw new IOException("SIM Explorer pipe unavailable",new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()));}
   try{return new NamedPipeServerStream(PipeDirection.InOut,true,false,handle);}catch{handle.Dispose();throw;}
  }finally{pinned.Free();}
 }
 [StructLayout(LayoutKind.Sequential)]private struct SecurityAttributes{public int Length;public IntPtr Descriptor;[MarshalAs(UnmanagedType.Bool)]public bool Inherit;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern SafePipeHandle CreateNamedPipe(string name,uint access,uint mode,uint instances,uint outSize,uint inSize,uint timeout,ref SecurityAttributes security);
}
