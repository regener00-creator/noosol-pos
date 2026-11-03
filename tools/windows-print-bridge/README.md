# SAPURI Print bridge

Windows x64 / .NET Framework 4.6.2+ / Microsoft Edge WebView2 Runtime.
Build with `tools/windows-printer-setup/build.ps1`. Dependencies are downloaded
from NuGet and Google Fonts, pinned by SHA-256, and bundled with licenses.
No signing certificate, background cloud service, or printer-default mutation.

The existing setup installs the bridge under the current Windows user and
registers its startup entry plus the `sapuri-print` pairing protocol. The browser
creates a random 256-bit pairing token. Only the exact production Origin, exact
loopback Host, authenticated JSON POSTs and bounded payloads are accepted. The
renderer has JavaScript, host objects, downloads, navigation and all external
network requests disabled. Thai fonts are bundled; raster images must be data URLs.

Printer routes are validated against installed physical printers and saved locally.
Each accepted print id is journaled before rendering; response retries reuse that id.
A restart marks unfinished work unknown instead of printing again. Success means
Windows accepted dispatch, not proof of paper output. No document HTML is persisted.
The journal retains the latest 300 jobs; identifiers must not be reused for new jobs.

Verification:
- `node tests/direct-printer-browser.test.js` — settings, routing, changing printers,
  saved defaults, network loss, duplicate clicks/retries, no silent kiosk fallback.
- `tools/windows-print-bridge/build.ps1 -Testing`
- `node tests/direct-printer-native.cjs` — real WebView2 render of receipt/A4/labels,
  security gates, routing, persistence and idempotency, exports PDFs without paper.
  Test switches and virtual test printers are absent from the release binary.
- Physically test each driver, media size and device before store rollout.

The browser may ask for permission to open the pairing protocol and access the
local network once. The application does not weaken browser or Windows policies.
