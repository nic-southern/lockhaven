import "package:flutter/foundation.dart";
import "package:lockhaven_field/auth/auth_service.dart";
import "package:lockhaven_field/config.dart";
import "package:lockhaven_field/hub/hub_client.dart";
import "package:lockhaven_field/hub/models.dart";

class AppState extends ChangeNotifier {
  AppState({FieldConfig? config, AuthService? authService})
      : config = config ?? FieldConfig.fromEnvironment(),
        auth = authService ??
            AuthService(config: config ?? FieldConfig.fromEnvironment()),
        hubBaseUrl = (config ?? FieldConfig.fromEnvironment()).hubBaseUrl;

  final FieldConfig config;
  final AuthService auth;

  String hubBaseUrl;
  StoredSession? session;
  HubClient? _client;
  String? errorMessage;
  bool busy = false;

  List<SiteSummary> sites = const [];
  List<OrganizationSummary> organizations = const [];
  bool sitesLoading = false;

  bool get isSignedIn => session != null && !(session!.isExpired);

  HubClient get client {
    final existing = _client;
    if (existing != null) return existing;
    final created = auth.clientFor(session);
    _client = created;
    return created;
  }

  Future<void> bootstrap() async {
    final savedHub = await auth.hubPrefs.read();
    if (savedHub != null && savedHub.isNotEmpty) {
      hubBaseUrl = savedHub;
    }
    session = await auth.restore();
    if (session != null) {
      hubBaseUrl = session!.hubBaseUrl;
      _client = auth.clientFor(session);
      try {
        await refreshSites();
      } catch (error) {
        if (error is HubException && error.statusCode == 401) {
          await signOut();
        }
      }
    }
    notifyListeners();
  }

  Future<void> signIn() async {
    busy = true;
    errorMessage = null;
    notifyListeners();
    try {
      session = await auth.signInWithBrowser(hubBaseUrl: hubBaseUrl);
      _client?.close();
      _client = auth.clientFor(session);
      await refreshSites();
    } catch (error) {
      errorMessage = error is HubException
          ? error.message
          : "Sign-in could not be completed.";
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    busy = true;
    notifyListeners();
    try {
      await auth.signOut(session);
    } finally {
      session = null;
      _client?.close();
      _client = null;
      sites = const [];
      organizations = const [];
      busy = false;
      notifyListeners();
    }
  }

  Future<void> refreshSites() async {
    sitesLoading = true;
    notifyListeners();
    try {
      final results = await Future.wait([
        client.listSites(),
        client.listOrganizations(),
      ]);
      sites = results[0] as List<SiteSummary>;
      organizations = results[1] as List<OrganizationSummary>;
      errorMessage = null;
    } catch (error) {
      errorMessage = error is HubException
          ? error.message
          : "Sites could not be loaded.";
      rethrow;
    } finally {
      sitesLoading = false;
      notifyListeners();
    }
  }

  OrganizationSummary? orgFor(String organizationId) {
    for (final org in organizations) {
      if (org.id == organizationId) return org;
    }
    return null;
  }

  @override
  void dispose() {
    _client?.close();
    super.dispose();
  }
}
