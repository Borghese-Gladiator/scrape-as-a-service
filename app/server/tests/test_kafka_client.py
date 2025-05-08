# test_kafka_client.py

import pytest
from unittest.mock import patch, MagicMock, call
from kafka.admin import NewTopic
from server.utils.kafka_client import KafkaAdminClient, KafkaClient
from server.utils.constants import ScrapeTopic
from server.config import KAFKA_URL

#======================
#   KafkaAdminClient
#======================
@patch("kafka.KafkaAdminClient.__init__")
def test_kafka_admin_client_init(mock_super_init):
    client = KafkaAdminClient()
    mock_super_init.assert_called_once_with(
        bootstrap_servers=KAFKA_URL,
        client_id="my-server-admin"
    )

@patch("server.utils.kafka_client.BaseKafkaAdminClient.create_topics")
def test_create_default_topics(mock_create_topics):
    client = KafkaAdminClient()
    client.create_default_topics()
    expected_topics = [
        NewTopic(name=topic.value, num_partitions=1, replication_factor=1)
        for topic in ScrapeTopic
    ]
    mock_create_topics.assert_called_once()
    actual_args = mock_create_topics.call_args[0][0]
    assert {t.name for t in actual_args} == {t.name for t in expected_topics}


@patch("server.utils.kafka_client.BaseKafkaAdminClient.delete_topics")
def test_delete_default_topics(mock_delete_topics):
    client = KafkaAdminClient()
    client.delete_default_topics()
    expected = {topic.value for topic in ScrapeTopic}
    mock_delete_topics.assert_called_once_with(expected)

#======================
#   KafkaClient
#======================
@patch("server.utils.kafka_client.KafkaProducer")
def test_kafka_client_enqueue_scrape_job(mock_producer_class):
    mock_producer = MagicMock()
    mock_producer_class.return_value = mock_producer

    client = KafkaClient()
    client.enqueue_scrape_job("job1", "do something", ScrapeTopic.API)

    mock_producer.send.assert_called_once_with(
        ScrapeTopic.API.value,
        key=b"job1",
        value=b"do something"
    )


@patch("server.utils.kafka_client.KafkaProducer")
def test_kafka_client_cancel_scrape_job(mock_producer_class):
    mock_producer = MagicMock()
    mock_producer_class.return_value = mock_producer

    client = KafkaClient()
    client.cancel_scrape_job("job2", ScrapeTopic.WEBDRIVER)

    mock_producer.send.assert_called_once_with(ScrapeTopic.WEBDRIVER.value, key="job2", value=None)
    mock_producer.flush.assert_called_once()
