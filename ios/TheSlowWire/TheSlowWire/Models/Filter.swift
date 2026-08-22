import Foundation

// Swift port of the site's quick filters (src/lib/feed/filter.ts): the same
// five chips per section, the same synonyms, the same matching semantics.
// A .substring matches case-insensitively anywhere; a .word carries the
// site's \b guard for short tokens that hide inside longer words ("meta" in
// "metadata", "aws" in "awsome", "workers" keeps its accepted false positive).
struct FilterDef: Identifiable, Equatable {
    enum Synonym: Equatable {
        case substring(String)
        case word(String)
    }

    let id: String
    let label: String
    let synonyms: [Synonym]

    // Same haystack as the site: title + summary + sourceName, lowercased once.
    func matches(_ article: FeedArticle) -> Bool {
        let haystack = "\(article.title) \(article.summary) \(article.sourceName)".lowercased()
        return synonyms.contains { synonym in
            switch synonym {
            case .substring(let s):
                haystack.contains(s)
            case .word(let w):
                haystack.range(of: "\\b\(w)\\b", options: .regularExpression) != nil
            }
        }
    }
}

extension FilterDef {
    static func chips(for vertical: Vertical) -> [FilterDef] {
        switch vertical {
        case .ai:
            [
                FilterDef(id: "anthropic", label: "Anthropic", synonyms: [.substring("anthropic"), .substring("claude")]),
                // "gpt-" keeps its hyphen on purpose, same as the site: a bare
                // "gpt" would match inside unrelated words like "widgetgpt".
                FilterDef(id: "openai", label: "OpenAI", synonyms: [.substring("openai"), .substring("chatgpt"), .substring("gpt-")]),
                FilterDef(id: "google", label: "Google", synonyms: [.substring("google"), .substring("gemini"), .substring("deepmind")]),
                FilterDef(id: "meta", label: "Meta", synonyms: [.word("meta"), .substring("llama")]),
                FilterDef(id: "qwen", label: "Qwen", synonyms: [.substring("qwen"), .substring("alibaba")]),
            ]
        case .design:
            [
                FilterDef(id: "figma", label: "Figma", synonyms: [.substring("figma")]),
                FilterDef(id: "adobe", label: "Adobe", synonyms: [.substring("adobe"), .substring("photoshop"), .substring("illustrator")]),
                FilterDef(id: "apple", label: "Apple", synonyms: [.word("apple"), .substring("ios"), .substring("human interface")]),
                FilterDef(id: "google", label: "Google", synonyms: [.substring("google"), .substring("material design"), .substring("android")]),
                FilterDef(id: "framer", label: "Framer", synonyms: [.word("framer")]),
            ]
        case .cloud:
            [
                FilterDef(id: "aws", label: "AWS", synonyms: [.word("aws"), .substring("amazon web services"), .substring("bedrock"), .word("lambda")]),
                FilterDef(id: "azure", label: "Azure", synonyms: [.substring("azure"), .substring("microsoft")]),
                FilterDef(id: "gcp", label: "GCP", synonyms: [.word("gcp"), .substring("google cloud")]),
                FilterDef(id: "cloudflare", label: "Cloudflare", synonyms: [.substring("cloudflare"), .word("workers")]),
                FilterDef(id: "kubernetes", label: "Kubernetes", synonyms: [.substring("kubernetes"), .substring("k8s"), .substring("cncf")]),
            ]
        }
    }
}
