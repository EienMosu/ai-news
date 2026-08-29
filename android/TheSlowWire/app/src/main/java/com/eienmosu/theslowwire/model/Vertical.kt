package com.eienmosu.theslowwire.model

/** The three worlds the product covers. `id` is the API's own section value. */
enum class Vertical(val id: String, val navTitle: String) {
    AI("ai", "AI News"),
    DESIGN("design", "Design News"),
    CLOUD("cloud", "Cloud News");

    companion object {
        /** The section behind a stored or deep-linked string, AI when unknown —
         *  an unrecognised section must land the reader somewhere real. */
        fun from(id: String?): Vertical =
            entries.firstOrNull { it.id == id } ?: AI
    }
}
