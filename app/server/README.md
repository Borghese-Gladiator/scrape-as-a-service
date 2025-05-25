# Server
FastAPI server to handle API requests from frontend

Features
- start scrape jobs (enqueue jobs in Kafka)
- reads data from scrape jobs

## Local Setup
Steps
- `poetry install`
- `Invoke-Expression (poetry env activate)` OR `eval $(poetry env activate)`
- `fastapi dev server/main.py`

ProtoBuf steps
- `poetry run python -m grpc_tools.protoc -I="$($PWD)/../../proto" --python_out="$($PWD)/proto_gen" $PROTO_FILE`

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
- Minio read/write
- Redis read/write
- protobuf serialize/deserialize

<details>
<summary>Feature Testing</summary>

KAFKA read/write
```python
#====================
#   KAFKA package
#====================
from server.clients.kafka_client import KafkaAdminClient
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
from server.clients.kafka_client import KafkaClient, KafkaAdminClient
admin_client = KafkaAdminClient()
admin_client.create_default_topics()
admin_client.delete_default_topics()

client = KafkaClient()
client.enqueue_jobs("job1", "do something", ScrapeTopic.API)
client.enqueue_jobs("job2", "do something else", ScrapeTopic.WEBDRIVER)
client.cancel_scrape_job("job2", ScrapeTopic.WEBDRIVER)
```

MINIO read/write
```python
from minio import Minio
from minio.error import S3Error

# Setup MinIO client
client = Minio(
    "localhost:9002",                  # Replace with your MinIO server URL
    access_key="minioadmin",  # Replace with your access key
    secret_key="minioadmin",  # Replace with your secret key
    secure=False                    # False if you're using HTTP
)

bucket_name = "my-bucket"
object_name = "hello.txt"
file_path = "local_hello.txt"

# Ensure bucket exists
if not client.bucket_exists(bucket_name):
    client.make_bucket(bucket_name)

# ✅ Upload (write) a file to MinIO
try:
    client.fput_object(bucket_name, object_name, file_path)
    print(f"File '{file_path}' uploaded to bucket '{bucket_name}' as '{object_name}'.")
except S3Error as err:
    print("Upload error:", err)

# ✅ Download (read) a file from MinIO
try:
    client.fget_object(bucket_name, object_name, "downloaded_" + file_path)
    print(f"File '{object_name}' downloaded from bucket '{bucket_name}'.")
except S3Error as err:
    print("Download error:", err)
```

Redis read/write
```python
from server.clients.redis_client import RedisClient

client = RedisClient()

# QUEUE
task = {"task_id": "abc123", "url": "https://example.com"}
client.enqueue("my:queue", task)
print("Dequeued:", client.dequeue("my:queue"))

# SORTED SET
result = {"task_id": "abc123", "result": "s3://mybucket/result.json"}
client.zadd("my:results", result)
print("Recent results:", client.zrange("my:results", 0, 5, desc=True))

# STREAM
client.stream_create_consumer_group("my:stream", "workers")
client.stream_add("my:stream", {"task_id": "xyz456", "url": "https://stream.com"})
message = client.stream_read("my:stream", "workers", "worker-1")
if message:
    msg_id, data = message
    print("Stream task:", data)
    client.stream_ack("my:stream", "workers", msg_id)
```

FastAPI `/scrape`
- run infrastructure (`docker compose up`) AND run server (`fastapi dev server/main.py`)
- send request via REST client
  - `localhost:8000`
  - body
    ```json
    {
        "url": "https://jsonplaceholder.typicode.com/todos/1",
        "method": "GET",
        "headers": {},
        "params": {},
        "body": "",
        "scrape_type": "API"
    }
    ```

</details>

</details>

#### Troubleshooting
Error on MacOS
```zsh
➜  server git:(main) eval $(poetry env activate)
Discovered shell doesn't have an activator in virtual environment
```
Solution
```
➜  server git:(main) ✗ poetry env list --full-path
/Users/timothy.shee/Library/Caches/pypoetry/virtualenvs/server-Vld1RlOx-py3.13
➜  server git:(main) ✗ source /Users/timothy.shee/Library/Caches/pypoetry/virtualenvs/server-Vld1RlOx-py3.13/bin/activate
(server-py3.13) ➜  server git:(main) ✗
```
