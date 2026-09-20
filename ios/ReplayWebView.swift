import SwiftUI
import UIKit
import WebKit

@MainActor
struct ReplayWebView: UIViewRepresentable {
    let serverURL: URL
    let reloadToken: UUID
    let pauseToken: Int
    let onLoading: (Bool) -> Void
    let onFailure: (String?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Sessions, drawings, indicators and settings are saved by this web
        // origin in localStorage. A nonpersistent store would discard them.
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(context.coordinator, name: "replayExport")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.05, green: 0.06, blue: 0.08, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        context.coordinator.webView = webView
        context.coordinator.loadConfiguredPage()
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        if coordinator.lastReloadToken != reloadToken {
            coordinator.lastReloadToken = reloadToken
            coordinator.loadConfiguredPage()
        }
        if coordinator.lastPauseToken != pauseToken {
            coordinator.lastPauseToken = pauseToken
            // Static JS only; never interpolate script-message content here.
            webView.evaluateJavaScript("window.dispatchEvent(new Event('replay:pause'))", completionHandler: nil)
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "replayExport")
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: ReplayWebView
        weak var webView: WKWebView?
        var lastReloadToken: UUID
        var lastPauseToken: Int
        private var sharing = false
        private let maximumExportBytes = 8 * 1024 * 1024

        init(parent: ReplayWebView) {
            self.parent = parent
            self.lastReloadToken = parent.reloadToken
            self.lastPauseToken = parent.pauseToken
        }

        private func trusted(_ url: URL?) -> Bool {
            guard let url,
                  parent.serverURL.scheme?.lowercased() == "https",
                  let configuredHost = parent.serverURL.host?.lowercased(),
                  url.scheme?.lowercased() == "https",
                  url.host?.lowercased() == configuredHost,
                  url.user == nil, url.password == nil,
                  (url.port ?? 443) == (parent.serverURL.port ?? 443)
            else { return false }
            return true
        }

        func loadConfiguredPage() {
            guard trusted(parent.serverURL) else {
                DispatchQueue.main.async { [weak self] in
                    self?.parent.onLoading(false)
                    self?.parent.onFailure("Configure ReplayApp.swift with your HTTPS server URL.")
                }
                return
            }
            webView?.load(URLRequest(url: parent.serverURL))
        }

        private func openExternal(_ url: URL) {
            guard ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return }
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            // Let WKUIDelegate handle new-window requests, including target=_blank.
            if navigationAction.targetFrame == nil {
                decisionHandler(["https", "http"].contains(url.scheme?.lowercased() ?? "") ? .allow : .cancel)
                return
            }
            if trusted(url) {
                decisionHandler(.allow)
            } else {
                if navigationAction.targetFrame?.isMainFrame == true {
                    if navigationAction.navigationType == .linkActivated {
                        openExternal(url)
                    } else {
                        parent.onLoading(false)
                        parent.onFailure("The server redirected to another origin. Check the configured HTTPS URL.")
                    }
                }
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }
            if trusted(url) { webView.load(navigationAction.request) }
            else { openExternal(url) }
            return nil
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            if navigationResponse.isForMainFrame,
               let response = navigationResponse.response as? HTTPURLResponse,
               response.statusCode >= 400 {
                parent.onLoading(false)
                parent.onFailure("The server returned HTTP \(response.statusCode). Check the server and try again.")
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.onFailure(nil)
            parent.onLoading(true)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.onLoading(false)
            parent.onFailure(nil)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            reportNavigationFailure(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            reportNavigationFailure(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            parent.onLoading(false)
            parent.onFailure("The web view stopped. Tap Retry to restore your saved session.")
        }

        private func reportNavigationFailure(_ error: Error) {
            let failure = error as NSError
            guard !(failure.domain == NSURLErrorDomain && failure.code == NSURLErrorCancelled) else { return }
            parent.onLoading(false)
            parent.onFailure(error.localizedDescription)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "replayExport",
                  message.webView === webView,
                  message.frameInfo.isMainFrame,
                  trusted(message.frameInfo.request.url),
                  trusted(webView?.url)
            else { return }
            let origin = message.frameInfo.securityOrigin
            let actualPort = origin.port == 0 ? 443 : origin.port
            guard origin.`protocol`.lowercased() == "https",
                  origin.host.lowercased() == parent.serverURL.host?.lowercased(),
                  actualPort == (parent.serverURL.port ?? 443)
            else { return }
            guard !sharing else { return }
            guard let payload = message.body as? [String: Any],
                  let filename = payload["filename"] as? String,
                  let mimeType = payload["mimeType"] as? String,
                  let content = payload["content"] as? String,
                  mimeType == "text/csv;charset=utf-8;",
                  filename.range(of: #"^[A-Za-z0-9][A-Za-z0-9._=^+\-]{0,155}\.csv$"#, options: .regularExpression) != nil,
                  !filename.contains("..")
            else {
                showExportError("The export request is not a valid CSV file.")
                return
            }
            guard content.utf8.count <= maximumExportBytes else {
                showExportError("This CSV exceeds the 8 MB mobile sharing limit. Export a shorter session or use the desktop browser.")
                return
            }
            guard let presenter = presentationController() else { return }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ReplayExport-\(UUID().uuidString)", isDirectory: true)
            let file = directory.appendingPathComponent(filename, isDirectory: false)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                try Data(content.utf8).write(to: file, options: .atomic)
                let activity = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                // iPad requires an explicit popover anchor.
                activity.popoverPresentationController?.sourceView = presenter.view
                activity.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
                activity.popoverPresentationController?.permittedArrowDirections = []
                sharing = true
                activity.completionWithItemsHandler = { [weak self] _, _, _, _ in
                    Task { @MainActor [weak self] in
                        try? FileManager.default.removeItem(at: directory)
                        self?.sharing = false
                    }
                }
                presenter.present(activity, animated: true)
            } catch {
                try? FileManager.default.removeItem(at: directory)
                showExportError("The CSV could not be prepared: \(error.localizedDescription)")
            }
        }

        private func presentationController() -> UIViewController? {
            var controller = webView?.window?.rootViewController
            while let presented = controller?.presentedViewController { controller = presented }
            return controller
        }

        private func showExportError(_ message: String) {
            guard let presenter = presentationController(), !(presenter is UIAlertController) else { return }
            let alert = UIAlertController(title: "Export unavailable", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            presenter.present(alert, animated: true)
        }
    }
}
