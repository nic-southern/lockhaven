import "package:flutter/material.dart";
import "package:lockhaven_field/screens/find_scan_screen.dart";
import "package:lockhaven_field/screens/sites_screen.dart";
import "package:lockhaven_field/state/app_state.dart";

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.state});

  final AppState state;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [
      SitesScreen(state: widget.state),
      FindScanScreen(state: widget.state),
    ];

    return Scaffold(
      body: pages[index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.place_outlined),
            selectedIcon: Icon(Icons.place),
            label: "Sites",
          ),
          NavigationDestination(
            icon: Icon(Icons.qr_code_scanner_outlined),
            selectedIcon: Icon(Icons.qr_code_scanner),
            label: "Find",
          ),
        ],
      ),
    );
  }
}
