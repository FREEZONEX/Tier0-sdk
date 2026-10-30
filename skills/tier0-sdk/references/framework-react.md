# React platform adapters

Generated adapters in @tier0/sdk/openapi/react cover the current platform clients only. Use the generated useOpenapiV2Info, useOpenapiV2AuthWhoami, member and notification adapters as appropriate; inspect installed types for exact signatures. Retired Flow and Namespace hooks have no aliases.

For UNS data, call unsV2 from the application service layer and integrate its promises with the framework's query/state library. Keep verified Collection/record IDs, permissions, errors and pagination in that layer; render business objects rather than raw API responses. App runtime authentication is provided by the trusted host, never a browser-embedded service key.
