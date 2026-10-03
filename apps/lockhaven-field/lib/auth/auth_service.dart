import "dart:convert";
import "dart:io";
import "dart:math";

import "package:lockhaven_field/config.dart";
import "package:lockhaven_field/hub/hub_client.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:path_provider/path_provider.dart";
import "package:url_launcher/url_launcher.dart";

String normalizeHubBaseUrl(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return "";
  return trimmed.replaceAll(RegExp(r"/$"), "");
}

class HubPrefs {
  Future<File> _file() async {
    final dir = await getApplicationSupportDirectory();
    return File("${dir.path}/hub_base_url.txt");
  }

  Future<String?> read() async {
    try {
      final file = await _file();
      if (!await file.exists()) return null;
      final value = normalizeHubBaseUrl(await file.readAsString());
      return value.isEmpty ? null : value;
    } catch (_) {
      return null;
    }
  }

  Future<void> write(String url) async {
    final value = normalizeHubBaseUrl(url);
    if (value.isEmpty) return;
    final file = await _file();
    await file.parent.create(recursive: true);
    await file.writeAsString(value);
  }
}

class SessionStore {
  Future<File> _file() async {
    final dir = await getApplicationSupportDirectory();
    return File("${dir.path}/field_session.json");
  }

  Future<StoredSession?> read() async {
    try {
      final file = await _file();
      if (!await file.exists()) return null;
      final json = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
      return StoredSession.fromJson(json);
    } catch (_) {
      return null;
    }
  }

  Future<void> write(StoredSession session) async {
    final file = await _file();
    await file.parent.create(recursive: true);
    await file.writeAsString(jsonEncode(session.toJson()));
    if (!Platform.isWindows) {
      await Process.run("chmod", ["600", file.path]);
    }
  }

  Future<void> clear() async {
    try {
      final file = await _file();
      if (await file.exists()) {
        await file.delete();
      }
    } catch (_) {
      // Ignore wipe failures on sign-out.
    }
  }
}

class StoredSession {
  const StoredSession({
    required this.token,
    required this.expiresAt,
    required this.user,
    required this.hubBaseUrl,
  });

  final String token;
  final DateTime expiresAt;
  final FieldUser user;
  final String hubBaseUrl;

  bool get isExpired => expiresAt.isBefore(DateTime.now());

  Map<String, dynamic> toJson() => {
        "token": token,
        "expiresAt": expiresAt.toIso8601String(),
        "hubBaseUrl": hubBaseUrl,
        "user": {
          "id": user.id,
          "email": user.email,
          "name": user.name,
        },
      };

  factory StoredSession.fromJson(Map<String, dynamic> json) {
    return StoredSession(
      token: json["token"] as String,
      expiresAt: DateTime.parse(json["expiresAt"] as String),
      hubBaseUrl: json["hubBaseUrl"] as String? ??
          FieldConfig.fromEnvironment().hubBaseUrl,
      user: FieldUser.fromJson(json["user"] as Map<String, dynamic>),
    );
  }
}

class AuthService {
  AuthService({
    required this.config,
    SessionStore? store,
    HubPrefs? hubPrefs,
  })  : store = store ?? SessionStore(),
        hubPrefs = hubPrefs ?? HubPrefs();

  final FieldConfig config;
  final SessionStore store;
  final HubPrefs hubPrefs;

  HubClient clientFor(StoredSession? session) {
    return HubClient(
      baseUrl: session?.hubBaseUrl ?? config.hubBaseUrl,
      getToken: () async => session?.token,
    );
  }

  Future<StoredSession?> restore() async {
    final session = await store.read();
    if (session == null || session.isExpired) {
      await store.clear();
      return null;
    }
    return session;
  }

  Future<StoredSession> signInWithBrowser({String? hubBaseUrl}) async {
    final base = normalizeHubBaseUrl(hubBaseUrl ?? config.hubBaseUrl);
    if (base.isEmpty) {
      throw HubException("Enter the Console address before signing in.");
    }
    final parsed = Uri.tryParse(base);
    if (parsed == null ||
        !(parsed.isScheme("https") || parsed.isScheme("http"))) {
      throw HubException("Console address must start with https:// or http://.");
    }

    final loopback = LoopbackAuthServer();
    final redirectUri = await loopback.start();
    final state = _randomState();
    final authUrl = Uri.parse("$base/field/auth").replace(
      queryParameters: {
        "redirect_uri": redirectUri.toString(),
        "state": state,
      },
    );

    final launched = await launchUrl(
      authUrl,
      mode: LaunchMode.externalApplication,
    );
    if (!launched) {
      await loopback.stop();
      throw HubException("Could not open the system browser.");
    }

    late final Uri callback;
    try {
      callback = await loopback.waitForCallback();
    } catch (error) {
      await loopback.stop();
      throw HubException(
        "Sign-in timed out or was cancelled. Try again.",
      );
    }

    final code = callback.queryParameters["code"];
    final returnedState = callback.queryParameters["state"];
    if (code == null || code.isEmpty) {
      throw HubException("Sign-in did not return a code.");
    }
    if (returnedState != state) {
      throw HubException("Sign-in state did not match. Try again.");
    }

    final client = HubClient(
      baseUrl: base,
      getToken: () async => null,
    );
    try {
      final exchanged = await client.exchangeAuthCode(code);
      final session = StoredSession(
        token: exchanged.token,
        expiresAt: exchanged.expiresAt,
        user: exchanged.user,
        hubBaseUrl: base,
      );
      await store.write(session);
      await hubPrefs.write(base);
      return session;
    } finally {
      client.close();
    }
  }

  Future<void> signOut(StoredSession? session) async {
    if (session != null) {
      final client = clientFor(session);
      try {
        await client.revokeSession();
      } catch (_) {
        // Local wipe still proceeds.
      } finally {
        client.close();
      }
    }
    await store.clear();
  }

  String _randomState() {
    final random = Random.secure();
    final bytes = List<int>.generate(24, (_) => random.nextInt(256));
    return base64UrlEncode(bytes).replaceAll("=", "");
  }
}
