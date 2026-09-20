# Run Replay on an iPhone or in a WKWebView wrapper

The web application and Python API run on your server. The iPhone loads that server over HTTPS; yfinance runs on the server. The included Swift files are a starter wrapper, not a signed app or an Xcode project. Native compilation, signing, Simulator testing, and device testing require macOS and Xcode and have not been performed in this Linux workspace.

## Host the application at one HTTPS origin

From the repository root, build the browser assets and run the API:

```bash
npm ci
npm run build
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

The backend serves `dist/` when it exists at startup. Build before starting it, and restart the backend after the first build. Put a TLS reverse proxy in front of port 8000 and expose a URL such as `https://replay.example.com/`. Keep the application at the server root: `/`, `/assets/*`, and `/api/*` must all resolve through that same origin. The frontend already uses relative `/api` URLs, so no device-specific API URL or CORS change is needed.

For example, an existing Caddy installation on the same host can use:

```caddyfile
replay.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

Use your domain and server's TLS configuration; this example does not deploy anything. Restrict direct access to port 8000 to the proxy/private network. If proxy and Python share a host, binding Uvicorn to `127.0.0.1` is sufficient. If the service is public, configure access control at your reverse proxy as appropriate: the application does not provide user accounts or server-side portfolios.

Open the HTTPS URL in iPhone Safari first and verify `/api/health` returns JSON. `localhost` and `127.0.0.1` on an iPhone refer to the phone, not your development computer. For local development use a LAN hostname with HTTPS and a certificate trusted by the device, or an HTTPS development tunnel. A local-network deployment may require `NSLocalNetworkUsageDescription` in the iOS target. The starter deliberately requires HTTPS even in Debug.

## Create the native target

1. In Xcode, create an **iOS App** with SwiftUI and Swift. Use iOS 18 or newer for this starter's WebKit/browser API baseline.
2. Replace the generated `App` and content view with [`ios/ReplayApp.swift`](../ios/ReplayApp.swift) and [`ios/ReplayWebView.swift`](../ios/ReplayWebView.swift). There must be only one `@main` app type.
3. Change `serverURL` in `ReplayApp.swift` to your exact HTTPS root URL. Origin checks include scheme, host, and port. Redirects to a different origin require changing this configured URL; they are not trusted automatically.
4. Choose your bundle identifier, signing team, app icon, and supported orientations. Build in Xcode, then run on a physical iPhone. Add an iPad run if you support iPad.

Leave App Transport Security enabled. No `NSAllowsArbitraryLoads` or `NSAllowsArbitraryLoadsInWebContent` exception is required for a correctly configured HTTPS server. ATS protects connections by default; Apple documents its configuration in [NSAppTransportSecurity](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSAppTransportSecurity).

The wrapper uses `WKWebsiteDataStore.default()` to retain the origin's cookies and web storage between launches, matching Apple's [persistent data store documentation](https://developer.apple.com/documentation/webkit/wkwebsitedatastore). Browser and wrapper storage are separate. Changing hostname, port, or HTTP to HTTPS changes the web origin and therefore starts a separate local session. Reinstalling the native app or clearing website data can also remove saved sessions; CSV exports are the portable record.

## Layout, keyboard, and lifecycle ownership

The web application owns safe-area padding through CSS `env(safe-area-inset-*)` and `viewport-fit=cover`. The Swift wrapper extends the web view with `.ignoresSafeArea(.container)` and uses `.never` for automatic scroll insets. Do not add native notch/home-indicator padding on top, which would double those insets.

Keyboard avoidance remains enabled. The wrapper does **not** ignore the keyboard safe area and does not pin the web view to a fixed screen height. Test ticker, quantity, price, period, and text-annotation fields with the software keyboard, including the last field in a long dialog. Do not disable pinch zoom or increase page scale to work around layout issues.

When the SwiftUI scene becomes inactive or enters the background, the wrapper dispatches the static `replay:pause` window event. The web application also pauses on page visibility changes/page hiding. Foregrounding the app should preserve its candle and account; replay resumes only after pressing Play.

Same-origin pages remain in the app. External HTTP(S) links open the system browser, including `target="_blank"` links through `WKUIDelegate`. Main-page navigation failures, HTTP errors, and terminated web-content processes show a Retry view. Apple's [new-window delegate documentation](https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:createwebviewwith:for:windowfeatures:)) describes the callback used for new windows.

## CSV export bridge

Browser exports keep their normal Blob download. In the wrapper, the same export buttons instead send this synchronous message:

```javascript
window.webkit.messageHandlers.replayExport.postMessage({
  filename: 'replay-AAPL-2026-09-19.csv',
  mimeType: 'text/csv;charset=utf-8;',
  content: '"Replay session","AAPL"\r\n'
});
```

The coordinator accepts messages only from its own web view's main frame on the configured HTTPS origin. It checks the sender's frame request, actual WebKit security origin, current page URL, CSV MIME type, filename characters, path traversal, and an 8 MiB UTF-8 content limit. It writes a uniquely scoped temporary file and opens `UIActivityViewController`; choose **Save to Files**, AirDrop, or another available destination. The temporary directory is removed after completion or cancellation. Invalid/oversized trusted requests show a native error; subframe and foreign-origin requests are ignored.

The share sheet includes the popover anchor required on iPad. See Apple's [UIActivityViewController documentation](https://developer.apple.com/documentation/uikit/uiactivityviewcontroller) and [WKScriptMessage.frameInfo](https://developer.apple.com/documentation/webkit/wkscriptmessage/frameinfo) for the native APIs. Bridge unit tests verify escaped CSV content and desktop fallback behavior; native origin validation and actual share-sheet presentation still require an Xcode/device run.

## Device acceptance checks

- Launch, background, force-quit, and relaunch; confirm positions, replay cursor, studies, drawings, and display settings restore at the same origin.
- Load real history, change ticker/interval, and switch between portrait and landscape. Verify the notch and home indicator do not obscure controls.
- Complete buy/sell orders, replay stepping, statistical normalization, comparison loading, drawing creation/editing, and chart pan/pinch zoom with touch.
- Open each dialog with the software keyboard; verify fields and submit/close buttons remain reachable.
- Export CSV to Files and cancel an export. Open the saved file and verify its account totals, order rows, and equity history.
- Tap attribution/external links, stop the server, and test Retry after restoring connectivity. Confirm backgrounding pauses replay.

This starter requires connectivity to load the application and fetch market data. It adds no service worker or offline-history cache and makes no offline-availability claim. Existing browser-local session data is retained by the persistent website store when available.
