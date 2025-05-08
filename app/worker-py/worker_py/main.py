from proto_gen import scrape_task_pb2
from utils.minio_client import MinioClient

task = scrape_task_pb2.ScrapeTask(url="https://example.com", method="GET")
print(task)
