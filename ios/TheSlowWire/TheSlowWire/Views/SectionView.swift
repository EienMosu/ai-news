import SwiftUI

struct SectionView: View {
    let vertical: Vertical

    @State private var state = LoadState.loading

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
                    feedList(days)
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

    private func feedList(_ days: [FeedResult]) -> some View {
        List {
            // `day` is nullable in the contract, so it cannot be the row
            // identity; the position in the newest-first response is.
            ForEach(days.indices, id: \.self) { index in
                let result = days[index]
                Section(formatDay(result.day)) {
                    ForEach(result.articles) { article in
                        NavigationLink(value: article) {
                            ArticleRow(article: article, accent: vertical.color)
                        }
                        .listRowBackground(Color.paper)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .refreshable { await load() }
        .navigationDestination(for: FeedArticle.self) { article in
            ArticleView(article: article, accent: vertical.color)
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
