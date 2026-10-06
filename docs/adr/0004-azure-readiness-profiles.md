# Separate metadata readiness from full Azure views

Status: accepted. The `personal` profile validates the minimal metadata path through Log Analytics and explicitly skips unconfigured Application Insights and Managed Grafana, avoiding phantom resource lookups and unnecessary setup cost. The `team` and `internal` profiles require both services alongside their cost controls; `internal` additionally requires least-privilege group RBAC, and `--production` implies `internal` with broader network and alert checks. Configured optional resources are still validated in the personal profile.
