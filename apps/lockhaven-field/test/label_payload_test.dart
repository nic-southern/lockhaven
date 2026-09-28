import "package:flutter_test/flutter_test.dart";
import "package:lockhaven_field/labels/label_payload.dart";

void main() {
  test("assetLabelQrPayload puts serial on a second line", () {
    expect(assetLabelQrPayload(tag: "LH-ABC123"), "LH-ABC123");
    expect(
      assetLabelQrPayload(tag: "LH-ABC123", serial: "SN-9"),
      "LH-ABC123\nSN-9",
    );
    expect(assetLabelQrPayload(tag: "  ", serial: "SN-9"), "");
  });

  test("formatAssetLabelCsv matches helper schema v1", () {
    final row = AssetLabelCsvRow.build(
      tag: "LH-ABC123",
      serial: 'SN,"9"',
      companyName: "NewMarketEntertainment",
      siteName: "Main",
    );
    expect(row, isNotNull);
    final csv = formatAssetLabelCsv([row!]);
    expect(
      csv,
      'schema_version,tag,serial,company_name,qr_text,site_name\r\n'
      '1,LH-ABC123,"SN,""9""",NewMarketEntertainment,"LH-ABC123\nSN,""9""",Main\r\n',
    );
  });
}
