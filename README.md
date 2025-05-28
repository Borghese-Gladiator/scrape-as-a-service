# scrape-as-a-service
Scrape as a Service is a scalable scraping platform for extracting web pages and parsing HTML results into structured data using LLMs.

This platform scales by queueing all scrape jobs into an ingestion pipeline and then scaling the number of workers based on the queue depth.

## Architecture

- **Frontend**: React (Vite)
- **API Server**: FastAPI
- **Worker**: `worker-py` (Python)

**Infrastructure:**
- **Redis**: Handles data ingest pipeline and scrape completion notifications
- **Kafka (kraft mode)**: Handles data ingest pipeline
- **Minio**: Object storage for raw and structured results
- **Ollama**: Handles LLM requests

## Example Flow

1. Frontend sends a `/scrape` request.
2. Server enqueues the scrape request into Redis/Kafka.
3. `worker-py` processes the job:
   - Scrapes the target (API, HTML, or browser-based)
   - Saves raw results to Minio
   - Sends content to Ollama for LLM-powered parsing and saves structured results to Minio
   - Publishes a scrape completion notification (with `job_id`) to Redis
4. Frontend polls the server for results using `job_id`:
   - Server checks Redis for completion notification
   - If present, server retrieves data from Minio and returns it

## Local Development

1. **Run infrastructure:**
   ```sh
   docker compose up -d
   ```
2. Run code
   - run frontend: [README.md](/app/frontend/README.md)
   - run server: [README.md](/app/server/README.md)
   - run worker: [README.md](/app/worker-py/README.md)

## Usage
- Access web UI online here (TODO) OR view locally here (TODO)
  - screenshot here (TODO)
- Enter URLs to scrape
  - Configure method, headers, parameters, or body if needed
- Submit request list
- Wait for job to complete and download structured data


## Planned Features
- **LLM-Powered Parsing**: Uses DeepSeek to intelligently extract and structure HTML content.
- **Kubernetes Ephemeral Pods**: Each scrape job runs in a temporary containerized environment.


<details>
<summary>Archived Info</summary>

# Misc
Selenium
- XPath
 - search prefixed with "//" will search the entire document, not just the children of this current node.
 - Use ".//" to limit your search to the children of the receiving Element

Python
- Be careful of stray commas - `abc = "abc",` creates a tuple with "abc" and ''


# Failed Implementations
### Scrapers per Website
I wrote scrapers per website, but it quickly became unsustainable and they had to be fixed repeatedly for their given websites.

It had some good ideas, but became super hard to scale anything since I couldn't figure out how to run multiple of a poetry package nor how to install it on a Docker container.

Implementation Steps
- Each run script loads the list of URLs to scrape.
- The run script calls the `Producer.enqueue` to create scrape jobs at a Redis key specified in `utils/constants.py`
- The run script calls the corresponding `Webdriver.process_jobs` to constantly scrape until the queue is finished

### RQ Failed Implementation
To simplify my scrape at scale project, I am using OOP to encapsulate each part. BaseProducer handles redis message logic and BaseWebdriver handles proxy rotation, header rotation, etc.. RQ expects the logic to be on the Producer side so it can pass scrape jobs and have workers that can process any job. This means RQ can only handle functions and cannot handle class methods since it cannot pass the instance easily (eg: Webdriver for Selenium nor session data). Furthermore, I don't want to spin up/down a webdriver within the scrape function. I want to reuse it. Due to these two reasons (instance methods not working + webdriver reusage), I need to use my own Redis Queue implementation.

In general, the correct logic for my use case is Producer is dumb and simply enqueues URLs. The Consumer has the logic to scrape those URLs and put it back on the failed message queue.

</details>


---
The user provides a natural language prompt, like:
"Get me all the product names, prices, and reviews from this page"

You use a small/fast model (or toolkit) to identify the relevant HTML sections (e.g., divs, tables, spans)

Then pass only that filtered HTML to a larger model for final structured parsing.

