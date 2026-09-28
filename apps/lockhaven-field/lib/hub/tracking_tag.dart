import "dart:convert";

/// Mirrors `@nms/shared` tracking-tag suggestion so the field app can fill
/// tags even when Hub `assets.suggestTag` is unreachable.
const trackingAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const defaultTrackingTagPrefix = "LH";

String normalizeTrackingTagPrefix(String? value) {
  final trimmed = (value ?? "").trim().toUpperCase();
  if (trimmed.isEmpty || trimmed.length > 8) {
    return defaultTrackingTagPrefix;
  }
  if (!RegExp(r"^[A-Z0-9]+$").hasMatch(trimmed)) {
    return defaultTrackingTagPrefix;
  }
  return trimmed;
}

/// JavaScript `Math.imul` (signed 32-bit multiply).
int _imul(int a, int b) {
  final ah = (a >> 16) & 0xffff;
  final al = a & 0xffff;
  final bh = (b >> 16) & 0xffff;
  final bl = b & 0xffff;
  final high = ((ah * bl + al * bh) & 0xffff) << 16;
  return _toInt32(high + al * bl);
}

int _toInt32(int value) {
  return value.toSigned(32);
}

int _toUint32(int value) {
  return value.toUnsigned(32);
}

String generateTrackingTag(
  String seed, {
  int length = 6,
  String prefix = defaultTrackingTagPrefix,
}) {
  var hash = 2166136261;
  for (var index = 0; index < seed.length; index += 1) {
    hash = _toInt32(hash ^ seed.codeUnitAt(index));
    hash = _imul(hash, 16777619);
  }
  var value = _toUint32(hash);
  var body = "";
  for (var index = 0; index < length; index += 1) {
    body += trackingAlphabet[value % trackingAlphabet.length];
    value = value ~/ trackingAlphabet.length;
    if (value == 0) {
      value = _toUint32(hash) >> (index + 1);
      if (value == 0) value = 1;
    }
  }
  return "${normalizeTrackingTagPrefix(prefix)}-$body";
}

String suggestAssetTrackingTag({
  required String deviceId,
  String? hostname,
  String? serialNumber,
  int attempt = 0,
  String? prefix,
}) {
  final seed = [
    deviceId,
    hostname ?? "",
    serialNumber ?? "",
    "$attempt",
  ].join("|");
  return generateTrackingTag(
    seed,
    prefix: prefix ?? defaultTrackingTagPrefix,
  );
}

/// Parse tRPC / Zod error payloads into a short operator-facing message.
String humanizeHubError(Object? raw, {String fallback = "Request failed."}) {
  if (raw == null) return fallback;
  if (raw is! String) return raw.toString();
  final trimmed = raw.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    return trimmed.isEmpty ? fallback : trimmed;
  }
  try {
    final decoded = jsonDecode(trimmed);
    if (decoded is List && decoded.isNotEmpty) {
      final first = decoded.first;
      if (first is Map && first["message"] is String) {
        return first["message"] as String;
      }
    }
    if (decoded is Map && decoded["message"] is String) {
      return decoded["message"] as String;
    }
  } catch (_) {
    // Fall through.
  }
  return fallback;
}
