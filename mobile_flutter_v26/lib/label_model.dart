enum LabelMode { wms, vendor }

class ParsedLabel {
  final String? inboundNo;
  final String? product;
  final String? itemCode;
  final String? qty;
  final String? supplier;
  final String? inboundDate;
  final String? expiryDate;
  final String? containerNo;
  final String? lotNo;
  final String? palletNo;
  final String? prodDate;
  final String? prodTime;
  final String? line;

  const ParsedLabel({
    this.inboundNo,
    this.product,
    this.itemCode,
    this.qty,
    this.supplier,
    this.inboundDate,
    this.expiryDate,
    this.containerNo,
    this.lotNo,
    this.palletNo,
    this.prodDate,
    this.prodTime,
    this.line,
  });
}
