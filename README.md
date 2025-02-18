# scrape-as-a-service

## Overview
This repository provides a **Scrape-as-a-Service** platform that enables users to extract structured data from web pages effortlessly. The system allows users to specify:
- A list of **CSV headers** (defining the expected structured output).
- A list of **URLs** to scrape.

The backend system handles the web scraping process efficiently using **Kubernetes Ephemeral Pods**, **Redis** for task queueing, and **DeepSeek LLM** for intelligent HTML parsing.

## Usage
1. Access the web UI.
2. Enter the list of CSV headers and URLs to scrape.
3. Submit the request.
4. Wait for the job to complete and download the structured data.

`screenshot`

## Features
- **Web-Based UI**: Users can submit scraping jobs through a simple web interface.
- **Kubernetes Ephemeral Pods**: Each scrape job runs in a temporary containerized environment.
- **Redis Task Queue**: Ensures efficient job management and distribution.
- **LLM-Powered Parsing**: Uses DeepSeek to intelligently extract and structure HTML content.

How It Works
- spin up infrastructure
  - Redis Queue
  - Kubernetes Ephemeral Pods
  - Ollama server
- user submits request
  - Redis Queue `tasks` - enqueues task
  - Kubernetes Ephemeral Pods
    - connects and scrapes from website
    - connects to Ollama and parses with LLM
    - returns structured CSV data
  - Redis Queue `results` - saves task results

## Setup
### Prerequisites
- Kubernetes Cluster (e.g., Minikube, GKE, EKS)
- Redis (for task queueing)
- Python 3.9+
- Helm (for deploying Kubernetes resources)

### Installation
1. Clone the repository:
   ```sh
   git clone https://github.com/yourusername/scrape-as-a-service.git
   ```
2. Deploy Redis:
   ```sh
   helm install redis bitnami/redis
   ```
3. Deploy the application:
   ```sh
   kubectl apply -f k8s/
   ```
4. Set up environment variables:
   ```sh
   export REDIS_HOST="your-redis-host"
   export LLM_API_KEY="your-llm-key"
   ```
5. Start the service:
   ```sh
   python main.py
   ```

## License
This project is under the MIT License.