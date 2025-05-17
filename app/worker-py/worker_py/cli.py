import typer
from app.worker import start_worker

app = typer.Typer()

@app.command()
def run():
    """Start the worker process."""
    typer.echo("Starting worker...")
    start_worker()

if __name__ == "__main__":
    app()
