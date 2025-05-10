# kafka_app/kafka_client.py

from typing import Any

from kafka import KafkaAdminClient as BaseKafkaAdminClient
from kafka import KafkaProducer
from kafka.admin import NewTopic
from proto_gen import scrape_task_pb2

from server.config import KAFKA_CLIENT_ID, KAFKA_URL, ScrapeTopic


class KafkaAdminClient(BaseKafkaAdminClient):
    topics = {topic.value for topic in ScrapeTopic}

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
            value_serializer=lambda v: v.SerializeToString() if v else None,
            key_serializer=lambda k: k.encode('utf-8')
        )
            
    def enqueue_scrape_task(self, key: str, value: Any, job_type: ScrapeTopic):
        topic = job_type.value
        message = scrape_task_pb2.ScrapeTask(**value)
        self.producer.send(topic, key=key, value=message)
    
    def cancel_scrape_topic(self, key: str, job_type: ScrapeTopic):
        topic = job_type.value
        self.producer.send(topic, key=key, value=None)  # tombstone message for cancellation
        self.producer.flush()  # optional: ensure it's sent out immediately

