import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import (  # noqa: F401 (registered below)
    allowance_periods,
    allowances,
    anomalies,
    apartment_daily_series,
    apartment_detail,
    apartment_insights,
    apartment_report,
    aux_tags,
    budget,
    building_overview,
    communal_daily_series,
    communal_detail,
    communal_insights,
    communal_report,
    hot_water_ring,
    leak_detail,
    living_types,
    meters,
    occupancy,
    properties,
    room_roles,
    room_types,
    rooms,
    sources,
    staff_quarters,
    tariffs,
    usage,
)

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s [%(levelname)s] %(message)s")

app = FastAPI(title="Buxton Utilities API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(properties.router)
app.include_router(living_types.router)
app.include_router(allowance_periods.router)
app.include_router(room_roles.router)
app.include_router(room_types.router)
app.include_router(rooms.router)
app.include_router(meters.router)
app.include_router(aux_tags.router)
app.include_router(hot_water_ring.router)
app.include_router(tariffs.router)
app.include_router(usage.router)
app.include_router(apartment_report.router)
app.include_router(apartment_insights.router)
app.include_router(apartment_detail.router)
app.include_router(apartment_daily_series.router)
app.include_router(building_overview.router)
app.include_router(anomalies.router)
app.include_router(leak_detail.router)
app.include_router(budget.router)
app.include_router(sources.router)
app.include_router(communal_insights.router)
app.include_router(communal_detail.router)
app.include_router(communal_daily_series.router)
app.include_router(communal_report.router)
app.include_router(staff_quarters.router)
app.include_router(allowances.router)
app.include_router(occupancy.router)
