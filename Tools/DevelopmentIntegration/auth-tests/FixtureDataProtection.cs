using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;

// Qualification only: both the active provider AND framework key-ring warmup
// use memory. Merely replacing IDataProtectionProvider does not isolate warmup.
internal static class FixtureDataProtection {
 internal static void Configure(IServiceCollection services){
  services.AddDataProtection().UseEphemeralDataProtectionProvider();
  var memory=new MemoryRepository();
  services.Configure<KeyManagementOptions>(o=>{o.XmlRepository=memory;o.XmlEncryptor=null;});
 }
 sealed class MemoryRepository:IXmlRepository{
  readonly List<XElement> elements=[];
  public IReadOnlyCollection<XElement> GetAllElements(){lock(elements)return elements.Select(e=>new XElement(e)).ToArray();}
  public void StoreElement(XElement element,string friendlyName){lock(elements)elements.Add(new XElement(element));}
 }
}
