import io
from minio import Minio

from worker_py.config import MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_SECURE, MINIO_BUCKET_NAME

class MinioClient:
    def __init__(self, endpoint: str = MINIO_ENDPOINT, access_key: str = MINIO_ACCESS_KEY, secret_key: str = MINIO_SECRET_KEY, secure: bool = MINIO_SECURE):
        self.client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure
        )
        self.bucket_name = MINIO_BUCKET_NAME

    def create_bucket_if_missing(self, bucket_name: str, strict: bool = False):
        if self.client.bucket_exists(bucket_name):
            if strict:
                raise RuntimeError(f"Bucket '{bucket_name}' already exists.")
            return
        self.client.make_bucket(bucket_name)

    def upload(self, object_name: str, content: bytes, content_type: str = "application/octet-stream"):
        self.create_bucket_if_missing(self.bucket_name)
        data = io.BytesIO(content)
        self.client.put_object(
            self.bucket_name,
            object_name,
            data,
            length=len(content),
            content_type=content_type
        )
        print(f"Uploaded '{object_name}' to bucket '{self.bucket_name}'.")
    