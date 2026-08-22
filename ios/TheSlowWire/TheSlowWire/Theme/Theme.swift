import SwiftUI

// The three verticals and the locked design language (DESIGN.md: "A day that
// was judged, shown as the file it was judged in"). The world colour is the
// FIELD — the screen's ground; paper sheets are laid on it. Nothing informational
// renders below 70% opacity (the contrast floor).

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

    var symbol: String {
        switch self {
        case .ai: "brain"
        case .design: "paintbrush"
        case .cloud: "cloud"
        }
    }

    // The field: the ground a section's whole screen wears.
    var color: Color {
        switch self {
        case .ai: .worldAI
        case .design: .worldDesign
        case .cloud: .worldCloud
        }
    }

    // Type on the field — each world has its own warm off-white (DESIGN.md).
    var onField: Color {
        switch self {
        case .ai: Color(hex: 0xF3EEE2)
        case .design: Color(hex: 0xF6ECE7)
        case .cloud: Color(hex: 0xEEF2E9)
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

    static let ink = Color(hex: 0x151512)
    static let paper = Color(hex: 0xEFE9DC)
    static let worldAI = Color(hex: 0x16307F)
    static let worldDesign = Color(hex: 0x7E2412)
    static let worldCloud = Color(hex: 0x1A432B)
}

// Three faces, three jobs (DESIGN.md): Bricolage Grotesque for display
// (dates, headlines, the masthead), Literata for prose, JetBrains Mono for
// apparatus (counts, sources, scores). Bundled in Fonts/, registered via
// UIAppFonts; the names are the variable fonts' named instances.
extension Font {
    static func display(_ size: CGFloat) -> Font {
        .custom("BricolageGrotesque-ExtraBold", size: size)
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
