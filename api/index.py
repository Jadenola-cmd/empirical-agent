from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import clean, analyze, health
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Empirical Analysis API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(clean.router,   prefix="/api/clean")
app.include_router(analyze.router, prefix="/api/analyze")

def handler(event, context):
    import mangum
    return mangum.Mangum(app)(event, context)
