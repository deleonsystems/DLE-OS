# SIM Labor supplemental costs

A secondary Supplemental Charges workspace with two compact lists captures recurring per-unit consumables and separate one-time NRE. Add Charge offers Solder, Reflow, Wave Solder, Cleaning / Washing, Conformal Coating, Packing Material and Manual Consumable. Add NRE offers SMT Programming, Tooling / Special Setup and Manual NRE. Labels and amounts are editable; either kind can be removed.

Base Labor is the existing unrounded traveler-seconds/rate calculation. Recurring cost adds the sum of recurring amounts before markup. Final currency outputs round to cents, away from zero at midpoint. Browser calculations use scaled BigInt arithmetic and the existing quoted-quantity denominator; server calculations use decimal arithmetic. NRE is summed separately, never divided by quantity, marked up or blended into unit pricing. The two-row footer updates immediately without a save.

`SimLaborCharge` stores a stable ID, `Kind` (`RECURRING` or `NRE`), short `Label` and nullable decimal `Amount`. Working drafts may retain blank labels/amounts; completion requires both. Validation limits plans to 100 unique charges, labels to 120 characters, and amounts to 0–1000000 with at most six decimal places.

`plan.charges` is persisted by Save Labor alongside existing operations, rate, markup, notes and visuals. Completed snapshots retain their exact charge rows and computed totals. `Totals.Cost` and `UnitSalePrice` represent recurring unit pricing; `BaseLaborCost`, `ConsumablesPerUnit` and `NreTotal` make the separation explicit. No new fields are serialized into old plans/snapshots when absent. Requests send `chargeContractVersion: 1`; older clients cannot silently erase saved charges.

No Materials edits, final quote assembly, purchasing, accounting, commission, PMA or traveler-release behavior is introduced. Focused backend and UI checks cover the 228.18 + 1.75 = 229.93 example, markup, NRE isolation, rounding, manual rows, validation, removal, persistence/restart and completed history. Normal 5177 qualification uses synthetic RFQI-SIM-0037.
