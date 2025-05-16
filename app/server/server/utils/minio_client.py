import io
import uuid
from datetime import datetime

from minio import Minio
from minio.error import S3Error

from .config import MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_SECURE, MINIO_BUCKET_NAME


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
        print(f"Bucket '{bucket_name}' created.")

    def _generate_upload_key(self, prefix="anon", filename="data.json") -> str:
        now = datetime.utcnow()
        time_path = now.strftime("%Y/%m/%d")
        unique_id = str(uuid.uuid4())
        return f"{prefix}/{time_path}/{unique_id}/{filename}"

    def upload(self, content: bytes, filename: str = "data.json", prefix: str = "anon", content_type: str = "application/octet-stream") -> str:
        self.create_bucket_if_missing(self.bucket_name)
        object_name = self._generate_upload_key(prefix, filename)
        data = io.BytesIO(content)

        self.client.put_object(
            self.bucket_name,
            object_name,
            data,
            length=len(content),
            content_type=content_type
        )
        print(f"Uploaded to '{object_name}' in bucket '{self.bucket_name}'.")
        return object_name  # return object key so it can be used for download or reference

    def download(self, object_name: str) -> bytes:
        try:
            response = self.client.get_object(self.bucket_name, object_name)
            content = response.read()
            response.close()
            response.release_conn()
            print(f"Downloaded '{object_name}' from bucket '{self.bucket_name}'.")
            return content
        except S3Error as e:
            print(f"Download failed: {e}")
            return b""

    def preview(self, object_name: str, byte_limit: int = 500):
        try:
            response = self.client.get_object(self.bucket_name, object_name)
            preview_bytes = response.read(byte_limit)
            response.close()
            response.release_conn()

            try:
                preview_text = preview_bytes.decode("utf-8")
            except UnicodeDecodeError:
                preview_text = str(preview_bytes)

            print(f"Preview of '{object_name}':\n{'-'*40}\n{preview_text}\n{'-'*40}")
        except S3Error as e:
            print(f"Preview failed: {e}")

    def list_objects(self, prefix: str = "anon"):
        print(f"Objects in bucket '{self.bucket_name}' with prefix '{prefix}':")
        for obj in self.client.list_objects(self.bucket_name, prefix=prefix, recursive=True):
            print(f" - {obj.object_name}")

    def delete_object(self, object_name: str):
        try:
            self.client.remove_object(self.bucket_name, object_name)
            print(f"Deleted '{object_name}' from bucket '{self.bucket_name}'.")
        except S3Error as e:
            print(f"Delete failed: {e}")
