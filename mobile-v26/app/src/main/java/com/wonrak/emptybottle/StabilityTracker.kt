package com.wonrak.emptybottle

class StabilityTracker(private val requiredHits: Int = 3) {
    private data class Vote(var value: String = "", var hits: Int = 0)
    private val votes = mutableMapOf<String, Vote>()

    fun reset() = votes.clear()

    fun stable(key: String, value: String?): String? {
        if (value.isNullOrBlank()) return null
        val normalized = value.trim().replace(Regex("\\s+"), " ")
        val vote = votes.getOrPut(key) { Vote() }
        if (vote.value == normalized) vote.hits++ else {
            vote.value = normalized
            vote.hits = 1
        }
        return if (vote.hits >= requiredHits) vote.value else null
    }
}
