import json
import time
import redis
from typing import Optional, List, Dict, Any


class RedisClient:
    def __init__(self, host="localhost", port=6379):
        self.redis = redis.Redis(host=host, port=port, decode_responses=True)

    # ------------------------------
    # QUEUE METHODS (LISTS)
    # ------------------------------
    def dequeue(self, queue_name: str, timeout: int = 0) -> Optional[dict]:
        """Pop item from front of queue (BLPOP)."""
        result = self.redis.blpop(queue_name, timeout=timeout)
        if result:
            _, item = result
            return json.loads(item)
        return None

    # ------------------------------
    # SORTED SET METHODS
    # ------------------------------
    def zadd(self, set_name: str, item: dict, score: Optional[float] = None):
        """Add item to a sorted set with optional timestamp as score."""
        if score is None:
            score = time.time()
        self.redis.zadd(set_name, {json.dumps(item): score})

