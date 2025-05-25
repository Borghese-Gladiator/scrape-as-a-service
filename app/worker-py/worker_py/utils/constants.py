from functools import lru_cache
from enum import Enum
import uuid

REDIS_OUTPUT_SORTED_SET = "scrape-output"

# NOTE: These have the same logic, but the result is cached so they must be used as different functions.
@lru_cache(maxsize=1)
def get_redis_consumer_name() -> str:
    return f"worker-{uuid.uuid4().hex[:8]}"
@lru_cache(maxsize=1)
def get_kafka_consumer_name() -> str:
    return f"worker-{uuid.uuid4().hex[:8]}"
