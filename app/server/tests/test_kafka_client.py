# test_kafka_client.py

from unittest.mock import MagicMock, patch

import pytest
from kafka.admin import NewTopic
from server.config import KAFKA_URL
from server.utils.constants import ScrapeTopic
from server.utils.kafka_client import KafkaAdminClient, KafkaClient


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
@pytest.mark.parametrize(
    "key, value, topic, expected_exception, expected_send_call",
    [
        # Test case 1: Valid key, value, and topic
        ("job1", "do something", ScrapeTopic.API, None, (ScrapeTopic.API.value, b"job1", b"do something")),

        # Test case 2: Empty key
        ("", "do something", ScrapeTopic.API, None, (ScrapeTopic.API.value, b"", b"do something")),

        # Test case 3: Empty value
        ("job1", "", ScrapeTopic.API, None, (ScrapeTopic.API.value, b"job1", b"")),

        # Test case 4: Invalid topic
        ("job1", "do something", "INVALID_TOPIC", ValueError, None),

        # Test case 5: Large payload
        ("job1", "x" * 10_000_000, ScrapeTopic.API, None, (ScrapeTopic.API.value, b"job1", b"x" * 10_000_000)),
    ],
)
@patch("server.utils.kafka_client.KafkaProducer")
def test_kafka_client_enqueue_scrape_job(
    mock_producer_class, key, value, topic, expected_exception, expected_send_call
):
    mock_producer = MagicMock()
    mock_producer_class.return_value = mock_producer

    client = KafkaClient()

    if expected_exception:
        with pytest.raises(expected_exception):
            client.enqueue_scrape_job(key, value, topic)
        mock_producer.send.assert_not_called()
    else:
        client.enqueue_scrape_job(key, value, topic)
        mock_producer.send.assert_called_once_with(
            expected_send_call[0], key=expected_send_call[1], value=expected_send_call[2]
        )


@patch("server.utils.kafka_client.KafkaProducer")
def test_kafka_client_cancel_scrape_job(mock_producer_class):
    mock_producer = MagicMock()
    mock_producer_class.return_value = mock_producer

    client = KafkaClient()
    client.cancel_scrape_job("job2", ScrapeTopic.WEBDRIVER)

    mock_producer.send.assert_called_once_with(ScrapeTopic.WEBDRIVER.value, key="job2", value=None)
    mock_producer.flush.assert_called_once()
