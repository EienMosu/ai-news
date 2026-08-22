import SwiftUI

// A vertical's screen: the world colour is the GROUND (the field), paper day
// sheets are laid on it. Switching tabs is leaving one world for another.
struct SectionView: View {
    let vertical: Vertical
    @Binding var selection: Vertical
    @Binding var deepLink: DeepLinkTarget?

    @State private var state = LoadState.loading
    @State private var activeFilterID: String?
    @State private var searchText = ""
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
            .safeAreaInset(edge: .bottom) {
                SectionSwitch(selection: $selection)
            }
            .toolbar(.hidden, for: .navigationBar)
            .toolbar(.hidden, for: .tabBar)
            .navigationDestination(for: Story.self) { story in
                ArticleView(story: story, vertical: vertical)
            }
        }
        .task {
            #if DEBUG
            // Headless UI testing lever: simctl cannot tap, so launch
            // arguments can pre-apply a chip or a search term.
            // e.g. simctl launch <udid> <bundle> -preselectFilter anthropic
            let args = ProcessInfo.processInfo.arguments
            if let i = args.firstIndex(of: "-preselectFilter"), i + 1 < args.count {
                activeFilterID = args[i + 1]
            }
            if let i = args.firstIndex(of: "-preselectSearch"), i + 1 < args.count {
                searchText = args[i + 1]
            }
            #endif
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

    // The search bar is the web's Others chip in mobile clothes: a free-text
    // def matched with the same semantics (lowercased substring over
    // title + summary + sourceName), narrowing the LOADED days only.
    private var searchFilter: FilterDef? {
        let text = searchText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }
        return FilterDef(id: text, label: text, synonyms: [.substring(text.lowercased())])
    }

    private var activeFilters: [FilterDef] {
        [activeFilter, searchFilter].compactMap { $0 }
    }

    // The masthead: mark + wordmark in apparatus voice, the section's own
    // news title in display, the product's claim as the tagline.
    private var masthead: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 9) {
                FileMark()
                    .stroke(vertical.onField, style: StrokeStyle(lineWidth: 2, lineJoin: .miter))
                    .frame(width: 24, height: 24)
                Apparatus("The Slow Wire", size: 11, medium: true)
                    .foregroundStyle(vertical.onField)
                Spacer()
            }
            Text("\(vertical.title) News")
                .font(.display(34))
                .foregroundStyle(vertical.onField)
            Apparatus("Ranked by importance, not recency", size: 10.5)
                .foregroundStyle(vertical.onField.opacity(0.7))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func loadedView(_ days: [FeedResult]) -> some View {
        // Folded once for the whole list: a story shown in a newer day does
        // not repeat in an older one (index-aligned with `days`), then the
        // active chip and the search text narrow each day together.
        let dayStories = Story.groupDays(days)
        let allStories = dayStories.flatMap { $0 }
        let filters = activeFilters
        let filtered: [[Story]] = dayStories.map { stories in
            guard !filters.isEmpty else { return stories }
            return stories.filter { story in
                filters.allSatisfy { $0.matches(story.lead) }
            }
        }
        let shown = filtered.reduce(0) { $0 + $1.count }

        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                masthead
                filterChips(allStories)
                searchBar
                if !filters.isEmpty {
                    filterStatus(filters, shown: shown, total: allStories.count)
                }
                if shown == 0, !filters.isEmpty {
                    emptyFilterSheet(filters.map(\.label).joined(separator: " · "))
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
            .padding(.bottom, 24)
        }
        .refreshable { await load() }
        .scrollDismissesKeyboard(.immediately)
    }

    // The selection grammar (DESIGN.md): selected = paper background with
    // field-coloured text; inactive = transparent, on-field at 70%, with a
    // 35% on-field border. Each chip names its own effect: the count is how
    // many of the loaded stories it narrows to; the active one grows an ×.
    private func filterChips(_ allStories: [Story]) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Stamp("Filter", color: vertical.onField)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(FilterDef.chips(for: vertical)) { def in
                        let isActive = activeFilterID == def.id
                        let count = allStories.count { def.matches($0.lead) }
                        Button {
                            activeFilterID = isActive ? nil : def.id
                        } label: {
                            HStack(spacing: 6) {
                                Apparatus(def.label, size: 11, medium: isActive)
                                Apparatus("\(count)", size: 10)
                                    .opacity(0.6)
                                if isActive {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold))
                                }
                            }
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
    }

    // The web's FILTER sentence, once per section: says what the narrowing
    // did, in numbers, right where it happened.
    private func filterStatus(_ filters: [FilterDef], shown: Int, total: Int) -> some View {
        Apparatus(
            "\(filters.map(\.label).joined(separator: " + ")) · \(shown) of \(total) stories in view",
            size: 10.5
        )
        .foregroundStyle(vertical.onField.opacity(0.7))
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(vertical.onField.opacity(0.7))
            TextField(
                "",
                text: $searchText,
                prompt: Text("SEARCH THESE DAYS")
                    .font(.apparatus(11))
                    .foregroundStyle(vertical.onField.opacity(0.5))
            )
            .font(.apparatus(12))
            .foregroundStyle(vertical.onField)
            .tint(vertical.onField)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(vertical.onField.opacity(0.7))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(vertical.onField.opacity(0.35), lineWidth: 1)
        )
    }

    // A zero-match narrowing still keeps its sheet (web grammar) instead of
    // a bare message floating on the field.
    private func emptyFilterSheet(_ label: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Apparatus("Filter · \(label)", size: 10.5)
                .foregroundStyle(Color.ink.opacity(0.7))
            Text("No matches in these days.")
                .font(.prose(15))
                .foregroundStyle(Color.ink.opacity(0.75))
            Button {
                activeFilterID = nil
                searchText = ""
            } label: {
                Apparatus("Clear", size: 11, medium: true)
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

// The section switch, in the web's own grammar (SectionNav): three equal
// cells, mono uppercase, the current cell inverted to paper with its field's
// text; inactive cells stay on the field at 70% behind a 35% border.
struct SectionSwitch: View {
    @Binding var selection: Vertical

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Vertical.allCases) { vertical in
                let isCurrent = vertical == selection
                Button {
                    selection = vertical
                } label: {
                    Apparatus(vertical.title, size: 11.5, medium: isCurrent)
                        .foregroundStyle(isCurrent ? vertical.color : selection.onField.opacity(0.7))
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(isCurrent ? Color.paper : .clear)
                }
                .buttonStyle(.plain)
                if vertical != Vertical.allCases.last {
                    Rectangle()
                        .fill(selection.onField.opacity(0.35))
                        .frame(width: 1, height: 46)
                }
            }
        }
        .background(selection.color)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(selection.onField.opacity(0.35), lineWidth: 1)
        )
        .padding(.horizontal, 14)
        .padding(.top, 6)
        .padding(.bottom, 2)
        .background(
            // A soft fade so sheets scrolling under the switch stay legible.
            LinearGradient(
                colors: [selection.color.opacity(0), selection.color],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        )
    }
}

#Preview {
    SectionView(vertical: .ai, selection: .constant(.ai), deepLink: .constant(nil))
}
