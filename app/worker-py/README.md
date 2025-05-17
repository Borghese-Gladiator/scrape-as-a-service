# worker-py
`worker-py` is a Python worker service for the Scrape as a Service platform. It is responsible for processing scrape jobs from both Redis streams and Kafka topics, executing the scrape (API, HTML, or WEBDRIVER), saving results to Minio object storage, and publishing job completion notifications.

## Features & How It Works

- **Job Ingestion**: Reads scrape jobs from Redis streams and Kafka topics. Listens to configured sources for new scrape tasks.
- **Flexible Scraping**: Supports scraping API endpoints, HTML pages, and browser-based (WEBDRIVER) content. Depending on the job type, performs the appropriate scraping logic (API request, HTML fetch, or browser automation).
- **Result Storage**: Saves raw and processed scrape results to Minio, organizing them by job and type.
- **Completion Notification**: Publishes job completion (by `job_id`) to a Redis Sorted Set for downstream consumers. Adds an entry to signal that the job has finished, including the `job_id` and result location.

## Usage

1. Install dependencies:
   ```sh
   poetry install
   ```
