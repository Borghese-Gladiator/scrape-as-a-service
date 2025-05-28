from typing import Any

import requests
from tenacity import retry, stop_after_attempt, wait_fixed, retry_if_exception_type

from proto_gen import scrape_task_pb2
from .base_scraper import BaseScraper



class ApiScraper(BaseScraper):
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_fixed(2),
        retry=retry_if_exception_type(requests.exceptions.RequestException)
    )
    def scrape(self, task: scrape_task_pb2.ScrapeTask) -> Any:
        print(f"[{task.job_id}] Starting API scrape: {task.url}")
        response = requests.request(
            method=task.method.upper() or "GET",
            url=task.url,
            headers=dict(task.headers),
            params=dict(task.params),
            data=task.body,
            timeout=10
        )
        response.raise_for_status()
        print(f"[{task.job_id}] API scrape successful")
        return response.json()

class ApiScraper(BaseScraper):
    def __init__(self, url: str, method: str, headers: dict = None, params: dict = None, body: dict = None):
        super().__init__(url, method, headers, params, body)

    def scrape(self) -> dict:
        try:
            if self.method == 'GET':
                resp = requests.get(self.url, headers=self.headers, params=self.params)
            elif self.method == 'POST':
                resp = requests.post(self.url, headers=self.headers, json=self.body)
            elif self.method == 'PUT':
                resp = requests.put(self.url, headers=self.headers, json=self.body)
            elif self.method == 'DELETE':
                resp = requests.delete(self.url, headers=self.headers, json=self.body)
            elif self.method == 'PATCH':
                resp = requests.patch(self.url, headers=self.headers, json=self.body)
            elif self.method == 'OPTIONS':
                resp = requests.options(self.url, headers=self.headers, params=self.params)
            elif self.method == 'HEAD':
                resp = requests.head(self.url, headers=self.headers, params=self.params)
            else:
                raise ValueError("Unsupported HTTP method.")
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            print(f"An error occurred: {e}")
            return None


class ApiScraper(BaseScraper):
    def scrape(self):
        method = self.task.method
        response = requests.request(
            method,
            self.task.url,
            headers=self.task.headers,
            params=self.task.params,
            data=self.task.body
        )
        response.raise_for_status()
        return response.json()
