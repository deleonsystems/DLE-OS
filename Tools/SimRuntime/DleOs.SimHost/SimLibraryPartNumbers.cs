internal sealed record LibraryNumberRoleEdit(string Id,string Role);
internal sealed record LibraryPartNumberSummary(string[] CustomerPartNumbers,string? ManufacturerPartNumber);
internal sealed partial class SimLibraryBomStore {
 internal static bool ManufacturerRole(LibraryBomRow row,LibraryAlternate a)=>a.NumberRole=="MFG"||(a.NumberRole is null&&row.Source is null);
 internal static bool ManufacturerEligible(LibraryBomRow row,LibraryAlternate a)=>ManufacturerRole(row,a)&&a.Status=="APPROVED"&&a.Decision is not null;
 internal static bool NumberReviewed(LibraryBomRow row,LibraryAlternate a)=>a.Decision is not null&&(a.Status=="REJECTED"||(a.NumberRole=="CUSTOMER"&&a.Status=="REFERENCE")||ManufacturerEligible(row,a));
 private static LibraryAlternate[] ApplyNumberRoles(LibraryRowEdit e,LibraryBomRow? old,LibraryActor? actor){
  var alts=old?.Alternates??[];if(e.NumberRoles is null)return alts;
  Require(e.NumberRoles.Length<=alts.Length&&e.NumberRoles.Select(x=>x.Id).Distinct().Count()==e.NumberRoles.Length,"Choose each part number once.");
  foreach(var entry in e.NumberRoles){Require(alts.Any(a=>a.Id==entry.Id)&&entry.Role is "MFG" or "CUSTOMER" or "UNRESOLVED","Choose Customer P/N or Manufacturer P/N for an existing number.");}
  return alts.Select(a=>{
   var role=e.NumberRoles.SingleOrDefault(x=>x.Id==a.Id)?.Role;var current=a.NumberRole??"UNRESOLVED";
   if(role is null||role==current)return a;
   Require(actor is not null,"A part-number decision requires an identified user.");
   return a with{NumberRole=role=="UNRESOLVED"?null:role,Status=role=="CUSTOMER"?"REFERENCE":"PROPOSED",Decision=role=="CUSTOMER"?actor:null,Reason=null,SourceDecision=null};
  }).ToArray();
 }
 // Future quote adapters must use the chosen manufacturer identity, never a customer reference.
 // No current RFQ/job adapter is installed by this feature.
 internal static LibraryPartNumberSummary PartNumbers(LibraryBomRow r){
  var customer=r.Alternates.Where(a=>a.NumberRole=="CUSTOMER"&&a.Status=="REFERENCE"&&a.Decision is not null).Select(a=>a.PartNumber).ToList();
  if(r.IdentityConfirmed&&r.IdentityBasis=="CUSTOMER")customer.Insert(0,r.SourcePartNumber);
  var chosen=r.Alternates.SingleOrDefault(a=>a.Id==r.SelectedAlternateId);
  var manufacturer=chosen is not null&&ManufacturerEligible(r,chosen)?chosen.PartNumber:r.SelectedAlternateId is null&&r.IdentityConfirmed&&r.IdentityBasis=="MFG"?r.ManufacturerPartNumber:null;
  return new(customer.Distinct(StringComparer.Ordinal).ToArray(),manufacturer);
 }
}
