import SwiftUI

// A section's screen, Modern Classic: one ground, the journal masthead, the
// filter zone, then the day list. The departments bar at the bottom is the
// one control that changes section.
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
                Color.ground.ignoresSafeArea()
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
                ArticleView(story: story)
            }
        }
        .task {
            #if DEBUG
            // Headless UI testing lever: simctl cannot tap, so launch
            // arguments can pre-apply a chip or a search term.
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

    // A deep link for this tab pushes the fetched story onto the path.
    private func consumeDeepLink() async {
        guard let target = deepLink, target.section == vertical else { return }
        deepLink = nil
        guard let story = try? await FeedClient().fetchStory(urlHash: target.urlHash) else { return }
        path.append(story)
    }

    private var activeFilter: FilterDef? {
        FilterDef.chips(for: vertical).first { $0.id == activeFilterID }
    }

    // The search field is the web's quick-filter twin: a free-text def with
    // identical matching semantics, narrowing the LOADED days only.
    private var searchFilter: FilterDef? {
        let text = searchText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }
        return FilterDef(id: text, label: text, synonyms: [.substring(text.lowercased())])
    }

    private var activeFilters: [FilterDef] {
        [activeFilter, searchFilter].compactMap { $0 }
    }

    // The masthead: the product's claim, the centered Playfair wordmark, and
    // the newest day's own line beneath it — the journal's opening. The util
    // row on top carries the theme toggle at its right, as on the site.
    private func masthead(_ days: [FeedResult]) -> some View {
        VStack(spacing: 8) {
            HStack(alignment: .center) {
                Apparatus("Ranked by importance", size: 10)
                    .foregroundStyle(Color.muted)
                Spacer()
                ThemeToggle()
            }
            Text("The Slow Wire")
                .font(.displayHeavy(34))
                .foregroundStyle(Color.ink)
            if let first = days.first(where: { $0.day != nil }), let day = first.day {
                Apparatus("\(formatDDMMYYYY(day)) · \(first.articles.count) stories", size: 10.5)
                    .foregroundStyle(Color.muted)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func loadedView(_ days: [FeedResult]) -> some View {
        // Folded once for the whole list, then the active chip and the search
        // text narrow each day together, mirroring the web.
        let dayStories = Story.groupDays(days)
        let filters = activeFilters
        let filtered: [[Story]] = dayStories.map { stories in
            guard !filters.isEmpty else { return stories }
            return stories.filter { story in
                filters.allSatisfy { $0.matches(story.lead) }
            }
        }
        let shown = filtered.reduce(0) { $0 + $1.count }
        let total = dayStories.reduce(0) { $0 + $1.count }

        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                masthead(days)
                filterChips(dayStories.flatMap { $0 })
                searchBar
                if !filters.isEmpty {
                    Apparatus(
                        "\(filters.map(\.label).joined(separator: " + ")) · \(shown) of \(total) stories in view",
                        size: 10.5
                    )
                    .foregroundStyle(Color.muted)
                }
                if shown == 0, !filters.isEmpty {
                    emptyFilterBlock(filters.map(\.label).joined(separator: " · "))
                } else {
                    ForEach(days.indices, id: \.self) { index in
                        if !filtered[index].isEmpty {
                            DaySheet(
                                day: days[index].day,
                                totalInDay: days[index].articles.count,
                                stories: filtered[index]
                            )
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 24)
        }
        .refreshable { await load() }
        .scrollDismissesKeyboard(.immediately)
    }

    // The chips, Modern Classic grammar: hairline capsules with counts; the
    // active chip presses in — ink fill, ground text, an ×.
    private func filterChips(_ allStories: [Story]) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Stamp("Filter", color: .ink)
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
                                    .foregroundStyle(isActive ? Color.ground.opacity(0.8) : Color.muted)
                                if isActive {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold))
                                }
                            }
                            .foregroundStyle(isActive ? Color.ground : Color.ink)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(isActive ? Color.ink : .clear, in: Capsule())
                            .overlay(
                                Capsule().strokeBorder(
                                    isActive ? .clear : Color.hairMid,
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

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.muted)
            TextField(
                "",
                text: $searchText,
                prompt: Text("SEARCH THESE DAYS")
                    .font(.apparatus(11))
                    .foregroundStyle(Color.muted.opacity(0.8))
            )
            .font(.apparatus(12))
            .foregroundStyle(Color.ink)
            .tint(.ink)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.muted)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .overlay(
            RoundedRectangle(cornerRadius: 3)
                .strokeBorder(Color.hairMid, lineWidth: 1)
        )
    }

    // A zero-match narrowing keeps its frame (web grammar).
    private func emptyFilterBlock(_ label: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Apparatus("Filter · \(label)", size: 10.5)
                .foregroundStyle(Color.muted)
            Text("No matches in these days.")
                .font(.prose(15))
                .foregroundStyle(Color.inkSoft)
            Button {
                activeFilterID = nil
                searchText = ""
            } label: {
                Apparatus("Clear", size: 11, medium: true)
                    .foregroundStyle(Color.ground)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.ink, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 14)
        .overlay(alignment: .top) { Rectangle().fill(Color.hairSoft).frame(height: 0.5) }
        .overlay(alignment: .bottom) { Rectangle().fill(Color.hairSoft).frame(height: 0.5) }
    }

    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(.ink)
            Apparatus("Opening the edition", size: 11)
                .foregroundStyle(Color.muted)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 36))
                .foregroundStyle(Color.muted)
            Text(message)
                .font(.prose(15))
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.inkSoft)
            Button {
                state = .loading
                Task { await load() }
            } label: {
                Apparatus("Try again", size: 11, medium: true)
                    .foregroundStyle(Color.ground)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.ink, in: Capsule())
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

    private func formatDDMMYYYY(_ day: String) -> String {
        let parts = day.split(separator: "-")
        guard parts.count == 3 else { return day }
        return "\(parts[2]).\(parts[1]).\(parts[0])"
    }
}

// The departments bar, the web's SectionNav in the app: three equal cells in
// display caps between hairlines, the current one ink at full strength on a
// 2pt gold baseline. Bottom placement is the mobile convention for "this
// changes where you are".
struct SectionSwitch: View {
    @Binding var selection: Vertical

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Color.hair).frame(height: 0.5)
            HStack(spacing: 0) {
                ForEach(Vertical.allCases) { vertical in
                    let isCurrent = vertical == selection
                    Button {
                        selection = vertical
                    } label: {
                        VStack(spacing: 0) {
                            Text(vertical.navTitle.uppercased())
                                .font(.display(11.5))
                                .kerning(1.1)
                                .foregroundStyle(isCurrent ? Color.ink : Color.muted)
                                .frame(maxWidth: .infinity, minHeight: 46)
                            Rectangle()
                                .fill(isCurrent ? Color.goldSoft : .clear)
                                .frame(height: 2)
                        }
                    }
                    .buttonStyle(.plain)
                    if vertical != Vertical.allCases.last {
                        Rectangle()
                            .fill(Color.hairSoft)
                            .frame(width: 0.5, height: 30)
                    }
                }
            }
            .background(Color.ground)
        }
        .background(Color.ground)
    }
}

#Preview {
    SectionView(vertical: .ai, selection: .constant(.ai), deepLink: .constant(nil))
}
