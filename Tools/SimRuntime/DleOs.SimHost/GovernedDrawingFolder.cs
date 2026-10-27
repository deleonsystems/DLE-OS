internal interface IGovernedDesktopFileSystem { bool DirectoryExists(string path); FileAttributes GetAttributes(string path); }
internal sealed class GovernedDesktopFileSystem:IGovernedDesktopFileSystem {public bool DirectoryExists(string p)=>Directory.Exists(p);public FileAttributes GetAttributes(string p)=>File.GetAttributes(p);}
internal sealed class GovernedDrawingFolder(string root,IGovernedDesktopFileSystem fs)
{
 internal const string ApprovedRoot=SimExplorerProtocol.Root;
 internal bool TryResolve(string? relative,out string? target,out string category){target=null;category="InvalidGovernedPath";if(!SimExplorerProtocol.SafePath(relative))return false;
 try{var full=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);for(var d=new DirectoryInfo(full);d is not null;d=d.Parent){if(!fs.DirectoryExists(d.FullName)||(fs.GetAttributes(d.FullName)&FileAttributes.ReparsePoint)!=0){category="GovernedRootUnavailable";return false;}}
 var cursor=full;foreach(var part in relative!.Split('/')){cursor=Path.Combine(cursor,part);if(!fs.DirectoryExists(cursor)||(fs.GetAttributes(cursor)&FileAttributes.ReparsePoint)!=0){category="GovernedFolderUnavailable";return false;}}
 if(!Path.GetFullPath(cursor).StartsWith(full+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))return false;target=cursor;category="None";return true;
 }catch(Exception e)when(e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException or System.Security.SecurityException){category="GovernedFolderUnavailable";return false;}}
}
