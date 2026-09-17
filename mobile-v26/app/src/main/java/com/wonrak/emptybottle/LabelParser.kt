package com.wonrak.emptybottle

data class ParsedLabel(
    val inboundNo: String? = null,
    val product: String? = null,
    val itemCode: String? = null,
    val qty: String? = null,
    val supplier: String? = null,
    val inboundDate: String? = null,
    val expiryDate: String? = null,
    val containerNo: String? = null,
    val lotNo: String? = null,
    val palletNo: String? = null,
    val prodDate: String? = null,
    val prodTime: String? = null,
    val line: String? = null,
)

object LabelParser {
    private fun first(text: String, vararg patterns: Regex): String? =
        patterns.firstNotNullOfOrNull { it.find(text)?.groupValues?.getOrNull(1)?.trim() }

    fun parseWms(raw: String): ParsedLabel {
        val t = raw.replace('\u00A0', ' ')
        return ParsedLabel(
            inboundNo = first(t,
                Regex("입고\\s*번호\\s*[:：]?\\s*(\\d{6,12})", RegexOption.IGNORE_CASE),
                Regex("\\b(26\\d{6})\\b")
            ),
            product = first(t, Regex("품\\s*명\\s*[:：]?\\s*([^\\n\\r]+)")),
            itemCode = first(t,
                Regex("품목\\s*코드\\s*[:：]?\\s*([A-Z0-9-]{4,20})", RegexOption.IGNORE_CASE)
            ),
            qty = first(t,
                Regex("(?:수량|수)\\s*[:：]?\\s*([0-9,]+(?:\\.[0-9]+)?\\s*(?:EA|개)?)", RegexOption.IGNORE_CASE)
            ),
            supplier = first(t, Regex("공급\\s*업체\\s*[:：]?\\s*([^\\n\\r]+)")),
            inboundDate = first(t,
                Regex("입고\\s*일자\\s*[:：]?\\s*(20\\d{6})"),
                Regex("입고\\s*일자\\s*[:：]?\\s*(20\\d{2}[-./]\\d{1,2}[-./]\\d{1,2})")
            ),
            expiryDate = first(t,
                Regex("사용\\s*기한\\s*[:：]?\\s*(20\\d{2}[-./]\\d{1,2}[-./]\\d{1,2})")
            ),
            containerNo = first(t,
                Regex("용기\\s*번호\\s*[:：]?\\s*([0-9]{1,5}\\s*/\\s*[0-9]{1,5})"),
                Regex("용기\\s*번호\\s*[:：]?\\s*([0-9]{1,5})")
            )
        )
    }

    fun parseVendor(raw: String): ParsedLabel {
        val t = raw.replace('\u00A0', ' ')
        return ParsedLabel(
            product = first(t, Regex("(?:품명|제품명)\\s*[:：]?\\s*([^\\n\\r]+)")),
            qty = first(t,
                Regex("(?:수량|QTY)\\s*[:：]?\\s*([0-9,]+(?:\\.[0-9]+)?\\s*(?:EA|개)?)", RegexOption.IGNORE_CASE)
            ),
            lotNo = first(t,
                Regex("(?:LOT|LOT\\s*NO|로트)\\s*[:：#.-]?\\s*([A-Z0-9-]{3,30})", RegexOption.IGNORE_CASE)
            ),
            palletNo = first(t,
                Regex("(?:P/?L|PALLET|P.NO|파레트)\\s*(?:NO)?\\s*[:：#.-]?\\s*([A-Z0-9-]{2,30})", RegexOption.IGNORE_CASE)
            ),
            prodDate = first(t,
                Regex("(?:생산일자|제조일자|MFG)\\s*[:：]?\\s*(20\\d{2}[-./]?\\d{2}[-./]?\\d{2})", RegexOption.IGNORE_CASE)
            ),
            prodTime = first(t,
                Regex("(?:생산시간|TIME)\\s*[:：]?\\s*([0-2]?\\d[:：][0-5]\\d(?::[0-5]\\d)?)", RegexOption.IGNORE_CASE)
            ),
            line = first(t,
                Regex("(?:LINE|라인)\\s*[:：#.-]?\\s*([A-Z0-9-]{1,20})", RegexOption.IGNORE_CASE)
            )
        )
    }
}
