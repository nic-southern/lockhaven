import "package:flutter/material.dart";
import "package:lockhaven_field/screens/site_assets_screen.dart";
import "package:lockhaven_field/state/app_state.dart";

class SitesScreen extends StatelessWidget {
  const SitesScreen({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    final user = state.session?.user;

    return Scaffold(
      appBar: AppBar(
        title: const Text("Sites"),
        actions: [
          IconButton(
            tooltip: "Refresh",
            onPressed: state.sitesLoading
                ? null
                : () async {
                    try {
                      await state.refreshSites();
                    } catch (_) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(
                              state.errorMessage ?? "Could not refresh sites.",
                            ),
                          ),
                        );
                      }
                    }
                  },
            icon: const Icon(Icons.refresh),
          ),
          PopupMenuButton<String>(
            onSelected: (value) async {
              if (value == "signOut") {
                await state.signOut();
              }
            },
            itemBuilder: (context) => [
              PopupMenuItem(
                enabled: false,
                child: Text(user?.email ?? ""),
              ),
              const PopupMenuItem(
                value: "signOut",
                child: Text("Sign out"),
              ),
            ],
          ),
        ],
      ),
      body: state.sitesLoading && state.sites.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : state.sites.isEmpty
              ? Center(
                  child: Text(
                    "No sites yet",
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  itemCount: state.sites.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 4),
                  itemBuilder: (context, index) {
                    final site = state.sites[index];
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
                      onTap: () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => SiteAssetsScreen(
                              state: state,
                              site: site,
                            ),
                          ),
                        );
                      },
                    );
                  },
                ),
    );
  }
}
