import SwiftUI

struct ContentView: View {
    var body: some View {
        WebView()
            .ignoresSafeArea()
            .task {
                HealthBridge.shared.requestAuthorization()
            }
    }
}
