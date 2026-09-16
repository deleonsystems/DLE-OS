# Labor planning references (SIM)

Estimated Total Hours uses exact operation seconds per assembly multiplied by Qty Quoted, divided by 3600. Display rounds to two decimals only after aggregation, so it may differ from multiplying the rounded Hours / Unit display. It is workload, not elapsed customer delivery time, and does not change pricing.

Manufacturing Lead uses an optional nullable value and DAYS/WEEKS unit. Weeks is the new UI default. Entered values must be positive whole numbers up to 36500. Persisted as `manufacturingLead` on the Labor plan and each new completed snapshot; older versions remain untouched. `leadContractVersion: 1` prevents older clients from erasing a populated lead.

Final Review references the latest completed Labor lead only. Draft edits cannot supply the completed reference. The reviewer still enters Quoted Delivery independently. Existing internal approval snapshots preserve their frozen reference when source work changes.
