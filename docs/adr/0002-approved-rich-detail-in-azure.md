# Store approved rich detail in Azure with a separate development boundary

Status: accepted as a product design decision; no work deployment is authorized by this record.

Approved work deployments may retain prompts, tool arguments and results, and script output in Azure with restricted access, explicit retention, and a separately tested content policy. Synthetic development data stays isolated from work data. This supports end-to-end investigation in the intended Azure environment while accepting the governance and ingestion-cost obligations of rich content. A metadata-only path remains necessary for surfaces or runs without content approval; absence of detail must be visible in coverage rather than treated as a successful empty result.
