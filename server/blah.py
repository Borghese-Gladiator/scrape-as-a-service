import logging

from fastapi import FastAPI, HTTPException
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry import trace


#=================
#   CONSTANTS
#=================
app = FastAPI()

#=================
#   MIDDLEWARE
#=================
# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configure OpenTelemetry tracing
tracer_provider = TracerProvider()
span_processor = BatchSpanProcessor(OTLPSpanExporter(endpoint="http://otel-collector:4317"))
tracer_provider.add_span_processor(span_processor)
trace.set_tracer_provider(tracer_provider)

tracer = trace.get_tracer(__name__)

# Auto-instrument FastAPI
FastAPIInstrumentor.instrument_app(app)

#=================
#   ROUTES
#=================
@app.get("/")
async def read_root():
    return {"message": "Hello, OpenTelemetry!"}

@app.get("/items/{item_id}")
async def read_item(item_id: int):
    return {"item_id": item_id}

@app.get("/error")
async def error_endpoint():
    with tracer.start_as_current_span("error_span"):
        try:
            raise ValueError("Something went wrong!")
        except ValueError as e:
            logger.error(f"Error occurred: {e}")
            span = trace.get_current_span()
            span.record_exception(e)  # Attach exception details to the trace
            span.set_status(trace.Status(status_code=trace.StatusCode.ERROR, description=str(e)))
            raise HTTPException(status_code=500, detail="Internal Server Error")
