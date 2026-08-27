import SwiftUI
import UIKit

// MODERN CLASSIC — the day's wire, set like a luxury journal (DESIGN.md, owner
// redesign 2026-08-27/28). One ivory page, ink type, gold as the single accent;
// the app follows the system appearance, so every token is a dynamic colour
// carrying both the light value and its true-dark twin. The web and this app
// read the same palette; change it there first, mirror it here.

enum Vertical: String, CaseIterable, Identifiable {
    case ai
    case design
    case cloud

    var id: String { rawValue }

    var title: String {
        switch self {
        case .ai: "AI"
        case .design: "Design"
        case .cloud: "Cloud"
        }
    }

    // The departments bar speaks full names — the words are the affordance.
    var navTitle: String {
        switch self {
        case .ai: "AI News"
        case .design: "Design News"
        case .cloud: "Cloud News"
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    /// A token: the light value and its dark twin, resolved by the system.
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        })
    }

    // The Modern Classic tokens (mirrors app/globals.css).
    static let ground = Color(light: 0xF6F1E6, dark: 0x17130D)
    static let ink = Color(light: 0x191512, dark: 0xECE3CE)
    static let inkSoft = Color(light: 0x575043, dark: 0xCDC1A6)
    static let muted = Color(light: 0x766C5B, dark: 0xA79C85)
    /// Gold that carries TEXT — deep enough for the 4.5:1 floor on ivory.
    static let gold = Color(light: 0x7D600E, dark: 0xD8AC52)
    /// Gold that carries RULES — the mock's brighter tone.
    static let goldSoft = Color(light: 0xA6811F, dark: 0xD8AC52)
    static let hair = Color(light: 0xC9BC9C, dark: 0x4A4230)
    static let hairMid = Color(light: 0xD8CDB4, dark: 0x40392A)
    static let hairSoft = Color(light: 0xE2D8C2, dark: 0x2E2819)
}

// Three faces, three jobs: Playfair Display (display: masthead, headlines,
// folio numerals), Literata (prose), JetBrains Mono (apparatus). Bundled in
// Fonts/, registered via UIAppFonts; names are the variable fonts' instances.
extension Font {
    static func display(_ size: CGFloat) -> Font {
        .custom("PlayfairDisplayRoman-Bold", size: size)
    }

    static func displayHeavy(_ size: CGFloat) -> Font {
        .custom("PlayfairDisplayRoman-ExtraBold", size: size)
    }

    static func displayItalicish(_ size: CGFloat) -> Font {
        // Playfair's roman file carries no italic instances; the folio
        // numeral leans via .italic() at the call site instead.
        .custom("PlayfairDisplayRoman-Medium", size: size)
    }

    static func prose(_ size: CGFloat) -> Font {
        .custom("Literata-Regular", size: size)
    }

    static func proseSemiBold(_ size: CGFloat) -> Font {
        .custom("Literata-Regular_SemiBold", size: size)
    }

    static func apparatus(_ size: CGFloat) -> Font {
        .custom("JetBrainsMono-Regular", size: size)
    }

    static func apparatusMedium(_ size: CGFloat) -> Font {
        .custom("JetBrainsMonoRoman-Medium", size: size)
    }
}

// The apparatus voice: uppercase mono, letterspaced (web: 0.6875rem / 0.09em).
struct Apparatus: View {
    let text: String
    var size: CGFloat = 11
    var medium = false

    init(_ text: String, size: CGFloat = 11, medium: Bool = false) {
        self.text = text
        self.size = size
        self.medium = medium
    }

    var body: some View {
        Text(text.uppercased())
            .font(medium ? .apparatusMedium(size) : .apparatus(size))
            .kerning(size * 0.09)
    }
}

// The stamp: a boxed, letterspaced mono word — state never depends on hue;
// the word is the signal.
struct Stamp: View {
    let text: String
    var color: Color = .ink

    init(_ text: String, color: Color = .ink) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Apparatus(text, size: 10, medium: true)
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .overlay(Rectangle().strokeBorder(color.opacity(0.5), lineWidth: 1))
    }
}

// The gold double-rule: the lead's announcement and the document's opening —
// the design's signature detail, shared with the web (border-y gold, 4px tall).
struct GoldRule: View {
    var body: some View {
        VStack(spacing: 2) {
            Rectangle().fill(Color.goldSoft).frame(height: 1)
            Rectangle().fill(Color.goldSoft).frame(height: 1)
        }
        .accessibilityHidden(true)
    }
}
