const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type RoomCategory =
  | "apartment"
  | "apartment_room"
  | "communal"
  | "facility";

export type UtilityType =
  | "electricity"
  | "hot_water"
  | "cold_water"
  | "gas"
  | "other"
  | "aux"
  | "temperature"
  | "level";

export interface Property {
  id: string;
  code: string;
  name: string;
  address: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface LivingType {
  id: string;
  name: string;
  abbreviation: string | null;
  water_daily_litres_per_person: number | null;
  created_at: string;
  updated_at: string;
}

export interface AllowancePeriod {
  id: string;
  name: string | null;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomType {
  id: string;
  name: string;
  category: RoomCategory;
  shareable: boolean;
  living_type_id: string | null;
  living_type: LivingType | null;
  occupancy: number;
  show_message: boolean;
  message: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomRole {
  id: string;
  code: string;
  name: string;
  tone: "neutral" | "emerald" | "amber" | "red" | "sky";
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  number: number | null;
  room_type_id: string;
  parent_room_id: string | null;
  property_id: string | null;
  role_id: string | null;
  notes: string | null;
  room_type: RoomType;
  property: Property | null;
  role: RoomRole | null;
  created_at: string;
  updated_at: string;
}

export interface Meter {
  id: string;
  external_id: string;
  name: string | null;
  utility_type: UtilityType;
  influx_measurement: string;
  units: string | null;
  room_id: string | null;
  parent_meter_id: string | null;
  property_id: string | null;
  description: string | null;
  last_seen_value: number | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscoveredMeter {
  external_id: string;
  influx_measurement: string;
  category: string | null;
  apartment: string | null;
  sub_meter: string | null;
  units: string | null;
  description: string | null;
  last_seen: string | null;
}

export interface Tariff {
  id: string;
  property_id: string;
  period_id: string | null;
  living_type_id: string | null;
  utility_type: UtilityType | null;
  starts_at: string;
  ends_at: string | null;
  unit_rate: string;
  currency: string;
  note: string | null;
  living_type: LivingType | null;
  period: AllowancePeriod | null;
  created_at: string;
  updated_at: string;
}

export interface LatestReading {
  external_id: string;
  influx_measurement: string;
  value: number;
  units: string | null;
  last_seen: string;
  stale: boolean;
  room_id: string | null;
  room_name: string | null;
  utility_type: string | null;
}

export interface CategoryTotal {
  category: string;
  utility_type: string;
  total: number;
  units: string | null;
}

export interface OverviewResponse {
  from_: string;
  to: string;
  totals: Record<string, number>;
  breakdown: CategoryTotal[];
}

export interface TimeseriesPoint {
  ts: string;
  value: number;
}

export interface RoomUsageSeries {
  utility_type: string;
  units: string | null;
  points: TimeseriesPoint[];
}

export interface RoomUsageResponse {
  room_id: string;
  from_: string;
  to: string;
  series: RoomUsageSeries[];
}

export interface TrendBucket {
  period_start: string;
  value: number;
  previous_year_value: number | null;
}

export interface TrendResponse {
  utility_type: string;
  units: string | null;
  buckets: TrendBucket[];
}

async function http<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, string | number | boolean | undefined> },
): Promise<T> {
  const { query, ...rest } = init ?? {};
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
    cache: "no-store",
    ...rest,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  properties: {
    list: () => http<Property[]>("/properties"),
    get: (id: string) => http<Property>(`/properties/${id}`),
    create: (body: Omit<Property, "id" | "created_at" | "updated_at">) =>
      http<Property>("/properties", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Property>) =>
      http<Property>(`/properties/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: string) => http<void>(`/properties/${id}`, { method: "DELETE" }),
  },
  livingTypes: {
    list: () => http<LivingType[]>("/living-types"),
    create: (body: { name: string; abbreviation?: string | null }) =>
      http<LivingType>("/living-types", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<LivingType>) =>
      http<LivingType>(`/living-types/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: string) => http<void>(`/living-types/${id}`, { method: "DELETE" }),
  },
  allowancePeriods: {
    list: () => http<AllowancePeriod[]>("/allowance-periods"),
    create: (body: { name?: string | null; starts_at: string; ends_at?: string | null }) =>
      http<AllowancePeriod>("/allowance-periods", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Pick<AllowancePeriod, "name" | "starts_at" | "ends_at">>) =>
      http<AllowancePeriod>(`/allowance-periods/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: string) => http<void>(`/allowance-periods/${id}`, { method: "DELETE" }),
  },
  roomRoles: {
    list: () => http<RoomRole[]>("/room-roles"),
    create: (body: { code: string; name: string; tone?: string }) =>
      http<RoomRole>("/room-roles", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<RoomRole>) =>
      http<RoomRole>(`/room-roles/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: string) => http<void>(`/room-roles/${id}`, { method: "DELETE" }),
  },
  roomTypes: {
    list: () => http<RoomType[]>("/room-types"),
    create: (body: {
      name: string;
      category: RoomCategory;
      shareable?: boolean;
      living_type_id?: string | null;
      occupancy?: number;
      show_message?: boolean;
      message?: string | null;
    }) => http<RoomType>("/room-types", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<RoomType>) =>
      http<RoomType>(`/room-types/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: string) => http<void>(`/room-types/${id}`, { method: "DELETE" }),
  },
  rooms: {
    list: (opts?: {
      category?: RoomCategory;
      parent_id?: string;
      property_id?: string;
      living_type_id?: string;
      roots_only?: boolean;
    }) => http<Room[]>("/rooms", { query: opts }),
    get: (id: string) => http<Room>(`/rooms/${id}`),
    create: (body: {
      code: string;
      name: string;
      number?: number | null;
      room_type_id: string;
      parent_room_id?: string | null;
      property_id?: string | null;
      notes?: string | null;
    }) => http<Room>("/rooms", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Room>) =>
      http<Room>(`/rooms/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: string) => http<void>(`/rooms/${id}`, { method: "DELETE" }),
  },
  meters: {
    list: (opts?: {
      room_id?: string;
      utility_type?: UtilityType;
      property_id?: string;
      parent_meter_id?: string;
      unassigned?: boolean;
      roots_only?: boolean;
    }) => http<Meter[]>("/meters", { query: opts }),
    create: (body: {
      external_id: string;
      name?: string | null;
      utility_type: UtilityType;
      influx_measurement: string;
      units?: string | null;
      room_id?: string | null;
      parent_meter_id?: string | null;
      property_id?: string | null;
      description?: string | null;
    }) => http<Meter>("/meters", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Meter>) =>
      http<Meter>(`/meters/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: string) => http<void>(`/meters/${id}`, { method: "DELETE" }),
    discover: () => http<DiscoveredMeter[]>("/meters/discover"),
  },
  tariffs: {
    list: (opts?: {
      property_id?: string;
      living_type_id?: string;
      utility_type?: UtilityType;
      period_id?: string;
    }) => http<Tariff[]>("/tariffs", { query: opts }),
    create: (body: {
      property_id: string;
      period_id?: string | null;
      living_type_id?: string | null;
      utility_type?: UtilityType | null;
      starts_at: string;
      ends_at?: string | null;
      unit_rate: number | string;
      currency?: string;
      note?: string | null;
    }) => http<Tariff>("/tariffs", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Tariff>) =>
      http<Tariff>(`/tariffs/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: string) => http<void>(`/tariffs/${id}`, { method: "DELETE" }),
  },
  usage: {
    latest: () => http<LatestReading[]>("/usage/latest"),
    overview: (from: string, to: string) =>
      http<OverviewResponse>("/usage/overview", { query: { from, to } }),
    byRoom: (room_id: string, from: string, to: string, interval = "1h") =>
      http<RoomUsageResponse>(`/usage/by-room/${room_id}`, {
        query: { from, to, interval },
      }),
    trends: (utility: UtilityType, period = "monthly", lookback = 12) =>
      http<TrendResponse>("/usage/trends", { query: { utility, period, lookback } }),
  },
  occupancy: {
    byApartment: (living_type: string) =>
      http<ApartmentOccupancyResponse>("/occupancy/by-apartment", {
        query: { living_type },
      }),
  },
  reports: {
    apartment: (living_type: string, on?: string) =>
      http<ApartmentReportResponse>("/usage/apartment-report", {
        query: { living_type, ...(on ? { on } : {}) },
      }),
    communalRoom: (on?: string) =>
      http<CommunalReportResponse>("/usage/communal-room-report", {
        query: on ? { on } : undefined,
      }),
  },
  insights: {
    buildingOverview: (on?: string) =>
      http<BuildingOverviewResponse>("/usage/building-overview", {
        query: on ? { on } : undefined,
      }),
    apartment: (living_type: string, on?: string) =>
      http<InsightsResponse>("/usage/apartment-insights", {
        query: { living_type, ...(on ? { on } : {}) },
      }),
    staffQuarters: (on?: string) =>
      http<StaffQuartersResponse>("/usage/staff-quarters", {
        query: on ? { on } : undefined,
      }),
    dailySeries: (living_type: string, days = 7, on?: string) =>
      http<DailySeriesResponse>("/usage/apartment-daily-series", {
        query: { living_type, days, ...(on ? { on } : {}) },
      }),
    communalRooms: (on?: string) =>
      http<CommunalInsightsResponse>("/usage/communal-room-insights", {
        query: on ? { on } : undefined,
      }),
    communalDaily: (days = 10, on?: string) =>
      http<CommunalDailySeriesResponse>("/usage/communal-daily-series", {
        query: { days, ...(on ? { on } : {}) },
      }),
    apartmentAnomalies: (living_type: string, days = 14, on?: string) =>
      http<ApartmentAnomaliesResponse>("/usage/apartment-anomalies", {
        query: { living_type, days, ...(on ? { on } : {}) },
      }),
    communalAnomalies: (days = 14, on?: string) =>
      http<CommunalAnomaliesResponse>("/usage/communal-anomalies", {
        query: { days, ...(on ? { on } : {}) },
      }),
    apartmentLeakDetail: (apartment_number: number, living_type = "Apartment Living", days = 7, on?: string) =>
      http<ApartmentLeakDetailResponse>("/usage/apartment-leak-detail", {
        query: { apartment_number, living_type, days, ...(on ? { on } : {}) },
      }),
    perPersonBudget: (living_type: string, on?: string) =>
      http<PerPersonBudgetResponse>("/usage/per-person-budget", {
        query: { living_type, ...(on ? { on } : {}) },
      }),
    baselineDraw: (living_type = "Apartment Living", nights = 7, on?: string) =>
      http<BaselineDrawResponse>("/usage/apartment-baseline-draw", {
        query: { living_type, nights, ...(on ? { on } : {}) },
      }),
    submeterBreakdown: (apartment_number: number, living_type = "Apartment Living", on?: string) =>
      http<SubmeterBreakdownResponse>("/usage/apartment-submeter-breakdown", {
        query: { apartment_number, living_type, ...(on ? { on } : {}) },
      }),
    communalBaselineDraw: (nights = 7, on?: string) =>
      http<CommunalBaselineDrawResponse>("/usage/communal-baseline-draw", {
        query: { nights, ...(on ? { on } : {}) },
      }),
    communalSubmeterBreakdown: (room_id: string, on?: string) =>
      http<CommunalSubmeterBreakdownResponse>("/usage/communal-submeter-breakdown", {
        query: { room_id, ...(on ? { on } : {}) },
      }),
    apartmentDetail: (apartment_number: number, living_type = "Apartment Living", on?: string) =>
      http<ApartmentDetailResponse>("/usage/apartment-detail", {
        query: { apartment_number, living_type, ...(on ? { on } : {}) },
      }),
    communalRoomDetail: (room_id: string, on?: string) =>
      http<CommunalRoomDetailResponse>("/usage/communal-room-detail", {
        query: { room_id, ...(on ? { on } : {}) },
      }),
  },
  allowances: {
    list: (living_type_id?: string) =>
      http<Allowance[]>("/allowances", { query: living_type_id ? { living_type_id } : undefined }),
    upsert: (body: AllowanceUpsert) =>
      http<Allowance>("/allowances", { method: "POST", body: JSON.stringify(body) }),
    remove: (id: string) =>
      http<void>(`/allowances/${id}`, { method: "DELETE" }),
  },
};

// --- Building overview ------------------------------------------------------

export interface BuildingOccupancy {
  students_apartment_living: number;
  students_communal_living: number;
  students_total: number;
  staff: number;
  office: number | null;
  total_tracked: number;
}

export interface BuildingElectricity {
  apartment_living_mtd_kwh: number;
  communal_living_mtd_kwh: number;
  staff_mtd_kwh: number;
  building_total_mtd_kwh: number;
  building_total_mtd_cost: number;
  avg_kwh_per_person_per_day: number;
  rate_per_kwh: number;
}

export interface WaterAlertApartment {
  apartment_number: number;
  occupants: number;
  value_per_person: number;
}

export interface WaterAlerts {
  daily_cap_litres: number | null;
  monthly_cap_litres: number | null;
  yesterday_over_cap: WaterAlertApartment[];
  forecast_over_monthly: WaterAlertApartment[];
}

export interface HeavyApartment {
  apartment_number: number;
  occupants: number;
  mtd_kwh_per_person: number;
  percentile_rank: number;
}

export interface HeavyRoom {
  room_number: number;
  room_type: string;
  occupants: number;
  mtd_kwh_per_person: number;
  percentile_rank: number;
}

export interface ElectricityHeavyUsers {
  apartments_top_decile: HeavyApartment[];
  communal_rooms_top_decile: HeavyRoom[];
}

export interface BuildingOverviewResponse {
  report_date: string;
  snapshot_date: string | null;
  days_elapsed_mtd: number;
  days_in_month: number;
  occupancy: BuildingOccupancy;
  electricity: BuildingElectricity;
  water_alerts: WaterAlerts;
  electricity_heavy_users: ElectricityHeavyUsers;
}

// --- Communal report (Excel-style table) ------------------------------------

export interface RoomElectricity {
  yesterday: UtilityPeriod;
  mtd: UtilityPeriod;
  avg_per_day: UtilityPeriod;
}

export interface RoomReportRow {
  room_id: string;
  room_number: number;
  room_type: string;
  occupants: number;
  beds: number;
  electricity: RoomElectricity;
}

export interface CommunalReportResponse {
  living_type: string;
  report_date: string;
  snapshot_date: string | null;
  days_elapsed_mtd: number;
  tariff_rate_per_kwh: number;
  rooms: RoomReportRow[];
}

// --- Apartment insights -----------------------------------------------------

export interface UtilityFlags {
  top_decile: boolean;
  forecast_over_median_15x: boolean;
}

export interface CombinedWaterFlags {
  over_daily: boolean;
  over_monthly: boolean;
}

export interface CombinedWaterInsight {
  yesterday_units_per_person: number;
  mtd_units_per_person: number;
  eom_forecast_units_per_person: number;
  daily_limit: number | null;
  monthly_limit: number | null;
  flags: CombinedWaterFlags;
}

export interface UtilityInsight {
  utility_type: string;
  units_label: string;
  yesterday_units: number;
  yesterday_units_per_person: number;
  mtd_units: number;
  mtd_units_per_person: number;
  mtd_cost: number;
  mtd_cost_per_person: number;
  eom_forecast_units_per_person: number;
  eom_forecast_cost: number;
  eom_forecast_cost_per_person: number;
  percentile_rank: number;
  cohort_median: number;
  cohort_p90: number;
  flags: UtilityFlags;
}

export interface ApartmentInsight {
  apartment_number: number;
  occupants: number;
  beds: number;
  utilities: Record<string, UtilityInsight>;
  combined_water: CombinedWaterInsight;
  total_mtd_cost: number;
  total_eom_forecast_cost: number;
  risk_score: number;
  flags_summary: string[];
}

export interface CohortStats {
  median: number;
  p75: number;
  p90: number;
  p95: number;
}

export interface WaterLimitInfo {
  daily: number | null;
  monthly: number | null;
}

export interface InsightsResponse {
  living_type: string;
  living_type_id: string | null;
  report_date: string;
  snapshot_date: string | null;
  days_elapsed_mtd: number;
  days_in_month: number;
  water_limit: WaterLimitInfo;
  cohort_stats: Record<string, CohortStats>;
  apartments: ApartmentInsight[];
  caveats: string[];
}

// --- Daily series (for trends tabs) -----------------------------------------

export interface DailyEntry {
  date: string;
  cold_water_litres: number;
  hot_water_litres: number;
  combined_water_litres: number;
  electricity_kwh: number;
}

export interface DailyEntryPerPerson {
  date: string;
  cold_water_litres_pp: number;
  hot_water_litres_pp: number;
  combined_water_litres_pp: number;
  electricity_kwh_pp: number;
}

export interface ApartmentDailySeries {
  apartment_number: number;
  occupants: number;
  days_total: DailyEntry[];
  days_per_person: DailyEntryPerPerson[];
  days_over_water_limit: number;
  days_in_top_decile_electricity: number;
}

export interface DailySeriesResponse {
  living_type: string;
  date_range: [string, string];
  days: number;
  water_daily_limit: number | null;
  apartments: ApartmentDailySeries[];
}

// --- Anomalies --------------------------------------------------------------

export interface SpikeFlag {
  utility: string;
  severity: "amber" | "red";
  today_per_person: number;
  baseline_median: number;
  threshold_amber: number;
  threshold_red: number;
  robust_z: number;
}

export interface LeakFlag {
  severity: "amber" | "red";
  avg_overnight_litres: number;
  consecutive_nights: number;
  peak_night_litres: number;
  nights_over_threshold: number;
  threshold_litres: number;
}

export interface DowFlag {
  utility: string;
  severity: "amber" | "red";
  today_per_person: number;
  dow_median_per_person: number;
  ratio: number;
  day_name: string;
}

export interface DailyPoint {
  date: string;
  water_pp: number;
  electricity_pp: number;
}

export interface ApartmentAnomaly {
  apartment_number: number;
  occupants: number;
  spikes: SpikeFlag[];
  leak: LeakFlag | null;
  dow: DowFlag[];
  anomaly_score: number;
  daily_series: DailyPoint[];
  baseline_median_water_pp: number | null;
  baseline_q1_water_pp: number | null;
  baseline_q3_water_pp: number | null;
  baseline_median_elec_pp: number | null;
  baseline_q1_elec_pp: number | null;
  baseline_q3_elec_pp: number | null;
}

export interface ApartmentAnomaliesResponse {
  living_type: string;
  report_date: string;
  baseline_window_days: number;
  entries: ApartmentAnomaly[];
  cohort_red_count: number;
  cohort_amber_count: number;
  caveats: string[];
}

export interface RoomAnomaly {
  room_number: number;
  room_type: string;
  occupants: number;
  spikes: SpikeFlag[];
  dow: DowFlag[];
  anomaly_score: number;
  daily_series: DailyPoint[];
  baseline_median_elec_pp: number | null;
  baseline_q1_elec_pp: number | null;
  baseline_q3_elec_pp: number | null;
}

export interface HourlyCell {
  hour_utc: string;
  hour_sast: string;
  sast_date: string;
  sast_hour: number;
  cold_litres: number;
  hot_litres: number;
  total_litres: number;
}

export interface NightSummary {
  sast_date: string;
  cold_litres_overnight: number;
  hot_litres_overnight: number;
  total_litres_overnight: number;
  over_threshold: boolean;
}

export interface ApartmentLeakDetailResponse {
  apartment_number: number;
  living_type: string;
  days: number;
  window_start_hour: number;
  window_end_hour: number;
  leak_threshold_litres: number;
  cells: HourlyCell[];
  nights: NightSummary[];
}

// --- Sources (baseline draw + submeter breakdown) ----------------------------

export interface BaselineRow {
  apartment_number: number;
  occupants: number;
  avg_overnight_kwh: number;
  avg_overnight_watts: number;
  nights_observed: number;
  severity: "amber" | "red" | null;
}

export interface BaselineDrawResponse {
  living_type: string;
  report_date: string;
  nights: number;
  window_start_hour: number;
  window_end_hour: number;
  cohort_median_watts: number;
  cohort_p75_watts: number;
  cohort_p90_watts: number;
  rows: BaselineRow[];
}

export interface SubmeterRow {
  external_id: string;
  room_number: number | null;
  room_name: string;
  mtd_kwh: number;
  mtd_cost: number;
  pct_of_apartment_total: number;
}

export interface SubmeterBreakdownResponse {
  apartment_number: number;
  living_type: string;
  report_date: string;
  days_elapsed_mtd: number;
  total_submeter_mtd_kwh: number;
  total_submeter_mtd_cost: number;
  main_meter_external_id: string | null;
  main_meter_mtd_kwh: number | null;
  submeters: SubmeterRow[];
}

// --- Sources tab (communal) -------------------------------------------------

export interface CommunalBaselineRow {
  room_id: string;
  room_number: number;
  room_name: string;
  room_type: string;
  occupants: number;
  avg_overnight_kwh: number;
  avg_overnight_watts: number;
  nights_observed: number;
  severity: "amber" | "red" | null;
}

export interface CommunalBaselineDrawResponse {
  living_type: string;
  report_date: string;
  nights: number;
  window_start_hour: number;
  window_end_hour: number;
  cohort_median_watts: number;
  cohort_p75_watts: number;
  cohort_p90_watts: number;
  rows: CommunalBaselineRow[];
}

export interface CommunalSubmeterRow {
  external_id: string;
  mtd_kwh: number;
  mtd_cost: number;
  pct_of_room_total: number;
}

export interface CommunalSubmeterBreakdownResponse {
  room_id: string;
  room_number: number;
  room_name: string;
  living_type: string;
  report_date: string;
  days_elapsed_mtd: number;
  total_submeter_mtd_kwh: number;
  total_submeter_mtd_cost: number;
  main_meter_external_id: string | null;
  main_meter_mtd_kwh: number | null;
  submeters: CommunalSubmeterRow[];
}

// --- Apartment detail page --------------------------------------------------

export interface ApartmentDetailUtilityCard {
  utility_type: string;
  units_label: string;
  cost_per_unit: number;
  opening_reading: number | null;
  closing_reading: number | null;
  yesterday_units: number;
  mtd_units: number;
  mtd_cost: number;
}

export interface ApartmentDetailBedroomRow {
  room_id: string;
  room_number: number | null;
  room_name: string;
  external_id: string;
  opening_reading: number;
  current_reading: number;
  mtd_kwh: number;
  mtd_cost: number;
  mtd_pct: number;
  today_kwh: number;
  today_cost: number;
  today_pct: number;
}

export interface ApartmentDetailBudget {
  accommodation_rate_per_person_per_month: number | null;
  monthly_allowance_total: number;
  monthly_allowance_per_person: number;
  mtd_cost_total: number;
  mtd_cost_per_person: number;
  pct_consumed: number;
  projected_eom_cost: number;
  projected_eom_cost_per_person: number;
  projected_depletion_date: string | null;
  already_over: boolean;
  forecast_over: boolean;
}

export interface ApartmentDetailFlag {
  code: string;
  severity: "amber" | "red";
  description: string;
}

export interface ApartmentDetailResponse {
  apartment_number: number;
  living_type: string;
  report_date: string;
  days_in_month: number;
  days_elapsed_mtd: number;
  occupants: number;
  beds: number;
  snapshot_date: string | null;
  budget: ApartmentDetailBudget;
  utilities: Record<string, ApartmentDetailUtilityCard>;
  bedrooms: ApartmentDetailBedroomRow[];
  flags: ApartmentDetailFlag[];
}

// --- Communal room detail ---------------------------------------------------

export interface CommunalElectricityCard {
  cost_per_kwh: number;
  opening_reading: number | null;
  closing_reading: number | null;
  yesterday_kwh: number;
  mtd_kwh: number;
  mtd_cost: number;
}

export interface CommunalRoomBudget {
  accommodation_rate_per_person_per_month: number | null;
  monthly_allowance_total: number;
  monthly_allowance_per_person: number;
  mtd_cost_total: number;
  mtd_cost_per_person: number;
  pct_consumed: number;
  projected_eom_cost: number;
  projected_eom_cost_per_person: number;
  projected_depletion_date: string | null;
  already_over: boolean;
  forecast_over: boolean;
}

export interface CommunalRoomFlag {
  code: string;
  severity: "amber" | "red";
  description: string;
}

export interface CommunalRoomDetailResponse {
  room_id: string;
  room_number: number;
  room_name: string;
  room_type: string;
  living_type: string;
  report_date: string;
  days_in_month: number;
  days_elapsed_mtd: number;
  occupants: number;
  beds: number;
  snapshot_date: string | null;
  budget: CommunalRoomBudget;
  electricity: CommunalElectricityCard;
  flags: CommunalRoomFlag[];
}

export interface BudgetRow {
  entity_label: string;
  entity_number: number;
  entity_type: "apartment" | "room";
  room_type: string | null;
  occupants: number;
  mtd_water_litres: number | null;
  mtd_electricity_kwh: number;
  mtd_water_cost: number;
  mtd_electricity_cost: number;
  mtd_total_cost: number;
  eom_forecast_total_cost: number;
  monthly_allowance_cost: number;
  daily_allowance_cost: number;
  pct_consumed: number;
  already_over: boolean;
  forecast_over: boolean;
  predicted_over_date: string | null;
}

export interface PerPersonBudgetResponse {
  living_type: string;
  report_date: string;
  days_in_month: number;
  days_elapsed_mtd: number;
  days_remaining: number;
  accommodation_rate_per_person_per_month: number | null;
  daily_rate_per_person: number | null;
  rows: BudgetRow[];
}

export interface CommunalAnomaliesResponse {
  living_type: string;
  report_date: string;
  baseline_window_days: number;
  entries: RoomAnomaly[];
  cohort_red_count: number;
  cohort_amber_count: number;
  caveats: string[];
}

// --- Communal Insights ------------------------------------------------------

export interface ElectricityFlags {
  top_decile: boolean;
  forecast_over_median_15x: boolean;
}

export interface ElectricityStats {
  yesterday_kwh: number;
  yesterday_kwh_per_person: number;
  mtd_kwh: number;
  mtd_kwh_per_person: number;
  mtd_cost: number;
  mtd_cost_per_person: number;
  eom_forecast_kwh_per_person: number;
  eom_forecast_cost: number;
  eom_forecast_cost_per_person: number;
  percentile_rank: number;
  cohort_median: number;
  cohort_p90: number;
  flags: ElectricityFlags;
}

export interface RoomInsight {
  room_id: string;
  room_number: number;
  name: string;
  room_type: string;
  occupants: number;
  beds: number;
  electricity: ElectricityStats;
  risk_score: number;
  flags_summary: string[];
}

export interface CommunalInsightsResponse {
  living_type: string;
  report_date: string;
  snapshot_date: string | null;
  days_elapsed_mtd: number;
  days_in_month: number;
  cohort_stats: CohortStats;
  rooms: RoomInsight[];
  caveats: string[];
}

export interface DailyElectricityEntry {
  date: string;
  kwh: number;
  kwh_per_person: number;
}

export interface RoomDailySeries {
  room_id: string;
  room_number: number;
  name: string;
  occupants: number;
  days: DailyElectricityEntry[];
  days_in_top_decile: number;
}

export interface CommunalDailySeriesResponse {
  living_type: string;
  date_range: [string, string];
  days: number;
  rooms: RoomDailySeries[];
}

// --- Staff Quarters ---------------------------------------------------------

export interface StaffUtility {
  utility_type: string;
  units_label: string;
  yesterday_units: number;
  yesterday_cost: number;
  mtd_units: number;
  mtd_cost: number;
}

export interface StaffRoom {
  room_id: string;
  name: string;
  notes: string | null;
  occupants: number;
  utilities: Record<string, StaffUtility>;
  total_yesterday_cost: number;
  total_mtd_cost: number;
}

export interface StaffQuartersResponse {
  report_date: string;
  rooms: StaffRoom[];
}

// --- Living type allowances (writable) --------------------------------------

export interface Allowance {
  id: string;
  living_type_id: string;
  utility_type: UtilityType;
  units_per_person: number;
  period: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AllowanceUpsert {
  living_type_id: string;
  utility_type: UtilityType;
  units_per_person: number;
  period?: string;
  note?: string | null;
}

export interface UtilityPeriod {
  units: number;
  cost: number;
}

export interface ApartmentUtility {
  utility_type: string;
  units_label: string;
  yesterday: UtilityPeriod;
  mtd: UtilityPeriod;
  avg_per_day: UtilityPeriod;
}

export interface ApartmentRow {
  apartment_number: number;
  occupants: number;
  beds: number;
  utilities: Record<string, ApartmentUtility>;
  total_cost_yesterday: number;
  total_cost_mtd: number;
  total_cost_avg_per_day: number;
}

export interface TariffInfo {
  utility_type: string;
  rate_per_unit: number;
  raw_rate: number;
  raw_unit: string;
  display_unit: string;
}

export interface ApartmentReportResponse {
  living_type: string;
  report_date: string;
  snapshot_date: string | null;
  days_elapsed_mtd: number;
  tariffs: Record<string, TariffInfo>;
  apartments: ApartmentRow[];
}

export interface ApartmentOccupancy {
  apartment_number: number;
  living_type: string;
  occupants: number;
  beds: number;
  rooms: number;
}

export interface ApartmentOccupancyResponse {
  snapshot_date: string | null;
  living_type: string;
  apartments: ApartmentOccupancy[];
}

export function periodRange(period: "today" | "week" | "month"): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  const from = new Date(now);
  if (period === "today") from.setHours(0, 0, 0, 0);
  if (period === "week") from.setDate(now.getDate() - 7);
  if (period === "month") from.setMonth(now.getMonth() - 1);
  return { from: from.toISOString(), to };
}
