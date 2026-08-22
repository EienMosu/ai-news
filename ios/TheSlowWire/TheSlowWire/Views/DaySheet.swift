import SwiftUI

// One day, as the sheet it was judged on: paper laid on the field, a
// display-face date, an apparatus count, numbered entries under hairlines.
struct DaySheet: View {
    let day: String?
    let totalInDay: Int
    let stories: [Story]
    let vertical: Vertical

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(dateLabel)
                    .font(.display(21))
                    .foregroundStyle(Color.ink)
                Spacer()
                Apparatus(countLabel, size: 10.5)
                    .foregroundStyle(Color.ink.opacity(0.7))
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 10)

            if let relative = relativeLabel {
                Apparatus(relative, size: 10.5)
                    .foregroundStyle(Color.ink.opacity(0.7))
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
                    .padding(.top, -6)
            }

            hairline

            ForEach(Array(stories.enumerated()), id: \.element.id) { index, story in
                NavigationLink(value: story) {
                    ArticleRow(story: story, vertical: vertical)
                }
                .buttonStyle(.plain)
                if index < stories.count - 1 {
                    hairline
                }
            }
        }
        .padding(.bottom, 4)
        .background(Color.paper)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .shadow(color: .black.opacity(0.35), radius: 16, y: 10)
    }

    private var hairline: some View {
        Rectangle()
            .fill(Color.ink.opacity(0.12))
            .frame(height: 0.5)
            .padding(.horizontal, 16)
    }

    // Header count follows the web's sheet grammar: the day's own total, or
    // "K of N" when folding/filtering narrowed what is shown.
    private var countLabel: String {
        if stories.count == totalInDay {
            "\(totalInDay) \(totalInDay == 1 ? "story" : "stories")"
        } else {
            "\(stories.count) of \(totalInDay) stories"
        }
    }

    // Dates read DD.MM.YYYY (owner request, DESIGN.md); the store key stays ISO.
    private var dateLabel: String {
        guard let day else { return "Unknown day" }
        let parts = day.split(separator: "-")
        guard parts.count == 3 else { return day }
        return "\(parts[2]).\(parts[1]).\(parts[0])"
    }

    private var relativeLabel: String? {
        guard let day else { return nil }
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        parser.locale = Locale(identifier: "en_US_POSIX")
        guard let date = parser.date(from: day) else { return nil }
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return nil
    }
}
