import SwiftUI

// One day in the journal: the date and its count, then the gold double-rule
// and THE LEAD tag announcing the day's first story, then entries under
// hairline dividers. No card, no shadow — the page itself is the sheet.
struct DaySheet: View {
    let day: String?
    let totalInDay: Int
    let stories: [Story]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(dateLabel)
                    .font(.display(20))
                    .foregroundStyle(Color.ink)
                if let relative = relativeLabel {
                    Apparatus(relative, size: 10)
                        .foregroundStyle(Color.muted)
                        .padding(.leading, 6)
                }
                Spacer()
                Apparatus(countLabel, size: 10.5)
                    .foregroundStyle(Color.muted)
            }
            .padding(.bottom, 10)

            GoldRule()
            Apparatus("The lead", size: 10, medium: true)
                .kerning(3)
                .foregroundStyle(Color.gold)
                .padding(.top, 9)

            ForEach(Array(stories.enumerated()), id: \.element.id) { index, story in
                NavigationLink(value: story) {
                    // Numbered by visible position (owner's call): folding and
                    // filtering never leave gaps in the count.
                    ArticleRow(story: story, number: index + 1, isLead: index == 0)
                }
                .buttonStyle(.plain)
                if index < stories.count - 1 {
                    Rectangle()
                        .fill(Color.hairSoft)
                        .frame(height: 0.5)
                }
            }
        }
    }

    // Header count follows the web's grammar: the day's own total, or
    // "K of N" when folding/filtering narrowed what is shown.
    private var countLabel: String {
        if stories.count == totalInDay {
            "\(totalInDay) \(totalInDay == 1 ? "story" : "stories")"
        } else {
            "\(stories.count) of \(totalInDay) stories"
        }
    }

    // Dates read DD.MM.YYYY (owner request); the store key stays ISO.
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
