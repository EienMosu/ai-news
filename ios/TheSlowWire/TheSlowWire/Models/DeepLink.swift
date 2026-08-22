import Foundation

// theslowwire://article/<section>/<urlHash> — the app-scheme mirror of the
// site's /article/<section>/<hash> route. For a custom scheme the first path
// segment lands in `host`, the rest in `pathComponents` after the leading "/".
struct DeepLinkTarget: Equatable {
    let section: Vertical
    let urlHash: String

    static func parse(_ url: URL) -> DeepLinkTarget? {
        guard url.scheme == "theslowwire", url.host() == "article" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 2,
              let section = Vertical(rawValue: parts[0]),
              !parts[1].isEmpty
        else { return nil }
        return DeepLinkTarget(section: section, urlHash: parts[1])
    }
}
