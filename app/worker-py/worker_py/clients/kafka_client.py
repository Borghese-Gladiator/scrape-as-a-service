"""
Kafka client for barebones operations
"""
import json
from typing import Any, TYPE_CHECKING, Generator

from kafka import KafkaConsumer
from proto_gen import scrape_task_pb2

from worker_py.utils.config import (
    KAFKA_URL,
    KAFKA_TOPIC_MAP,
)

if TYPE_CHECKING:
    from kafka.consumer.fetcher import ConsumerRecord


class KafkaClient:
    def __init__(self, broker_url=KAFKA_URL, topic_list: list[str] = KAFKA_TOPIC_MAP.values(), group_name: str = "scrape-all"):
        self.broker_url = broker_url
        self.consumer = KafkaConsumer(
            *topic_list,
            bootstrap_servers=self.broker_url,
            group_id=group_name,
            auto_offset_reset='earliest',
        )
    
    def ping(self) -> bool:
        """
        Checks if the Kafka server is reachable and responsive.

        Returns:
            True if Kafka responds to the ping, False otherwise.
        """
        try:
            return bool(self.consumer.bootstrap_connected())
        except Exception as e:
            print(f"Kafka ping failed: {e}")
            return False
    
    def stream_read_str(self) -> Generator[tuple[str, str], None, None]:
        """
        Yields raw UTF-8 decoded messages from subscribed Kafka topics.
        """
        message: ConsumerRecord
        for message in self.consumer:
            yield message.topic, message.value.decode('utf-8')

    def stream_read_json(self) -> Generator[tuple[str, Any], None, None]:
        """
        Yields JSON-decoded messages from subscribed Kafka topics.
        """
        message: ConsumerRecord
        for message in self.consumer:
            yield message.topic, json.loads(message.value.decode('utf-8'))

    def stream_read_protobuf(self) -> Generator[tuple[str, scrape_task_pb2.ScrapeTask], None, None]:
        """
        Yields protobuf-deserialized ScrapeTask messages from subscribed Kafka topics.
        """
        message: ConsumerRecord
        for message in self.consumer:
            task = scrape_task_pb2.ScrapeTask()
            task.ParseFromString(message.value)
            yield message.topic, task