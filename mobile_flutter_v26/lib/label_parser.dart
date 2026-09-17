import 'label_model.dart';

class LabelParser {
  static String? _first(String text, List<RegExp> patterns) {
    for (final p in patterns) {
      final m = p.firstMatch(text);
      if (m != null && m.groupCount >= 1) {
        final v = m.group(1)?.trim();
        if (v != null && v.isNotEmpty) return v;
      }
    }
    return null;
  }

  static ParsedLabel parseWms(String raw) {
    final t = raw.replaceAll('\u00a0', ' ');
    return ParsedLabel(
      inboundNo: _first(t, [
        RegExp(r'입고\s*번호\s*[:：]?\s*(\d{6,12})', caseSensitive: false),
        RegExp(r'\b(26\d{6})\b'),
      ]),
      product: _first(t, [RegExp(r'품\s*명\s*[:：]?\s*([^\n\r]+)')]),
      itemCode: _first(t, [
        RegExp(r'품목\s*코드\s*[:：]?\s*([A-Z0-9-]{4,20})', caseSensitive: false),
      ]),
      qty: _first(t, [
        RegExp(r'(?:수량|수)\s*[:：]?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:EA|개)?)', caseSensitive: false),
      ]),
      supplier: _first(t, [RegExp(r'공급\s*업체\s*[:：]?\s*([^\n\r]+)')]),
      inboundDate: _first(t, [
        RegExp(r'입고\s*일자\s*[:：]?\s*(20\d{6})'),
        RegExp(r'입고\s*일자\s*[:：]?\s*(20\d{2}[-./]\d{1,2}[-./]\d{1,2})'),
      ]),
      expiryDate: _first(t, [
        RegExp(r'사용\s*기한\s*[:：]?\s*(20\d{2}[-./]\d{1,2}[-./]\d{1,2})'),
      ]),
      containerNo: _first(t, [
        RegExp(r'용기\s*번호\s*[:：]?\s*([0-9]{1,5}\s*/\s*[0-9]{1,5})'),
        RegExp(r'용기\s*번호\s*[:：]?\s*([0-9]{1,5})'),
      ]),
    );
  }

  static ParsedLabel parseVendor(String raw) {
    final t = raw.replaceAll('\u00a0', ' ');
    return ParsedLabel(
      product: _first(t, [RegExp(r'(?:품명|제품명)\s*[:：]?\s*([^\n\r]+)')]),
      qty: _first(t, [
        RegExp(r'(?:수량|QTY)\s*[:：]?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:EA|개)?)', caseSensitive: false),
      ]),
      lotNo: _first(t, [
        RegExp(r'(?:LOT|LOT\s*NO|로트)\s*[:：#.-]?\s*([A-Z0-9-]{3,30})', caseSensitive: false),
      ]),
      palletNo: _first(t, [
        RegExp(r'(?:P/?L|PALLET|P\.?NO|파레트)\s*(?:NO)?\s*[:：#.-]?\s*([A-Z0-9-]{2,30})', caseSensitive: false),
      ]),
      prodDate: _first(t, [
        RegExp(r'(?:생산일자|제조일자|MFG)\s*[:：]?\s*(20\d{2}[-./]?\d{2}[-./]?\d{2})', caseSensitive: false),
      ]),
      prodTime: _first(t, [
        RegExp(r'(?:생산시간|TIME)\s*[:：]?\s*([0-2]?\d[:：][0-5]\d(?::[0-5]\d)?)', caseSensitive: false),
      ]),
      line: _first(t, [
        RegExp(r'(?:LINE|라인)\s*[:：#.-]?\s*([A-Z0-9-]{1,20})', caseSensitive: false),
      ]),
    );
  }
}
