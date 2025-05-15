import pytest
import fakeredis
import json
import time
from redis.exceptions import ResponseError

from server.utils.redis_client import RedisClient


class TestRedisClient:
    @pytest.fixture(autouse=True)
    def setup(self):
        # Patch Redis with fakeredis
        self.fake_redis = fakeredis.FakeRedis(decode_responses=True)
        self.client = RedisClient()
        self.client.redis = self.fake_redis  # Inject fake redis

    # -------------------------
    # Queue (List) Tests
    # -------------------------
    def test_enqueue_and_dequeue(self):
        task = {"task_id": "abc", "url": "https://example.com"}
        self.client.enqueue("test:queue", task)
        result = self.client.dequeue("test:queue")
        assert result == task

    def test_dequeue_empty(self):
        result = self.client.dequeue("empty:queue", timeout=1)
        assert result is None

    # -------------------------
    # Sorted Set Tests
    # -------------------------
    def test_zadd_and_zrange(self):
        result = {"task_id": "abc", "result": "s3://bucket/result.json"}
        self.client.zadd("test:zset", result, score=100)
        items = self.client.zrange("test:zset")
        assert items == [result]

    def test_zrange_desc(self):
        now = time.time()
        older = {"task_id": "1"}
        newer = {"task_id": "2"}
        self.client.zadd("test:zset", older, score=now - 10)
        self.client.zadd("test:zset", newer, score=now)
        items = self.client.zrange("test:zset", desc=True)
        assert items == [newer, older]

    def test_zremove(self):
        item = {"key": "value"}
        self.client.zadd("test:zset", item)
        self.client.zremove("test:zset", item)
        items = self.client.zrange("test:zset")
        assert items == []

    # -------------------------
    # Stream Tests
    # -------------------------
    def test_stream_add_and_read(self):
        self.client.stream_create_consumer_group("test:stream", "workers")
        task = {"task_id": "xyz"}
        self.client.stream_add("test:stream", task)
        message = self.client.stream_read("test:stream", "workers", "consumer1")
        assert message is not None
        msg_id, data = message
        assert data["task_id"] == "xyz"
        self.client.stream_ack("test:stream", "workers", msg_id)

    def test_stream_create_consumer_group_idempotent(self):
        # Create once
        self.client.stream_create_consumer_group("test:stream", "group1")
        # Create again, should not raise
        self.client.stream_create_consumer_group("test:stream", "group1")

    def test_stream_read_empty(self):
        self.client.stream_create_consumer_group("test:stream", "group2")
        message = self.client.stream_read("test:stream", "group2", "consumer2", block_ms=100)
        assert message is None
