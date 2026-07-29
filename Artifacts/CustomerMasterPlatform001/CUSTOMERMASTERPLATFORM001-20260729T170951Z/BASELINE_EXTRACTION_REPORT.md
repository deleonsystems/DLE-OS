# Baseline Extraction Report

Source qualification attempt `Attempt-20260729T184319Z` completed two read-only passes over the fixed Customer Master source files. Identity, record count, ordered keys, and normalized record-stream fingerprints matched for every file.

The local package contains 380 Customer rows, 28 operational CustomerAddress rows, and one separately classified orphan address. Package SHA-256 is `926160D5BFBEAD171BE6DA481016B6810DF20BE6CA7577EF82AA8421C173D608`.

An API sample review exposed an ARM-10 package-transform defect: diagnostic decoded segments had been mistaken for physical field boundaries. The builder was corrected to use the already-qualified raw record after its exact physical key; layout A applies its proven 20-byte description width. No source was reread. Pre-correction packages remain archived in the mission artifact set.
