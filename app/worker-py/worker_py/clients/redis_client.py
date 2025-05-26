"""
Redis client for barebones operations
"""
import json
import time
import redis
from dataclasses import dataclass
from typing import Any, Generator, Optional

from proto_gen import scrape_task_pb2
from worker_py.utils.config import REDIS_CHANNEL_MAP_INPUT, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

#==================
#   CONSTANTS
#==================
CHANNEL_LIST = list(REDIS_CHANNEL_MAP_INPUT.values())

#==================
#   UTILS
#==================
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
    def __init__(self, channel_list: list[str] = CHANNEL_LIST, group_name: str = "scrape-all", consumer_name: str = "0"):
        self.redis = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            password=REDIS_PASSWORD,
            decode_responses=True
        )
        self.channel_list = channel_list
        self.group_name = group_name
        self.consumer_name = consumer_name
        for channel in channel_list:
            try:
                # id='0' means Consumer Group will read all messages from the beginning including acknowledged ones
                # id='$' means Consumer Group will read only new messages
                self.redis.xgroup_create(name=channel, groupname=group_name, id='$')
            except redis.exceptions.ResponseError as e:
                if "BUSYGROUP" in str(e):
                    # Consumer group already exists, which is okay
                    pass
                else:
                    raise  # re-raise unexpected exceptions

    def ping(self) -> bool:
        """
        Checks if the Redis server is reachable and responsive.

        Returns:
            True if Redis responds to the ping, False otherwise.
        """
        try:
            return self.redis.ping()
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
    def stream_read_str(self) -> Generator[tuple[str, Any], None, None]:
        """
        Continuously yields JSON-decoded messages from Redis streams.
        """
        while True:
            responses = self.redis.xreadgroup(
                groupname=self.group_name,
                consumername=self.consumer_name,
                streams={channel: '>' for channel in self.channel_list},
            )
            for channel, messages in responses:
                for msg_id, msg_data in messages:
                    self.redis.xack(channel, self.group_name, msg_id)
                    yield (channel, msg_data)

    def stream_read_protobuf(self) -> Generator[tuple[str, scrape_task_pb2.ScrapeTask], None, None]:
        """
        Continuously yields parsed ScrapeTask protobuf messages from Redis streams.
        """
        while True:
            responses = self.redis.xreadgroup(
                groupname=self.group_name,
                consumername=self.consumer_name,
                # '>' reads only new, never-delivered messages.
                # '0' reads from the start, but includes already-acknowledged messages.
                streams={channel: '>' for channel in self.channel_list},
            )
            for channel, messages in responses:
                for msg_id, msg_data in messages:
                    self.redis.xack(channel, self.group_name, msg_id)

                    task = scrape_task_pb2.ScrapeTask()
                    task.ParseFromString(msg_data["data"])
                    yield (channel, task)
    
    def reprocess_stream_read_str(self, count: int = 10) -> Generator[tuple[str, str], None, None]:
        """
        Reprocess unacknowledged messages from a Redis stream by claiming them
        and yielding (channel, data_str) tuples.
        """
        
        for channel in self.channel_list:
            try:
                # Step 1: Fetch unacknowledged message info
                pending = self.redis.xpending_range(
                    channel,
                    self.group_name,
                    min='-',
                    max='+',
                    count=count
                )

                if not pending:
                    continue

                # Step 2: Claim the messages to this consumer
                msg_ids = [entry['message_id'] for entry in pending]

                # Step 3: Claim the messages to this consumer
                claimed = self.redis.xclaim(
                    channel,
                    self.group_name,
                    self.consumer_name,
                    min_idle_time=0,
                    message_ids=msg_ids
                )

                for msg_id, msg_data in claimed:
                    self.redis.xack(channel, self.group_name, msg_id)
                    data = msg_data.get("data")
                    if data is not None:
                        yield (channel, data)
            except redis.exceptions.ResponseError as e:
                # Gracefully handle missing stream or consumer group
                print(f"Error processing stream {channel}: {e}")
                continue
        