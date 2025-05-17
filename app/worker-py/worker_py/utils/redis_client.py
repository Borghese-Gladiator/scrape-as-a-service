"""
Redis client for barebones operations
"""
import json
import time
import redis
from dataclasses import asdict, dataclass
from typing import Any, Optional

from proto_gen import scrape_task_pb2
from server.utils.config import REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

@dataclass
class WrapperForScrapeTask:
    """
    Wrapper class for ScrapeTask protobuf message.
    """
    job_id: str
    url: str
    headers: dict
    timestamp: int
    data: Any

class RedisClient:
    def __init__(self):
        self.redis = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            password=REDIS_PASSWORD,
            decode_responses=True
        )

    def ping(self) -> bool:
        """
        Checks if the Redis server is reachable and responsive.

        Returns:
            True if Redis responds to the ping, False otherwise.
        """
        try:
            return self.client.ping()
        except redis.ConnectionError:
            return False

    # ------------------------------
    # QUEUE METHODS (LISTS)
    # ------------------------------
    def enqueue(self, queue_name: str, item: dict):
        """Add item to the end of a queue (RPUSH)."""
        self.redis.rpush(queue_name, json.dumps(item))

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

    # ------------------------------
    # STREAM METHODS
    # ------------------------------
    def stream_create_consumer_group(self, stream_name: str, group_name: str):
        """Create a consumer group for a stream (if not exists)."""
        try:
            self.redis.xgroup_create(stream_name, group_name, id='0', mkstream=True)
        except redis.exceptions.ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise

    def stream_read(self, stream_name: str, group_name: str, consumer_name: str, block_ms: int = 5000) -> Optional[tuple]:
        """Read one entry from a stream using a consumer group."""
        messages = self.redis.xreadgroup(
            groupname=group_name,
            consumername=consumer_name,
            streams={stream_name: '>'},
            count=1,
            block=block_ms
        )
        if messages:
            _, entries = messages[0]
            return entries[0]  # (id, data)
        return None

    def stream_ack(self, stream_name: str, group_name: str, message_id: str):
        """Acknowledge a stream message."""
        self.redis.xack(stream_name, group_name, message_id)

