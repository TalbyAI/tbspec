# Choose the shared CLI and loopback web architecture

Type: grilling
Status: ready-for-human
State: open
Blocked by: 05, 10

## Question

How will CLI commands and the local loopback web interface call the same project operations in the selected runtime, with the web session token and file-write boundary enforced? Decide the packaging shape for Windows, macOS, and Linux with at most one required installed runtime where practical, including bundling and explicit upgrades of versioned starter resources. Consider TanStack Start only if Node wins and only if it fits this local server boundary; keep route handlers out of the project core.
