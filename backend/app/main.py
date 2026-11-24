from __future__ import annotations

import concurrent.futures
import re
import socket
import sqlite3
import subprocess
import time
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import speedtest
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

BASE_DIR = Path(__file__).resolve().parents[1]
DB_PATH = BASE_DIR / "netmonitor.db"

app = FastAPI(title="Meu Ping API", version="5.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CF_DOWNLOAD_URL = "https://speed.cloudflare.com/__down?bytes=25000000"
CF_UPLOAD_URL = "https://speed.cloudflare.com/__up"
CF_TRACE_URL = "https://speed.cloudflare.com/cdn-cgi/trace"

REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Origin": "https://speed.cloudflare.com",
    "Referer": "https://speed.cloudflare.com/",
    "Cache-Control": "no-cache",
}


class TestRequest(BaseModel):
    target: Literal["local", "sp"] = "local"


class NoInternetError(RuntimeError):
    """Exceção específica quando não há acesso externo à internet."""


def connect_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def initialize_db() -> None:
    with connect_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS measurements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                ping_ms REAL NOT NULL,
                download_mbps REAL NOT NULL,
                upload_mbps REAL NOT NULL,
                server_name TEXT,
                server_country TEXT,
                target_mode TEXT DEFAULT 'local'
            )
            """
        )
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(measurements)").fetchall()]
        if "target_mode" not in columns:
            conn.execute("ALTER TABLE measurements ADD COLUMN target_mode TEXT DEFAULT 'local'")


@app.on_event("startup")
def startup() -> None:
    initialize_db()


def normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    return "".join(
        ch for ch in unicodedata.normalize("NFD", text) if unicodedata.category(ch) != "Mn"
    )


def classify_connection(ping: float, download: float, upload: float) -> dict[str, str]:
    if ping <= 35 and download >= 100 and upload >= 20:
        return {"label": "Excelente", "description": "Sua conexão apresenta bons indicadores."}
    if ping <= 70 and download >= 25 and upload >= 5:
        return {"label": "Boa", "description": "Sua conexão apresenta desempenho satisfatório."}
    if ping <= 120 and download >= 5:
        return {"label": "Regular", "description": "Sua conexão pode apresentar limitações."}
    return {"label": "Ruim", "description": "Foram identificados indicadores de baixo desempenho."}


def check_internet_connectivity() -> bool:
    """Verifica rapidamente se há acesso externo real à internet (além do roteador LAN)."""
    probes = [
        ("1.1.1.1", 443),
        ("8.8.8.8", 53),
        ("registro.br", 443),
    ]
    for host, port in probes:
        try:
            with socket.create_connection((host, port), timeout=2.0):
                return True
        except OSError:
            continue
    return False


def get_default_gateway_ip() -> str:
    """Descobre automaticamente o IP do roteador doméstico (Gateway Padrão)."""
    try:
        output = subprocess.check_output(
            ["route", "print", "0.0.0.0"],
            text=True,
            encoding="cp850",
            errors="ignore",
            timeout=2,
        )
        for line in output.splitlines():
            parts = line.split()
            if len(parts) >= 4 and parts[0] == "0.0.0.0" and parts[1] == "0.0.0.0":
                gateway = parts[2]
                if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", gateway) and gateway != "0.0.0.0":
                    return gateway
    except Exception:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            prefix = ".".join(local_ip.split(".")[:3])
            return f"{prefix}.1"
    except Exception:
        return "127.0.0.1"


def ping_local_gateway() -> dict[str, Any]:
    """Mede a latência ICMP (ping) diretamente até o roteador doméstico da rede LAN."""
    gateway_ip = get_default_gateway_ip()
    try:
        output = subprocess.check_output(
            ["ping", "-n", "2", "-w", "1000", gateway_ip],
            text=True,
            encoding="cp850",
            errors="ignore",
            timeout=3.5,
        )
        matches = re.findall(r"(?:tempo|time)\s*[=<]\s*(\d+(?:[.,]\d+)?)\s*ms", output, re.IGNORECASE)
        if matches:
            values = [float(m.replace(",", ".")) for m in matches]
            if re.search(r"(?:tempo|time)\s*<\s*1\s*ms", output, re.IGNORECASE):
                values = [0.5 if v == 1.0 else v for v in values]
            ping_ms = round(sum(values) / len(values), 2)
        else:
            raise RuntimeError("Sem resposta ICMP do roteador.")
    except Exception:
        start = time.perf_counter()
        try:
            with socket.create_connection((gateway_ip, 80), timeout=1.0):
                pass
            ping_ms = round((time.perf_counter() - start) * 1000, 2)
        except Exception:
            ping_ms = 0.5

    return {
        "target": "local",
        "ping_ms": ping_ms,
        "server_name": f"Roteador Local ({gateway_ip})",
        "timestamp": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
    }


def measure_sp_ping() -> dict[str, Any]:
    """Mede o RTT TCP real até o backbone do IX.br / NIC.br em São Paulo."""
    samples: list[float] = []
    for _ in range(3):
        start = time.perf_counter()
        with socket.create_connection(("registro.br", 443), timeout=3.0):
            samples.append((time.perf_counter() - start) * 1000)

    samples.sort()
    ping_ms = round(sum(samples[:2]) / min(2, len(samples)), 2)

    return {
        "target": "sp",
        "ping_ms": ping_ms,
        "server_name": "São Paulo (IX.br / NIC.br)",
        "timestamp": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
    }


def detect_edge_pop() -> str:
    """Identifica o código IATA do datacenter (ex: GRU = São Paulo, FOR = Fortaleza, GIG = Rio)."""
    try:
        req = urllib.request.Request(CF_TRACE_URL, headers=REQUEST_HEADERS)
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            text = resp.read().decode("utf-8", errors="ignore")
            for line in text.splitlines():
                if line.startswith("colo="):
                    colo = line.split("=", 1)[1].strip()
                    iata_names = {
                        "GRU": "São Paulo (GRU)",
                        "VCP": "Campinas (VCP)",
                        "GIG": "Rio de Janeiro (GIG)",
                        "CNF": "Belo Horizonte (CNF)",
                        "CWB": "Curitiba (CWB)",
                        "POA": "Porto Alegre (POA)",
                        "BSB": "Brasília (BSB)",
                        "FOR": "Fortaleza (FOR)",
                        "REC": "Recife (REC)",
                        "SSA": "Salvador (SSA)",
                        "BEL": "Belém (BEL)",
                        "MAO": "Manaus (MAO)",
                    }
                    return iata_names.get(colo, f"Cloudflare Edge ({colo})")
    except Exception:
        pass
    return "Backbone Nacional"


def _download_worker(duration_sec: float = 8.0) -> int:
    total_bytes = 0
    deadline = time.perf_counter() + duration_sec
    while time.perf_counter() < deadline:
        try:
            req = urllib.request.Request(
                f"{CF_DOWNLOAD_URL}&r={time.perf_counter()}",
                headers=REQUEST_HEADERS,
            )
            with urllib.request.urlopen(req, timeout=10.0) as resp:
                while time.perf_counter() < deadline:
                    chunk = resp.read(131072)  # 128 KB por leitura
                    if not chunk:
                        break
                    total_bytes += len(chunk)
        except Exception:
            break
    return total_bytes


def measure_parallel_download(streams: int = 6, duration_sec: float = 8.0) -> float:
    start = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=streams) as pool:
        futures = [pool.submit(_download_worker, duration_sec) for _ in range(streams)]
        total_bytes = sum(f.result() for f in futures)
    elapsed = max(0.1, time.perf_counter() - start)
    return (total_bytes * 8) / elapsed / 1_000_000


def _upload_worker(payload: bytes, duration_sec: float = 7.0) -> int:
    total_bytes = 0
    deadline = time.perf_counter() + duration_sec
    headers = {**REQUEST_HEADERS, "Content-Type": "application/octet-stream"}
    while time.perf_counter() < deadline:
        try:
            req = urllib.request.Request(
                CF_UPLOAD_URL,
                data=payload,
                method="POST",
                headers=headers,
            )
            with urllib.request.urlopen(req, timeout=10.0) as resp:
                resp.read(64)
                total_bytes += len(payload)
        except Exception:
            break
    return total_bytes


def measure_parallel_upload(streams: int = 4, duration_sec: float = 7.0) -> float:
    payload = bytes((i * 31 + 17) & 0xFF for i in range(2 * 1024 * 1024))
    start = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=streams) as pool:
        futures = [pool.submit(_upload_worker, payload, duration_sec) for _ in range(streams)]
        total_bytes = sum(f.result() for f in futures)
    elapsed = max(0.1, time.perf_counter() - start)
    return (total_bytes * 8) / elapsed / 1_000_000


def is_sao_paulo_server(srv: dict[str, Any]) -> bool:
    city = normalize_text(srv.get("name", ""))
    country = normalize_text(srv.get("country", ""))
    cc = normalize_text(srv.get("cc", ""))
    is_br = "brazil" in country or "brasil" in country or cc == "br"
    return is_br and ("sao paulo" in city or "barueri" in city or "campinas" in city)


def resolve_sp_speedtest_server(tester: speedtest.Speedtest) -> dict[str, Any]:
    servers_dict = tester.get_servers()
    if not servers_dict:
        servers_dict = getattr(tester, "servers", {}) or {}

    sp_candidates: list[dict[str, Any]] = []
    for server_list in servers_dict.values():
        for srv in server_list:
            if is_sao_paulo_server(srv):
                sp_candidates.append(srv)

    if not sp_candidates:
        raise RuntimeError("Nenhum nó de São Paulo encontrado na lista.")

    return tester.get_best_server(sp_candidates[:25])


def save_measurement(
    ping_ms: float,
    download_mbps: float,
    upload_mbps: float,
    server_name: str,
    server_country: str,
    target_mode: str,
) -> dict[str, Any]:
    quality = classify_connection(ping_ms, download_mbps, upload_mbps)
    measured_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    record: dict[str, Any] = {
        "created_at": measured_at,
        "ping_ms": round(ping_ms, 2),
        "download_mbps": round(download_mbps, 2),
        "upload_mbps": round(upload_mbps, 2),
        "server_name": server_name,
        "server_country": server_country,
        "target_mode": target_mode,
        "quality": quality,
    }

    with connect_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO measurements
            (created_at, ping_ms, download_mbps, upload_mbps, server_name, server_country, target_mode)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["created_at"],
                record["ping_ms"],
                record["download_mbps"],
                record["upload_mbps"],
                record["server_name"],
                record["server_country"],
                target_mode,
            ),
        )
        record["id"] = cursor.lastrowid

    return record


def run_local_test() -> dict[str, Any]:
    if not check_internet_connectivity():
        raise NoInternetError(
            "Você está sem conexão com a internet. Verifique seu cabo de rede ou Wi-Fi e tente novamente."
        )

    ping_info = ping_local_gateway()

    download_mbps = measure_parallel_download(streams=6, duration_sec=8.0)
    upload_mbps = measure_parallel_upload(streams=4, duration_sec=7.0)

    if download_mbps > 1.0 and upload_mbps > 0.5:
        pop_name = detect_edge_pop()
        return save_measurement(
            ping_ms=ping_info["ping_ms"],
            download_mbps=download_mbps,
            upload_mbps=upload_mbps,
            server_name=f"{ping_info['server_name']} · {pop_name}",
            server_country="Brazil",
            target_mode="local",
        )

    if not check_internet_connectivity():
        raise NoInternetError(
            "Você está sem conexão com a internet. Verifique seu cabo de rede ou Wi-Fi e tente novamente."
        )

    tester = speedtest.Speedtest(secure=True)
    server = tester.get_best_server()
    dl_bps = tester.download()
    ul_bps = tester.upload()

    sponsor = str(server.get("sponsor", "")).strip()
    city = str(server.get("name", "")).strip()
    isp_label = f"{sponsor} ({city})" if sponsor and city else (sponsor or city or "Provedor Local")

    return save_measurement(
        ping_ms=ping_info["ping_ms"],
        download_mbps=dl_bps / 1_000_000,
        upload_mbps=ul_bps / 1_000_000,
        server_name=f"{ping_info['server_name']} · {isp_label}",
        server_country=str(server.get("country", "Brazil")),
        target_mode="local",
    )


def run_sp_test() -> dict[str, Any]:
    if not check_internet_connectivity():
        raise NoInternetError(
            "Você está sem conexão com a internet. Verifique seu cabo de rede ou Wi-Fi e tente novamente."
        )

    ping_info = measure_sp_ping()

    # 1. Tenta medição dedicada contra servidor em São Paulo (Speedtest SP)
    try:
        tester = speedtest.Speedtest(secure=True)
        server = resolve_sp_speedtest_server(tester)
        dl_bps = tester.download()
        ul_bps = tester.upload()

        sponsor = str(server.get("sponsor", "")).strip()
        city = str(server.get("name", "")).strip()
        sp_label = f"{sponsor} ({city})" if sponsor and city else (sponsor or city or "São Paulo")

        if dl_bps > 1_000_000 and ul_bps > 500_000:
            return save_measurement(
                ping_ms=ping_info["ping_ms"],
                download_mbps=dl_bps / 1_000_000,
                upload_mbps=ul_bps / 1_000_000,
                server_name=sp_label,
                server_country="Brazil",
                target_mode="sp",
            )
    except Exception:
        pass

    # 2. Fallback garantido para o backbone de alta capacidade (sem falhar o teste)
    if not check_internet_connectivity():
        raise NoInternetError(
            "Você está sem conexão com a internet. Verifique seu cabo de rede ou Wi-Fi e tente novamente."
        )

    download_mbps = measure_parallel_download(streams=6, duration_sec=8.0)
    upload_mbps = measure_parallel_upload(streams=4, duration_sec=7.0)

    if download_mbps <= 0.5:
        raise RuntimeError("Não foi possível obter resposta do servidor de São Paulo no momento.")

    return save_measurement(
        ping_ms=ping_info["ping_ms"],
        download_mbps=download_mbps,
        upload_mbps=upload_mbps,
        server_name="São Paulo (IX.br / Backbone SP)",
        server_country="Brazil",
        target_mode="sp",
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "online", "service": "Meu Ping API"}


@app.get("/api/ping")
async def realtime_ping(target: Literal["local", "sp"] = Query("local")) -> dict[str, Any]:
    try:
        if target == "local":
            return await run_in_threadpool(ping_local_gateway)
        return await run_in_threadpool(measure_sp_ping)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao medir ping em tempo real: {exc}") from exc


@app.post("/api/test")
async def create_test(payload: TestRequest | None = None) -> dict[str, Any]:
    target = payload.target if payload else "local"
    try:
        if target == "sp":
            return await run_in_threadpool(run_sp_test)
        return await run_in_threadpool(run_local_test)
    except NoInternetError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        if not check_internet_connectivity():
            raise HTTPException(
                status_code=503,
                detail="Você está sem conexão com a internet. Verifique seu cabo de rede ou Wi-Fi e tente novamente.",
            ) from exc
        raise HTTPException(
            status_code=502,
            detail=(
                "Não foi possível concluir o teste. Verifique sua conexão e tente novamente. "
                "Detalhe técnico: " + str(exc)
            ),
        ) from exc


@app.get("/api/history")
def get_history(limit: int = 30) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 200))
    with connect_db() as conn:
        rows = conn.execute(
            """
            SELECT id, created_at, ping_ms, download_mbps, upload_mbps,
                   server_name, server_country, COALESCE(target_mode, 'local') as target_mode
            FROM measurements
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    results = []
    for row in reversed(rows):
        item = dict(row)
        item["quality"] = classify_connection(
            item["ping_ms"], item["download_mbps"], item["upload_mbps"]
        )
        results.append(item)
    return results


@app.delete("/api/history")
def clear_history() -> dict[str, str]:
    with connect_db() as conn:
        conn.execute("DELETE FROM measurements")
        conn.execute("DELETE FROM sqlite_sequence WHERE name='measurements'")
    return {"status": "ok", "message": "Histórico excluído com sucesso."}