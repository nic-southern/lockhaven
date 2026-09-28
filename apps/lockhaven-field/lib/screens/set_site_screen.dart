import "package:flutter/material.dart";
import "package:lockhaven_field/state/app_state.dart";

/// Full-page site picker for asset / container site reassignment.
class SetSiteScreen extends StatelessWidget {
  const SetSiteScreen({
    super.key,
    required this.state,
    required this.organizationId,
    this.currentSiteId,
    this.isContainer = false,
  });

  final AppState state;
  final String organizationId;
  final String? currentSiteId;
  final bool isContainer;

  @override
  Widget build(BuildContext context) {
    final sites = state.sites
        .where((site) => site.organizationId == organizationId)
        .toList();

    return Scaffold(
      appBar: AppBar(
        title: Text(isContainer ? "Set container site" : "Set site"),
      ),
      body: sites.isEmpty
          ? const Center(child: Text("No sites available"))
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              itemCount: sites.length,
              separatorBuilder: (_, _) => const SizedBox(height: 4),
              itemBuilder: (context, index) {
                final site = sites[index];
                final selected = site.id == currentSiteId;
                final address = site.address?.trim();
                return ListTile(
                  leading: Icon(
                    selected ? Icons.place : Icons.place_outlined,
                  ),
                  title: Text(site.name),
                  subtitle: address == null || address.isEmpty
                      ? null
                      : Text(address),
                  trailing: selected ? const Icon(Icons.check) : null,
                  onTap: () => Navigator.of(context).pop(site),
                );
              },
            ),
    );
  }
}
