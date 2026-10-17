// Remove transient credentials before loading the application or making requests.
globalThis.tbspecOpeningBootstrap = new URLSearchParams(location.hash.slice(1)).get(
  "tbspec-bootstrap",
);
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
