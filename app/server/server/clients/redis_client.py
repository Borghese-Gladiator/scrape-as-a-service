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

    def zrange(self, set_name: str, start: int = 0, stop: int = -1, desc: bool = False) -> list[dict]:
        """Fetch items from a sorted set (optionally reversed)."""
        items = self.redis.zrevrange(set_name, start, stop) if desc else self.redis.zrange(set_name, start, stop)
        return [json.loads(item) for item in items]

    def zremove(self, set_name: str, item: dict):
        """Remove a specific item from a sorted set."""
        self.redis.zrem(set_name, json.dumps(item))

    def search(self, set_name: str, job_id: str) -> Any | None:
        """
        Searches a Redis sorted set for a message that matches the given job_id.

        Args:
            set_name: The Redis sorted set key name.
            job_id: The job_id string to look for.

        Returns:
            The decoded message (protobuf object) if found, else None.
        """
        # ZRANGE returns full range; adjust for paging in production if needed
        members = self.client.zrange(set_name, 0, -1)

        for raw in members:
            try:
                msg = scrape_task_pb2.ScrapeTask.FromString(raw)
                if msg.job_id == job_id:
                    return msg
            except Exception as e:
                continue  # Skip if not a valid ScrapeTask

        return None


    # ------------------------------
    # STREAM METHODS
    # ------------------------------
    def stream_add_scrape_task(self, stream_name: str, raw_dict: dict):
        """
        Enqueue scrape task into Redis Stream.

        This methods builds a ProtoBuf message and wraps it with a human readable dict.
        This enables both human readable and machine readable data to be stored in the stream.
        
        Machine Readable benefits
            enables efficient message size
            structured, versioned data
        
        Human Readable benefits
            easy inspection/debugging (Grafana, Kibana, etc.)
        """
        proto_scrape_task = scrape_task_pb2.ScrapeTask(**raw_dict)
        value = WrapperForScrapeTask(
            job_id=raw_dict.get("job_id"),
            url=raw_dict.get("url"),
            headers=json.dumps(raw_dict.get("headers") or {}),
            timestamp=int(time.time()),
            data=proto_scrape_task.SerializeToString()
        )
        self.redis.xadd(stream_name, asdict(value))
        
    def stream_add(self, stream_name: str, value: dict):
        """Add an item to a stream."""
        self.redis.xadd(stream_name, value)

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

