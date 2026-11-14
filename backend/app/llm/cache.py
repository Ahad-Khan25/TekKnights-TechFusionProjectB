"""Small in-memory TTL + LRU cache for LLM responses (keyed by a hash of provider-agnostic prompt)."""
from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from typing import Any


class TTLCache:
    def __init__(self, max_items: int = 512, ttl_s: int = 3600) -> None:
        self.max_items, self.ttl_s = max_items, ttl_s
        self._data: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()
        self.hits = self.misses = 0

    @staticmethod
    def make_key(*parts: Any) -> str:
        raw = json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get(self, key: str) -> Any | None:
        with self._lock:
            item = self._data.get(key)
            if not item or item[0] < time.monotonic():
                if item:
                    del self._data[key]
                self.misses += 1
                return None
            self._data.move_to_end(key)
            self.hits += 1
            return item[1]

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = (time.monotonic() + self.ttl_s, value)
            self._data.move_to_end(key)
            while len(self._data) > self.max_items:
                self._data.popitem(last=False)

    def stats(self) -> dict:
        return {"items": len(self._data), "hits": self.hits, "misses": self.misses}
