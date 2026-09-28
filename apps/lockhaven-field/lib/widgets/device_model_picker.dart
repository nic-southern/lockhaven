import "package:flutter/material.dart";
import "package:lockhaven_field/hub/models.dart";

/// Searchable device-model picker backed by Hub `deviceModels.list`.
class DeviceModelPicker extends StatefulWidget {
  const DeviceModelPicker({
    super.key,
    required this.models,
    required this.selectedId,
    required this.onChanged,
    this.enabled = true,
    this.loading = false,
    this.labelText = "Device model",
    this.hintText = "Search catalog…",
  });

  final List<DeviceModelSummary> models;
  final String? selectedId;
  final ValueChanged<String?> onChanged;
  final bool enabled;
  final bool loading;
  final String labelText;
  final String hintText;

  @override
  State<DeviceModelPicker> createState() => _DeviceModelPickerState();
}

class _DeviceModelPickerState extends State<DeviceModelPicker> {
  late TextEditingController _textController;
  final FocusNode _focusNode = FocusNode();
  String? _lastSyncedId;

  @override
  void initState() {
    super.initState();
    _textController = TextEditingController(text: _labelFor(widget.selectedId));
    _lastSyncedId = widget.selectedId;
    _focusNode.addListener(() {
      if (!_focusNode.hasFocus) {
        _syncFromSelection();
      }
    });
  }

  @override
  void didUpdateWidget(covariant DeviceModelPicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.selectedId != _lastSyncedId ||
        widget.models != oldWidget.models) {
      _syncFromSelection();
    }
  }

  @override
  void dispose() {
    _textController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  DeviceModelSummary? _modelFor(String? id) {
    if (id == null || id.isEmpty) return null;
    for (final model in widget.models) {
      if (model.id == id) return model;
    }
    return null;
  }

  String _labelFor(String? id) => _modelFor(id)?.displayLabel ?? "";

  void _syncFromSelection() {
    final next = _labelFor(widget.selectedId);
    _lastSyncedId = widget.selectedId;
    if (_textController.text != next) {
      _textController.text = next;
    }
  }

  void _clear() {
    _textController.clear();
    _lastSyncedId = null;
    widget.onChanged(null);
  }

  @override
  Widget build(BuildContext context) {
    final selected = _modelFor(widget.selectedId);
    final emptyCatalog = !widget.loading && widget.models.isEmpty;

    return RawAutocomplete<DeviceModelSummary>(
      textEditingController: _textController,
      focusNode: _focusNode,
      displayStringForOption: (model) => model.displayLabel,
      optionsBuilder: (value) {
        if (widget.models.isEmpty) return const Iterable.empty();
        return widget.models.where((model) => model.matchesQuery(value.text));
      },
      onSelected: (model) {
        _lastSyncedId = model.id;
        _textController.text = model.displayLabel;
        widget.onChanged(model.id);
      },
      fieldViewBuilder: (context, textController, focusNode, onFieldSubmitted) {
        return TextField(
          controller: textController,
          focusNode: focusNode,
          enabled: widget.enabled && !widget.loading,
          decoration: InputDecoration(
            labelText: widget.labelText,
            hintText: emptyCatalog ? "No models in Hub yet" : widget.hintText,
            helperText: selected == null && !emptyCatalog
                ? "Optional — pick from the organization catalog"
                : null,
            suffixIcon: widget.loading
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : (textController.text.isNotEmpty
                    ? IconButton(
                        tooltip: "Clear",
                        onPressed: widget.enabled ? _clear : null,
                        icon: const Icon(Icons.clear),
                      )
                    : const Icon(Icons.arrow_drop_down)),
          ),
          onChanged: (value) {
            // Typing away from the selected label clears the id without
            // resetting the in-progress search text.
            if (selected != null && value != selected.displayLabel) {
              _lastSyncedId = null;
              widget.onChanged(null);
            }
          },
          onSubmitted: (_) => onFieldSubmitted(),
        );
      },
      optionsViewBuilder: (context, onSelectedOption, options) {
        final list = options.toList(growable: false);
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            borderRadius: BorderRadius.circular(8),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 280, maxWidth: 520),
              child: list.isEmpty
                  ? const ListTile(
                      dense: true,
                      title: Text("No matching models"),
                    )
                  : ListView.builder(
                      padding: EdgeInsets.zero,
                      shrinkWrap: true,
                      itemCount: list.length,
                      itemBuilder: (context, index) {
                        final model = list[index];
                        return ListTile(
                          dense: true,
                          selected: model.id == widget.selectedId,
                          title: Text(model.displayLabel),
                          subtitle: model.manufacturer == null ||
                                  model.manufacturer!.trim().isEmpty
                              ? Text(model.model)
                              : Text(
                                  "${model.manufacturer} · ${model.model}",
                                ),
                          onTap: () => onSelectedOption(model),
                        );
                      },
                    ),
            ),
          ),
        );
      },
    );
  }
}
