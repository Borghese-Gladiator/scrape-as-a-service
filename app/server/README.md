# Server
FastAPI server to handle API requests from frontend

Features
- start scrape jobs (enqueue jobs in Kafka)
- reads data from scrape jobs

## Local Setup
Steps
- `poetry install`
- `Invoke-Expression (poetry env activate)`
- `fastapi dev main.py`

Steps for ProtoBuf
- `python -m grpc_tools.protoc -I. --python_out=. scrape_job.proto`


<details>
<summary>Methodology</summary>

Bootstrap
- `poetry init`
- `poetry add "fastapi[standard]"`
- VSCode - select Python interpreter using path from `poetry env info`
- `Invoke-Expression (poetry env activate)`
- `main.py` - implement FastAPI endpoints
- `fastapi dev main.py` - run dev server

Features
- Kafka read/write
  - `docker-compose.yml`
  - `kafka_client.py`
  - `test_kafka_client.py`
- Kafka with ProtoBuf read/write
  - `kafka_client.py`
  - `test_kafka_client.py`

<details>
<summary>Feature Testing</summary>

KAFKA read/write
```python
#====================
#   KAFKA package
#====================
from server.utils.kafka_client import KafkaAdminClient
from kafka import KafkaAdminClient
admin_client = KafkaAdminClient(
    bootstrap_servers=KAFKA_URL,
    client_id='test'
)
example_topic = "example_topic"
admin_client.create_topics([NewTopic(name=example_topic, num_partitions=1, replication_factor=1)])
admin_client.delete_topics(topics=[example_topic])

from kafka import KafkaProducer
producer = KafkaProducer(bootstrap_servers="localhost:9092")
for _ in range(10):
    producer.send(example_topic, b'some_message_bytes')

from kafka import KafkaConsumer
consumer = KafkaConsumer(
    example_topic,
    bootstrap_servers="localhost:9092",
    auto_offset_reset='earliest',
    enable_auto_commit=True,
    group_id="test-group",
)
messages = []
for message in consumer:
    messages.append((message.key.decode() if message.key else None, message.value.decode()))
    if len(messages) >= 1:
        break
consumer.close()

#=========================
#   KAFKA implementation
#=========================
from server.utils.kafka_client import KafkaClient, KafkaAdminClient
admin_client = KafkaAdminClient()
admin_client.create_default_topics()
admin_client.delete_default_topics()

client = KafkaClient()
client.enqueue_jobs("job1", "do something", ScrapeTopic.API)
client.enqueue_jobs("job2", "do something else", ScrapeTopic.WEBDRIVER)
client.cancel_scrape_job("job2", ScrapeTopic.WEBDRIVER)
```

</details>

</details>