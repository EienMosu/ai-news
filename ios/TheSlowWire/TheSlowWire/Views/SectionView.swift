import SwiftUI

// A vertical's screen: the world colour is the GROUND (the field), paper day
// sheets are laid on it. Switching tabs is leaving one world for another.
struct SectionView: View {
    let vertical: Vertical
    @Binding var deepLink: DeepLinkTarget?

    @State private var state = LoadState.loading
    @State private var activeFilterID: String?
    // The explicit navigation path: NavigationLink taps append to it on their
    // own; deep links append to it programmatically.
    @State private var path: [Story] = []

    enum LoadState {
        case loading
        case loaded([FeedResult])
        case failed(String)
    }

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                vertical.color.ignoresSafeArea()
                switch state {
                case .loading:
                    loadingView
                case .loaded(let days):
                    loadedView(days)
                case .failed(let message):
                    errorView(message)
                }
            }
            .navigationDestination(for: Story.self) { story in
                ArticleView(story: story, vertical: vertical)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .task {
            // Runs when the tab first appears; the guard stops a re-fetch
            // every time the user switches back to an already-loaded tab.
            if case .loading = state { await load() }
            await consumeDeepLink()
        }
        .onChange(of: deepLink) {
            Task { await consumeDeepLink() }
        }
    }

    // A deep link for this tab pushes the fetched story onto the path. The
    // fetch goes through /api/article (article + siblings composed server-
    // side), so a cold start needs no feed in hand. Consuming clears the
    // shared binding so the other two tabs stop seeing it.
    private func consumeDeepLink() async {
        guard let target = deepLink, target.section == vertical else { return }
        deepLink = nil
        guard let story = try? await FeedClient().fetchStory(urlHash: target.urlHash) else { return }
        path.append(story)
    }

    private var activeFilter: FilterDef? {
        FilterDef.chips(for: vertical).first { $0.id == activeFilterID }
    }

    // The masthead: the section is the page's identity; the product name
    // rides above it in apparatus voice.
    private var masthead: some View {
        VStack(alignment: .leading, spacing: 4) {
            Apparatus("The Slow Wire", size: 11)
                .foregroundStyle(vertical.onField.opacity(0.7))
            Text(vertical.title)
                .font(.display(40))
                .foregroundStyle(vertical.onField)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                masthead
                filterChips
                if shown == 0, let def = activeFilter {
                    emptyFilterSheet(def)
                } else {
                    ForEach(days.indices, id: \.self) { index in
                        if !filtered[index].isEmpty {
                            DaySheet(
                                day: days[index].day,
                                totalInDay: days[index].articles.count,
                                stories: filtered[index],
                                vertical: vertical
                            )
                        }
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 8)
            .padding(.bottom, 40)
        }
        .refreshable { await load() }
    }

    // The selection grammar (DESIGN.md): selected = paper background with
    // field-coloured text; inactive = transparent, on-field at 70%, with a
    // 35% on-field border.
    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(FilterDef.chips(for: vertical)) { def in
                    let isActive = activeFilterID == def.id
                    Button {
                        activeFilterID = isActive ? nil : def.id
                    } label: {
                        Apparatus(def.label, size: 11, medium: isActive)
                            .foregroundStyle(isActive ? vertical.color : vertical.onField.opacity(0.7))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(isActive ? Color.paper : .clear, in: Capsule())
                            .overlay(
                                Capsule().strokeBorder(
                                    isActive ? .clear : vertical.onField.opacity(0.35),
                                    lineWidth: 1
                                )
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }

    // A zero-match filter still keeps its sheet (web grammar) instead of a
    // bare message floating on the field.
    private func emptyFilterSheet(_ def: FilterDef) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Apparatus("Filter · \(def.label)", size: 10.5)
                .foregroundStyle(Color.ink.opacity(0.7))
            Text("No matches in these days.")
                .font(.prose(15))
                .foregroundStyle(Color.ink.opacity(0.75))
            Button {
                activeFilterID = nil
            } label: {
                Apparatus("Clear filter", size: 11, medium: true)
                    .foregroundStyle(vertical.onField)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(vertical.color, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.paper)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .shadow(color: .black.opacity(0.35), radius: 16, y: 10)
    }

    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(vertical.onField)
            Apparatus("Counting the day", size: 11)
                .foregroundStyle(vertical.onField.opacity(0.7))
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 36))
                .foregroundStyle(vertical.onField.opacity(0.8))
            Text(message)
                .font(.prose(15))
                .multilineTextAlignment(.center)
                .foregroundStyle(vertical.onField.opacity(0.85))
            Button {
                state = .loading
                Task { await load() }
            } label: {
                Apparatus("Try again", size: 11, medium: true)
                    .foregroundStyle(vertical.color)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.paper, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(24)
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
}

#Preview {
    SectionView(vertical: .ai, deepLink: .constant(nil))
}
