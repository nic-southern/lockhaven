import "dart:typed_data";

import "package:image/image.dart" as img;
import "package:lockhaven_field/labels/label_payload.dart";
import "package:qr/qr.dart";

/// Locked 18 mm layout matching `scripts/print-asset-labels.sh`.
const labelWidth = 210;
const labelHeight = 120;
const labelQrSize = 92;
const labelTextX = 104;

/// Build a 1-bit PNG (QR left + tag / serial / company) for `ptouch-print --image`.
Uint8List renderAssetLabelPng({
  required String tag,
  String? serial,
  String? companyName,
  String? qrText,
}) {
  final payload = (qrText ?? assetLabelQrPayload(tag: tag, serial: serial)).trim();
  if (payload.isEmpty) {
    throw ArgumentError("QR payload is empty");
  }

  final canvas = img.Image(
    width: labelWidth,
    height: labelHeight,
    numChannels: 1,
  );
  img.fill(canvas, color: img.ColorUint8.rgb(255, 255, 255));

  _pasteQr(canvas, payload, x: 4, y: 14, size: labelQrSize);

  final maxText = labelWidth - labelTextX - 2;
  final tagLine = _fit(tag.trim().isEmpty ? "—" : tag.trim(), img.arial14, maxText);
  final serialLine = _fit(
    (serial ?? "").trim().isEmpty ? "—" : serial!.trim(),
    img.arial14,
    maxText,
  );
  final companyLine = _fit(
    (companyName ?? "").trim().isEmpty ? "—" : companyName!.trim(),
    img.arial14,
    maxText,
  );

  img.drawString(
    canvas,
    tagLine,
    font: img.arial14,
    x: labelTextX,
    y: 16,
    color: img.ColorUint8.rgb(0, 0, 0),
  );
  img.drawString(
    canvas,
    serialLine,
    font: img.arial14,
    x: labelTextX,
    y: 48,
    color: img.ColorUint8.rgb(0, 0, 0),
  );
  img.drawString(
    canvas,
    companyLine,
    font: img.arial14,
    x: labelTextX,
    y: 76,
    color: img.ColorUint8.rgb(0, 0, 0),
  );

  // ptouch-print wants a 2-color PNG.
  final mono = canvas.convert(numChannels: 1);
  return Uint8List.fromList(img.encodePng(mono));
}

void _pasteQr(
  img.Image canvas,
  String data, {
  required int x,
  required int y,
  required int size,
}) {
  final qrCode = QrCode(
    payload: QrPayload.fromString(data),
    errorCorrectLevel: QrErrorCorrectLevel.medium,
  );
  final qrImage = QrImage(qrCode);
  final modules = qrImage.moduleCount;
  final scale = size / modules;
  for (var row = 0; row < modules; row += 1) {
    for (var col = 0; col < modules; col += 1) {
      if (!qrImage.isDark(row, col)) continue;
      final px = x + (col * scale).floor();
      final py = y + (row * scale).floor();
      final pw = ((col + 1) * scale).ceil() - (col * scale).floor();
      final ph = ((row + 1) * scale).ceil() - (row * scale).floor();
      img.fillRect(
        canvas,
        x1: px,
        y1: py,
        x2: px + pw - 1,
        y2: py + ph - 1,
        color: img.ColorUint8.rgb(0, 0, 0),
      );
    }
  }
}

String _fit(String text, img.BitmapFont font, int maxWidth) {
  if (_stringWidth(text, font) <= maxWidth) return text;
  const ellipsis = "…";
  var trimmed = text;
  while (trimmed.isNotEmpty &&
      _stringWidth("$trimmed$ellipsis", font) > maxWidth) {
    trimmed = trimmed.substring(0, trimmed.length - 1);
  }
  return trimmed.isEmpty ? ellipsis : "$trimmed$ellipsis";
}

int _stringWidth(String text, img.BitmapFont font) {
  var width = 0;
  for (final unit in text.codeUnits) {
    final ch = font.characters[unit];
    width += ch?.xAdvance ?? font.base ~/ 2;
  }
  return width;
}
