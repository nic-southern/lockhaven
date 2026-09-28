import "package:flutter/material.dart";
import "package:lockhaven_field/state/app_state.dart";

/// Full-page site chooser (e.g. before Add asset from Find).
class PickSiteScreen extends StatelessWidget {
  const PickSiteScreen({
    super.key,
    required this.state,
    this.title = "Choose site",
  });

  final AppState state;
  final String title;

  @override
  Widget build(BuildContext context) {
    final sites = state.sites;

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: sites.isEmpty
          ? const Center(child: Text("No sites yet"))
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              itemCount: sites.length,
              separatorBuilder: (_, _) => const SizedBox(height: 4),
              itemBuilder: (context, index) {
                final site = sites[index];
                final org = state.orgFor(site.organizationId);
                return ListTile(
                  leading: const Icon(Icons.place_outlined),
                  title: Text(site.name),
                  subtitle: Text(
                    [
                      if (org != null) org.name,
                      if (site.address != null && site.address!.isNotEmpty)
                        site.address!,
                    ].join(" · "),
                  ),
                  onTap: () => Navigator.of(context).pop(site),
                );
              },
            ),
    );
  }
}
