import SwiftUI

// The three verticals and their locked world colours (DESIGN.md).

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

    var color: Color {
        switch self {
        case .ai: .worldAI
        case .design: .worldDesign
        case .cloud: .worldCloud
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
