# Server
FastAPI server to handle API requests from frontend

Features
- kicks off scrape jobs (enqueue in Kafka)
- reads data from scrape jobs (dequeue from Kafka)

Steps to Run
- `poetry install`
- `Invoke-Expression (poetry env activate)`
- `fastapi dev main.py`

<details>
<summary>Steps to Implement</summary>

- `poetry init`
- `poetry add fastapi[standard]`
- VSCode - select Python interpreter using path from `poetry env info`
- `Invoke-Expression (poetry env activate)`
- create `main.py`
- `fastapi dev main.py` - run dev server

</details>
