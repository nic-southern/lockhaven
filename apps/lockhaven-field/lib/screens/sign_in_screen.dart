import "package:flutter/material.dart";
import "package:lockhaven_field/auth/auth_service.dart";
import "package:lockhaven_field/screens/settings_screen.dart";
import "package:lockhaven_field/state/app_state.dart";

class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, required this.state});

  final AppState state;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  late final TextEditingController hubController;

  @override
  void initState() {
    super.initState();
    hubController = TextEditingController(text: widget.state.hubBaseUrl);
  }

  @override
  void dispose() {
    hubController.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    widget.state.hubBaseUrl = normalizeHubBaseUrl(hubController.text);
    await widget.state.signIn();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final state = widget.state;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        actions: [
          IconButton(
            tooltip: "Settings",
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => SettingsScreen(config: state.config),
                ),
              );
            },
            icon: const Icon(Icons.settings_outlined),
          ),
        ],
      ),
      body: Stack(
        children: [
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    scheme.primaryContainer.withValues(alpha: 0.55),
                    scheme.surface,
                    scheme.tertiaryContainer.withValues(alpha: 0.35),
                  ],
                ),
              ),
            ),
          ),
          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        "Lockhaven",
                        style: Theme.of(context).textTheme.headlineLarge,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        "Field",
                        style: Theme.of(context).textTheme.titleLarge
                            ?.copyWith(color: scheme.primary),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        "Sign in with your Console account to work sites, assets, and scans on this computer.",
                        style: Theme.of(context).textTheme.bodyLarge
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                      const SizedBox(height: 20),
                      TextField(
                        controller: hubController,
                        enabled: !state.busy,
                        keyboardType: TextInputType.url,
                        autocorrect: false,
                        decoration: const InputDecoration(
                          labelText: "Console address",
                          hintText: "https://console.example",
                        ),
                        onSubmitted: (_) {
                          if (!state.busy) _signIn();
                        },
                      ),
                      const SizedBox(height: 20),
                      FilledButton(
                        onPressed: state.busy ? null : _signIn,
                        child: state.busy
                            ? const SizedBox(
                                height: 18,
                                width: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Text("Sign in with browser"),
                      ),
                      if (state.errorMessage != null) ...[
                        const SizedBox(height: 16),
                        Text(
                          state.errorMessage!,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(color: scheme.error),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
