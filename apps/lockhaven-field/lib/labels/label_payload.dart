/// Label payload helpers matching `@nms/shared` CSV / QR rules.
library;

const assetLabelCsvSchemaVersion = 1;

const assetLabelCsvColumnKeys = [
  "schema_version",
  "tag",
  "serial",
  "company_name",
  "qr_text",
  "site_name",
];

/// Plain-text QR payload: tracking tag first; serial on a second line when set.
String assetLabelQrPayload({required String tag, String? serial}) {
  final trimmedTag = tag.trim();
  if (trimmedTag.isEmpty) return "";
  final trimmedSerial = serial?.trim() ?? "";
  if (trimmedSerial.isEmpty) return trimmedTag;
  return "$trimmedTag\n$trimmedSerial";
}

class AssetLabelCsvRow {
  const AssetLabelCsvRow({
    required this.tag,
    required this.qrText,
    this.serial,
    this.companyName,
    this.siteName,
  });

  final String tag;
  final String qrText;
  final String? serial;
  final String? companyName;
  final String? siteName;

  static AssetLabelCsvRow? build({
    required String tag,
    String? serial,
    String? companyName,
    String? siteName,
  }) {
    final qrText = assetLabelQrPayload(tag: tag, serial: serial);
    if (qrText.isEmpty) return null;
    return AssetLabelCsvRow(
      tag: tag.trim(),
      serial: _blankToNull(serial),
      companyName: _blankToNull(companyName),
      qrText: qrText,
      siteName: _blankToNull(siteName),
    );
  }
}

String? _blankToNull(String? value) {
  final trimmed = value?.trim() ?? "";
  return trimmed.isEmpty ? null : trimmed;
}

String _escapeCsvCell(String value) {
  if (RegExp(r'[",\r\n]').hasMatch(value)) {
    return '"${value.replaceAll('"', '""')}"';
  }
  return value;
}

String formatAssetLabelCsv(List<AssetLabelCsvRow> rows) {
  final header = assetLabelCsvColumnKeys.join(",");
  final lines = rows.map((row) {
    return [
      "$assetLabelCsvSchemaVersion",
      row.tag,
      row.serial ?? "",
      row.companyName ?? "",
      row.qrText,
      row.siteName ?? "",
    ].map(_escapeCsvCell).join(",");
  });
  return "${([header, ...lines]).join("\r\n")}\r\n";
}
