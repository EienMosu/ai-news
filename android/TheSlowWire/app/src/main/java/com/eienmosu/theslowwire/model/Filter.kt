package com.eienmosu.theslowwire.model

/**
 * Kotlin port of the site's quick filters (src/lib/feed/filter.ts): the same
 * five chips per section, the same synonyms, the same matching semantics.
 *
 * A Substring matches case-insensitively anywhere; a Word carries the site's
 * \b guard for short tokens that would otherwise hide inside longer words
 * ("meta" in "metadata", "aws" in "awsome"). "workers" keeps the accepted
 * false positive the spec calls out ("co-workers"), deliberately, so all three
 * surfaces narrow to exactly the same set.
 */
data class FilterDef(
    val id: String,
    val label: String,
    val synonyms: List<Synonym>,
) {
    sealed interface Synonym {
        data class Substring(val value: String) : Synonym
        data class Word(val value: String) : Synonym
    }

    /** Same haystack as the site: title + summary + sourceName, lowercased once. */
    fun matches(article: FeedArticle): Boolean {
        val haystack = "${article.title} ${article.summary} ${article.sourceName}".lowercase()
        return synonyms.any { synonym ->
            when (synonym) {
                is Synonym.Substring -> haystack.contains(synonym.value)
                is Synonym.Word -> wordRegex(synonym.value).containsMatchIn(haystack)
            }
        }
    }

    companion object {
        // Regex compilation is not free and these run once per article per
        // keystroke, so each pattern is built once and kept.
        private val wordCache = mutableMapOf<String, Regex>()

        private fun wordRegex(word: String): Regex =
            wordCache.getOrPut(word) { Regex("\\b${Regex.escape(word)}\\b") }

        private fun sub(value: String) = Synonym.Substring(value)
        private fun word(value: String) = Synonym.Word(value)

        fun chips(vertical: Vertical): List<FilterDef> = when (vertical) {
            Vertical.AI -> listOf(
                FilterDef("anthropic", "Anthropic", listOf(sub("anthropic"), sub("claude"))),
                // "gpt-" keeps its hyphen on purpose, same as the site: a bare
                // "gpt" would match inside unrelated words like "widgetgpt".
                FilterDef("openai", "OpenAI", listOf(sub("openai"), sub("chatgpt"), sub("gpt-"))),
                FilterDef("google", "Google", listOf(sub("google"), sub("gemini"), sub("deepmind"))),
                FilterDef("meta", "Meta", listOf(word("meta"), sub("llama"))),
                FilterDef("qwen", "Qwen", listOf(sub("qwen"), sub("alibaba"))),
            )
            Vertical.DESIGN -> listOf(
                FilterDef("figma", "Figma", listOf(sub("figma"))),
                FilterDef("adobe", "Adobe", listOf(sub("adobe"), sub("photoshop"), sub("illustrator"))),
                FilterDef("apple", "Apple", listOf(word("apple"), sub("ios"), sub("human interface"))),
                FilterDef("google", "Google", listOf(sub("google"), sub("material design"), sub("android"))),
                FilterDef("framer", "Framer", listOf(word("framer"))),
            )
            Vertical.CLOUD -> listOf(
                FilterDef("aws", "AWS", listOf(word("aws"), sub("amazon web services"), sub("bedrock"), word("lambda"))),
                FilterDef("azure", "Azure", listOf(sub("azure"), sub("microsoft"))),
                FilterDef("gcp", "GCP", listOf(word("gcp"), sub("google cloud"))),
                FilterDef("cloudflare", "Cloudflare", listOf(sub("cloudflare"), word("workers"))),
                FilterDef("kubernetes", "Kubernetes", listOf(sub("kubernetes"), sub("k8s"), sub("cncf"))),
            )
        }

        /** The search field's twin of a chip: a free-text def with the same
         *  substring semantics, narrowing the loaded days only. */
        fun freeText(query: String): FilterDef? {
            val text = query.trim()
            if (text.isEmpty()) return null
            return FilterDef(text, text, listOf(sub(text.lowercase())))
        }
    }
}
