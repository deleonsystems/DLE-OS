using System.Text.Json;

try {
    if (args.Length < 2) throw new ArgumentException("Usage: <status|preview|apply|activate> <repository> [package directory|version] [expected version]");
    var repo = Path.GetFullPath(args[1]);
    if (!File.Exists(Path.Combine(repo, "Tools", "SimRuntime", "DleOs.SimHost", "DleOs.SimHost.csproj")))
        throw new ArgumentException("Expected a local SIM repository.");
    var store = new SimCustomerReferences(Path.Combine(repo, ".sim-state"));
    switch (args[0]) {
        case "status":
            var version = store.CurrentVersion(); var snapshot = store.Read(version);
            Console.WriteLine(JsonSerializer.Serialize(new { version, count = snapshot.Customers.Length, packages = snapshot.Packages.Keys }, SimCustomerReferences.Json)); break;
        case "preview" when args.Length == 3:
            Console.WriteLine(JsonSerializer.Serialize(store.Preview(args[2]), SimCustomerReferences.Json)); break;
        case "apply" when args.Length == 4:
            Console.WriteLine(JsonSerializer.Serialize(new { version = store.Import(args[2], args[3]) })); break;
        case "activate" when args.Length == 4:
            store.Activate(args[2], args[3]); Console.WriteLine(JsonSerializer.Serialize(new { version = store.CurrentVersion() })); break;
        default: throw new ArgumentException("Invalid command. Apply and activate require the expected current version (or none).");
    }
} catch (Exception e) { Console.Error.WriteLine(e.Message); Environment.ExitCode = 1; }
