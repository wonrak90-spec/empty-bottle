class StabilityTracker {
  final int requiredHits;
  final Map<String, _Vote> _votes = {};

  StabilityTracker({this.requiredHits = 3});

  void reset() => _votes.clear();

  String? stable(String key, String? value) {
    if (value == null || value.trim().isEmpty) return null;
    final normalized = value.trim().replaceAll(RegExp(r'\s+'), ' ');
    final vote = _votes.putIfAbsent(key, () => _Vote());

    if (vote.value == normalized) {
      vote.hits++;
    } else {
      vote.value = normalized;
      vote.hits = 1;
    }

    return vote.hits >= requiredHits ? vote.value : null;
  }
}

class _Vote {
  String value = '';
  int hits = 0;
}
