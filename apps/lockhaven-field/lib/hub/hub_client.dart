import "dart:convert";
import "dart:io";

import "package:http/http.dart" as http;
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/hub/tracking_tag.dart";

class HubException implements Exception {
  HubException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class HubClient {
  HubClient({
    required this.baseUrl,
    required this.getToken,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  final String baseUrl;
  final Future<String?> Function() getToken;
  final http.Client _http;

  Uri _uri(String path, [Map<String, String>? query]) {
    return Uri.parse("$baseUrl$path").replace(queryParameters: query);
  }

  Future<Map<String, String>> _headers({bool jsonBody = false}) async {
    final headers = <String, String>{
      "Accept": "application/json",
    };
    if (jsonBody) {
      headers["Content-Type"] = "application/json";
    }
    final token = await getToken();
    if (token != null && token.isNotEmpty) {
      headers["Authorization"] = "Bearer $token";
    }
    return headers;
  }

  Future<dynamic> _trpcGet(String procedure, [Object? input]) async {
    final query = <String, String>{};
    if (input != null) {
      // Hub uses the default identity transformer — send the bare input
      // object, not a `{ "json": ... }` envelope.
      query["input"] = jsonEncode(input);
    }
    final response = await _http.get(
      _uri("/api/trpc/$procedure", query.isEmpty ? null : query),
      headers: await _headers(),
    );
    return _decodeTrpc(response);
  }

  Future<dynamic> _trpcPost(String procedure, Object input) async {
    final response = await _http.post(
      _uri("/api/trpc/$procedure"),
      headers: await _headers(jsonBody: true),
      body: jsonEncode(input),
    );
    return _decodeTrpc(response);
  }

  dynamic _decodeTrpc(http.Response response) {
    Map<String, dynamic>? body;
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>?;
    } catch (_) {
      body = null;
    }

    if (response.statusCode >= 400) {
      final message = _extractError(body) ??
          "Request failed (${response.statusCode}).";
      throw HubException(message, statusCode: response.statusCode);
    }

    if (body == null) {
      throw HubException("Unexpected response from Hub.");
    }

    if (body.containsKey("error")) {
      throw HubException(_extractError(body) ?? "Request failed.");
    }

    final result = body["result"];
    if (result is Map<String, dynamic>) {
      final data = result["data"];
      // Tolerate optional `{ json: ... }` envelopes from older transformers.
      if (data is Map<String, dynamic> &&
          data.length == 1 &&
          data.containsKey("json")) {
        return data["json"];
      }
      return data;
    }

    if (body.containsKey("json") && body.length <= 2) {
      return body["json"];
    }

    return body;
  }

  String? _extractError(Map<String, dynamic>? body) {
    if (body == null) return null;
    final error = body["error"];
    if (error is Map<String, dynamic>) {
      final nested = error["json"];
      if (nested is Map<String, dynamic>) {
        final message = nested["message"];
        if (message is String && message.isNotEmpty) {
          return humanizeHubError(message);
        }
      }
      final message = error["message"];
      if (message is String && message.isNotEmpty) {
        return humanizeHubError(message);
      }
    }
    final message = body["message"];
    if (message is String && message.isNotEmpty) {
      return humanizeHubError(message);
    }
    return null;
  }

  Future<FieldSessionExchange> exchangeAuthCode(String code) async {
    final response = await _http.post(
      _uri("/api/field/auth/exchange"),
      headers: await _headers(jsonBody: true),
      body: jsonEncode({"code": code}),
    );
    Map<String, dynamic>? body;
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>?;
    } catch (_) {
      body = null;
    }
    if (response.statusCode >= 400 || body == null) {
      throw HubException(
        body?["error"] as String? ?? "Sign-in could not be completed.",
        statusCode: response.statusCode,
      );
    }
    return FieldSessionExchange.fromJson(body);
  }

  Future<void> revokeSession() async {
    final response = await _http.post(
      _uri("/api/field/auth/revoke"),
      headers: await _headers(jsonBody: true),
      body: "{}",
    );
    if (response.statusCode >= 400 && response.statusCode != 404) {
      throw HubException("Could not sign out.", statusCode: response.statusCode);
    }
  }

  Future<FieldUser> me() async {
    final data = await _trpcGet("access.me") as Map<String, dynamic>?;
    if (data == null) {
      throw HubException("Sign in to continue.", statusCode: 401);
    }
    return FieldUser.fromJson(data);
  }

  Future<List<SiteSummary>> listSites() async {
    final data = await _trpcGet("sites.list");
    final list = data as List<dynamic>? ?? const [];
    return list
        .whereType<Map<String, dynamic>>()
        .map(SiteSummary.fromJson)
        .toList();
  }

  Future<List<OrganizationSummary>> listOrganizations() async {
    final data = await _trpcGet("organizations.list");
    final list = data as List<dynamic>? ?? const [];
    return list
        .whereType<Map<String, dynamic>>()
        .map(OrganizationSummary.fromJson)
        .toList();
  }

  Future<List<DeviceModelSummary>> listDeviceModels(
    String organizationId,
  ) async {
    final data = await _trpcGet("deviceModels.list", {
      "organizationId": organizationId,
    });
    final list = data as List<dynamic>? ?? const [];
    final models = list
        .whereType<Map<String, dynamic>>()
        .map(DeviceModelSummary.fromJson)
        .toList();
    models.sort(
      (a, b) => a.displayLabel.toLowerCase().compareTo(
            b.displayLabel.toLowerCase(),
          ),
    );
    return models;
  }

  Future<List<AssetSummary>> listAssetsForSite(String siteId) async {
    final data = await _trpcGet("assets.page", {
      "limit": 100,
      "filters": {
        "siteId": [siteId],
      },
    });
    return _pageItems(data);
  }

  Future<List<AssetSummary>> searchAssets(String query) async {
    final data = await _trpcGet("assets.page", {
      "limit": 50,
      "search": query,
    });
    return _pageItems(data);
  }

  Future<AssetSummary?> assetById(String id) async {
    final data = await _trpcGet("assets.byId", {"id": id});
    if (data == null) return null;
    return AssetSummary.fromJson(data as Map<String, dynamic>);
  }

  Future<List<AssetSummary>> folderChildren(String parentAssetId) async {
    final data = await _trpcGet("assets.children", {
      "parentAssetId": parentAssetId,
    });
    final list = data as List<dynamic>? ?? const [];
    return list
        .whereType<Map<String, dynamic>>()
        .map(AssetSummary.fromJson)
        .toList();
  }

  Future<String> suggestTag({
    required String organizationId,
    String? siteId,
    String? serial,
    int attempt = 0,
  }) async {
    final data = await _trpcGet("assets.suggestTag", {
      "organizationId": organizationId,
      "siteId": ?siteId,
      "serial": ?serial,
      "attempt": attempt,
    }) as Map<String, dynamic>;
    return data["tag"] as String? ?? "";
  }

  Future<AssetSummary> createAsset({
    required String organizationId,
    required String siteId,
    required String tag,
    String? serial,
    String? hostname,
    String? vendor,
    String? model,
    String? deviceModelId,
    String? notes,
    String? parentAssetId,
    bool isContainer = false,
    String status = "in_service",
  }) async {
    final data = await _trpcPost("assets.create", {
      "organizationId": organizationId,
      "siteId": siteId,
      "tag": tag,
      "serial": serial,
      "hostname": hostname,
      "vendor": vendor,
      "model": model,
      "deviceModelId": deviceModelId,
      "notes": notes,
      "parentAssetId": parentAssetId,
      "isContainer": isContainer,
      "status": status,
    });
    return AssetSummary.fromJson(data as Map<String, dynamic>);
  }

  /// Create a site folder (container). Differentiated by tag / name, not a kind.
  Future<AssetSummary> createFolder({
    required String organizationId,
    required String siteId,
    required String tag,
    String? hostname,
    String? notes,
    String status = "in_service",
  }) async {
    final data = await _trpcPost("assets.createFolder", {
      "organizationId": organizationId,
      "siteId": siteId,
      "tag": tag,
      "hostname": hostname,
      "notes": notes,
      "status": status,
    });
    return AssetSummary.fromJson(data as Map<String, dynamic>);
  }

  Future<AssetSummary> updateAsset(
    String id,
    Map<String, dynamic> fields,
  ) async {
    final data = await _trpcPost("assets.update", {
      "id": id,
      ...fields,
    });
    return AssetSummary.fromJson(data as Map<String, dynamic>);
  }

  Future<AssetSummary> setParent({
    required String childAssetId,
    String? parentAssetId,
  }) async {
    final data = await _trpcPost("assets.setParent", {
      "childAssetId": childAssetId,
      "parentAssetId": parentAssetId,
    });
    return AssetSummary.fromJson(data as Map<String, dynamic>);
  }

  List<AssetSummary> _pageItems(dynamic data) {
    if (data is Map<String, dynamic>) {
      final items = data["items"] as List<dynamic>? ?? const [];
      return items
          .whereType<Map<String, dynamic>>()
          .map(AssetSummary.fromJson)
          .toList();
    }
    if (data is List<dynamic>) {
      return data
          .whereType<Map<String, dynamic>>()
          .map(AssetSummary.fromJson)
          .toList();
    }
    return const [];
  }

  void close() {
    _http.close();
  }
}

class FieldSessionExchange {
  const FieldSessionExchange({
    required this.token,
    required this.expiresAt,
    required this.sessionId,
    required this.user,
  });

