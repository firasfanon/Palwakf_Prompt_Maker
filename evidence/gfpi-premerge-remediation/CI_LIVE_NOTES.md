# Live GitHub Actions observations (read through the checks API; logs are not reachable from this session)
- HEAD `26c4ae0` (before remediation): browser general FAIL (scrollWidth 410>390), node regression passed once and failed once (flaky generated_at) on identical code; non-gating control on unmodified `main` FAILED identically.
- HEAD `fbd86fa` (remediation): all 4 jobs success; Browser general success; overflow diagnostic `sw=390 cw=390 over=[]`; the control on unmodified `main` still failed (410>390) in the same run, i.e. in-CI before/after for R1.
- Steps `Baseline control` and `Overflow diagnostic` were removed afterwards (purpose served).
