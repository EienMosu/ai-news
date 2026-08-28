import SwiftUI

// The site's top-right theme control, same grammar: a hairline capsule naming
// the mode a tap switches TO (moon · DARK on a light page, sun · LIGHT on a
// dark one). The choice persists in UserDefaults via AppStorage — "" means no
// choice yet, so the app follows the system, exactly like the site before its
// first toggle click. ContentView reads the same key and applies it with
// .preferredColorScheme; this view only reads the RESOLVED scheme, so its
// label is always the truthful opposite of what is on screen.
struct ThemeToggle: View {
    @AppStorage("appearance") private var appearance = ""
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button {
            appearance = colorScheme == .dark ? "light" : "dark"
        } label: {
            HStack(spacing: 5) {
                Image(systemName: colorScheme == .dark ? "sun.max" : "moon")
                    .font(.system(size: 10, weight: .semibold))
                Apparatus(colorScheme == .dark ? "Light" : "Dark", size: 10, medium: true)
            }
            .foregroundStyle(Color.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .overlay(Capsule().strokeBorder(Color.hair, lineWidth: 1))
            // The capsule is visually small; the tappable area must not be.
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(colorScheme == .dark ? "Switch to light mode" : "Switch to dark mode")
    }
}

#Preview {
    ZStack {
        Color.ground.ignoresSafeArea()
        ThemeToggle()
    }
}
