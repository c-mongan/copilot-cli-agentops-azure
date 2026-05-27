# Actioner

The actioner is a future Azure Function that receives Azure Monitor alert payloads and creates deterministic notifications or issue artifacts.

It must not call broad LLM tools, read unrelated secrets, mutate Azure resources broadly, or change repository files automatically.
