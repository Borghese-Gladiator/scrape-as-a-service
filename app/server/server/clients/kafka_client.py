"""
Kafka client for barebones operations
"""
from typing import Any

from kafka import KafkaAdminClient as BaseKafkaAdminClient
from kafka import KafkaProducer
from kafka.admin import NewTopic
from proto_gen import scrape_task_pb2

from server.utils.config import KAFKA_CLIENT_ID, KAFKA_URL, KAFKA_TOPIC_MAP
from server.utils.constants import ScrapeType

class KafkaAdminClient(BaseKafkaAdminClient):
    topics = {topic for topic in KAFKA_TOPIC_MAP.values()}

    def __init__(self, **kwargs):
        kwargs.setdefault("bootstrap_servers", KAFKA_URL)
        kwargs.setdefault("client_id", KAFKA_CLIENT_ID)
        super().__init__(**kwargs)

    def create_default_topics(self):
        topics_to_create = [NewTopic(name=t, num_partitions=1, replication_factor=1) for t in self.topics]
        return super().create_topics(topics_to_create)

    def delete_default_topics(self):
        return super().delete_topics(self.topics)


class KafkaClient:
    def __init__(self, broker_url=KAFKA_URL):
        self.producer = KafkaProducer(
            bootstrap_servers=broker_url,
            
            # Serializes for ProtoBuf
            value_serializer=lambda v: v.SerializeToString() if v else None,
            
            # For null keys, Kafka uses round-robin partitioning
            # and distributes messages evenly across all partitions.
            # However, there is no ordering guarantee (not needed for my scraping)
            key_serializer=lambda k: k.encode('utf-8') if k else None
        )
    
    def ping(self) -> bool:
        """
        Checks if the Kafka server is reachable and responsive.

        Returns:
            True if Kafka responds to the ping, False otherwise.
        """
        try:
            return self.producer.bootstrap_connected()
        except Exception as e:
            print(f"Kafka ping failed: {e}")
            return False
            
    def stream(self, topic: str, key: str, value: Any):
        proto_scrape_task = scrape_task_pb2.ScrapeTask(**value)
        self.producer.send(topic, key=key, value=proto_scrape_task)
    
    def cancel(self, topic: str, key: str, scrape_type: ScrapeType):
        self.producer.send(topic, key=key, value=None)  # tombstone message for cancellation
        self.producer.flush()  # optional: ensure it's sent out immediately

