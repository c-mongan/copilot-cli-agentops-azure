# Project-local observation with a wrapper-free default

Status: accepted for the Copilot CLI-first plan.

The first installation path will use project-local configuration and Copilot's native telemetry and hooks. Native CLI telemetry still requires environment activation or enterprise managed settings; a project file alone cannot switch it on. Enterprise policy can cover ordinary `copilot`, with a reversible single-session launch as the local fallback. Owned Node and Python scripts may opt into automatic library instrumentation; an explicit script runner remains available when a reliable script boundary or trace-context bridge is needed. This preserves ordinary commands and makes project setup removable by reverting owned changes. A mandatory global shim would simplify control but create the installation and removal burden the user wants to avoid. Native and automatic signals alone cannot claim visibility into arbitrary internal code, so coverage must state that limit.
