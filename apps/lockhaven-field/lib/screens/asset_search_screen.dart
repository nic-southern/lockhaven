import "package:flutter/material.dart";
import "package:lockhaven_field/hub/hub_client.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/state/app_state.dart";

class AssetSearchResult {
  const AssetSearchResult.asset(this.asset) : standAlone = false;
  const AssetSearchResult.standAlone()
      : asset = null,
        standAlone = true;

  final AssetSummary? asset;
  final bool standAlone;
}

/// Full-page search for assets (tag / serial / name) used by container flows.
class AssetSearchScreen extends StatefulWidget {
  const AssetSearchScreen({
    super.key,
    required this.state,
    required this.title,
    this.subtitle,
    this.containersOnly = false,
    this.itemsOnly = false,
    this.allowStandAlone = false,
    this.excludeAssetId,
  });

  final AppState state;
  final String title;
  final String? subtitle;
  final bool containersOnly;
  final bool itemsOnly;
  final bool allowStandAlone;
  final String? excludeAssetId;

  @override
  State<AssetSearchScreen> createState() => _AssetSearchScreenState();
}

class _AssetSearchScreenState extends State<AssetSearchScreen> {
  final controller = TextEditingController();
  final focusNode = FocusNode();
  List<AssetSummary> results = const [];
  bool searching = false;
  String? error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    controller.dispose();
    focusNode.dispose();
    super.dispose();
  }

  Future<void> _search([String? raw]) async {
    final query = (raw ?? controller.text).trim();
    if (query.isEmpty) {
      setState(() {
        results = const [];
        error = null;
      });
      return;
    }

    setState(() {
      searching = true;
      error = null;
    });

    try {
      final found = <String, AssetSummary>{};
      for (final candidate in scanQueryCandidates(query)) {
        final rows = await widget.state.client.searchAssets(candidate);
        for (final row in rows) {
          if (widget.excludeAssetId != null &&
              row.id == widget.excludeAssetId) {
            continue;
          }
          if (widget.containersOnly && !row.isContainer) continue;
          if (widget.itemsOnly && row.isContainer) continue;
          found[row.id] = row;
        }
      }
      if (!mounted) return;
      setState(() {
        results = found.values.toList();
        searching = false;
        if (results.isEmpty) {
          error = "No match.";
        }
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        searching = false;
        error = err is HubException ? err.message : "Search failed.";
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.subtitle != null) ...[
              Text(
                widget.subtitle!,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
              const SizedBox(height: 16),
            ],
            TextField(
              controller: controller,
              focusNode: focusNode,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: "Search",
                hintText: "Tag, serial, or name",
                prefixIcon: Icon(Icons.search),
              ),
              textInputAction: TextInputAction.search,
              onSubmitted: _search,
              onChanged: (value) {
                if (value.trim().length >= 2) {
                  _search(value);
                }
              },
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: searching ? null : () => _search(),
              child: searching
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text("Search"),
            ),
            if (widget.allowStandAlone) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () {
                  Navigator.of(context).pop(
                    const AssetSearchResult.standAlone(),
                  );
                },
                icon: const Icon(Icons.link_off),
                label: const Text("Stand alone"),
              ),
            ],
            if (error != null) ...[
              const SizedBox(height: 12),
              Text(error!),
            ],
            const SizedBox(height: 12),
            Expanded(
              child: ListView.separated(
                itemCount: results.length,
                separatorBuilder: (_, _) => const SizedBox(height: 4),
                itemBuilder: (context, index) {
                  final asset = results[index];
                  return ListTile(
                    leading: Icon(
                      asset.isContainer
                          ? Icons.inventory_2_outlined
                          : Icons.memory_outlined,
                    ),
                    title: Text(asset.title),
                    subtitle: Text(
                      [
                        asset.tag,
                        if (asset.siteName != null) asset.siteName!,
                        asset.subtitle,
                      ].join(" · "),
                    ),
                    onTap: () {
                      Navigator.of(context).pop(
                        AssetSearchResult.asset(asset),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
