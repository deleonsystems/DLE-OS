using System.Security.Cryptography;
using System.Text;

if (args.Length != 1 || string.IsNullOrWhiteSpace(args[0]))
    throw new ArgumentException("Exactly one key directory is required.");

var directory = Path.GetFullPath(args[0]);
var privatePath = Path.Combine(directory, "issuer-private.pem");
var publicPath = Path.Combine(directory, "validator-public.pem");
if (File.Exists(privatePath) || File.Exists(publicPath))
    throw new InvalidOperationException(
        "Development identity signing material already exists. Use the documented rotation procedure.");

Directory.CreateDirectory(directory);
using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
File.WriteAllText(privatePath, key.ExportPkcs8PrivateKeyPem(), new UTF8Encoding(false));
File.WriteAllText(publicPath, key.ExportSubjectPublicKeyInfoPem(), new UTF8Encoding(false));
Console.WriteLine("Development ES256 signing material generated without displaying key contents.");
