"""
Kafka client for barebones operations
"""
from typing import Any

from kafka import KafkaConsumer
from proto_gen import scrape_task_pb2

from .config import KAFKA_CLIENT_ID, KAFKA_URL, KAFKA_TOPIC_MAP
from .constants import ScrapeType

class KafkaClient:
    def __init__(self, broker_url=KAFKA_URL):
        self.broker_url = broker_url
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
    
    def consume_messages(self, topic, timeout=5):
        consumer = KafkaConsumer(
            topic,
            bootstrap_servers=self.broker_url,
            auto_offset_reset='earliest',
            enable_auto_commit=True,
            group_id="test-group",
        )
        messages = []
        for message in consumer:
            messages.append((message.key.decode() if message.key else None,
                             message.value.decode()))
            if len(messages) >= 1:
                break
        consumer.close()
        return messages