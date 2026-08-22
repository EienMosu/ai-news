import SwiftUI

struct SectionView: View {
    let vertical: Vertical

    @State private var state = LoadState.loading
    @State private var activeFilterID: String?

    enum LoadState {
        case loading
        case loaded([FeedResult])
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            Group {
                switch state {
                case .loading:
                    ProgressView("Loading \(vertical.title)…")
                        .tint(vertical.color)
                case .loaded(let days):
                    loadedView(days)
                case .failed(let message):
                    errorView(message)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.paper)
            .navigationTitle(vertical.title)
        }
        .task {
            // Runs when the tab first appears; the guard stops a re-fetch
            // every time the user switches back to an already-loaded tab.
            if case .loading = state { await load() }
        }
    }

    private var activeFilter: FilterDef? {
        FilterDef.chips(for: vertical).first { $0.id == activeFilterID }
    }

    private func loadedView(_ days: [FeedResult]) -> some View {
        // Folded once for the whole list: a story shown in a newer day does
        // not repeat in an older one (index-aligned with `days`), then the
        // active chip narrows each day, mirroring the site's ?f= behaviour.
        let dayStories = Story.groupDays(days)
        let filtered: [[Story]] = dayStories.map { stories in
            guard let def = activeFilter else { return stories }
            return stories.filter { def.matches($0.lead) }
        }
        let shown = filtered.reduce(0) { $0 + $1.count }

        return VStack(spacing: 0) {
            filterChips
            if shown == 0, let def = activeFilter {
                emptyFilterView(def)
            } else {
                feedList(days, filtered)
            }
        }
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(FilterDef.chips(for: vertical)) { def in
                    let isActive = activeFilterID == def.id
                    Button {
                        activeFilterID = isActive ? nil : def.id
                    } label: {
                        Text(def.label)
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(
                                isActive ? vertical.color : Color.ink.opacity(0.06),
                                in: Capsule()
                            )
                            .foregroundStyle(isActive ? .white : Color.ink)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    private func feedList(_ days: [FeedResult], _ filtered: [[Story]]) -> some View {
        List {
            // `day` is nullable in the contract, so it cannot be the row
            // identity; the position in the newest-first response is.
            ForEach(days.indices, id: \.self) { index in
                if !filtered[index].isEmpty {
                    Section(formatDay(days[index].day)) {
                        ForEach(filtered[index]) { story in
                            NavigationLink(value: story) {
                                ArticleRow(
                                    article: story.lead,
                                    accent: vertical.color,
                                    otherSources: story.otherSources
                                )
                            }
                            .listRowBackground(Color.paper)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .refreshable { await load() }
        .navigationDestination(for: Story.self) { story in
            ArticleView(story: story, accent: vertical.color)
        }
    }

    private func emptyFilterView(_ def: FilterDef) -> some View {
        VStack(spacing: 8) {
            Spacer()
            Text("No \(def.label) stories in these days.")
                .foregroundStyle(Color.ink.opacity(0.6))
            Button("Clear filter") { activeFilterID = nil }
                .tint(vertical.color)
            Spacer()
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40))
                .foregroundStyle(vertical.color)
            Text(message)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.ink.opacity(0.7))
            Button("Try Again") {
                state = .loading
                Task { await load() }
            }
            .buttonStyle(.borderedProminent)
            .tint(vertical.color)
        }
        .padding()
    }

    private func load() async {
        do {
            let response = try await FeedClient().fetchFeed(section: vertical)
            state = .loaded(response.results)
        } catch {
            // A pull-to-refresh failure keeps the stale list instead of
            // replacing it with an error screen.
            if case .loaded = state { return }
            state = .failed(error.localizedDescription)
        }
    }

    private func formatDay(_ day: String?) -> String {
        guard let day else { return "Unknown day" }
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        parser.locale = Locale(identifier: "en_US_POSIX")
        guard let date = parser.date(from: day) else { return day }
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }
}

#Preview {
    SectionView(vertical: .ai)
}