  final String token;
  final DateTime expiresAt;
  final String sessionId;
  final FieldUser user;

  factory FieldSessionExchange.fromJson(Map<String, dynamic> json) {
    return FieldSessionExchange(
      token: json["token"] as String,
      expiresAt: DateTime.parse(json["expiresAt"] as String),
      sessionId: json["sessionId"] as String,
      user: FieldUser.fromJson(json["user"] as Map<String, dynamic>),
    );
  }
}

/// Starts a loopback HTTP server and waits for Hub to redirect with ?code=.
class LoopbackAuthServer {
  HttpServer? _server;

  int? get port => _server?.port;

  Future<Uri> start() async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    return Uri.parse("http://127.0.0.1:${_server!.port}/callback");
  }

  Future<Uri> waitForCallback({
    Duration timeout = const Duration(minutes: 5),
  }) async {
    final server = _server;
    if (server == null) {
      throw StateError("Loopback server was not started.");
    }

    final request = await server.timeout(timeout).first;
    final redirect = request.uri;
    request.response
      ..statusCode = 200
      ..headers.contentType = ContentType.html
      ..write(
        "<!doctype html><html><body style='font-family:sans-serif;padding:2rem'>"
        "<h1>You can return to the app</h1>"
        "<p>Sign-in finished. Close this window.</p>"
        "</body></html>",
      );
    await request.response.close();
    await stop();
    return redirect;
  }

  Future<void> stop() async {
    await _server?.close(force: true);
    _server = null;
  }
}
