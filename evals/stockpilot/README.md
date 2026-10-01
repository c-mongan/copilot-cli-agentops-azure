# StockPilot fixtures (placeholder — Task 9)

This directory is reserved by the master plan for the StockPilot-derived
proving ground. Task 6 built the deterministic architecture engine against
hand-built fixture ledgers in `agentops-cli/test/architecture.test.js`
(`baseInventory`, `plantedNearMandatoryLedger`, `plantedCoactivatedLedger`,
`plantedThrashLedger`, `plantedMechanicalLedger`, `healthyLedger`) — those
are the four planted-flaw ledgers plus the healthy negative control the
spec promises as the "known right answers for detection" surface.

Task 9 is responsible for the full StockPilot harness and the Vally
single-change experiment loop; this file reserves the path and documents
the handoff so neither task reinvents the other's fixtures.
