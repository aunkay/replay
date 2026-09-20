import SwiftUI

// Add these Swift files to a new iOS App target and replace its generated App.
// Use your deployed HTTPS origin, including the port when it is not 443.
@main
struct ReplayApp: App {
    private let serverURL = URL(string: "https://replay.example.com/")!

    var body: some Scene {
        WindowGroup {
            ReplayScreen(serverURL: serverURL)
                .preferredColorScheme(.dark)
        }
    }
}

private struct ReplayScreen: View {
    let serverURL: URL
    @Environment(\.scenePhase) private var scenePhase
    @State private var reloadToken = UUID()
    @State private var pauseToken = 0
    @State private var loading = true
    @State private var failure: String?

    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.06, blue: 0.08).ignoresSafeArea()
            ReplayWebView(
                serverURL: serverURL,
                reloadToken: reloadToken,
                pauseToken: pauseToken,
                onLoading: { loading = $0 },
                onFailure: { failure = $0 }
            )
            // Web CSS owns the notch/home-indicator insets. Keep keyboard
            // avoidance enabled: do not use ignoresSafeArea(.keyboard).
            .ignoresSafeArea(.container)

            if let failure {
                VStack(spacing: 16) {
                    Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                    Text("Unable to open Replay").font(.headline)
                    Text(failure).font(.subheadline).multilineTextAlignment(.center)
                    Button("Retry") {
                        self.failure = nil
                        loading = true
                        reloadToken = UUID()
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(28)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
                .padding(24)
            } else if loading {
                ProgressView("Loading Replay…")
                    .padding(20)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                    .allowsHitTesting(false)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { pauseToken += 1 }
        }
    }
}
